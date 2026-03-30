import * as vscode from 'vscode';
import { MessageConnection } from 'vscode-jsonrpc';
import { CoreConfigurationKeys, CoreConfigurationSections, ViewIds } from '../coreCommandIds';
import { BaseWebviewProvider } from './baseProvider';
import * as ConsoleProtocol from '../rpc/webview/console';
import * as LspProtocol from '../rpc/webview/lsp';
import * as SessionProtocol from '../rpc/webview/session';
import { RuntimeSession } from '../runtime/session';
import { RuntimeSessionService } from '../runtime/runtimeSession';
import { RuntimeStartupService } from '../runtime/runtimeStartup';
import {
    LanguageRuntimeSessionChannel,
    RuntimeCodeFragmentStatus,
} from '../internal/runtimeTypes';
import {
    UiFrontendEvent,
} from '../runtime/comms/positronUiComm';
import type { ILanguageRuntimeGlobalEvent } from '../runtime/runtimeEvents';
import { PositronConsoleService } from '../services/console/consoleService';
import { IPositronConsoleInstance, RuntimeCodeExecutionMode, RuntimeErrorBehavior, type IConsoleCodeAttribution } from '../services/console/interfaces/consoleService';
import { ConsoleThemeProvider } from './consoleThemeProvider';
import { resolveConsoleAppearance } from './consoleSettings';
import { SessionSnapshotBuilder } from './sessionSnapshotBuilder';

/**
 * Webview provider for the R Console panel.
 * Provides code input, execution, and output display.
 * Supports multiple sessions with per-session message routing.
 */
export class ConsoleViewProvider extends BaseWebviewProvider {
    private readonly _consoleServiceDisposables: vscode.Disposable[] = [];
    private readonly _sessionSnapshotBuilder: SessionSnapshotBuilder;

    // Multi-session support: track subscriptions per session
    private readonly _allSessionSubscriptions = new Map<string, vscode.Disposable[]>();
    // Console instance event subscriptions (Positron pattern)
    private readonly _consoleInstanceSubscriptions = new Map<string, vscode.Disposable[]>();

    // Flags for webview lifecycle/state synchronization.
    // Session updates are queued until the webview explicitly signals readiness.
    private _pendingSessionInfoUpdate = false;
    private _pendingRestoreStatesForInstances = false;
    private _webviewReady = false;
    private readonly _suppressStartupNotificationOnce = new Set<string>();
    // Sessions that have already been initialized in this webview lifecycle.
    // Prevents redundant initial restore-state sends before instance-driven updates take over.
    private readonly _initializedSessions = new Set<string>();
    private readonly _sessionSyncSeq = new Map<string, number>();
    private _pendingLanguageSupportAssetsRefresh = false;

    // Current console width in characters (Positron pattern: track for new sessions)
    private _currentWidthInChars = 80;
    private readonly _missingSessionWarnings = new Set<string>();
    private readonly _lastClearReasons = new Map<string, 'user' | 'runtime' | undefined>();
    private readonly _consoleThemeProvider = new ConsoleThemeProvider();
    private _runtimeStartupEvent: ConsoleProtocol.RuntimeStartupPhaseNotification.RuntimeStartupEvent | undefined;

    constructor(
        extensionUri: vscode.Uri,
        outputChannel: vscode.LogOutputChannel,
        private readonly _sessionManager?: RuntimeSessionService,
        private readonly _consoleService?: PositronConsoleService,
        private readonly _runtimeStartupService?: RuntimeStartupService,
        getAdditionalLocalResourceRoots: () => readonly vscode.Uri[] = () => [],
        private readonly _getLanguageMonacoSupportModuleUris: (webview: vscode.Webview) => Readonly<Record<string, string>> = () => ({}),
        private readonly _getLanguageTextMateGrammarDefinitions: (
            webview: vscode.Webview,
        ) => Readonly<Record<string, { scopeName: string; grammarUrl: string }>> = () => ({}),
    ) {
        super(extensionUri, outputChannel, getAdditionalLocalResourceRoots);
        this._sessionSnapshotBuilder = new SessionSnapshotBuilder(this._sessionManager, this._consoleService);

        // Subscribe to console service events (Positron 1:1 pattern)
        this._subscribeToConsoleServiceEvents();

        // Subscribe to runtime UI event bus (Positron-style global runtime events)
        this._subscribeToRuntimeEvents();

        // Keep Monaco token theme in sync with VS Code color theme.
        this._consoleServiceDisposables.push(
            vscode.window.onDidChangeActiveColorTheme(() => {
                void this._sendConsoleThemeChanged();
            })
        );

        if (this._runtimeStartupService) {
            this._consoleServiceDisposables.push(
                this._runtimeStartupService.onDidChangeRuntimeStartupPhase(() => {
                    this._sendRuntimeStartupPhaseChanged();
                }),
                this._runtimeStartupService.onWillAutoStartRuntime((event) => {
                    this._runtimeStartupEvent = {
                        runtimeName: event.runtime.runtimeName,
                        languageName: event.runtime.languageName,
                        base64EncodedIconSvg: event.runtime.base64EncodedIconSvg,
                        newSession: event.newSession,
                    };
                    this._sendRuntimeStartupPhaseChanged();
                })
            );
        }

        if (this._sessionManager) {
            this._consoleServiceDisposables.push(
                this._sessionManager.onDidUpdateSessionName(() => {
                    this._sendSessionInfoUpdate();
                })
            );
        }
    }

    protected get _providerName(): string {
        return 'ConsoleViewProvider';
    }

    async reveal(preserveFocus: boolean): Promise<void> {
        const view = this.view;
        if (view) {
            view.show(preserveFocus);
            return;
        }

        await vscode.commands.executeCommand('workbench.views.action.showView', ViewIds.console);
    }

    /**
     * Subscribes to a session's events (multi-session support).
     * Each session gets its own subscription tracked by sessionId.
     */
    subscribeToSession(session: RuntimeSession): void {
        this._subscribeToSession(session);
        // Notify webview of updated session list (will be queued if connection not ready)
        this._sendSessionInfoUpdate();
    }

    /**
     * Unsubscribes from a session's events.
     */
    unsubscribeFromSession(sessionId: string): void {
        const disposables = this._allSessionSubscriptions.get(sessionId);
        if (disposables) {
            disposables.forEach(d => d.dispose());
            this._allSessionSubscriptions.delete(sessionId);
            this._suppressStartupNotificationOnce.delete(sessionId);
            this.log(`Unsubscribed from session ${sessionId}`, vscode.LogLevel.Debug);
        }
    }


    getLastClearReason(sessionId: string): 'user' | 'runtime' | undefined {
        return this._lastClearReasons.get(sessionId);
    }

    refreshLanguageSupportAssets(): void {
        this._refreshWebviewOptions();

        if (!this._connection || !this._webviewReady || !this._view) {
            this._pendingLanguageSupportAssetsRefresh = true;
            return;
        }

        this._sendLanguageSupportAssetsChanged();
    }

    async openCodeInEditor(sessionId: string | undefined, code?: string): Promise<boolean> {
        const instance = sessionId
            ? this._consoleService?.getConsoleInstance(sessionId)
            : undefined;
        const content = typeof code === 'string' && code.trim().length > 0
            ? code
            : (sessionId
                ? this._consoleService?.getClipboardRepresentation(sessionId, '# ')
                : undefined) ?? '';

        if (content.trim().length === 0) {
            return false;
        }

        const document = await vscode.workspace.openTextDocument({
            language: instance?.runtimeMetadata.languageId || 'plaintext',
            content,
        });

        await vscode.window.showTextDocument(document, {
            preview: false,
            preserveFocus: false,
        });

        return true;
    }

    /**
     * Internal method to subscribe to a session with sessionId tracking.
     */
    private _subscribeToSession(session: RuntimeSession): void {
        const sessionId = session.sessionId;

        // Don't subscribe twice
        if (this._allSessionSubscriptions.has(sessionId)) {
            return;
        }

        // Suppress exactly one startup notification burst for restored/reconnected sessions.
        if (this._sessionManager?.wasSessionRestored(sessionId)) {
            this._suppressStartupNotificationOnce.add(sessionId);
        }

        this.log(`Subscribing to session ${sessionId} events (multi-session)`, vscode.LogLevel.Debug);

        const disposables: vscode.Disposable[] = [];

        // Listen for startup complete event (Positron pattern: onDidCompleteStartup)
        disposables.push(
            session.onDidCompleteStartup(info => {
                const suppressStartupNotification = this._suppressStartupNotificationOnce.delete(sessionId);
                if (suppressStartupNotification) {
                    this.log('Suppressing startup banner for restored session ' + sessionId, vscode.LogLevel.Debug);
                } else {
                    this.log(`Startup complete for ${sessionId}: info=${JSON.stringify(info)}`, vscode.LogLevel.Debug);
                    this.log(`Startup complete for ${sessionId}: banner=${info.banner?.substring(0, 100) || 'EMPTY/UNDEFINED'}`, vscode.LogLevel.Info);
                }

                const instance = this._consoleService?.getConsoleInstance(sessionId);
                if (!instance) {
                    this.log(`Startup complete for ${sessionId}: console instance missing`, vscode.LogLevel.Warning);
                }

                // Store startup banner in console instance so restoreState remains canonical.
                if (!suppressStartupNotification && instance && info.banner) {
                    instance.addRuntimeStartupBanner(
                        info.banner,
                        info.implementation_version ?? info.language_version ?? ''
                    );
                }

                instance?.completeStartup();
            })
        );

        // Listen for resource usage updates (Positron pattern)
        if (session.onDidUpdateResourceUsage) {
            disposables.push(
                session.onDidUpdateResourceUsage(usage => {
                    this._sendResourceUsage(sessionId, usage);
                })
            );
        }

        this._allSessionSubscriptions.set(sessionId, disposables);
    }

    private _nextSyncSeq(sessionId: string): number {
        const seq = (this._sessionSyncSeq.get(sessionId) ?? 0) + 1;
        this._sessionSyncSeq.set(sessionId, seq);
        return seq;
    }

    private _currentSyncSeq(sessionId: string): number {
        return this._sessionSyncSeq.get(sessionId) ?? 0;
    }

    private _deleteSyncSeq(sessionId: string): void {
        this._sessionSyncSeq.delete(sessionId);
    }

    protected _registerRpcHandlers(connection: MessageConnection): void {
        this._webviewReady = false;
        this._pendingRestoreStatesForInstances = true;
        // Webview was (re)created — all sessions need restore state on reconnect.
        this._initializedSessions.clear();

        // Deterministic readiness signal from webview.
        connection.onNotification(ConsoleProtocol.ConsoleReadyNotification.type, () => {
            this._webviewReady = true;
            this._flushPendingConsoleSync('console/ready');
        });

        // Handle console settings request.
        connection.onRequest(ConsoleProtocol.GetConsoleSettingsRequest.type, async () => {
            return this._getConsoleSettings();
        });

        connection.onRequest(ConsoleProtocol.ConsoleRequestFullStateRequest.type, async (params) => {
            this.log(
                `[SyncSeq] Full state requested: session=${params.sessionId} reason=${params.reason}`,
                vscode.LogLevel.Warning,
            );
            this._sendRestoreStateForInstance(params.sessionId, {
                useCurrentSyncSeq: true,
            });
        });

        // Handle execute request from webview
        connection.onRequest(ConsoleProtocol.ExecuteRequest.type, async (params) => {
            this.log(`Execute request: ${params.code.substring(0, 50)}...`, vscode.LogLevel.Debug);

            // Use executionId from frontend if provided, otherwise generate one
            const executionId = params.executionId || `exec-${Date.now()}`;

            const targetSession = this._resolveSessionForRequest('execute', params.sessionId);
            if (!targetSession) {
                throw new Error('sessionId is required for execute');
            }

            const instance = this._consoleService?.getConsoleInstance(targetSession.sessionId);
            if (!instance) {
                throw new Error(`No console instance for session: ${targetSession.sessionId}`);
            }

            const attribution: IConsoleCodeAttribution = {
                source: 'console',
            };

            let mode: RuntimeCodeExecutionMode = RuntimeCodeExecutionMode.Interactive;
            if (params.mode === 'non-interactive') {
                mode = RuntimeCodeExecutionMode.NonInteractive;
            } else if (params.mode === 'silent') {
                mode = RuntimeCodeExecutionMode.Silent;
            } else if (params.mode === 'transient') {
                mode = RuntimeCodeExecutionMode.Transient;
            }

            const errorBehavior =
                params.errorBehavior === RuntimeErrorBehavior.Stop
                    ? RuntimeErrorBehavior.Stop
                    : RuntimeErrorBehavior.Continue;

            this.log(`Executing on session: ${targetSession.sessionId}`, vscode.LogLevel.Debug);
            await instance.enqueueCode(
                params.code,
                attribution,
                params.allowIncomplete ?? false,
                mode,
                errorBehavior,
                executionId
            );
            return { executionId };
        });

        // Handle completion request
        connection.onRequest(ConsoleProtocol.CompleteRequest.type, async (params) => {
            this.log(`Complete request at position ${params.cursorPos}`, vscode.LogLevel.Debug);

            const targetSession = this._resolveSessionForRequest('complete', params.sessionId);
            if (targetSession) {
                const matches = await targetSession.getCompletions(params.code, params.cursorPos);
                return {
                    items: matches.map((m: string) => ({
                        label: m,
                        kind: 'text'
                    }))
                };
            }
            return { items: [] };
        });

        // Handle isComplete request (Positron pattern: use runtime isCodeFragmentComplete)
        connection.onRequest(ConsoleProtocol.IsCompleteRequest.type, async (params) => {
            this.log(`IsComplete request: ${params.code.substring(0, 30)}...`, vscode.LogLevel.Debug);

            const targetSession = this._resolveSessionForRequest('isComplete', params.sessionId);
            if (targetSession) {
                const status = await targetSession.isCodeFragmentComplete(params.code);
                const statusMap: Record<RuntimeCodeFragmentStatus, string> = {
                    [RuntimeCodeFragmentStatus.Complete]: 'complete',
                    [RuntimeCodeFragmentStatus.Incomplete]: 'incomplete',
                    [RuntimeCodeFragmentStatus.Invalid]: 'invalid',
                    [RuntimeCodeFragmentStatus.Unknown]: 'unknown',
                };
                return { status: statusMap[status] || 'unknown' };
            }

            // No session available - return unknown so frontend handles it appropriately
            return { status: 'unknown' };
        });

        // Handle interrupt request
        connection.onRequest(ConsoleProtocol.InterruptRequest.type, async (params) => {
            this.log('Interrupt request received', vscode.LogLevel.Debug);

            const instance = this._resolveConsoleInstance('interrupt', params?.sessionId);
            if (instance) {
                instance.interrupt();
            }
        });

        // Handle clear console request (user action)
        connection.onRequest(ConsoleProtocol.ClearConsoleRequest.type, async (params) => {
            const instance = this._resolveConsoleInstance('clearConsole', params?.sessionId);
            if (instance) {
                if (instance.clearConsole()) {
                    this.clearOutput(instance.sessionId, 'user');
                }
            }
        });

        // Handle toggle word wrap request
        connection.onRequest(ConsoleProtocol.ToggleWordWrapRequest.type, async (params) => {
            const instance = this._resolveConsoleInstance('toggleWordWrap', params?.sessionId);
            if (instance) {
                instance.toggleWordWrap();
            }
        });

        // Handle toggle trace request
        connection.onRequest(ConsoleProtocol.ToggleTraceRequest.type, async (params) => {
            const instance = this._resolveConsoleInstance('toggleTrace', params?.sessionId);
            if (instance) {
                instance.toggleTrace();
            }
        });

        connection.onRequest('console/openInEditor', async (params: { sessionId?: string; code?: string }) => {
            const code = typeof params?.code === 'string' ? params.code : undefined;
            const success = await this.openCodeInEditor(params?.sessionId, code);
            return success
                ? { success: true }
                : { success: false, error: 'No code to open in editor' };
        });

        // Handle replyPrompt request (readline response)
        connection.onRequest(ConsoleProtocol.ReplyPromptRequest.type, async (params) => {
            this.log(`ReplyPrompt request: id=${params.id}`, vscode.LogLevel.Debug);

            const instance = this._resolveConsoleInstance('replyPrompt', params.sessionId);
            if (instance) {
                instance.replyToPrompt(params.value);
            }
        });

        // Handle list sessions request
        connection.onRequest(SessionProtocol.ListSessionsRequest.type, async () => {
            // Backward-compatible fallback: first list request implies webview is ready.
            if (!this._webviewReady) {
                this._webviewReady = true;
                this._flushPendingConsoleSync('session/list fallback');
            }

            if (!this._sessionManager && !this._consoleService) {
                return { sessions: [], activeSessionId: undefined };
            }
            return this._buildSessionInfoSnapshot();
        });

        // Handle create session request
        connection.onRequest(SessionProtocol.CreateSessionRequest.type, async (params) => {
            this.log(`Create session request: ${params.name || '(runtime default)'}`, vscode.LogLevel.Debug);
            if (!this._sessionManager) {
                throw new Error('Session manager not available');
            }
            try {
                const requestedName = params.name?.trim();
                const session = params.showRuntimePicker
                    ? await this._sessionManager.createSessionFromPicker(requestedName || undefined)
                    : await this._sessionManager.startConsoleSession(requestedName || undefined);

                if (!session) {
                    return {};
                }

                // Webview-initiated sessions bypass SupervisorApplication's
                // lifecycle wiring, so subscribe here to keep follow-up startup
                // and session-info updates flowing.
                this.subscribeToSession(session);
                this._sendSessionInfoUpdate();
                const sessions = this._sessionSnapshotBuilder.buildSessionsWithConsoleOverlay();
                return {
                    session: sessions.find(candidate => candidate.id === session.sessionId),
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.log(`Create session request failed: ${message}`, vscode.LogLevel.Error);
                void vscode.window.showErrorMessage(`Failed to create session: ${message}`);
                this._sendSessionInfoUpdate();
                throw error;
            }
        });

        // Handle stop session request
        connection.onRequest(SessionProtocol.StopSessionRequest.type, async (params) => {
            this.log(`Stop session request: ${params.sessionId}`, vscode.LogLevel.Debug);
            if (!this._sessionManager) {
                throw new Error('Session manager not available');
            }
            if (!params.sessionId) {
                this._warnMissingSession('stopSession');
                return;
            }
            if (!this._sessionManager.getSession(params.sessionId)) {
                this._consoleService?.deletePositronConsoleSession(params.sessionId);
                this._sendSessionInfoUpdate();
                return;
            }

            await this._sessionManager.deleteSession(params.sessionId);
            this._sendSessionInfoUpdate();
        });

        // Handle restart session request
        connection.onRequest(SessionProtocol.RestartSessionRequest.type, async (params) => {
            this.log(`Restart session request: ${params.sessionId}`, vscode.LogLevel.Debug);
            if (!this._sessionManager) {
                throw new Error('Session manager not available');
            }
            if (!params.sessionId) {
                this._warnMissingSession('restartSession');
                return;
            }

            await this._sessionManager.restartSession(
                params.sessionId,
                'console/restartSession request',
            );
        });

        // Handle switch session request
        connection.onRequest(SessionProtocol.SwitchSessionRequest.type, async (params) => {
            this.log(`Switch session request: ${params.sessionId}`, vscode.LogLevel.Debug);
            if (!this._sessionManager) {
                throw new Error('Session manager not available');
            }
            if (!params.sessionId) {
                this._warnMissingSession('switchSession');
                return;
            }
            await this._sessionManager.focusSession(params.sessionId);
            this._sendSessionInfoUpdate();
        });

        // Handle rename session request
        connection.onRequest(SessionProtocol.RenameSessionRequest.type, async (params) => {
            this.log(`Rename session request: ${params.sessionId} -> ${params.newName}`, vscode.LogLevel.Debug);
            if (!this._sessionManager) {
                throw new Error('Session manager not available');
            }
            if (!params.sessionId) {
                this._warnMissingSession('renameSession');
                return;
            }
            this._sessionManager.updateSessionName(params.sessionId, params.newName);
            this._sendSessionInfoUpdate();
        });

        connection.onRequest(SessionProtocol.ListOutputChannelsRequest.type, async (params) => {
            if (!this._sessionManager) {
                return { channels: [] };
            }

            const session = this._sessionManager.getSession(params.sessionId);
            if (!session) {
                this._warnMissingSession('listOutputChannels');
                return { channels: [] };
            }

            return {
                channels: session.listOutputChannels(),
            };
        });

        connection.onRequest(SessionProtocol.ShowOutputChannelRequest.type, async (params) => {
            if (!this._sessionManager) {
                throw new Error('Session manager not available');
            }

            const session = this._sessionManager.getSession(params.sessionId);
            if (!session) {
                this._warnMissingSession('showOutputChannel');
                return;
            }

            switch (params.channel) {
                case 'console':
                    session.showOutput(LanguageRuntimeSessionChannel.Console);
                    return;
                case 'kernel':
                    session.showOutput(LanguageRuntimeSessionChannel.Kernel);
                    return;
                case 'lsp':
                    session.showLspOutput();
                    return;
            }
        });

        // Handle console width change notification.
        // The language extension layer owns syncing width into language runtimes.
        connection.onNotification(ConsoleProtocol.SetConsoleWidthNotification.type, (params) => {
            this.log(`Console width change: ${params.widthInChars} chars`, vscode.LogLevel.Debug);
            this._currentWidthInChars = params.widthInChars;
            this._consoleService?.setConsoleWidth(params.widthInChars);
        });

        connection.onNotification(ConsoleProtocol.ConsoleOpenExternalNotification.type, (params) => {
            if (!params?.url) {
                return;
            }

            try {
                const uri = vscode.Uri.parse(params.url, true);
                if (uri.scheme !== 'http' && uri.scheme !== 'https') {
                    this.log(`Blocked non-http(s) external URL from console output: ${params.url}`, vscode.LogLevel.Warning);
                    return;
                }
                void vscode.env.openExternal(uri);
            } catch (error) {
                this.log(`Failed to open external URL from console output: ${error}`, vscode.LogLevel.Warning);
            }
        });

        // =====================================================================
        // LSP RPC Handlers (Console LSP Bridge)
        // These forward LSP requests from the webview to the session's LSP client
        // =====================================================================

        // Handle LSP completion request
        connection.onRequest(LspProtocol.LspCompletionRequest.type, async (params) => {
            this.log(`LSP completion request for session ${params.sessionId}`, vscode.LogLevel.Debug);

            if (!params.sessionId) {
                this._warnMissingSession('lspCompletion');
                return { items: [] };
            }
            const targetSession = this._sessionManager?.getSession(params.sessionId);
            if (!targetSession) {
                this.log(`LSP completion: session ${params.sessionId} not found`, vscode.LogLevel.Debug);
                return { items: [] };
            }

            const lsp = targetSession.lsp;
            if (!lsp) {
                this.log(`LSP completion: no LSP client for session ${params.sessionId}`, vscode.LogLevel.Debug);
                return { items: [] };
            }

            try {
                const items = await lsp.requestCompletion(params.code, params.position);
                // Convert LSP items to our protocol format
                const result: LspProtocol.LspCompletionItem[] = items.map((item: any) => ({
                    label: item.label || item,
                    kind: item.kind,
                    detail: item.detail,
                    documentation: item.documentation,
                    insertText: item.insertText || item.textEdit?.newText,
                    filterText: item.filterText,
                    sortText: item.sortText
                }));
                return { items: result };
            } catch (error) {
                this.log(`LSP completion error: ${error}`, vscode.LogLevel.Warning);
                return { items: [] };
            }
        });

        // Handle LSP hover request
        connection.onRequest(LspProtocol.LspHoverRequest.type, async (params) => {
            this.log(`LSP hover request for session ${params.sessionId}`, vscode.LogLevel.Debug);

            if (!params.sessionId) {
                this._warnMissingSession('lspHover');
                return null;
            }
            const targetSession = this._sessionManager?.getSession(params.sessionId);
            if (!targetSession) {
                return null;
            }

            const lsp = targetSession.lsp;
            if (!lsp) {
                return null;
            }

            try {
                const result = await lsp.requestHover(params.code, params.position);
                if (!result) {
                    return null;
                }

                // Convert LSP hover to our protocol format
                let contents: LspProtocol.LspMarkupContent | string;
                if (typeof result.contents === 'string') {
                    contents = result.contents;
                } else if (Array.isArray(result.contents)) {
                    // MarkedString array - join them
                    contents = result.contents.map((c: any) =>
                        typeof c === 'string' ? c : c.value
                    ).join('\n\n');
                } else if ('value' in result.contents) {
                    contents = {
                        kind: result.contents.kind || 'markdown',
                        value: result.contents.value
                    };
                } else {
                    contents = String(result.contents);
                }

                return {
                    contents,
                    range: result.range
                };
            } catch (error) {
                this.log(`LSP hover error: ${error}`, vscode.LogLevel.Warning);
                return null;
            }
        });

        // Handle LSP signature help request
        connection.onRequest(LspProtocol.LspSignatureHelpRequest.type, async (params) => {
            this.log(`LSP signature help request for session ${params.sessionId}`, vscode.LogLevel.Debug);

            if (!params.sessionId) {
                this._warnMissingSession('lspSignatureHelp');
                return null;
            }
            const targetSession = this._sessionManager?.getSession(params.sessionId);
            if (!targetSession) {
                return null;
            }

            const lsp = targetSession.lsp;
            if (!lsp) {
                return null;
            }

            try {
                const result = await lsp.requestSignatureHelp(params.code, params.position);
                if (!result || !result.signatures || result.signatures.length === 0) {
                    return null;
                }

                // Convert LSP signature help to our protocol format
                const signatures: LspProtocol.LspSignatureInformation[] = result.signatures.map((sig: any) => ({
                    label: sig.label,
                    documentation: sig.documentation,
                    parameters: sig.parameters?.map((p: any) => ({
                        label: p.label,
                        documentation: p.documentation
                    })),
                    activeParameter: sig.activeParameter
                }));

                return {
                    signatures,
                    activeSignature: result.activeSignature,
                    activeParameter: result.activeParameter
                };
            } catch (error) {
                this.log(`LSP signature help error: ${error}`, vscode.LogLevel.Warning);
                return null;
            }
        });
    }

    /**
     * Sends session info update to webview
     */
    private _sendSessionInfoUpdate(): void {
        if (!this._sessionManager && !this._consoleService) {
            this.log('_sendSessionInfoUpdate: No session source', vscode.LogLevel.Warning);
            return;
        }

        if (!this._connection) {
            // Connection not ready yet, mark as pending
            this.log('_sendSessionInfoUpdate: Connection not ready, marking as pending', vscode.LogLevel.Debug);
            this._pendingSessionInfoUpdate = true;
            return;
        }

        if (!this._webviewReady) {
            this.log('_sendSessionInfoUpdate: Webview not ready, marking as pending', vscode.LogLevel.Debug);
            this._pendingSessionInfoUpdate = true;
            return;
        }

        this._connection.sendNotification(
            SessionProtocol.SessionInfoNotification.type,
            this._buildSessionInfoSnapshot(),
        );

        // Clear pending flag
        this._pendingSessionInfoUpdate = false;
    }

    private _flushPendingConsoleSync(reason: string): void {
        if (!this._connection || !this._webviewReady) {
            return;
        }

        if (this._sessionManager || this._consoleService) {
            this._sendSessionInfoUpdate();
        }
        this._sendRuntimeStartupPhaseChanged();
        void this._sendConsoleThemeChanged();
        this._sendConsoleSettingsChanged();

        if (this._pendingRestoreStatesForInstances) {
            this._sendRestoreStatesForInstances();
            this._pendingRestoreStatesForInstances = false;
        }

        if (this._pendingLanguageSupportAssetsRefresh) {
            this._sendLanguageSupportAssetsChanged();
        }
    }

    private _buildSessionInfoSnapshot(): SessionProtocol.SessionInfoNotification.Params {
        const sessions = this._sessionSnapshotBuilder.buildSessionsWithConsoleOverlay();

        return {
            sessions,
            activeSessionId: this._sessionSnapshotBuilder.resolveForegroundConsoleSessionId(sessions, [
                this._sessionManager?.activeSessionId,
                this._consoleService?.activePositronConsoleInstance?.sessionId,
            ]),
        };
    }

    private async _sendConsoleThemeChanged(): Promise<void> {
        if (!this._connection || !this._webviewReady) {
            return;
        }

        const theme = await this._consoleThemeProvider.getConsoleThemeData();
        this._connection.sendNotification(ConsoleProtocol.ConsoleThemeChangedNotification.type, {
            theme,
        });
    }

    private _sendLanguageSupportAssetsChanged(): void {
        if (!this._connection || !this._webviewReady || !this._view) {
            this._pendingLanguageSupportAssetsRefresh = true;
            return;
        }

        this._connection.sendNotification(
            ConsoleProtocol.LanguageSupportAssetsChangedNotification.type,
            {
                modules: this._getLanguageMonacoSupportModuleUris(this._view.webview),
                grammars: this._getLanguageTextMateGrammarDefinitions(this._view.webview),
            },
        );
        this._pendingLanguageSupportAssetsRefresh = false;
    }

    private _sendRuntimeStartupPhaseChanged(): void {
        if (!this._connection || !this._webviewReady || !this._runtimeStartupService) {
            return;
        }

        const phase = this._runtimeStartupService.startupPhase;
        if (phase === 'complete' || phase === 'discovering' || phase === 'awaitingTrust') {
            this._runtimeStartupEvent = undefined;
        }

        this._connection.sendNotification(ConsoleProtocol.RuntimeStartupPhaseNotification.type, {
            phase,
            discoveredCount: this._runtimeStartupService.discoveredRuntimeCount,
            runtimeStartupEvent: this._runtimeStartupEvent,
        });
    }

    private _warnMissingSession(action: string): void {
        if (this._missingSessionWarnings.has(action)) {
            return;
        }
        this._missingSessionWarnings.add(action);
        this.log(`[ConsoleViewProvider] ${action} missing sessionId; dropping`, vscode.LogLevel.Warning);
    }

    private _resolveSessionForRequest(action: string, sessionId?: string): RuntimeSession | undefined {
        if (!sessionId) {
            this._warnMissingSession(action);
            return undefined;
        }

        const session = this._sessionManager?.getSession(sessionId);

        if (!session) {
            this.log(`[ConsoleViewProvider] ${action}: session ${sessionId} not found`, vscode.LogLevel.Warning);
        }

        return session;
    }

    private _resolveConsoleInstance(action: string, sessionId?: string): IPositronConsoleInstance | undefined {
        if (!this._consoleService) {
            this.log(`[ConsoleViewProvider] ${action}: console service not available`, vscode.LogLevel.Debug);
            return undefined;
        }

        const instance = sessionId
            ? this._consoleService.getConsoleInstance(sessionId)
            : this._consoleService.activePositronConsoleInstance;

        if (!instance) {
            this.log(`[ConsoleViewProvider] ${action}: console instance not found`, vscode.LogLevel.Debug);
        }

        return instance;
    }

    protected _getHtmlContent(webview: vscode.Webview): string {
        const scriptUri = this._getWebviewUri(webview, 'webview', 'dist', 'console', 'index.js');
        const styleUri = this._getWebviewUri(webview, 'webview', 'dist', 'console', 'index.css');
        const languageMonacoSupportModules = this._serializeInlineScriptData(
            this._getLanguageMonacoSupportModuleUris(webview)
        );
        const languageTextMateGrammars = this._serializeInlineScriptData(
            this._getLanguageTextMateGrammarDefinitions(webview)
        );
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource}; worker-src blob:;">
    <link href="${styleUri}" rel="stylesheet">
    <title>Console</title>
</head>
<body>
    <div id="app"></div>
    <script nonce="${nonce}">
        globalThis.__arkLanguageMonacoSupportModules = ${languageMonacoSupportModules};
        globalThis.__arkLanguageTextMateGrammars = ${languageTextMateGrammars};
    </script>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Gets the configured console scrollback size.
     */
    private _getScrollbackSize(): number {
        const config = vscode.workspace.getConfiguration(CoreConfigurationSections.supervisor);
        const size = config.get<number>('console.scrollbackSize');
        if (typeof size === 'number' && Number.isFinite(size)) {
            return Math.max(0, size);
        }
        return 1000;
    }

    /**
     * Gets the configured console settings.
     */
    private _getConsoleSettings(): ConsoleProtocol.ConsoleSettings {
        const config = vscode.workspace.getConfiguration(CoreConfigurationSections.supervisor);
        const editorConfig = vscode.workspace.getConfiguration('editor');

        const appearance = resolveConsoleAppearance({
            configuredFontFamily: config.get<string>('console.fontFamily'),
            editorFontFamily: editorConfig.get<string>('fontFamily'),
            configuredFontSize: config.get<number>('console.fontSize'),
            configuredFontSizeInspection: config.inspect<number>('console.fontSize'),
            editorFontSize: editorConfig.get<number>('fontSize'),
            configuredLineHeight: config.get<number>('console.lineHeight'),
            configuredLineHeightInspection: config.inspect<number>('console.lineHeight'),
            editorLineHeight: editorConfig.get<number>('lineHeight'),
        });

        return {
            scrollbackSize: this._getScrollbackSize(),
            fontFamily: appearance.fontFamily,
            fontSize: appearance.fontSize,
            lineHeight: appearance.lineHeight,
        };
    }

    /**
     * Sends the current console settings to the webview.
     */
    private _sendConsoleSettingsChanged(): void {
        if (!this._connection || !this._webviewReady) {
            return;
        }

        this._connection.sendNotification(
            ConsoleProtocol.ConsoleSettingsChangedNotification.type,
            this._getConsoleSettings(),
        );
    }

    /**
     * Clears the console output
     */
    clearOutput(sessionId: string, reason?: 'user' | 'runtime'): void {
        if (!sessionId) {
            this._warnMissingSession('clearOutput');
            return;
        }
        this._lastClearReasons.set(sessionId, reason);
        if (reason === 'user') {
            this._sendFocusInput(sessionId);
        }
    }

    /**
     * Sends a reveal execution request to the webview.
     */
    sendRevealExecution(executionId: string, sessionId?: string): void {
        if (!sessionId) {
            this._warnMissingSession('revealExecution');
            return;
        }
        this._connection?.sendNotification(ConsoleProtocol.RevealExecutionNotification.type, {
            executionId,
            sessionId
        });
    }

    private _sendFocusInput(sessionId: string): void {
        this._connection?.sendNotification(ConsoleProtocol.FocusInputNotification.type, { sessionId });
    }

    private _sendPasteText(sessionId: string, text: string): void {
        this._connection?.sendNotification(ConsoleProtocol.PasteTextNotification.type, { sessionId, text });
    }

    private _sendSelectAll(sessionId: string): void {
        this._connection?.sendNotification(ConsoleProtocol.SelectAllNotification.type, { sessionId });
    }

    private _sendHistoryNavigateUp(sessionId: string, usingPrefixMatch: boolean): void {
        this._connection?.sendNotification(ConsoleProtocol.NavigateInputHistoryUpNotification.type, {
            sessionId,
            usingPrefixMatch
        });
    }

    private _sendHistoryNavigateDown(sessionId: string): void {
        this._connection?.sendNotification(ConsoleProtocol.NavigateInputHistoryDownNotification.type, { sessionId });
    }

    private _sendHistoryClear(sessionId: string): void {
        this._connection?.sendNotification(ConsoleProtocol.ClearInputHistoryNotification.type, { sessionId });
    }

    private _sendPendingCode(sessionId: string, code?: string): void {
        this._connection?.sendNotification(ConsoleProtocol.SetPendingCodeNotification.type, { sessionId, code });
    }

    private _sendPendingInputChanged(sessionId: string, code: string | undefined, inputPrompt: string): void {
        this._connection?.sendNotification(ConsoleProtocol.PendingInputChangedNotification.type, {
            sessionId,
            code,
            inputPrompt,
        });
    }

    private _sendHistoryAdd(sessionId: string, code: string): void {
        const trimmed = code.trim();
        if (!trimmed) {
            return;
        }
        this._connection?.sendNotification(ConsoleProtocol.HistoryAddNotification.type, {
            sessionId,
            input: trimmed,
            when: Date.now()
        });
    }

    private _sendResourceUsage(sessionId: string, usage: ConsoleProtocol.RuntimeResourceUsage): void {
        this._connection?.sendNotification(ConsoleProtocol.ResourceUsageNotification.type, {
            sessionId,
            usage
        });
    }

    private _sendSessionMetadataUpdate(
        sessionId: string,
        metadata: {
            trace?: boolean;
            wordWrap?: boolean;
            inputPrompt?: string;
            continuationPrompt?: string;
            workingDirectory?: string | null;
        }
    ): void {
        if (!this._connection || !this._webviewReady) {
            this._pendingRestoreStatesForInstances = true;
            return;
        }

        const syncSeq = this._nextSyncSeq(sessionId);
        this._connection.sendNotification(
            ConsoleProtocol.ConsoleSessionMetadataChangedNotification.type,
            {
                sessionId,
                syncSeq,
                ...metadata,
            },
        );
    }

    private _sendRuntimeChanges(
        sessionId: string,
        changes: ConsoleProtocol.ConsoleRuntimeChange[],
    ): void {
        if (!this._connection || !this._webviewReady) {
            this._pendingRestoreStatesForInstances = true;
            return;
        }

        if (changes.length === 0) {
            return;
        }

        const syncSeq = this._nextSyncSeq(sessionId);
        this._connection.sendNotification(
            ConsoleProtocol.ConsoleRuntimeChangesNotification.type,
            { sessionId, syncSeq, changes },
        );
    }

    // =========================================================================
    // Runtime Event Bus Handlers (Positron 1:1 Pattern)
    // =========================================================================

    /**
     * Subscribes to RuntimeSessionService runtime-global UI events.
     */
    private _subscribeToRuntimeEvents(): void {
        if (!this._sessionManager) {
            return;
        }

        this._consoleServiceDisposables.push(
            this._sessionManager.onDidReceiveRuntimeEvent((runtimeEvent) => {
                this._handleRuntimeEvent(runtimeEvent);
            })
        );
    }

    /**
     * Handles runtime-global UI events (UiFrontendEvent).
     */
    private _handleRuntimeEvent(runtimeEvent: ILanguageRuntimeGlobalEvent): void {
        const sessionId = runtimeEvent.session_id;
        switch (runtimeEvent.event.name) {
            case UiFrontendEvent.ClearConsole:
                if (this._consoleService?.getConsoleInstance(sessionId)?.clearConsole()) {
                    this.clearOutput(sessionId, 'runtime');
                }
                break;
        }
    }

    // =========================================================================
    // Console Service Event Subscriptions (Positron 1:1 Pattern)
    // =========================================================================

    /**
     * Subscribes to PositronConsoleService events to forward them to the webview.
     * This implements the Positron 1:1 event-driven pattern for session lifecycle.
     */
    private _subscribeToConsoleServiceEvents(): void {
        if (!this._consoleService) {
            return;
        }

        this.log('[ConsoleViewProvider] Subscribing to console service events', vscode.LogLevel.Debug);

        // Forward onDidStartPositronConsoleInstance to webview
        this._consoleServiceDisposables.push(
            this._consoleService.onDidStartPositronConsoleInstance(instance => {
                this.log(`[ConsoleViewProvider] Console instance started: ${instance.sessionId}`, vscode.LogLevel.Debug);
                this._sendSessionInfoUpdate();
                this._subscribeToConsoleInstanceEvents(instance);
            })
        );

        // Forward onDidDeletePositronConsoleInstance to webview
        this._consoleServiceDisposables.push(
            this._consoleService.onDidDeletePositronConsoleInstance(instance => {
                this.log(`[ConsoleViewProvider] Console instance deleted: ${instance.sessionId}`, vscode.LogLevel.Debug);
                this._unsubscribeFromConsoleInstanceEvents(instance.sessionId);
                this._suppressStartupNotificationOnce.delete(instance.sessionId);
                this._sendSessionInfoUpdate();
            })
        );

        // Forward onDidChangeActivePositronConsoleInstance to webview
        this._consoleServiceDisposables.push(
            this._consoleService.onDidChangeActivePositronConsoleInstance(instance => {
                this.log(`[ConsoleViewProvider] Active console instance changed: ${instance?.sessionId || 'none'}`, vscode.LogLevel.Debug);
                this._sendSessionInfoUpdate();
            })
        );

        // Forward reveal execution requests to webview
        this._consoleServiceDisposables.push(
            this._consoleService.onDidRevealExecution(event => {
                this.sendRevealExecution(event.executionId, event.sessionId);
            })
        );

        this._consoleServiceDisposables.push(
            this._consoleService.onDidChangePendingInput(event => {
                this._sendPendingInputChanged(
                    event.sessionId,
                    event.code,
                    event.inputPrompt,
                );
            })
        );

        // Forward console appearance settings changes to the webview.
        this._consoleServiceDisposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (
                    e.affectsConfiguration(CoreConfigurationKeys.consoleScrollbackSize) ||
                    e.affectsConfiguration(CoreConfigurationKeys.consoleFontSize) ||
                    e.affectsConfiguration(CoreConfigurationKeys.consoleFontFamily) ||
                    e.affectsConfiguration(CoreConfigurationKeys.consoleLineHeight) ||
                    e.affectsConfiguration('editor.fontFamily') ||
                    e.affectsConfiguration('editor.fontSize') ||
                    e.affectsConfiguration('editor.lineHeight')
                ) {
                    this._sendConsoleSettingsChanged();
                }
            })
        );

        // Seed existing instances (in case provider is created after sessions)
        for (const instance of this._consoleService.positronConsoleInstances) {
            this._subscribeToConsoleInstanceEvents(instance);
        }
    }

    private _subscribeToConsoleInstanceEvents(instance: IPositronConsoleInstance): void {
        const sessionId = instance.sessionId;
        if (this._consoleInstanceSubscriptions.has(sessionId)) {
            return;
        }

        const disposables: vscode.Disposable[] = [];

        disposables.push(instance.onFocusInput(() => {
            this._sendFocusInput(sessionId);
        }));

        disposables.push(instance.onDidPasteText(text => {
            this._sendPasteText(sessionId, text);
        }));

        disposables.push(instance.onDidSelectAll(() => {
            this._sendSelectAll(sessionId);
        }));

        disposables.push(instance.onDidNavigateInputHistoryUp(e => {
            this._sendHistoryNavigateUp(sessionId, e.usePrefixMatch ?? false);
        }));

        disposables.push(instance.onDidNavigateInputHistoryDown(() => {
            this._sendHistoryNavigateDown(sessionId);
        }));

        disposables.push(instance.onDidClearInputHistory(() => {
            this._sendHistoryClear(sessionId);
        }));

        // Add executed code to webview history (1:1 Positron pattern).
        // In Positron, consoleInput.tsx listens for onDidExecuteCode and adds the
        // code to its local HistoryNavigator2. Here we bridge the same event to
        // the webview via the historyAdd notification so that code executed from
        // the editor (Ctrl+Enter) is available for ArrowUp/Down recall.
        disposables.push(instance.onDidExecuteCode(({ code, mode }) => {
            if (mode === RuntimeCodeExecutionMode.Interactive ||
                mode === RuntimeCodeExecutionMode.NonInteractive) {
                this._sendHistoryAdd(sessionId, code);
            }
        }));

        disposables.push(instance.onDidSetPendingCode(code => {
            this._sendPendingCode(sessionId, code);
        }));

        disposables.push(instance.onDidChangePrompt(() => {
            this._sendSessionMetadataUpdate(sessionId, {
                inputPrompt: instance.inputPrompt,
                continuationPrompt: instance.continuationPrompt,
            });
            this._sendSessionInfoUpdate();
        }));

        disposables.push(instance.onDidChangeWorkingDirectory((workingDirectory) => {
            this._sendSessionMetadataUpdate(sessionId, {
                workingDirectory: workingDirectory ?? null,
            });
        }));

        disposables.push(instance.onDidChangeWordWrap(() => {
            this._sendSessionMetadataUpdate(sessionId, {
                wordWrap: instance.wordWrap,
            });
        }));

        disposables.push(instance.onDidChangeTrace(() => {
            this._sendSessionMetadataUpdate(sessionId, {
                trace: instance.trace,
            });
        }));

        disposables.push(instance.onDidAttachSession(() => {
            this._sendSessionInfoUpdate();
        }));

        disposables.push(instance.onDidChangeState(() => {
            this._sendSessionInfoUpdate();
        }));

        disposables.push(instance.onDidChangeRuntimeItems((events) => {
            if (events.some((event) => event.kind === 'restore')) {
                this._sendSessionInfoUpdate();
                this._sendRestoreStateForInstance(sessionId);
                return;
            }

            if (events.some((event) =>
                event.kind === 'appendActivityItem' &&
                event.item.type === 'prompt'
            )) {
                this._sendSessionInfoUpdate();
            }

            const changes: ConsoleProtocol.ConsoleRuntimeChange[] = [];
            for (const event of events) {
                switch (event.kind) {
                    case 'appendRuntimeItem':
                        changes.push({
                            kind: 'appendRuntimeItem',
                            runtimeItem: event.item,
                        });
                        break;
                    case 'appendActivityItem':
                        changes.push({
                            kind: 'appendActivityItem',
                            parentId: event.parentId,
                            activityItem: event.item,
                        });
                        break;
                    case 'replaceActivityOutput':
                        changes.push({
                            kind: 'replaceActivityOutput',
                            parentId: event.parentId,
                            outputId: event.outputId,
                            activityItem: event.item,
                        });
                        break;
                    case 'clearActivityOutput':
                        changes.push({
                            kind: 'clearActivityOutput',
                            parentId: event.parentId,
                        });
                        break;
                    case 'updateActivityInputState':
                        changes.push({
                            kind: 'updateActivityInputState',
                            parentId: event.parentId,
                            state: event.state,
                        });
                        break;
                }
            }

            this._sendRuntimeChanges(sessionId, changes);
        }));

        // Only send restore state if this session hasn't been initialized
        // in the current webview lifecycle. Afterwards, runtime item updates
        // are mirrored through onDidChangeRuntimeItems.
        if (!this._initializedSessions.has(sessionId)) {
            this._sendRestoreStateForInstance(sessionId, {
                useCurrentSyncSeq: true,
            });
            this._initializedSessions.add(sessionId);
        }

        this._consoleInstanceSubscriptions.set(sessionId, disposables);
    }

    private _unsubscribeFromConsoleInstanceEvents(sessionId: string): void {
        const disposables = this._consoleInstanceSubscriptions.get(sessionId);
        if (disposables) {
            disposables.forEach(d => d.dispose());
            this._consoleInstanceSubscriptions.delete(sessionId);
        }
        this._deleteSyncSeq(sessionId);
    }

    /**
     * Sends restore state notifications for all existing console instances.
     */
    private _sendRestoreStatesForInstances(): void {
        if (!this._connection || !this._consoleService) {
            this._pendingRestoreStatesForInstances = true;
            return;
        }

        if (!this._webviewReady) {
            this._pendingRestoreStatesForInstances = true;
            return;
        }

        for (const instance of this._consoleService.positronConsoleInstances) {
            this._sendRestoreStateForInstance(instance.sessionId, {
                useCurrentSyncSeq: true,
            });
        }

        this._pendingRestoreStatesForInstances = false;
    }

    private _sendRestoreStateForInstance(
        sessionId: string,
        options?: {
            useCurrentSyncSeq?: boolean;
        },
    ): void {
        if (!this._connection || !this._consoleService || !this._webviewReady) {
            this._pendingRestoreStatesForInstances = true;
            return;
        }

        const instance = this._consoleService.getConsoleInstance(sessionId);
        if (!instance) {
            return;
        }

        const serializedState = this._consoleService.getSerializedState(sessionId);
        if (!serializedState) {
            return;
        }

        const state = {
            ...serializedState,
            inputPrompt: instance.inputPrompt,
            continuationPrompt: instance.continuationPrompt,
            workingDirectory: instance.workingDirectory ?? null,
        };
        const syncSeq = options?.useCurrentSyncSeq
            ? this._currentSyncSeq(sessionId)
            : this._nextSyncSeq(sessionId);

        this._connection.sendNotification(ConsoleProtocol.ConsoleRestoreStateNotification.type, {
            sessionId,
            syncSeq,
            state
        });
    }

}
