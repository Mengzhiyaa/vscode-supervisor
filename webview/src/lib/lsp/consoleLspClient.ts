import { CancellationTokenSource, type MessageConnection } from 'vscode-jsonrpc/browser';
import type * as Lsp from 'vscode-languageserver-protocol';
import type { ConsoleLspConfiguration } from '@shared/lspTunnel';
import { monaco } from '$lib/monaco/setup';
import { completion, hoverContents, languageSelector, lspRange, marker, markdown, position, range, type LspCompletion } from './conversions';
import { requestWithDeadline } from './rpcLspTransport';

type Registration = { id: string; method: string; registerOptions?: Record<string, unknown> };
interface ConsoleCodeAction extends monaco.languages.CodeAction {
    lspAction?: Lsp.CodeAction;
    version?: number;
}

const capabilityMethods: Record<string, string> = {
    completionProvider: 'textDocument/completion', hoverProvider: 'textDocument/hover',
    signatureHelpProvider: 'textDocument/signatureHelp', definitionProvider: 'textDocument/definition',
    declarationProvider: 'textDocument/declaration', typeDefinitionProvider: 'textDocument/typeDefinition',
    implementationProvider: 'textDocument/implementation', referencesProvider: 'textDocument/references',
    renameProvider: 'textDocument/rename', codeActionProvider: 'textDocument/codeAction',
    documentFormattingProvider: 'textDocument/formatting', documentRangeFormattingProvider: 'textDocument/rangeFormatting',
    documentHighlightProvider: 'textDocument/documentHighlight', documentSymbolProvider: 'textDocument/documentSymbol',
    semanticTokensProvider: 'textDocument/semanticTokens', diagnosticProvider: 'textDocument/diagnostic',
};

/** Console-scoped adapter using public Monaco APIs and standard JSON-RPC only.
 * It deliberately avoids 0.57's global synchronizer and non-disposable native client.
 */
export class ConsoleLspClient {
    readonly ready: Promise<void>;
    private readonly uri: string;
    private readonly markerOwner: string;
    private readonly registrations = new Map<string, Registration>();
    private readonly disposables: monaco.IDisposable[] = [];
    private providers: monaco.IDisposable[] = [];
    private readonly requests = new Set<CancellationTokenSource>();
    private readonly initialization = new CancellationTokenSource();
    private notifications: Promise<void> = Promise.resolve();
    private initialized = false;
    private opened = false;
    private syncActive = false;
    private disposed = false;
    private capabilities: Lsp.ServerCapabilities = {};
    private diagnosticTimer: ReturnType<typeof setTimeout> | undefined;
    private diagnosticResultId: string | undefined;
    private diagnosticSerial = 0;
    private diagnostics: Lsp.Diagnostic[] = [];
    private readonly commandId: string;

    constructor(
        private readonly connection: MessageConnection,
        private readonly model: monaco.editor.ITextModel,
        private readonly configuration: ConsoleLspConfiguration,
        clientKey: string,
        private readonly fallback: (at: monaco.Position, token: monaco.CancellationToken) => Promise<monaco.languages.CompletionItem[]>,
    ) {
        this.uri = model.uri.toString(true);
        this.markerOwner = `supervisor-lsp:${clientKey}`;
        this.commandId = `supervisor.consoleLsp.${clientKey}`;
        this.disposables.push(
            monaco.editor.registerCommand(this.commandId, (_accessor: unknown, command: string, args: unknown[]) => {
                if (!this.allowedCommand(command)) { return; }
                const source = new CancellationTokenSource();
                void this.request('workspace/executeCommand', { command, arguments: args }, source.token)
                    .finally(() => source.dispose());
            }),
            connection.onRequest('workspace/applyEdit', (params: Lsp.ApplyWorkspaceEditParams) => this.applyEdit(params.edit)),
            connection.onRequest('client/registerCapability', (params: Lsp.RegistrationParams) => {
                for (const registration of params.registrations) {
                    this.registrations.set(`dynamic:${registration.id}`, registration as Registration);
                }
                if (this.initialized) { this.refreshProviders(); this.syncOpen(); }
                return null;
            }),
            connection.onRequest('client/unregisterCapability', (params: Lsp.UnregistrationParams) => {
                for (const registration of params.unregisterations) { this.registrations.delete(`dynamic:${registration.id}`); }
                if (this.initialized) { this.refreshProviders(); this.syncOpen(); }
                return null;
            }),
            connection.onNotification('textDocument/publishDiagnostics', (params: Lsp.PublishDiagnosticsParams) => {
                if (this.disposed || params.uri !== this.uri ||
                    (params.version !== undefined && params.version !== this.model.getVersionId())) { return; }
                this.diagnostics = params.diagnostics;
                monaco.editor.setModelMarkers(model, this.markerOwner, params.diagnostics.map(marker));
            }),
            connection.onRequest('workspace/diagnostic/refresh', () => { this.scheduleDiagnostics(); return null; }),
            connection.onNotification('workspace/diagnostic/refresh', () => this.scheduleDiagnostics()),
            connection.onNotification('workspace/semanticTokens/refresh', () => this.refreshProviders()),
            connection.onNotification('client/registerCapability', (params: Lsp.RegistrationParams) => {
                for (const registration of params.registrations) {
                    this.registrations.set(`dynamic:${registration.id}`, registration as Registration);
                }
                if (this.initialized) { this.refreshProviders(); this.syncOpen(); }
            }),
            connection.onNotification('client/unregisterCapability', (params: Lsp.UnregistrationParams) => {
                for (const registration of params.unregisterations) { this.registrations.delete(`dynamic:${registration.id}`); }
                if (this.initialized) { this.refreshProviders(); this.syncOpen(); }
            }),
            model.onDidChangeContent(event => {
                if (!this.syncActive || this.disposed) { return; }
                const syncKind = this.syncKind();
                if (syncKind !== 0) {
                    this.notify('textDocument/didChange', {
                        textDocument: { uri: this.uri, version: model.getVersionId() },
                        contentChanges: syncKind === 1 ? [{ text: model.getValue() }]
                            : event.changes.map(change => ({ range: lspRange(change.range), text: change.text })),
                    });
                }
                // Diagnostics for a previous buffer must not survive into this one.
                this.diagnostics = [];
                this.diagnosticResultId = undefined;
                monaco.editor.setModelMarkers(model, this.markerOwner, []);
                this.scheduleDiagnostics();
            }),
            model.onWillDispose(() => this.dispose()),
        );
        connection.listen();
        this.ready = this.initialize();
    }

    private async initialize(): Promise<void> {
        const timeout = setTimeout(() => this.initialization.cancel(), 15_000);
        try {
            // A logical handshake obtains the capabilities of the initialized Host client.
            const result = await requestWithDeadline<Lsp.InitializeResult>(this.connection, 'initialize', {
                capabilities: {},
            }, 15_000, this.initialization.token);
            if (this.disposed || this.initialization.token.isCancellationRequested) { throw new Error('Console LSP initialization cancelled'); }
            if (result.capabilities.positionEncoding && result.capabilities.positionEncoding !== 'utf-16') {
                throw new Error('Console LSP requires UTF-16 positions');
            }
            this.capabilities = result.capabilities;
            for (const [name, option] of Object.entries(result.capabilities)) {
                const method = capabilityMethods[name];
                if (method && option) {
                    this.registrations.set(`static:${method}`, { id: `static:${method}`, method,
                        registerOptions: typeof option === 'object' ? option as Record<string, unknown> : {} });
                }
            }
            await this.connection.sendNotification('initialized', {});
            if (this.disposed || this.initialization.token.isCancellationRequested) {
                throw new Error('Console LSP initialization cancelled');
            }
            this.initialized = true;
            this.refreshProviders();
            this.syncOpen();
            await this.notifications;
            if (this.disposed) { throw new Error('Console LSP initialization cancelled'); }
            this.scheduleDiagnostics();
        } finally {
            clearTimeout(timeout);
            this.initialization.dispose();
        }
    }

    private options(method: string): Record<string, unknown> | undefined {
        if (this.disposed || this.model.isDisposed()) { return undefined; }
        for (const registration of [...this.registrations.values()].reverse()) {
            if (registration.method !== method) { continue; }
            const options = registration.registerOptions ?? {};
            const selector = options.documentSelector as Lsp.DocumentSelector | null | undefined;
            const filters = languageSelector(selector);
            if (monaco.languages.score(filters, this.model.uri, this.model.getLanguageId()) > 0) { return options; }
        }
        return undefined;
    }

    private syncKind(): number {
        const dynamic = this.options('textDocument/didChange');
        if (dynamic) { return Number(dynamic.syncKind ?? 0); }
        const sync = this.capabilities.textDocumentSync;
        return typeof sync === 'number' ? sync : sync?.change ?? 0;
    }

    private syncOpen(): void {
        if (this.disposed || this.model.isDisposed()) { return; }
        const sync = this.capabilities.textDocumentSync;
        const enabled = typeof sync === 'number' ? sync !== 0 : Boolean(sync?.openClose);
        const shouldOpen = enabled || Boolean(this.options('textDocument/didOpen'));
        this.syncActive = shouldOpen || this.syncKind() !== 0;
        if (shouldOpen && !this.opened) {
            this.opened = true;
            this.notify('textDocument/didOpen', { textDocument: {
                uri: this.uri, languageId: this.model.getLanguageId(), version: this.model.getVersionId(), text: this.model.getValue(),
            } });
        } else if (!shouldOpen && this.opened) {
            this.opened = false;
            this.notify('textDocument/didClose', { textDocument: { uri: this.uri } });
        }
    }

    private notify(method: string, params: unknown): void {
        this.notifications = this.notifications.then(() => this.connection.sendNotification(method, params));
        // Keep the rejected promise for request callers, and handle it for notification-only traffic.
        void this.notifications.catch(() => this.dispose());
    }

    private owns(model: monaco.editor.ITextModel): boolean {
        return !this.disposed && !model.isDisposed() && model === this.model && model.uri.toString(true) === this.uri;
    }

    private async request<T>(method: string, params: unknown, token: monaco.CancellationToken,
        isCurrent?: () => boolean): Promise<T | null> {
        const version = this.model.getVersionId();
        const current = isCurrent ?? (() => version === this.model.getVersionId());
        const source = new CancellationTokenSource();
        this.requests.add(source);
        const cancellation = token.onCancellationRequested(() => source.cancel());
        if (token.isCancellationRequested) { source.cancel(); }
        const timeout = setTimeout(() => source.cancel(), 15_000);
        try {
            await this.ready;
            await this.notifications;
            if (this.disposed || this.model.isDisposed() || source.token.isCancellationRequested || !current()) { return null; }
            const value = await requestWithDeadline<T>(this.connection, method, params, 15_000, source.token);
            return this.disposed || source.token.isCancellationRequested || this.model.isDisposed() ||
                !current() ? null : value;
        } catch (error) {
            if (!source.token.isCancellationRequested && !this.disposed) { console.debug(`[ConsoleLsp] ${method} failed`, error); }
            return null;
        } finally {
            clearTimeout(timeout); cancellation.dispose(); source.dispose(); this.requests.delete(source);
        }
    }

    private at(at: monaco.Position): Lsp.TextDocumentPositionParams {
        return { textDocument: { uri: this.uri }, position: position(at) };
    }

    private allowedCommand(command: string): boolean {
        return !this.disposed && Boolean(this.configuration.allowedCommands?.includes(command)) &&
            Boolean(this.capabilities.executeCommandProvider?.commands.includes(command));
    }

    private command(command?: Lsp.Command): monaco.languages.Command | undefined {
        return command && this.allowedCommand(command.command)
            ? { id: this.commandId, title: command.title, arguments: [command.command, command.arguments ?? []] }
            : undefined;
    }

    private refreshProviders(): void {
        if (this.disposed || this.model.isDisposed()) { return; }
        for (const provider of this.providers) { provider.dispose(); }
        this.providers = [];
        const selector = { language: this.model.getLanguageId(), scheme: this.model.uri.scheme };
        const supports = (method: string, model: monaco.editor.ITextModel) => this.owns(model) && Boolean(this.options(method));
        const add = (provider: monaco.IDisposable) => this.providers.push(provider);
        const complete = this.options('textDocument/completion');
        // A session-scoped fallback remains useful even when its server has no completion capability.
        if (complete || this.configuration.kernelCompletionFallback !== false) {
            add(monaco.languages.registerCompletionItemProvider(selector, {
                triggerCharacters: complete?.triggerCharacters as string[] | undefined,
                provideCompletionItems: async (model, at, context, token) => {
                    if (!this.owns(model)) { return null; }
                    const version = model.getVersionId();
                    const languageId = model.getLanguageId();
                    const offset = model.getOffsetAt(at);
                    const text = model.getValue();
                    const before = text.slice(0, offset);
                    const after = text.slice(offset);
                    const word = model.getWordUntilPosition(at);
                    const fullWord = model.getWordAtPosition(at) ?? word;
                    const defaultRange = new monaco.Range(at.lineNumber, word.startColumn, at.lineNumber, word.endColumn);
                    const withinWord = (editRange: Lsp.Range) => editRange.start.line === at.lineNumber - 1 &&
                        editRange.end.line === at.lineNumber - 1 && editRange.start.character >= word.startColumn - 1 &&
                        editRange.start.character <= at.column - 1 && editRange.end.character >= at.column - 1 &&
                        editRange.end.character <= fullWord.endColumn - 1;
                    const isCurrent = () => {
                        if (!this.owns(model) || model.getLanguageId() !== languageId) { return false; }
                        if (model.getVersionId() === version) { return true; }
                        const value = model.getValue();
                        if (value.length < text.length || !value.startsWith(before) || !value.endsWith(after)) { return false; }
                        // Monaco can filter an in-flight result as the same word grows.
                        // Any change outside that word still invalidates the request.
                        const end = model.getPositionAt(offset + value.length - text.length);
                        const currentWord = model.getWordUntilPosition(end);
                        return end.lineNumber === at.lineNumber && currentWord.startColumn === word.startColumn &&
                            currentWord.endColumn === end.column;
                    };
                    const result = complete ? await this.request<Lsp.CompletionItem[] | Lsp.CompletionList>(
                        'textDocument/completion', { ...this.at(at), context: {
                            triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter,
                        } }, token, isCurrent) : null;
                    if (token.isCancellationRequested || !isCurrent()) { return null; }
                    const items = Array.isArray(result) ? result : result?.items ?? [];
                    const changed = version !== model.getVersionId();
                    // Only edits within the original word can be reused against a newer buffer.
                    // Extra edits stay version-bound, and server commands are omitted below.
                    const reusableItems = changed ? items.filter(item => {
                        if (item.additionalTextEdits?.length) { return false; }
                        const edit = item.textEdit;
                        return !edit || ('range' in edit ? withinWord(edit.range) : withinWord(edit.insert) && withinWord(edit.replace));
                    }) : items;
                    const suggestions: monaco.languages.CompletionItem[] = reusableItems.map(item => {
                        const converted = completion(item, model, at);
                        return { ...converted, version, range: item.textEdit ? converted.range : defaultRange,
                            command: changed ? undefined : this.command(item.command),
                            commitCharacters: item.commitCharacters ?? complete?.allCommitCharacters as string[] | undefined };
                    });
                    if (suggestions.length === 0 && this.configuration.kernelCompletionFallback !== false) {
                        suggestions.push(...await this.fallback(at, token));
                    }
                    if (token.isCancellationRequested || !isCurrent()) { return null; }
                    return { suggestions, incomplete: !Array.isArray(result) && Boolean(result?.isIncomplete) };
                },
                resolveCompletionItem: complete?.resolveProvider ? async (item, token) => {
                    const original = item as LspCompletion;
                    if (!original.lspItem || original.version !== this.model.getVersionId()) { return item; }
                    const resolved = await this.request<Lsp.CompletionItem>('completionItem/resolve', original.lspItem, token);
                    if (!resolved) { return item; }
                    // Keep the selected item's original insertion range when resolve only adds documentation.
                    const insertion = 'insert' in original.range ? original.range.insert : original.range;
                    return { ...completion({ ...original.lspItem, ...resolved }, this.model,
                        new monaco.Position(insertion.endLineNumber, insertion.endColumn)),
                        range: original.range, commitCharacters: resolved.commitCharacters ?? original.commitCharacters,
                        command: this.command(resolved.command ?? original.lspItem.command) };
                } : undefined,
            }));
        }
        if (this.options('textDocument/hover')) {
            add(monaco.languages.registerHoverProvider(selector, {
                provideHover: async (model, at, token) => {
                    if (!supports('textDocument/hover', model)) { return null; }
                    const value = await this.request<Lsp.Hover>('textDocument/hover', this.at(at), token);
                    return value ? { contents: hoverContents(value.contents), range: value.range ? range(value.range) : undefined } : null;
                },
            }));
        }
        const signature = this.options('textDocument/signatureHelp');
        if (signature) {
            add(monaco.languages.registerSignatureHelpProvider(selector, {
                signatureHelpTriggerCharacters: signature.triggerCharacters as string[] | undefined,
                signatureHelpRetriggerCharacters: signature.retriggerCharacters as string[] | undefined,
                provideSignatureHelp: async (model, at, token, context) => {
                    if (!supports('textDocument/signatureHelp', model)) { return null; }
                    const value = await this.request<Lsp.SignatureHelp>('textDocument/signatureHelp', {
                        ...this.at(at), context: { triggerKind: context.triggerKind,
                            triggerCharacter: context.triggerCharacter, isRetrigger: context.isRetrigger },
                    }, token);
                    return value ? { value: {
                        signatures: value.signatures.map(signature => ({ ...signature,
                            // Monaco uses a numeric index; -1 leaves every parameter unhighlighted.
                            activeParameter: signature.activeParameter === null ? -1 : signature.activeParameter,
                            documentation: signature.documentation ? markdown(signature.documentation) : undefined,
                            parameters: signature.parameters?.map(parameter => ({ ...parameter,
                                documentation: parameter.documentation ? markdown(parameter.documentation) : undefined })) ?? [],
                        })), activeSignature: value.activeSignature ?? 0,
                        activeParameter: value.activeParameter === null ? -1 : value.activeParameter ?? 0,
                    }, dispose() {} } : null;
                },
            }));
        }
        for (const method of ['definition', 'declaration', 'typeDefinition', 'implementation'] as const) {
            const lspMethod = `textDocument/${method}`;
            if (!this.options(lspMethod)) { continue; }
            const provide = async (model: monaco.editor.ITextModel, at: monaco.Position, token: monaco.CancellationToken) => {
                if (!supports(lspMethod, model)) { return null; }
                const value = await this.request<Lsp.Location | Lsp.Location[] | Lsp.LocationLink[]>(lspMethod, this.at(at), token);
                return value ? (Array.isArray(value) ? value : [value]).map(location => 'targetUri' in location
                    ? { uri: monaco.Uri.parse(location.targetUri), range: range(location.targetRange),
                        targetSelectionRange: range(location.targetSelectionRange),
                        originSelectionRange: location.originSelectionRange ? range(location.originSelectionRange) : undefined }
                    : { uri: monaco.Uri.parse(location.uri), range: range(location.range) }) : null;
            };
            if (method === 'definition') { add(monaco.languages.registerDefinitionProvider(selector, { provideDefinition: provide })); }
            if (method === 'declaration') { add(monaco.languages.registerDeclarationProvider(selector, { provideDeclaration: provide })); }
            if (method === 'typeDefinition') { add(monaco.languages.registerTypeDefinitionProvider(selector, { provideTypeDefinition: provide })); }
            if (method === 'implementation') { add(monaco.languages.registerImplementationProvider(selector, { provideImplementation: provide })); }
        }
        if (this.options('textDocument/references')) {
            add(monaco.languages.registerReferenceProvider(selector, {
                provideReferences: async (model, at, context, token) => {
                    if (!supports('textDocument/references', model)) { return null; }
                    const value = await this.request<Lsp.Location[]>('textDocument/references', { ...this.at(at), context }, token);
                    return value?.map(location => ({ uri: monaco.Uri.parse(location.uri), range: range(location.range) }));
                },
            }));
        }
        if (this.options('textDocument/documentHighlight')) {
            add(monaco.languages.registerDocumentHighlightProvider(selector, {
                provideDocumentHighlights: async (model, at, token) => {
                    if (!supports('textDocument/documentHighlight', model)) { return null; }
                    const value = await this.request<Lsp.DocumentHighlight[]>('textDocument/documentHighlight', this.at(at), token);
                    return value?.map(highlight => ({ range: range(highlight.range),
                        kind: highlight.kind === undefined ? undefined : highlight.kind - 1 }));
                },
            }));
        }
        this.registerEditingProviders(selector, supports, add);
        this.registerSymbolProviders(selector, supports, add);
        this.scheduleDiagnostics();
    }

    private registerEditingProviders(
        selector: monaco.languages.LanguageSelector,
        supports: (method: string, model: monaco.editor.ITextModel) => boolean,
        add: (provider: monaco.IDisposable) => void,
    ): void {
        for (const method of ['formatting', 'rangeFormatting'] as const) {
            const lspMethod = `textDocument/${method}`;
            if (!this.options(lspMethod)) { continue; }
            const provide = async (model: monaco.editor.ITextModel, selection: monaco.Range | undefined,
                options: monaco.languages.FormattingOptions, token: monaco.CancellationToken) => {
                if (!supports(lspMethod, model)) { return null; }
                const result = await this.request<Lsp.TextEdit[]>(lspMethod, { textDocument: { uri: this.uri }, options,
                    ...(selection ? { range: lspRange(selection) } : {}) }, token);
                return result?.map(edit => ({ range: range(edit.range), text: edit.newText }));
            };
            if (method === 'formatting') {
                add(monaco.languages.registerDocumentFormattingEditProvider(selector, {
                    provideDocumentFormattingEdits: (model, options, token) => provide(model, undefined, options, token),
                }));
            } else {
                add(monaco.languages.registerDocumentRangeFormattingEditProvider(selector, {
                    provideDocumentRangeFormattingEdits: (model, selection, options, token) => provide(model, selection, options, token),
                }));
            }
        }
        const rename = this.options('textDocument/rename');
        if (rename) {
            add(monaco.languages.registerRenameProvider(selector, {
                provideRenameEdits: async (model, at, newName, token) => {
                    if (!supports('textDocument/rename', model)) { return null; }
                    const edit = await this.request<Lsp.WorkspaceEdit>('textDocument/rename', { ...this.at(at), newName }, token);
                    return edit ? this.workspaceEdit(edit) : null;
                },
                resolveRenameLocation: rename.prepareProvider ? async (model, at, token) => {
                    if (!supports('textDocument/rename', model)) { return null; }
                    const value = await this.request<Lsp.Range | { range: Lsp.Range; placeholder: string } | { defaultBehavior: boolean }>(
                        'textDocument/prepareRename', this.at(at), token);
                    if (!value) { return null; }
                    if ('start' in value) { return { range: range(value), text: model.getValueInRange(range(value)) }; }
                    if ('range' in value) { return { range: range(value.range), text: value.placeholder }; }
                    const word = model.getWordAtPosition(at);
                    return value.defaultBehavior && word ? { range: new monaco.Range(at.lineNumber, word.startColumn, at.lineNumber, word.endColumn), text: word.word } : null;
                } : undefined,
            }));
        }
        const codeActions = this.options('textDocument/codeAction');
        if (codeActions) {
            add(monaco.languages.registerCodeActionProvider(selector, {
                provideCodeActions: async (model, selection, context, token) => {
                    if (!supports('textDocument/codeAction', model)) { return null; }
                    const value = await this.request<(Lsp.CodeAction | Lsp.Command)[]>('textDocument/codeAction', {
                        textDocument: { uri: this.uri }, range: lspRange(selection),
                        context: { diagnostics: this.diagnostics, only: context.only ? [context.only] : undefined,
                            triggerKind: context.trigger === monaco.languages.CodeActionTriggerType.Auto ? 2 : 1 },
                    }, token);
                    const actions: ConsoleCodeAction[] = [];
                    for (const action of value ?? []) {
                        if (typeof action.command === 'string') {
                            const command = this.command(action as Lsp.Command);
                            if (command) { actions.push({ title: action.title, command }); }
                            continue;
                        }
                        const codeAction = action as Lsp.CodeAction;
                        const command = this.command(codeAction.command);
                        if (codeAction.command && !command) { continue; }
                        const edit = codeAction.edit ? this.workspaceEdit(codeAction.edit) : undefined;
                        if ((edit || command || codeActions.resolveProvider) && !edit?.rejectReason) { actions.push({
                            title: codeAction.title, kind: codeAction.kind, edit, command,
                            isPreferred: codeAction.isPreferred, disabled: codeAction.disabled?.reason,
                            lspAction: codeAction, version: model.getVersionId(),
                        }); }
                    }
                    return { actions, dispose() {} };
                },
                resolveCodeAction: codeActions.resolveProvider ? async (action, token) => {
                    const original = action as ConsoleCodeAction;
                    if (!original.lspAction || original.version !== this.model.getVersionId()) { return action; }
                    const resolved = await this.request<Lsp.CodeAction>('codeAction/resolve', original.lspAction, token);
                    if (!resolved) { return action; }
                    const edit = resolved.edit ? this.workspaceEdit(resolved.edit) : undefined;
                    const command = this.command(resolved.command);
                    if (edit?.rejectReason || (resolved.command && !command)) { return action; }
                    return { ...action, edit, command, disabled: resolved.disabled?.reason };
                } : undefined,
            }));
        }
    }

    private registerSymbolProviders(
        selector: monaco.languages.LanguageSelector,
        supports: (method: string, model: monaco.editor.ITextModel) => boolean,
        add: (provider: monaco.IDisposable) => void,
    ): void {
        if (this.options('textDocument/documentSymbol')) {
            const convert = (symbol: Lsp.DocumentSymbol): monaco.languages.DocumentSymbol => ({
                name: symbol.name, detail: symbol.detail ?? '', kind: symbol.kind - 1,
                tags: symbol.tags ?? [], range: range(symbol.range), selectionRange: range(symbol.selectionRange),
                children: symbol.children?.map(convert),
            });
            add(monaco.languages.registerDocumentSymbolProvider(selector, {
                provideDocumentSymbols: async (model, token) => {
                    if (!supports('textDocument/documentSymbol', model)) { return null; }
                    const value = await this.request<Lsp.DocumentSymbol[] | Lsp.SymbolInformation[]>('textDocument/documentSymbol',
                        { textDocument: { uri: this.uri } }, token);
                    return value?.filter(symbol => !('location' in symbol) || symbol.location.uri === this.uri)
                        .map(symbol => 'location' in symbol ? { name: symbol.name, detail: '', kind: symbol.kind - 1,
                            tags: symbol.tags ?? [], range: range(symbol.location.range), selectionRange: range(symbol.location.range),
                            containerName: symbol.containerName } : convert(symbol));
                },
            }));
        }
        const semantic = this.options('textDocument/semanticTokens');
        if (semantic?.legend && semantic.full) {
            add(monaco.languages.registerDocumentSemanticTokensProvider(selector, {
                getLegend: () => semantic.legend as Lsp.SemanticTokensLegend,
                releaseDocumentSemanticTokens() {},
                provideDocumentSemanticTokens: async (model, previousResultId, token) => {
                    if (!supports('textDocument/semanticTokens', model)) { return null; }
                    const delta = previousResultId && typeof semantic.full === 'object' &&
                        (semantic.full as { delta?: boolean }).delta;
                    const result = await this.request<Lsp.SemanticTokens | Lsp.SemanticTokensDelta>(
                        delta ? 'textDocument/semanticTokens/full/delta' : 'textDocument/semanticTokens/full',
                        { textDocument: { uri: this.uri }, ...(delta ? { previousResultId } : {}) }, token);
                    if (!result) { return null; }
                    return 'data' in result ? { resultId: result.resultId, data: new Uint32Array(result.data) }
                        : { resultId: result.resultId, edits: result.edits.map(edit => ({ ...edit,
                            data: edit.data ? new Uint32Array(edit.data) : undefined })) };
                },
            }));
        }
    }

    private workspaceEdit(edit: Lsp.WorkspaceEdit): monaco.languages.WorkspaceEdit & { rejectReason?: string } {
        const entries: { uri: string; version?: number | null; edits: Lsp.TextDocumentEdit['edits'] }[] = [];
        for (const [uri, edits] of Object.entries(edit.changes ?? {})) { entries.push({ uri, edits }); }
        for (const change of edit.documentChanges ?? []) {
            if (!('textDocument' in change)) { return { edits: [], rejectReason: 'Console LSP cannot create, rename, or delete files' }; }
            entries.push({ uri: change.textDocument.uri, version: change.textDocument.version, edits: change.edits });
        }
        if (entries.some(entry => entry.uri !== this.uri ||
            (entry.version != null && entry.version !== this.model.getVersionId()))) {
            return { edits: [], rejectReason: 'Console LSP edit targets another document or an obsolete version' };
        }
        const edits: monaco.languages.IWorkspaceTextEdit[] = [];
        for (const entry of entries) {
            for (const edit of entry.edits) {
                // Snippet edits are not advertised: pushEditOperations cannot expand snippets.
                // Reject the entire WorkspaceEdit so supported edits are never partially applied.
                if (!('newText' in edit)) { return { edits: [], rejectReason: 'Console LSP cannot apply snippet workspace edits' }; }
                edits.push({ resource: this.model.uri, versionId: this.model.getVersionId(),
                    textEdit: { range: range(edit.range), text: edit.newText } });
            }
        }
        return { edits };
    }

    private applyEdit(edit: Lsp.WorkspaceEdit): Lsp.ApplyWorkspaceEditResult {
        if (!this.owns(this.model)) { return { applied: false, failureReason: 'Console document is closed' }; }
        const converted = this.workspaceEdit(edit);
        if (converted.rejectReason) { return { applied: false, failureReason: converted.rejectReason }; }
        try {
            this.model.pushEditOperations([], converted.edits.map(edit => {
                if (!('textEdit' in edit)) { throw new Error('Unsupported Console edit'); }
                return { range: range(lspRange(edit.textEdit.range)), text: edit.textEdit.text };
            }), () => null);
            return { applied: true };
        } catch (error) { return { applied: false, failureReason: String(error) }; }
    }

    private scheduleDiagnostics(): void {
        if (this.diagnosticTimer) { clearTimeout(this.diagnosticTimer); }
        const serial = ++this.diagnosticSerial;
        if (!this.initialized || !this.options('textDocument/diagnostic')) { return; }
        this.diagnosticTimer = setTimeout(() => {
            this.diagnosticTimer = undefined;
            const source = new CancellationTokenSource();
            void this.request<Lsp.DocumentDiagnosticReport>('textDocument/diagnostic', {
                textDocument: { uri: this.uri }, identifier: this.options('textDocument/diagnostic')?.identifier,
                previousResultId: this.diagnosticResultId,
            }, source.token).then(result => {
                if (!result || this.disposed || serial !== this.diagnosticSerial) { return; }
                this.diagnosticResultId = result.resultId;
                if (result.kind === 'full') {
                    this.diagnostics = result.items;
                    monaco.editor.setModelMarkers(this.model, this.markerOwner, result.items.map(marker));
                }
            }).finally(() => source.dispose());
        }, 250);
    }

    /** Remove Console resources without stopping the shared Host language server. */
    dispose(): void {
        if (this.disposed) { return; }
        this.disposed = true;
        this.initialization.cancel();
        for (const request of this.requests) { request.cancel(); }
        for (const provider of this.providers) { provider.dispose(); }
        this.providers = [];
        for (const disposable of this.disposables) { disposable.dispose(); }
        if (this.diagnosticTimer) { clearTimeout(this.diagnosticTimer); }
        if (!this.model.isDisposed()) { monaco.editor.setModelMarkers(this.model, this.markerOwner, []); }
    }

    async stop(): Promise<void> {
        this.dispose();
        if (!this.initialized) { return; }
        try {
            await this.notifications.catch(() => {});
            if (this.opened) {
                await this.connection.sendNotification('textDocument/didClose', { textDocument: { uri: this.uri } });
                this.opened = false;
            }
        } catch { /* The Host closes obsolete logical connections during a restart. */ }
    }
}
