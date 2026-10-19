import * as vscode from 'vscode';
import {
    createMessageConnection,
    ErrorCodes,
    ResponseError,
    type MessageConnection,
} from 'vscode-jsonrpc/node';
import {
    SupervisorManagerRpc,
    SUPERVISOR_MANAGER_REQUEST_CANCELLED,
    type SupervisorConfigurationRequest,
    type SupervisorManagerActionRequest,
    type SupervisorManagerState,
    type SupervisorSessionActionRequest,
} from '../shared/supervisorManager';
import { WebviewMessageReader, WebviewMessageWriter } from '../rpc/webview/transport';
import {
    SupervisorManagementError,
    SupervisorManagerService,
} from '../supervisor/SupervisorManagerService';
import { BaseWebviewProvider } from './baseProvider';

/** One management editor per window, with polling owned by the visible Host panel. */
export class SupervisorManagerProvider extends BaseWebviewProvider implements vscode.Disposable {
    private _panel: vscode.WebviewPanel | undefined;
    private _timer: ReturnType<typeof setTimeout> | undefined;
    private _selectedId: string | undefined;
    private _lastState: SupervisorManagerState | undefined;
    private _refreshAbort: AbortController | undefined;
    private _pending: Promise<unknown> = Promise.resolve();
    private _disposed = false;
    private _panelDisposables: vscode.Disposable[] = [];

    constructor(
        extensionUri: vscode.Uri,
        outputChannel: vscode.LogOutputChannel,
        private readonly _service: SupervisorManagerService,
    ) {
        super(extensionUri, outputChannel);
    }

    open(): void {
        if (this._disposed) {
            return;
        }
        if (this._panel) {
            this._panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'supervisor.manager',
            vscode.l10n.t('Kernel Supervisor Manager'),
            vscode.ViewColumn.Active,
            { retainContextWhenHidden: true },
        );
        this._panel = panel;
        panel.iconPath = new vscode.ThemeIcon('server-process');
        this._applyWebviewOptions(panel.webview);
        this._connection = createMessageConnection(
            new WebviewMessageReader(panel.webview),
            new WebviewMessageWriter(panel.webview),
        );
        this._registerRpcHandlers(this._connection);
        this._connection.listen();
        panel.webview.html = this._getHtmlContent(panel.webview);
        this._panelDisposables.push(
            panel.onDidDispose(() => this.closePanel()),
            panel.onDidChangeViewState(() => {
                this.clearTimer();
                if (!panel.visible) {
                    this._refreshAbort?.abort();
                }
                if (panel.visible) {
                    this.scheduleRefresh(0);
                }
            }),
        );
        // The Webview's initial getState request starts the refresh loop.
    }

    private enqueue<T>(task: (panel: vscode.WebviewPanel) => Promise<T>): Promise<T> {
        const panel = this._panel;
        const operation = this._pending
            .then(() => {
                if (this._disposed || !panel || this._panel !== panel) {
                    throw new vscode.CancellationError();
                }
                return task(panel);
            })
            .catch((error) => {
                if (error instanceof vscode.CancellationError) {
                    throw new ResponseError(
                        SUPERVISOR_MANAGER_REQUEST_CANCELLED,
                        'Supervisor refresh cancelled',
                    );
                }
                throw new ResponseError(
                    ErrorCodes.InternalError,
                    error instanceof SupervisorManagementError
                        ? error.message
                        : vscode.l10n.t(
                              'Unable to complete the supervisor operation. Refresh and check the Supervisor log.',
                          ),
                );
            });
        this._pending = operation.catch(() => undefined);
        return operation;
    }

    private async refresh(panel: vscode.WebviewPanel): Promise<SupervisorManagerState> {
        if (this._panel !== panel || this._disposed) {
            throw new vscode.CancellationError();
        }
        // Navigation actions can hide this editor before their response is sent.
        if (!panel.visible) {
            if (this._lastState) {
                return this._lastState;
            }
            throw new vscode.CancellationError();
        }
        const controller = new AbortController();
        this._refreshAbort = controller;
        try {
            const state = await this._service.getState(this._selectedId, controller.signal);
            if (this._panel !== panel || controller.signal.aborted) {
                throw new vscode.CancellationError();
            }
            this._selectedId = state.selectedId;
            this._lastState = state;
            this.scheduleRefresh();
            return state;
        } finally {
            if (this._refreshAbort === controller) {
                this._refreshAbort = undefined;
            }
        }
    }

    private clearTimer(): void {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = undefined;
        }
    }

    private scheduleRefresh(delay = 5000): void {
        this.clearTimer();
        if (!this._panel?.visible || this._disposed) {
            return;
        }
        const panel = this._panel;
        this._timer = setTimeout(() => {
            this._timer = undefined;
            void this.enqueue(async () => {
                if (!panel.visible) {
                    return;
                }
                const state = await this.refresh(panel);
                if (this._panel === panel) {
                    await this._connection?.sendNotification(SupervisorManagerRpc.state, state);
                }
            }).catch(() => {
                // Retry without sending raw Host/HTTP exceptions across the boundary.
                this.scheduleRefresh();
            });
        }, delay);
    }

    protected get _providerName(): string {
        return 'SupervisorManagerProvider';
    }

    protected _registerRpcHandlers(connection: MessageConnection): void {
        connection.onRequest(SupervisorManagerRpc.getState, (params?: { selectedId?: unknown }) =>
            this.enqueue(async (panel) => {
                if (params?.selectedId !== undefined && typeof params.selectedId !== 'string') {
                    throw new Error('Invalid supervisor identifier');
                }
                this._selectedId = (params?.selectedId as string | undefined) ?? this._selectedId;
                return this.refresh(panel);
            }),
        );
        connection.onRequest(
            SupervisorManagerRpc.action,
            (params: SupervisorManagerActionRequest) =>
                this.enqueue(async (panel) => {
                    if (
                        !params ||
                        typeof params.instanceId !== 'string' ||
                        ![
                            'showLogs',
                            'openWorkspace',
                            'restart',
                            'shutdown',
                            'openSettings',
                        ].includes(params.action)
                    ) {
                        throw new Error('Invalid supervisor action');
                    }
                    await this._service.runAction(params);
                    return this.refresh(panel);
                }),
        );
        connection.onRequest(
            SupervisorManagerRpc.configure,
            (params: SupervisorConfigurationRequest) =>
                this.enqueue(async (panel) => {
                    if (
                        !params ||
                        typeof params.instanceId !== 'string' ||
                        !params.configuration ||
                        typeof params.configuration !== 'object' ||
                        Array.isArray(params.configuration)
                    ) {
                        throw new Error('Invalid supervisor configuration');
                    }
                    await this._service.configure(params.instanceId, params.configuration);
                    return this.refresh(panel);
                }),
        );
        connection.onRequest(
            SupervisorManagerRpc.sessionAction,
            (params: SupervisorSessionActionRequest) =>
                this.enqueue(async (panel) => {
                    if (
                        !params ||
                        typeof params.instanceId !== 'string' ||
                        typeof params.sessionId !== 'string' ||
                        !['reconnect', 'focus'].includes(params.action)
                    ) {
                        throw new Error('Invalid session action');
                    }
                    await this._service.runSessionAction(params);
                    return this.refresh(panel);
                }),
        );
    }

    protected _getHtmlContent(webview: vscode.Webview): string {
        const script = this._getWebviewUri(
            webview,
            'webview',
            'dist',
            'supervisorManager',
            'index.js',
        );
        const commonStyle = this._getWebviewUri(webview, 'webview', 'dist', 'common', 'index.css');
        const style = this._getWebviewUri(
            webview,
            'webview',
            'dist',
            'supervisorManager',
            'index.css',
        );
        const nonce = this._getNonce();
        return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:;">
    <link href="${commonStyle}" rel="stylesheet">
    <link href="${style}" rel="stylesheet">
    <title>Kernel Supervisor Manager</title>
</head>
<body>
    <div id="app"></div>
    ${this._getLocalizationInlineScript(nonce)}
    <script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
    }

    private closePanel(): void {
        this.clearTimer();
        this._refreshAbort?.abort();
        this._refreshAbort = undefined;
        this._connection?.dispose();
        this._connection = undefined;
        this._panel = undefined;
        this._selectedId = undefined;
        this._lastState = undefined;
        this._panelDisposables.splice(0).forEach((disposable) => disposable.dispose());
    }

    dispose(): void {
        this._disposed = true;
        const panel = this._panel;
        this.closePanel();
        panel?.dispose();
    }
}
