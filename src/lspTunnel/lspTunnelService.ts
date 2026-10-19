import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { posix } from 'path';
import type { CancellationToken, MessageConnection } from 'vscode-jsonrpc/node';
import type { CompletionItem, CompletionList } from 'vscode-languageserver-protocol';
import type { ILanguageConsoleLspBridge, ILanguageLsp } from '../api';
import { LanguageLspState } from '../api';
import type { RuntimeSession } from '../runtime/session';
import * as Protocol from '../rpc/webview/lspTunnel';
import {
    consoleLspModelUri,
    isLspJsonRpcMessage,
    LSP_TUNNEL_MAX_MESSAGE_BYTES,
    LSP_TUNNEL_MAX_QUEUED_BYTES,
    type LspJsonRpcMessage,
    type LspTunnelKey,
    type LspTunnelMessage,
    type LspTunnelOpenParams,
    type LspTunnelOpenResult,
    type LspTunnelOpenDocument,
} from '../shared/lspTunnel';

type RpcId = string | number | null;
interface Tunnel {
    id: string;
    epoch: number;
    session: RuntimeSession;
    lsp: ILanguageLsp;
    bridge: ILanguageConsoleLspBridge;
    generation: number;
    uri: string;
    initialized: boolean;
    opened: boolean;
    closed: boolean;
    disposables: vscode.Disposable[];
    requests: Map<RpcId, vscode.CancellationTokenSource>;
    serverRequests: Map<RpcId, { resolve(value: unknown): void; reject(error: Error): void }>;
    resolveItems: Map<string, { method: string; value: unknown }>;
    queue: Promise<void>;
    queuedBytes: number;
    outbound: Promise<void>;
    outboundBytes: number;
}

const requestMethods = new Set([
    'textDocument/completion',
    'completionItem/resolve',
    'textDocument/hover',
    'textDocument/signatureHelp',
    'textDocument/definition',
    'textDocument/declaration',
    'textDocument/typeDefinition',
    'textDocument/implementation',
    'textDocument/references',
    'textDocument/documentHighlight',
    'textDocument/documentSymbol',
    'textDocument/semanticTokens/full',
    'textDocument/semanticTokens/full/delta',
    'textDocument/formatting',
    'textDocument/rangeFormatting',
    'textDocument/rename',
    'textDocument/prepareRename',
    'textDocument/codeAction',
    'codeAction/resolve',
    'textDocument/diagnostic',
    'workspace/executeCommand',
]);

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

/** Expand list defaults before both browser conversion and completionItem/resolve. */
function completionWithDefaults(item: CompletionItem, list: CompletionList): CompletionItem {
    const defaults = list.itemDefaults;
    if (!defaults) {
        return item;
    }
    const result = { ...item };
    result.insertTextFormat ??= defaults.insertTextFormat;
    result.insertTextMode ??= defaults.insertTextMode;
    result.commitCharacters =
        list.applyKind?.commitCharacters === 2
            ? defaults.commitCharacters || item.commitCharacters
                ? [
                      ...new Set([
                          ...(defaults.commitCharacters ?? []),
                          ...(item.commitCharacters ?? []),
                      ]),
                  ]
                : undefined
            : (item.commitCharacters ?? defaults.commitCharacters);
    result.data =
        list.applyKind?.data === 2 && item.data != null
            ? { ...record(defaults.data), ...record(item.data) }
            : (item.data ?? defaults.data);
    if (!item.textEdit && defaults.editRange) {
        const newText = item.textEditText ?? item.label;
        const editRange = defaults.editRange;
        result.textEdit =
            'start' in editRange
                ? { range: editRange, newText }
                : { insert: editRange.insert, replace: editRange.replace, newText };
    }
    return result;
}

/** Logical Console connections over the session's initialized Host LanguageClient. */
export class LspTunnelService implements vscode.Disposable {
    private readonly tunnels = new Map<string, Tunnel>();
    private readonly opening = new Map<string, vscode.CancellationTokenSource>();
    private readonly watchedSessions = new Map<
        string,
        {
            session: RuntimeSession;
            disposables: vscode.Disposable[];
            lspListener?: vscode.Disposable;
        }
    >();
    private epoch = 0;
    private requestId = 0;
    private disposed = false;
    private readonly handlers: vscode.Disposable[];

    constructor(
        private readonly connection: MessageConnection,
        private readonly getSession: (id: string) => RuntimeSession | undefined,
        private readonly log: vscode.LogOutputChannel,
    ) {
        this.handlers = [
            connection.onRequest(Protocol.LspTunnelOpenRequest.type, (params, token) =>
                this.open(params, token),
            ),
            connection.onRequest(Protocol.LspTunnelSendRequest.type, (params) => this.send(params)),
            connection.onRequest(Protocol.LspTunnelCloseRequest.type, (key) => this.close(key)),
            connection.onRequest(Protocol.LspTunnelOpenDocumentRequest.type, (params) =>
                this.openDocument(params),
            ),
            connection.onClose(() => this.dispose()),
        ];
    }

    private current(tunnel: Tunnel): boolean {
        return (
            !this.disposed &&
            !tunnel.closed &&
            this.getSession(tunnel.session.sessionId) === tunnel.session &&
            tunnel.session.lsp === tunnel.lsp &&
            tunnel.session.boundLspGeneration === tunnel.generation &&
            tunnel.lsp.state === LanguageLspState.Running
        );
    }

    private watchSessionLsp(session: RuntimeSession): void {
        const watched = this.watchedSessions.get(session.sessionId);
        if (!watched) {
            return;
        }
        watched.lspListener?.dispose();
        const lsp = session.lsp;
        // Keep watching after a tunnel closes so a foreground switch can resume
        // the Console connection when its language session manager starts LSP.
        watched.lspListener = lsp.onDidChangeState?.((event) => {
            if (session.lsp !== lsp || this.getSession(session.sessionId) !== session) {
                return;
            }
            const available = event.newState === LanguageLspState.Running;
            if (!available) {
                this.opening.get(session.sessionId)?.cancel();
            }
            this.notifyAvailability(session, available);
        });
    }

    private notifyAvailability(session: RuntimeSession, available: boolean): void {
        const params = {
            sessionId: session.sessionId,
            generation: session.boundLspGeneration,
            available,
        };
        void Promise.resolve()
            .then(() =>
                this.connection.sendNotification(
                    Protocol.LspTunnelAvailabilityChangedNotification.type,
                    params,
                ),
            )
            .catch(() => {});
    }

    private async open(
        params: LspTunnelOpenParams,
        token: CancellationToken,
    ): Promise<LspTunnelOpenResult> {
        if (
            this.disposed ||
            !vscode.workspace.isTrusted ||
            typeof params?.sessionId !== 'string' ||
            typeof params.webviewClientId !== 'string' ||
            params.webviewClientId.length > 128
        ) {
            throw new Error('Console LSP open is unavailable');
        }
        const session = this.getSession(params.sessionId);
        if (!session || session.sessionMetadata.sessionMode !== 'console') {
            return { supported: false };
        }
        const watched = this.watchedSessions.get(session.sessionId);
        if (watched && watched.session !== session) {
            this.closeSession(session.sessionId);
        }
        if (!this.watchedSessions.has(session.sessionId)) {
            if (this.watchedSessions.size >= 32) {
                throw new Error('Console LSP session limit reached');
            }
            this.watchedSessions.set(session.sessionId, {
                session,
                disposables: [
                    session.onDidChangeConsoleLspConfiguration(() => {
                        this.opening.get(session.sessionId)?.cancel();
                        for (const tunnel of [...this.tunnels.values()]) {
                            if (tunnel.session === session) {
                                this.close(tunnel);
                            }
                        }
                        void Promise.resolve()
                            .then(() =>
                                this.connection.sendNotification(
                                    Protocol.LspTunnelConfigurationChangedNotification.type,
                                    {
                                        sessionId: session.sessionId,
                                        generation: session.boundLspGeneration,
                                    },
                                ),
                            )
                            .catch(() => {});
                        this.watchSessionLsp(session);
                        this.notifyAvailability(
                            session,
                            session.lsp.state === LanguageLspState.Running,
                        );
                    }),
                    session.onDidEndSession(() => this.closeSession(session.sessionId)),
                ],
            });
            this.watchSessionLsp(session);
        }
        const configuration = session.consoleLspConfiguration;
        const lsp = session.lsp;
        const bridge = lsp.consoleLspBridge;
        if (!configuration || !bridge) {
            return { supported: false };
        }
        if (!['ready', 'idle', 'busy'].includes(session.getRuntimeState())) {
            throw new Error('Console runtime is unavailable');
        }
        const uri = vscode.Uri.parse(
            consoleLspModelUri(session.sessionId, session.runtimeMetadata.languageId),
        ).toString(true);
        if (params.modelUri !== uri) {
            throw new Error('Console LSP model does not belong to session');
        }
        // Only the language session manager may activate LSP: it first stops the
        // other Console clients for this language, as in Positron. Opening a
        // browser connection must never reactivate a background Console's LSP.
        if (lsp.state !== LanguageLspState.Running) {
            return { supported: true, available: false };
        }
        this.opening.get(session.sessionId)?.cancel();
        // One Console document owner per session; replacing a surface closes its old logical connection.
        for (const tunnel of [...this.tunnels.values()]) {
            if (tunnel.session === session) {
                this.close(tunnel);
            }
        }
        if (this.tunnels.size + this.opening.size >= 32) {
            throw new Error('Console LSP connection limit reached');
        }
        const cancellation = new vscode.CancellationTokenSource();
        this.opening.set(session.sessionId, cancellation);
        const external = token.onCancellationRequested(() => cancellation.cancel());
        let cancelListener: vscode.Disposable | undefined;
        const cancelled = new Promise<never>((_resolve, reject) => {
            cancelListener = cancellation.token.onCancellationRequested(() =>
                reject(new Error('Console LSP open cancelled or timed out')),
            );
        });
        const timeout = setTimeout(() => cancellation.cancel(), 15_000);
        if (token.isCancellationRequested) {
            cancellation.cancel();
        }
        const generation = session.boundLspGeneration;
        try {
            await Promise.race([lsp.wait(), cancelled]);
            if (
                this.disposed ||
                cancellation.token.isCancellationRequested ||
                session !== this.getSession(session.sessionId) ||
                session.lsp !== lsp ||
                session.boundLspGeneration !== generation ||
                !bridge.capabilities ||
                lsp.state !== LanguageLspState.Running
            ) {
                throw new Error('Obsolete or unavailable Host LSP client');
            }
            const tunnel: Tunnel = {
                id: randomUUID(),
                epoch: ++this.epoch,
                session,
                lsp,
                bridge,
                generation,
                uri,
                initialized: false,
                opened: false,
                closed: false,
                disposables: [],
                requests: new Map(),
                serverRequests: new Map(),
                resolveItems: new Map(),
                queue: Promise.resolve(),
                queuedBytes: 0,
                outbound: Promise.resolve(),
                outboundBytes: 0,
            };
            this.tunnels.set(tunnel.id, tunnel);
            tunnel.disposables.push(
                bridge.onDidReceiveNotification((notification) => {
                    if (!tunnel.initialized || !this.current(tunnel)) {
                        return;
                    }
                    if (
                        notification.method === 'textDocument/publishDiagnostics' &&
                        record(notification.params).uri !== tunnel.uri
                    ) {
                        return;
                    }
                    this.receive(tunnel, { jsonrpc: '2.0', ...notification });
                }),
                bridge.registerRequestHandler('workspace/applyEdit', async (params) => {
                    if (!this.current(tunnel) || !tunnel.opened) {
                        return { applied: false, failureReason: 'Console document is closed' };
                    }
                    try {
                        return await this.requestBrowser(tunnel, 'workspace/applyEdit', params);
                    } catch {
                        return {
                            applied: false,
                            failureReason: 'Console edit request failed or timed out',
                        };
                    }
                }),
                ...(lsp.onDidChangeState
                    ? [
                          lsp.onDidChangeState((event) => {
                              if (event.newState !== LanguageLspState.Running) {
                                  this.close(tunnel);
                              }
                          }),
                      ]
                    : []),
                session.onDidChangeRuntimeState((state) => {
                    if (['restarting', 'exiting', 'exited', 'offline'].includes(state)) {
                        this.close(tunnel);
                    }
                }),
            );
            return {
                supported: true,
                available: true,
                tunnelId: tunnel.id,
                epoch: tunnel.epoch,
                configuration,
            };
        } finally {
            clearTimeout(timeout);
            external.dispose();
            cancelListener?.dispose();
            cancellation.dispose();
            if (this.opening.get(session.sessionId) === cancellation) {
                this.opening.delete(session.sessionId);
            }
        }
    }

    private async send(params: LspTunnelMessage): Promise<void> {
        const tunnel = this.tunnels.get(params?.tunnelId);
        if (!tunnel || !this.current(tunnel) || tunnel.epoch !== params.epoch) {
            throw new Error('Console LSP connection is obsolete');
        }
        if (!isLspJsonRpcMessage(params.message)) {
            throw new Error('Invalid LSP message');
        }
        const message = params.message;
        const bytes = Buffer.byteLength(JSON.stringify(message));
        if (
            bytes > LSP_TUNNEL_MAX_MESSAGE_BYTES ||
            tunnel.queuedBytes + bytes > LSP_TUNNEL_MAX_QUEUED_BYTES
        ) {
            this.close(tunnel, 'failed', 'LSP send queue exceeded limit');
            throw new Error('LSP send queue exceeded limit');
        }
        if (!message.method) {
            const pending = tunnel.serverRequests.get(message.id!);
            if (pending) {
                tunnel.serverRequests.delete(message.id!);
                if (message.error) {
                    pending.reject(new Error(message.error.message));
                } else {
                    pending.resolve(message.result);
                }
            }
            return;
        }
        if (message.method === '$/cancelRequest') {
            const id = record(message.params).id as RpcId;
            tunnel.requests.get(id)?.cancel();
            return;
        }
        tunnel.queuedBytes += bytes;
        const write = tunnel.queue
            .then(async () => {
                if (!this.current(tunnel)) {
                    return;
                }
                if ('id' in message) {
                    // Keep document notifications ordered without blocking cancellation on a server response.
                    void this.request(tunnel, message);
                } else {
                    await this.notify(tunnel, message);
                }
            })
            .finally(() => {
                tunnel.queuedBytes -= bytes;
            });
        tunnel.queue = write.catch(() =>
            this.close(tunnel, 'failed', 'Host LSP notification failed'),
        );
        await write;
    }

    private async request(tunnel: Tunnel, message: LspJsonRpcMessage): Promise<void> {
        const id = message.id!;
        const source = new vscode.CancellationTokenSource();
        if (tunnel.requests.has(id) || tunnel.requests.size >= 256) {
            source.dispose();
            this.close(tunnel, 'failed', 'Console LSP request limit reached');
            return;
        }
        tunnel.requests.set(id, source);
        const cancelled = new Promise<never>((_resolve, reject) => {
            source.token.onCancellationRequested(() =>
                reject(new Error('Console LSP request cancelled or timed out')),
            );
        });
        const timeout = setTimeout(() => source.cancel(), 15_000);
        try {
            let result: unknown;
            const method = message.method!;
            if (method === 'initialize') {
                // Local handshake only: the Host has already initialized the real server.
                result = { capabilities: tunnel.bridge.capabilities };
            } else if (method === 'shutdown') {
                result = null;
            } else {
                if (!tunnel.initialized || !tunnel.opened || !requestMethods.has(method)) {
                    throw new Error('Unsupported Console LSP request');
                }
                let params = message.params;
                if (method.endsWith('/resolve')) {
                    const item = tunnel.resolveItems.get(
                        String(record(params)._supervisorBridgeItem),
                    );
                    if (!item || item.method !== method) {
                        throw new Error('Console resolve item is not owned by this connection');
                    }
                    params = item.value;
                } else if (method === 'workspace/executeCommand') {
                    const command = record(params).command;
                    const commands = record(
                        tunnel.bridge.capabilities?.executeCommandProvider,
                    ).commands;
                    if (
                        typeof command !== 'string' ||
                        !tunnel.session.consoleLspConfiguration?.allowedCommands?.includes(
                            command,
                        ) ||
                        !Array.isArray(commands) ||
                        !commands.includes(command)
                    ) {
                        throw new Error('Console LSP command is not allowed');
                    }
                } else if (record(record(params).textDocument).uri !== tunnel.uri) {
                    throw new Error('Console LSP request targets another document');
                }
                result = await Promise.race([
                    tunnel.bridge.sendRequest(method, params, source.token),
                    cancelled,
                ]);
                if (source.token.isCancellationRequested) {
                    throw new Error('Console LSP request cancelled');
                }
                result = this.resolveResult(tunnel, method, result);
            }
            if (this.current(tunnel)) {
                this.receive(tunnel, { jsonrpc: '2.0', id, result: result ?? null });
            }
        } catch (error) {
            if (this.current(tunnel)) {
                this.receive(tunnel, {
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: source.token.isCancellationRequested ? -32800 : -32603,
                        message: error instanceof Error ? error.message : String(error),
                    },
                });
            }
        } finally {
            clearTimeout(timeout);
            source.dispose();
            tunnel.requests.delete(id);
        }
    }

    private resolveResult(tunnel: Tunnel, method: string, result: unknown): unknown {
        const attach = (value: unknown, resolveMethod: string) => {
            const key = randomUUID();
            if (tunnel.resolveItems.size >= 2048) {
                tunnel.resolveItems.delete(tunnel.resolveItems.keys().next().value!);
            }
            tunnel.resolveItems.set(key, { method: resolveMethod, value });
            return { ...record(value), _supervisorBridgeItem: key };
        };
        if (method === 'textDocument/completion') {
            if (Array.isArray(result)) {
                return result.map((item) => attach(item, 'completionItem/resolve'));
            }
            const list = record(result);
            if (Array.isArray(list.items)) {
                const completionList = result as CompletionList;
                // The Host advertises support for list defaults. Console receives
                // standalone items, including effective resolve data and edit ranges.
                const {
                    itemDefaults: _defaults,
                    applyKind: _applyKind,
                    ...expanded
                } = completionList;
                return {
                    ...expanded,
                    items: completionList.items.map((item) =>
                        attach(
                            completionWithDefaults(item, completionList),
                            'completionItem/resolve',
                        ),
                    ),
                };
            }
        } else if (method === 'textDocument/codeAction' && Array.isArray(result)) {
            return result.map((item) =>
                typeof record(item).command === 'string'
                    ? item
                    : attach(item, 'codeAction/resolve'),
            );
        }
        return result;
    }

    private async notify(tunnel: Tunnel, message: LspJsonRpcMessage): Promise<void> {
        if (message.method === 'initialized') {
            tunnel.initialized = true;
            const registrations = tunnel.bridge.registrations;
            if (registrations.length) {
                this.receive(tunnel, {
                    jsonrpc: '2.0',
                    method: 'client/registerCapability',
                    params: { registrations },
                });
            }
            return;
        }
        if (message.method === 'exit') {
            this.close(tunnel);
            return;
        }
        if (
            !tunnel.initialized ||
            !['textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose'].includes(
                message.method!,
            )
        ) {
            throw new Error('Unsupported Console LSP notification');
        }
        const document = record(record(message.params).textDocument);
        if (document.uri !== tunnel.uri) {
            throw new Error('Console notification targets another document');
        }
        if (message.method === 'textDocument/didOpen') {
            if (
                tunnel.opened ||
                document.languageId !== tunnel.session.runtimeMetadata.languageId ||
                typeof document.text !== 'string'
            ) {
                throw new Error('Invalid Console document open');
            }
            tunnel.opened = true;
        } else if (!tunnel.opened) {
            throw new Error('Console document is not open');
        }
        if (message.method === 'textDocument/didClose') {
            tunnel.opened = false;
        }
        await tunnel.bridge.sendNotification(message.method!, message.params);
    }

    private receive(tunnel: Tunnel, message: LspJsonRpcMessage): void {
        if (!this.current(tunnel)) {
            return;
        }
        const bytes = Buffer.byteLength(JSON.stringify(message));
        if (
            bytes > LSP_TUNNEL_MAX_MESSAGE_BYTES ||
            tunnel.outboundBytes + bytes > LSP_TUNNEL_MAX_QUEUED_BYTES
        ) {
            this.close(tunnel, 'failed', 'LSP receive queue exceeded limit');
            return;
        }
        tunnel.outboundBytes += bytes;
        tunnel.outbound = tunnel.outbound
            .then(async () => {
                if (this.current(tunnel)) {
                    await this.connection.sendNotification(
                        Protocol.LspTunnelMessageNotification.type,
                        { tunnelId: tunnel.id, epoch: tunnel.epoch, message },
                    );
                }
            })
            .catch(() => this.close(tunnel, 'failed', 'Webview transport failed'))
            .finally(() => {
                tunnel.outboundBytes -= bytes;
            });
    }

    private requestBrowser(tunnel: Tunnel, method: string, params: unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const id = `host:${++this.requestId}`;
            const timeout = setTimeout(() => {
                tunnel.serverRequests.delete(id);
                reject(new Error('Console server request timed out'));
            }, 10_000);
            tunnel.serverRequests.set(id, {
                resolve: (value) => {
                    clearTimeout(timeout);
                    resolve(value);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
            });
            this.receive(tunnel, { jsonrpc: '2.0', id, method, params });
        });
    }

    private close(
        key: LspTunnelKey | Tunnel,
        state: 'closed' | 'failed' = 'closed',
        reason?: string,
    ): void {
        const id = 'id' in key ? key.id : key.tunnelId;
        const tunnel = this.tunnels.get(id);
        if (!tunnel || tunnel.epoch !== key.epoch || tunnel.closed) {
            return;
        }
        tunnel.closed = true;
        this.tunnels.delete(id);
        for (const disposable of tunnel.disposables) {
            disposable.dispose();
        }
        for (const source of tunnel.requests.values()) {
            source.cancel();
        }
        for (const pending of tunnel.serverRequests.values()) {
            pending.reject(new Error('Console connection closed'));
        }
        tunnel.serverRequests.clear();
        tunnel.resolveItems.clear();
        // Retire only this logical document. Never stop or reinitialize the shared server.
        if (
            tunnel.opened &&
            tunnel.session.lsp === tunnel.lsp &&
            tunnel.lsp.state === LanguageLspState.Running
        ) {
            void tunnel.bridge
                .sendNotification('textDocument/didClose', { textDocument: { uri: tunnel.uri } })
                .catch(() => {});
        }
        if (reason) {
            this.log.debug(`[ConsoleLspBridge] ${tunnel.session.sessionId}: ${reason}`);
        }
        void Promise.resolve()
            .then(() =>
                this.connection.sendNotification(Protocol.LspTunnelStateNotification.type, {
                    tunnelId: id,
                    epoch: tunnel.epoch,
                    state,
                    reason,
                }),
            )
            .catch(() => {});
    }

    closeSession(sessionId: string): void {
        const watched = this.watchedSessions.get(sessionId);
        watched?.lspListener?.dispose();
        for (const disposable of watched?.disposables ?? []) {
            disposable.dispose();
        }
        this.watchedSessions.delete(sessionId);
        this.opening.get(sessionId)?.cancel();
        for (const tunnel of [...this.tunnels.values()]) {
            if (tunnel.session.sessionId === sessionId) {
                this.close(tunnel);
            }
        }
    }

    private async openDocument(params: LspTunnelOpenDocument): Promise<boolean> {
        const tunnel = this.tunnels.get(params.tunnelId);
        if (
            !tunnel ||
            tunnel.closed ||
            tunnel.epoch !== params.epoch ||
            !vscode.workspace.isTrusted ||
            !this.current(tunnel) ||
            typeof params.uri !== 'string' ||
            tunnel.session !== this.getSession(tunnel.session.sessionId) ||
            tunnel.generation !== tunnel.session.boundLspGeneration
        ) {
            return false;
        }
        const uri = vscode.Uri.parse(params.uri);
        if (uri.scheme !== 'file' && uri.scheme !== 'vscode-remote') {
            return false;
        }
        const configuration = tunnel.session.consoleLspConfiguration;
        const roots = [
            ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []),
            ...(configuration?.workspaceFolders?.map((folder) => vscode.Uri.parse(folder.uri)) ??
                []),
            ...(configuration?.rootUri ? [vscode.Uri.parse(configuration.rootUri)] : []),
        ];
        const path = posix.normalize(uri.path);
        if (
            !roots.some((root) => {
                const parent = posix.normalize(root.path).replace(/\/$/, '');
                return (
                    root.scheme === uri.scheme &&
                    root.authority === uri.authority &&
                    (path === parent || path.startsWith(`${parent}/`))
                );
            })
        ) {
            return false;
        }
        const selection = params.selection;
        if (
            selection &&
            [
                selection.start.line,
                selection.start.character,
                selection.end.line,
                selection.end.character,
            ].some((value) => !Number.isSafeInteger(value) || value < 0)
        ) {
            return false;
        }
        const document = await vscode.workspace.openTextDocument(uri);
        if (
            tunnel.closed ||
            !this.current(tunnel) ||
            tunnel.session !== this.getSession(tunnel.session.sessionId)
        ) {
            return false;
        }
        await vscode.window.showTextDocument(document, {
            selection: selection
                ? new vscode.Range(
                      selection.start.line,
                      selection.start.character,
                      selection.end.line,
                      selection.end.character,
                  )
                : undefined,
            preview: true,
        });
        return true;
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const pending of this.opening.values()) {
            pending.cancel();
        }
        for (const tunnel of [...this.tunnels.values()]) {
            this.close(tunnel);
        }
        for (const handler of this.handlers) {
            handler.dispose();
        }
        for (const watched of this.watchedSessions.values()) {
            watched.lspListener?.dispose();
            for (const disposable of watched.disposables) {
                disposable.dispose();
            }
        }
        this.watchedSessions.clear();
    }
}
