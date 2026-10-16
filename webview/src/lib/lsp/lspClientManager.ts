import { CancellationTokenSource, type MessageConnection } from 'vscode-jsonrpc/browser';
import { monaco } from '$lib/monaco/setup';
import type { LspTunnelAvailabilityChanged, LspTunnelConfigurationChanged, LspTunnelMessage, LspTunnelOpenResult, LspTunnelState } from '@shared/lspTunnel';
import { ConsoleLspClient } from './consoleLspClient';
import { RpcLspTransport, requestWithDeadline } from './rpcLspTransport';

export const lspClientManagerContext = Symbol('Console LSP client manager');

interface Binding {
    sessionId: string;
    model: monaco.editor.ITextModel;
    languageId: string;
    outer: MessageConnection;
    cancellation: CancellationTokenSource;
    transport?: RpcLspTransport;
    client?: ConsoleLspClient;
    disposed: boolean;
    opening: boolean;
    available?: boolean;
    failures: number;
    retryTimer?: ReturnType<typeof setTimeout>;
    opener?: monaco.IDisposable;
    stableTimer?: ReturnType<typeof setTimeout>;
    disposeListener: monaco.IDisposable;
}

export interface ConsoleLspSessionState {
    id: string;
    runtimeState: string;
    runtimeAttached: boolean;
}

export type ConsoleLspClientState = 'starting' | 'running' | 'unavailable' | 'unsupported' | 'failed';

/** Console surface owns clients; editor mount/unmount only attaches models. */
export class LspClientManager {
    private readonly webviewClientId = crypto.randomUUID();
    private readonly bindings = new Map<monaco.editor.ITextModel, Binding>();
    private readonly transports = new Map<string, RpcLspTransport>();
    private readonly handlers = new Map<MessageConnection, monaco.IDisposable[]>();
    private readonly sessions = new Map<string, ConsoleLspSessionState>();
    private readonly status = new Map<string, ConsoleLspClientState>();
    private disposed = false;
    private readonly stateListeners = new Set<(sessionId: string) => void>();

    onDidChangeState(listener: (sessionId: string) => void): monaco.IDisposable {
        this.stateListeners.add(listener);
        return { dispose: () => this.stateListeners.delete(listener) };
    }

    private setState(sessionId: string, state: ConsoleLspClientState): void {
        if (this.status.get(sessionId) === state) { return; }
        this.status.set(sessionId, state);
        for (const listener of this.stateListeners) { listener(sessionId); }
    }

    getState(sessionId: string): ConsoleLspClientState | undefined {
        return this.status.get(sessionId);
    }

    updateSessions(sessions: readonly ConsoleLspSessionState[]): void {
        if (this.disposed) { return; }
        const previous = new Map(this.sessions);
        this.sessions.clear();
        for (const session of sessions) { this.sessions.set(session.id, session); }
        for (const binding of [...this.bindings.values()]) {
            const session = this.sessions.get(binding.sessionId);
            if (!session) { this.detachModel(binding.model); continue; }
            const available = session.runtimeAttached && ['ready', 'busy'].includes(session.runtimeState);
            if (!available) {
                binding.cancellation.cancel();
                if (binding.retryTimer) { clearTimeout(binding.retryTimer); binding.retryTimer = undefined; }
                this.retireClient(binding);
                this.setState(binding.sessionId, 'unavailable');
            } else if (!binding.client && (!previous.get(session.id)?.runtimeAttached ||
                !['ready', 'busy'].includes(previous.get(session.id)?.runtimeState ?? ''))) {
                // A restarted or reattached runtime may have retired the Host's
                // old availability watcher. Probe once to subscribe to its LSP again.
                binding.available = undefined;
                binding.failures = 0;
                void this.start(binding);
            }
        }
    }

    attachModel(model: monaco.editor.ITextModel, sessionId: string, outer: MessageConnection): void {
        if (this.disposed || model.isDisposed()) { return; }
        const previous = this.bindings.get(model);
        if (previous?.outer === outer && previous.sessionId === sessionId && previous.languageId === model.getLanguageId()) { return; }
        this.detachModel(model);
        this.ensureHandlers(outer);
        const binding: Binding = {
            sessionId, model, languageId: model.getLanguageId(), outer, cancellation: new CancellationTokenSource(),
            disposed: false, opening: false, failures: 0,
            disposeListener: model.onWillDispose(() => this.detachModel(model)),
        };
        this.bindings.set(model, binding);
        void this.start(binding);
    }

    private ensureHandlers(outer: MessageConnection): void {
        if (this.handlers.has(outer)) { return; }
        this.handlers.set(outer, [
            outer.onNotification('lspTunnel/message', (message: LspTunnelMessage) =>
                this.transports.get(message.tunnelId)?.receive(message)),
            outer.onNotification('lspTunnel/state', (state: LspTunnelState) => {
                const transport = this.transports.get(state.tunnelId);
                if (transport?.key.epoch === state.epoch) {
                    transport.close(state.state === 'failed' ? new Error(state.reason ?? 'LSP tunnel failed') : undefined);
                }
            }),
            outer.onNotification('lspTunnel/configurationChanged', (params: LspTunnelConfigurationChanged) => this.retry(params.sessionId)),
            outer.onNotification('lspTunnel/availabilityChanged', (params: LspTunnelAvailabilityChanged) => {
                if (params.available) {
                    this.retry(params.sessionId, true);
                } else {
                    for (const binding of this.bindings.values()) {
                        if (binding.sessionId === params.sessionId) { this.pause(binding); }
                    }
                }
            }),
            outer.onClose(() => {
                for (const binding of [...this.bindings.values()]) {
                    if (binding.outer === outer) { this.detachModel(binding.model); }
                }
                for (const handler of this.handlers.get(outer) ?? []) { handler.dispose(); }
                this.handlers.delete(outer);
            }),
        ]);
    }

    private current(binding: Binding): boolean {
        return !this.disposed && !binding.disposed && !binding.model.isDisposed() &&
            this.bindings.get(binding.model) === binding &&
            binding.model.getLanguageId() === binding.languageId;
    }

    private pause(binding: Binding): void {
        binding.available = false;
        binding.cancellation.cancel();
        if (binding.retryTimer) { clearTimeout(binding.retryTimer); binding.retryTimer = undefined; }
        this.retireClient(binding);
        this.setState(binding.sessionId, 'unavailable');
    }

    retry(sessionId: string, available?: boolean): void {
        for (const binding of this.bindings.values()) {
            if (binding.sessionId === sessionId) {
                binding.available = available;
                binding.cancellation.cancel();
                this.retireClient(binding);
                if (binding.retryTimer) { clearTimeout(binding.retryTimer); binding.retryTimer = undefined; }
                this.setState(binding.sessionId, 'unavailable');
                binding.failures = 0;
                this.scheduleRetry(binding);
            }
        }
    }

    private scheduleRetry(binding: Binding): void {
        const session = this.sessions.get(binding.sessionId);
        if (!this.current(binding) || binding.available === false || binding.client || binding.retryTimer || binding.failures >= 3 ||
            !session?.runtimeAttached || !['ready', 'busy'].includes(session.runtimeState)) { return; }
        const delay = 250 * 2 ** binding.failures++;
        binding.retryTimer = setTimeout(() => {
            binding.retryTimer = undefined;
            void this.start(binding);
        }, delay);
    }

    private async start(binding: Binding): Promise<void> {
        if (!this.current(binding) || binding.available === false || binding.client || binding.opening) { return; }
        const session = this.sessions.get(binding.sessionId);
        if (!session?.runtimeAttached || !['ready', 'busy'].includes(session.runtimeState)) {
            this.setState(binding.sessionId, 'unavailable');
            return;
        }
        if (binding.cancellation.token.isCancellationRequested) {
            binding.cancellation.dispose();
            binding.cancellation = new CancellationTokenSource();
        }
        binding.opening = true;
        const token = binding.cancellation.token;
        this.setState(binding.sessionId, 'starting');
        try {
            const result = await requestWithDeadline<LspTunnelOpenResult>(binding.outer, 'lspTunnel/open', {
                sessionId: binding.sessionId, webviewClientId: this.webviewClientId,
                modelUri: binding.model.uri.toString(true),
            }, 30_000, token);
            if (!this.current(binding) || token.isCancellationRequested) {
                if (result.tunnelId && result.epoch !== undefined) {
                    void binding.outer.sendRequest('lspTunnel/close', { tunnelId: result.tunnelId, epoch: result.epoch }).catch(() => {});
                }
                return;
            }
            if (!result.supported) {
                this.setState(binding.sessionId, 'unsupported');
                return;
            }
            if (result.available === false) {
                // An intentional session-manager stop is not a connection failure.
                // Wait for Host availability instead of retrying the inactive LSP.
                this.pause(binding);
                return;
            }
            if (!result.tunnelId || result.epoch === undefined) {
                throw new Error('Console LSP tunnel returned an invalid endpoint');
            }
            const transport = new RpcLspTransport(binding.outer,
                { tunnelId: result.tunnelId, epoch: result.epoch }, error => {
                    this.transports.delete(result.tunnelId!);
                    if (binding.transport !== transport) { return; }
                    binding.client?.dispose();
                    binding.opener?.dispose();
                    binding.opener = undefined;
                    if (binding.stableTimer) { clearTimeout(binding.stableTimer); binding.stableTimer = undefined; }
                    binding.client = undefined;
                    binding.transport = undefined;
                    if (this.current(binding)) {
                        this.setState(binding.sessionId, error ? 'failed' : 'unavailable');
                        this.scheduleRetry(binding);
                    }
                });
            binding.transport = transport;
            this.transports.set(result.tunnelId, transport);
            const client = new ConsoleLspClient(transport.connection, binding.model, result.configuration ?? {},
                `${result.tunnelId}:${result.epoch}`, async (at, token) => {
                    const word = binding.model.getWordUntilPosition(at);
                    let value: { items: { label: string; insertText?: string; detail?: string }[] };
                    try {
                        value = await requestWithDeadline(
                            binding.outer, 'console/complete', { sessionId: binding.sessionId, code: binding.model.getValue(),
                                cursorPos: binding.model.getOffsetAt(at) }, 10_000, token);
                    } catch { return []; }
                    return value.items.map(item => ({ label: item.label, insertText: item.insertText ?? item.label,
                        detail: item.detail, kind: monaco.languages.CompletionItemKind.Text,
                        range: new monaco.Range(at.lineNumber, word.startColumn, at.lineNumber, word.endColumn) }));
                });
            binding.client = client;
            binding.opener = monaco.editor.registerEditorOpener({
                openCodeEditor: async (source, resource, selection) => {
                    if (!this.current(binding) || source.getModel() !== binding.model || resource.toString(true) === binding.model.uri.toString(true)) {
                        return false;
                    }
                    const selected = selection ? ('startLineNumber' in selection ? {
                        start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
                        end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
                    } : { start: { line: selection.lineNumber - 1, character: selection.column - 1 },
                        end: { line: selection.lineNumber - 1, character: selection.column - 1 } }) : undefined;
                    try {
                        return await requestWithDeadline<boolean>(binding.outer, 'lspTunnel/openDocument', {
                            ...transport.key, uri: resource.toString(true), selection: selected,
                        }, 10_000);
                    } catch { return false; }
                },
            });
            await client.ready;
            if (!this.current(binding) || token.isCancellationRequested || binding.client !== client) { client.dispose(); return; }
            this.setState(binding.sessionId, 'running');
            binding.stableTimer = setTimeout(() => {
                binding.failures = 0;
                binding.stableTimer = undefined;
            }, 30_000);
        } catch (error) {
            if (!this.current(binding) || token.isCancellationRequested) { return; }
            this.retireClient(binding);
            this.setState(binding.sessionId, 'failed');
            this.scheduleRetry(binding);
            console.debug(`[ConsoleLsp] Session '${binding.sessionId}' could not start its Console LSP client`, error);
        } finally {
            binding.opening = false;
            // A restart or configuration change may cancel an open while the
            // runtime becomes available again. Retry only after that open settles.
            if (token.isCancellationRequested) { this.scheduleRetry(binding); }
        }
    }

    private retireClient(binding: Binding): void {
        const client = binding.client;
        const transport = binding.transport;
        binding.client = undefined;
        binding.transport = undefined;
        binding.opener?.dispose();
        binding.opener = undefined;
        if (binding.stableTimer) { clearTimeout(binding.stableTimer); binding.stableTimer = undefined; }
        if (!transport) { return; }
        client?.dispose();
        // Bound Console cleanup even if the Host or outer Webview stops answering.
        const timeout = setTimeout(() => transport.close(), 2000);
        void (client?.stop() ?? Promise.resolve()).catch(() => {}).finally(() => {
            clearTimeout(timeout);
            this.transports.delete(transport.key.tunnelId);
            transport.close();
        });
    }

    detachModel(model: monaco.editor.ITextModel): void {
        const binding = this.bindings.get(model);
        if (!binding) { return; }
        binding.disposed = true;
        binding.cancellation.cancel();
        binding.cancellation.dispose();
        this.bindings.delete(model);
        binding.disposeListener.dispose();
        if (binding.retryTimer) { clearTimeout(binding.retryTimer); }
        this.retireClient(binding);
        this.status.delete(binding.sessionId);
        for (const listener of this.stateListeners) { listener(binding.sessionId); }
    }

    dispose(): void {
        if (this.disposed) { return; }
        this.disposed = true;
        for (const model of [...this.bindings.keys()]) { this.detachModel(model); }
        for (const handlers of this.handlers.values()) { for (const handler of handlers) { handler.dispose(); } }
        this.handlers.clear();
        this.stateListeners.clear();
    }
}
