import * as vscode from 'vscode';
import { createMessageConnection, type MessageConnection } from 'vscode-jsonrpc/node';
import type { ILanguageRuntimeSession, IPositronPackagesInstance, LanguageRuntimePackage } from '../api';
import { WebviewMessageReader, WebviewMessageWriter } from '../rpc/webview/transport';
import { PositronPackagesService } from '../services/packages';
import type { PackageDetailAction, PackageDetailState } from '../shared/packages';
import { BaseWebviewProvider } from './baseProvider';

/** A detail editor keeps its originating instance, even when the foreground changes. */
export class PackageDetailProvider extends BaseWebviewProvider implements vscode.Disposable {
    readonly panel: vscode.WebviewPanel;
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _tokenSource = new vscode.CancellationTokenSource();
    private readonly _session: ILanguageRuntimeSession;
    private _lastKnownPackage: Partial<LanguageRuntimePackage> | undefined;
    private _detail: Partial<LanguageRuntimePackage> | undefined;
    private _loading = true;
    private _error: string | undefined;
    private _revision = 0;
    private _disposed = false;

    constructor(
        extensionUri: vscode.Uri,
        outputChannel: vscode.LogOutputChannel,
        private readonly _packagesService: PositronPackagesService,
        private readonly _instance: IPositronPackagesInstance,
        private readonly _packageName: string,
        initialPackage: LanguageRuntimePackage | undefined,
        private readonly _runAction: (action: PackageDetailAction, pkg: Partial<LanguageRuntimePackage> | undefined) => Promise<void>,
    ) {
        super(extensionUri, outputChannel);
        this._session = _instance.session;
        this._lastKnownPackage = initialPackage;
        this.panel = vscode.window.createWebviewPanel(
            'supervisor.packageDetail',
            vscode.l10n.t('Package: {0}', _packageName),
            { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
            { retainContextWhenHidden: true },
        );
        this.panel.iconPath = new vscode.ThemeIcon('package');
        this._applyWebviewOptions(this.panel.webview);
        this._connection = createMessageConnection(
            new WebviewMessageReader(this.panel.webview),
            new WebviewMessageWriter(this.panel.webview),
        );
        this._registerRpcHandlers(this._connection);
        this._connection.listen();
        this.panel.webview.html = this._getHtmlContent(this.panel.webview);
        const sendState = () => this._sendState();
        this._disposables.push(
            this.panel.onDidDispose(() => this.dispose()),
            this.panel.onDidChangeViewState(event => {
                if (event.webviewPanel.visible) {
                    this._sendState();
                }
            }),
            _packagesService.onDidChangeActivePackagesInstance(sendState),
            _packagesService.onDidStopPackagesInstance(sendState),
            _instance.onDidRefreshPackagesInstance(sendState),
            _instance.onDidChangeRefreshState(sendState),
            _instance.onDidChangeInstallState(sendState),
            _instance.onDidChangeUpdateState(sendState),
            _instance.onDidChangeUpdateAllState(sendState),
            _instance.onDidChangeUninstallState(sendState),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('packages.vulnerabilities.enabled')) {
                    this._sendState();
                }
            }),
        );
        void this._loadDetail();
    }

    protected get _providerName(): string {
        return 'PackageDetailProvider';
    }

    protected _registerRpcHandlers(connection: MessageConnection): void {
        connection.onRequest('packageDetail/getState', () => this._buildState());
        connection.onRequest('packageDetail/action', async (params: { action?: unknown }) => {
            const action = params?.action;
            if (action !== 'install' && action !== 'update' && action !== 'uninstall' && action !== 'help') {
                throw new Error('Unknown package action');
            }
            const state = this._buildState();
            if (!state.sessionAlive || !state.isActive || state.busy) {
                throw new Error(vscode.l10n.t('The package session changed. Please try again.'));
            }
            await this._runAction(action, state.package);
            this._sendState();
            return this._buildState();
        });
        connection.onRequest('packageDetail/openExternal', async (params: { url?: unknown }) => {
            const state = this._buildState();
            const url = typeof params?.url === 'string' ? params.url : '';
            // Only links supplied by the bound package may reach the external opener.
            if (url !== state.package?.url && !state.package?.vulnerabilities?.some(item => item.url === url)) {
                return false;
            }
            try {
                const uri = vscode.Uri.parse(url, true);
                if ((uri.scheme !== 'https' && uri.scheme !== 'http') || !uri.authority) {
                    return false;
                }
                return await vscode.env.openExternal(uri);
            } catch {
                return false;
            }
        });
    }

    private get _sessionAlive(): boolean {
        return this._packagesService.getInstance(this._session.sessionId) === this._instance &&
            this._instance.session === this._session;
    }

    private async _loadDetail(): Promise<void> {
        const token = this._tokenSource.token;
        try {
            const detail = await this._instance.getPackageDetail(this._packageName, token);
            if (!token.isCancellationRequested && this._sessionAlive) {
                this._detail = detail;
            }
        } catch (error) {
            if (!token.isCancellationRequested) {
                this._error = error instanceof Error ? error.message : String(error);
            }
        } finally {
            if (!this._disposed) {
                this._loading = false;
                this._sendState();
            }
        }
    }

    private _buildState(): PackageDetailState {
        const sessionAlive = this._sessionAlive;
        const livePackage = sessionAlive ? this._instance.packages.find(
            pkg => pkg.name.toLowerCase() === this._packageName.toLowerCase(),
        ) : undefined;
        if (livePackage) {
            this._lastKnownPackage = livePackage;
        }
        const pkg = { ...this._lastKnownPackage, ...this._detail };
        // Installation state and advisories come from the live list, not the detail fetch.
        if (livePackage) {
            Object.assign(pkg, {
                version: livePackage.version,
                attached: livePackage.attached,
                outdated: livePackage.outdated,
                latestVersion: livePackage.latestVersion,
                vulnerabilities: livePackage.vulnerabilities,
            });
        }
        if (!vscode.workspace.getConfiguration().get<boolean>('packages.vulnerabilities.enabled', true)) {
            pkg.vulnerabilities = undefined;
        }
        return {
            revision: this._revision,
            packageName: this._packageName,
            languageId: this._session.runtimeMetadata.languageId,
            runtimeName: this._session.runtimeMetadata.runtimeName,
            package: pkg,
            installed: !!livePackage,
            sessionAlive,
            isActive: sessionAlive && this._packagesService.activePackagesInstance === this._instance,
            busy: sessionAlive && this._packagesService.activePackagesInstance === this._instance && this._packagesService.isBusy,
            loading: sessionAlive && this._loading,
            error: this._error,
        };
    }

    private _sendState(): void {
        if (this._disposed) {
            return;
        }
        if (!this._sessionAlive) {
            this._tokenSource.cancel();
        }
        this._revision++;
        void this._connection?.sendNotification('packageDetail/state', this._buildState());
    }

    isBoundTo(instance: IPositronPackagesInstance): boolean {
        return this._instance === instance && this._session === instance.session;
    }

    protected _getHtmlContent(webview: vscode.Webview): string {
        const scriptUri = this._getWebviewUri(webview, 'webview', 'dist', 'packageDetail', 'index.js');
        const commonStyleUri = this._getWebviewUri(webview, 'webview', 'dist', 'common', 'index.css');
        const styleUri = this._getWebviewUri(webview, 'webview', 'dist', 'packageDetail', 'index.css');
        const nonce = this._getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:;">
    <link href="${commonStyleUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>Package</title>
</head>
<body>
    <div id="app"></div>
    ${this._getLocalizationInlineScript(nonce)}
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._tokenSource.cancel();
        this._tokenSource.dispose();
        this._connection?.dispose();
        this._connection = undefined;
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
        this.panel.dispose();
    }
}
