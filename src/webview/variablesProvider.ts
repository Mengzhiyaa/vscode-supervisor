import * as vscode from 'vscode';
import { MessageConnection } from 'vscode-jsonrpc';
import { BaseWebviewProvider } from './baseProvider';
import * as VariablesProtocol from '../rpc/webview/variables';
import * as SessionProtocol from '../rpc/webview/session';
import { RuntimeSession } from '../runtime/session';
import { RuntimeSessionService } from '../runtime/runtimeSession';
import {
    PositronVariablesService,
    IPositronVariablesInstance,
    PositronVariablesGrouping,
    PositronVariablesSorting,
    RuntimeClientState,
    RuntimeClientStatus,
    Variable,
    VariableEntry,
    isVariableGroup,
    isVariableItem,
    isVariableOverflow,
    IVariableItem
} from '../services/variables';
import { SessionSnapshotBuilder } from './sessionSnapshotBuilder';

/**
 * Webview provider for the Variables sidebar view.
 * Displays environment variables from the R kernel.
 *
 * Uses PositronVariablesService for per-session lifecycle and state.
 */
export class VariablesViewProvider extends BaseWebviewProvider {
    private readonly _disposables: vscode.Disposable[] = [];
    private _pendingSessionInfoUpdate = false;
    private _webviewReady = false;
    private readonly _sessionSnapshotBuilder: SessionSnapshotBuilder;

    private readonly _instanceDisposables = new Map<string, vscode.Disposable[]>();
    private readonly _sessionEntries = new Map<string, VariablesProtocol.VariableEntry[]>();
    private readonly _sessionVariables = new Map<string, VariablesProtocol.Variable[]>();
    private readonly _lastInstancePayloads = new Map<string, string>();

    constructor(
        extensionUri: vscode.Uri,
        outputChannel: vscode.LogOutputChannel,
        private readonly _sessionManager: RuntimeSessionService | undefined,
        private readonly _variablesService: PositronVariablesService,
        getAdditionalLocalResourceRoots: () => readonly vscode.Uri[] = () => [],
    ) {
        super(extensionUri, outputChannel, getAdditionalLocalResourceRoots);
        this._sessionSnapshotBuilder = new SessionSnapshotBuilder(this._sessionManager);
        this._subscribeToVariablesServiceEvents();
        this._seedInstancesFromService();

        if (this._sessionManager) {
            this._disposables.push(
                this._sessionManager.onDidChangeForegroundSession(() => {
                    this._sendSessionInfoUpdate();
                }),
                this._sessionManager.onDidUpdateSessionName(() => {
                    this._sendSessionInfoUpdate();
                }),
                this._sessionManager.onDidDeleteRuntimeSession(() => {
                    this._sendSessionInfoUpdate();
                }),
                this._sessionManager.onDidChangeSessionState(() => {
                    this._sendSessionInfoUpdate();
                })
            );
        }
    }

    protected get _providerName(): string {
        return 'VariablesViewProvider';
    }

    override resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ): void | Thenable<void> {
        super.resolveWebviewView(webviewView, context, token);

        this._variablesService.setViewVisible(true);

        webviewView.onDidChangeVisibility(() => {
            this._variablesService.setViewVisible(webviewView.visible);
        });

        webviewView.onDidDispose(() => {
            this._variablesService.setViewVisible(false);
        });
    }

    /**
     * Subscribes to a session's events (multi-session support).
     * Session lifecycle is handled by PositronVariablesService; we only refresh session info.
     */
    subscribeToSession(session: RuntimeSession): void {
        void session;
        this._sendSessionInfoUpdate();
    }

    /**
     * Unsubscribes from a session's events.
     * Session lifecycle is handled by PositronVariablesService; we only refresh session info.
     */
    unsubscribeFromSession(sessionId: string): void {
        void sessionId;
        this._sendSessionInfoUpdate();
    }

    private _subscribeToVariablesServiceEvents(): void {
        this._disposables.push(
            this._variablesService.onDidStartPositronVariablesInstance(instance => {
                this._handleVariablesInstanceStarted(instance);
            }),
            this._variablesService.onDidStopPositronVariablesInstance(instance => {
                this._handleVariablesInstanceStopped(instance);
            }),
            this._variablesService.onDidChangeActivePositronVariablesInstance(instance => {
                this._sendActiveVariablesInstanceChanged(instance?.session.sessionId);
                this._sendSessionInfoUpdate();
            })
        );
    }

    private _seedInstancesFromService(): void {
        for (const instance of this._variablesService.positronVariablesInstances) {
            this._handleVariablesInstanceStarted(instance);
        }
    }

    private _handleVariablesInstanceStarted(instance: IPositronVariablesInstance): void {
        const sessionId = instance.session.sessionId;
        if (this._instanceDisposables.has(sessionId)) {
            return;
        }

        const disposables: vscode.Disposable[] = [];
        disposables.push(
            instance.onDidChangeEntries(entries => {
                this._handleEntriesChanged(instance, entries);
            }),
            instance.onDidChangeState(() => {
                this._sendVariablesInstanceUpdate(instance);
            }),
            instance.onDidChangeStatus(() => {
                this._sendVariablesInstanceUpdate(instance);
            })
        );

        this._instanceDisposables.set(sessionId, disposables);
        this._sendVariablesInstanceUpdate(instance);

        // Trigger refresh to populate data when instance is ready
        instance.requestRefresh();
    }

    private _handleVariablesInstanceStopped(instance: IPositronVariablesInstance): void {
        const sessionId = instance.session.sessionId;
        const disposables = this._instanceDisposables.get(sessionId);
        if (disposables) {
            disposables.forEach(d => d.dispose());
            this._instanceDisposables.delete(sessionId);
        }

        const previousEntries = this._sessionEntries.get(sessionId) ?? [];
        this._sessionVariables.delete(sessionId);
        this._sessionEntries.delete(sessionId);

        if (previousEntries.length > 0) {
            this.sendVariableEntriesChanged([], sessionId);
        }

        this._sendVariablesInstanceStopped(sessionId);
    }

    private _handleEntriesChanged(
        instance: IPositronVariablesInstance,
        entries: VariableEntry[],
    ): void {
        const sessionId = instance.session.sessionId;
        const currentEntries = this._convertVariableEntriesToProtocol(entries);
        this._sessionEntries.set(sessionId, currentEntries);
        this.sendVariableEntriesChanged(currentEntries, sessionId);

        // Update the cached flat variables for variables/list fallback.
        this._sessionVariables.set(sessionId, this._convertEntriesToProtocol(entries));

        this._sendVariablesInstanceUpdate(instance);
    }

    protected _registerRpcHandlers(connection: MessageConnection): void {
        this._webviewReady = false;
        this._lastInstancePayloads.clear();

        connection.onNotification(VariablesProtocol.VariablesReadyNotification.type, () => {
            this.log('Received variables/ready from webview', vscode.LogLevel.Debug);
            this._webviewReady = true;
            this._flushPendingVariablesSync();
        });

        connection.onRequest('session/list', async () => {
            this.log('Session list request', vscode.LogLevel.Debug);
            return this._buildSessionInfoSnapshot();
        });

        connection.onRequest(VariablesProtocol.ListVariablesRequest.type, async (params) => {
            const sessionId = this._resolveSessionId(params?.sessionId);
            if (!sessionId) {
                return { variables: [] };
            }
            const instance = this._variablesService.getVariablesInstance(sessionId);
            const cached = this._sessionVariables.get(sessionId) ?? [];

            if (instance) {
                try {
                    const raw = await instance.list();
                    const variables = this._convertToProtocol(raw);
                    if (sessionId) {
                        this._sessionVariables.set(sessionId, variables);
                    }
                    return { variables };
                } catch (e) {
                    this.log(`Failed to list variables: ${e}`, vscode.LogLevel.Warning);
                }
            }

            return { variables: cached };
        });

        connection.onRequest(VariablesProtocol.InspectVariableRequest.type, async (params) => {
            const sessionId = this._resolveSessionId(params.sessionId);
            if (!sessionId) {
                return { children: [] };
            }
            const instance = this._variablesService.getVariablesInstance(sessionId);
            if (instance) {
                try {
                    const result = await instance.inspect(params.path);
                    const children = result.children ?? [];
                    return {
                        children: this._convertToProtocol(children, params.path),
                        length: result.length
                    };
                } catch (e) {
                    this.log(`Failed to inspect variable: ${e}`, vscode.LogLevel.Warning);
                }
            }

            return { children: [] };
        });

        connection.onRequest(VariablesProtocol.SetActiveVariablesSessionRequest.type, async (params) => {
            const sessionId = this._resolveSessionId(params.sessionId);
            if (!sessionId) {
                return;
            }

            if (this._sessionManager?.getSession(sessionId)) {
                this._sessionManager.focusSession(sessionId);
            }

            // Keep the variables service aligned even when the requested session
            // is already the foreground session and sessionManager emits no change.
            this._variablesService.setActivePositronVariablesSession(sessionId);
            this._sendSessionInfoUpdate();
        });

        connection.onRequest(VariablesProtocol.ListVariableEntriesRequest.type, async (params) => {
            const sessionId = this._resolveSessionId(params?.sessionId);
            if (!sessionId) {
                return { entries: [] };
            }

            return {
                entries: this._sessionEntries.get(sessionId) ?? []
            };
        });

        connection.onRequest(VariablesProtocol.SetVariablesGroupingRequest.type, async (params) => {
            const instance = this._variablesService.activePositronVariablesInstance;
            if (!instance) {
                return;
            }

            switch (params.grouping) {
                case 'none':
                    instance.grouping = PositronVariablesGrouping.None;
                    break;
                case 'kind':
                    instance.grouping = PositronVariablesGrouping.Kind;
                    break;
                case 'size':
                    instance.grouping = PositronVariablesGrouping.Size;
                    break;
            }
        });

        connection.onRequest(VariablesProtocol.SetVariablesSortingRequest.type, async (params) => {
            const instance = this._variablesService.activePositronVariablesInstance;
            if (!instance) {
                return;
            }

            switch (params.sorting) {
                case 'name':
                    instance.sorting = PositronVariablesSorting.Name;
                    break;
                case 'size':
                    instance.sorting = PositronVariablesSorting.Size;
                    break;
                case 'recent':
                    instance.sorting = PositronVariablesSorting.Recent;
                    break;
            }
        });

        connection.onRequest(VariablesProtocol.SetVariablesFilterRequest.type, async (params) => {
            const instance = this._variablesService.activePositronVariablesInstance;
            instance?.setFilterText(params.filterText);
        });

        connection.onRequest(VariablesProtocol.SetVariablesHighlightRecentRequest.type, async (params) => {
            const instance = this._variablesService.activePositronVariablesInstance;
            if (!instance) {
                return;
            }

            instance.highlightRecent = params.highlightRecent;
        });

        connection.onRequest(VariablesProtocol.ExpandVariableGroupRequest.type, async (params) => {
            const sessionId = this._resolveSessionId(params.sessionId);
            if (!sessionId) {
                return;
            }

            this._variablesService.getVariablesInstance(sessionId)?.expandVariableGroup(params.groupId);
        });

        connection.onRequest(VariablesProtocol.CollapseVariableGroupRequest.type, async (params) => {
            const sessionId = this._resolveSessionId(params.sessionId);
            if (!sessionId) {
                return;
            }

            this._variablesService.getVariablesInstance(sessionId)?.collapseVariableGroup(params.groupId);
        });

        connection.onRequest(VariablesProtocol.ExpandVariableItemRequest.type, async (params) => {
            const sessionId = this._resolveSessionId(params.sessionId);
            if (!sessionId) {
                return;
            }

            await this._variablesService.getVariablesInstance(sessionId)?.expandVariableItem(params.path);
        });

        connection.onRequest(VariablesProtocol.CollapseVariableItemRequest.type, async (params) => {
            const sessionId = this._resolveSessionId(params.sessionId);
            if (!sessionId) {
                return;
            }

            this._variablesService.getVariablesInstance(sessionId)?.collapseVariableItem(params.path);
        });

        connection.onRequest('variables/refresh', async (params?: { sessionId?: string }) => {
            const sessionId = this._resolveSessionId(params?.sessionId);
            if (!sessionId) {
                return;
            }

            this._variablesService.getVariablesInstance(sessionId)?.requestRefresh();
        });

        connection.onRequest('variables/clear', async (params?: { includeHidden?: boolean; sessionId?: string }) => {
            const sessionId = this._resolveSessionId(params?.sessionId);
            if (!sessionId) {
                return;
            }
            const instance = this._variablesService.getVariablesInstance(sessionId);
            if (instance) {
                instance.requestClear(params?.includeHidden ?? false);
            }
        });

        connection.onRequest('variables/delete', async (params: { names: string[]; sessionId?: string }) => {
            const sessionId = this._resolveSessionId(params.sessionId);
            if (!sessionId) {
                return;
            }
            const instance = this._variablesService.getVariablesInstance(sessionId);
            if (instance) {
                instance.requestDelete(params.names);
            }
        });

        connection.onRequest('variables/formatForClipboard', async (params: { name?: string; path?: string[]; format: string; sessionId?: string }) => {
            const targetPath = params.path ?? (params.name ? [params.name] : []);
            if (targetPath.length === 0) {
                return '';
            }

            const sessionId = this._resolveSessionId(params.sessionId);
            if (!sessionId) {
                return '';
            }
            const instance = this._variablesService.getVariablesInstance(sessionId);
            if (!instance) {
                return '';
            }

            try {
                return await instance.clipboardFormat(targetPath, params.format);
            } catch (e) {
                this.log(`Failed to format variable for clipboard: ${e}`, vscode.LogLevel.Warning);
                return '';
            }
        });

        connection.onRequest('variables/view', async (params: { name?: string; path?: string[]; sessionId?: string }) => {
            const targetPath = params.path ?? (params.name ? [params.name] : []);
            if (targetPath.length === 0) {
                return;
            }

            const sessionId = this._resolveSessionId(params.sessionId);
            if (!sessionId) {
                return;
            }
            const instance = this._variablesService.getVariablesInstance(sessionId);
            if (!instance) {
                return;
            }

            try {
                await instance.view(targetPath);
            } catch (e) {
                this.log(`Failed to open variable viewer: ${e}`, vscode.LogLevel.Warning);
            }
        });
    }

    protected _getHtmlContent(webview: vscode.Webview): string {
        const scriptUri = this._getWebviewUri(webview, 'webview', 'dist', 'variables', 'index.js');
        const styleUri = this._getWebviewUri(webview, 'webview', 'dist', 'variables', 'index.css');
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:;">
    <link href="${styleUri}" rel="stylesheet">
    <title>Variables</title>
</head>
<body>
    <div id="app"></div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }


    sendVariableEntriesChanged(entries: VariablesProtocol.VariableEntry[], sessionId?: string): void {
        if (!sessionId || !this._webviewReady) {
            return;
        }

        this._connection?.sendNotification(VariablesProtocol.VariableEntriesChangedNotification.type, {
            sessionId,
            entries
        });
    }

    private _sendSessionInfoUpdate(): void {
        if (!this._connection) {
            this._pendingSessionInfoUpdate = true;
            return;
        }

        if (!this._webviewReady) {
            this._pendingSessionInfoUpdate = true;
            return;
        }

        this._connection.sendNotification('session/info', this._buildSessionInfoSnapshot());
        this._pendingSessionInfoUpdate = false;
    }

    private _buildSessionInfoSnapshot(): SessionProtocol.SessionInfoNotification.Params {
        const sessions = this._sessionSnapshotBuilder.buildBaseSessions();

        return {
            sessions,
            activeSessionId: this._sessionSnapshotBuilder.resolveActiveSessionId(sessions, [
                this._variablesService.activePositronVariablesInstance?.session.sessionId,
                this._sessionManager?.activeSessionId,
            ]),
        };
    }

    private _flushPendingVariablesSync(): void {
        if (!this._connection || !this._webviewReady) {
            return;
        }

        this._sendSessionInfoUpdate();
        this._sendExistingVariablesInstanceNotifications();
        this._sendActiveVariablesInstanceChanged(
            this._variablesService.activePositronVariablesInstance?.session.sessionId
        );
        for (const [sessionId, entries] of this._sessionEntries.entries()) {
            this.sendVariableEntriesChanged(entries, sessionId);
        }
    }

    private _sendExistingVariablesInstanceNotifications(): void {
        for (const instance of this._variablesService.positronVariablesInstances) {
            this._sendVariablesInstanceUpdate(instance);
        }
    }

    private _sendVariablesInstanceUpdate(instance: IPositronVariablesInstance): void {
        if (!this._connection || !this._webviewReady) {
            return;
        }

        const payload: VariablesProtocol.VariablesInstanceInfo = {
            sessionId: instance.session.sessionId,
            state: this._mapVariablesClientState(instance.state),
            status: this._mapVariablesClientStatus(instance.status),
            grouping: this._mapVariablesGrouping(instance.grouping),
            sorting: this._mapVariablesSorting(instance.sorting),
            filterText: instance.getFilterText(),
            highlightRecent: instance.highlightRecent,
        };

        // Skip if nothing changed since last send for this session.
        const serialized = JSON.stringify(payload);
        if (this._lastInstancePayloads.get(payload.sessionId) === serialized) {
            return;
        }
        this._lastInstancePayloads.set(payload.sessionId, serialized);

        this._connection.sendNotification(
            VariablesProtocol.VariablesInstanceStartedNotification.type,
            { instance: payload }
        );
    }

    private _sendVariablesInstanceStopped(sessionId: string): void {
        if (!this._connection || !this._webviewReady) {
            return;
        }

        this._lastInstancePayloads.delete(sessionId);

        this._connection.sendNotification(
            VariablesProtocol.VariablesInstanceStoppedNotification.type,
            { sessionId }
        );
    }

    private _sendActiveVariablesInstanceChanged(sessionId: string | undefined): void {
        if (!this._connection || !this._webviewReady) {
            return;
        }

        this._connection.sendNotification(
            VariablesProtocol.ActiveVariablesInstanceChangedNotification.type,
            { sessionId }
        );
    }

    private _mapVariablesClientState(
        state: RuntimeClientState
    ): VariablesProtocol.VariablesInstanceInfo['state'] {
        switch (state) {
            case RuntimeClientState.Uninitialized:
                return 'uninitialized';
            case RuntimeClientState.Opening:
                return 'opening';
            case RuntimeClientState.Connected:
                return 'connected';
            case RuntimeClientState.Closing:
                return 'closing';
            case RuntimeClientState.Closed:
                return 'closed';
            default:
                return 'uninitialized';
        }
    }

    private _mapVariablesClientStatus(
        status: RuntimeClientStatus
    ): VariablesProtocol.VariablesInstanceInfo['status'] {
        switch (status) {
            case RuntimeClientStatus.Idle:
                return 'idle';
            case RuntimeClientStatus.Busy:
                return 'busy';
            case RuntimeClientStatus.Disconnected:
            default:
                return 'disconnected';
        }
    }

    private _mapVariablesGrouping(
        grouping: PositronVariablesGrouping,
    ): VariablesProtocol.VariablesInstanceInfo['grouping'] {
        switch (grouping) {
            case PositronVariablesGrouping.None:
                return 'none';
            case PositronVariablesGrouping.Size:
                return 'size';
            case PositronVariablesGrouping.Kind:
            default:
                return 'kind';
        }
    }

    private _mapVariablesSorting(
        sorting: PositronVariablesSorting,
    ): VariablesProtocol.VariablesInstanceInfo['sorting'] {
        switch (sorting) {
            case PositronVariablesSorting.Size:
                return 'size';
            case PositronVariablesSorting.Recent:
                return 'recent';
            case PositronVariablesSorting.Name:
            default:
                return 'name';
        }
    }

    private _resolveSessionId(sessionId?: string): string | undefined {
        if (!sessionId) {
            this.log('Request missing sessionId; dropping', vscode.LogLevel.Debug);
            return undefined;
        }
        return sessionId;
    }

    private _convertToProtocol(variables: Variable[], parentPath: string[] = []): VariablesProtocol.Variable[] {
        return variables.map(v => ({
            name: this._getProtocolName(v),
            path: [...parentPath, v.access_key],
            type: v.display_type,
            value: v.display_value,
            size: v.size,
            hasChildren: v.has_children,
            kind: v.kind,
            hasViewer: v.has_viewer
        }));
    }

    private _convertEntriesToProtocol(entries: VariableEntry[]): VariablesProtocol.Variable[] {
        const results: VariablesProtocol.Variable[] = [];
        const seen = new Set<string>();

        const pushItem = (item: IVariableItem) => {
            const accessKey = item.path[item.path.length - 1];
            const name = item.displayName || accessKey;
            const key = this._getVariableKey(item.path);
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            results.push({
                name,
                path: [...item.path],
                type: item.displayType,
                value: item.displayValue,
                size: item.size,
                hasChildren: item.hasChildren,
                kind: item.kind,
                hasViewer: item.hasViewer
            });
        };

        for (const entry of entries) {
            if (isVariableItem(entry)) {
                pushItem(entry);
            } else if (isVariableGroup(entry)) {
                for (const item of entry.variableItems) {
                    pushItem(item);
                }
            }
        }

        return results;
    }

    private _convertVariableEntriesToProtocol(entries: VariableEntry[]): VariablesProtocol.VariableEntry[] {
        const results: VariablesProtocol.VariableEntry[] = [];

        for (const entry of entries) {
            if (isVariableGroup(entry)) {
                results.push({
                    type: 'group' as const,
                    id: entry.id,
                    title: entry.title,
                    isExpanded: entry.isExpanded
                });
                continue;
            }

            if (isVariableItem(entry)) {
                results.push({
                    type: 'item' as const,
                    id: entry.id,
                    isExpanded: entry.isExpanded,
                    indentLevel: entry.indentLevel,
                    path: [...entry.path],
                    displayName: entry.displayName,
                    displayValue: entry.displayValue,
                    displayType: entry.displayType,
                    size: entry.size,
                    kind: entry.kind,
                    hasChildren: entry.hasChildren,
                    hasViewer: entry.hasViewer,
                    isRecent: entry.isRecent
                });
                continue;
            }

            if (isVariableOverflow(entry)) {
                results.push({
                    type: 'overflow' as const,
                    id: entry.id,
                    indentLevel: entry.indentLevel,
                    overflowValues: entry.overflowValues
                });
            }
        }

        return results;
    }



    private _getProtocolName(variable: Variable): string {
        return variable.display_name || variable.access_key;
    }

    private _getVariableKey(path: string[]): string {
        return JSON.stringify(path);
    }
}
