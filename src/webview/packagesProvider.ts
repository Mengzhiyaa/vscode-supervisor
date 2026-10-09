import * as vscode from 'vscode';
import { MessageConnection } from 'vscode-jsonrpc/node';
import { BaseWebviewProvider } from './baseProvider';
import {
    type LanguageRuntimePackage,
    type PackageSpec,
    type PackagesItemSize,
    type IPositronPackagesInstance,
} from '../api';
import { PositronPackagesService } from '../services/packages';

interface PackagesSessionState {
    id: string;
    name: string;
    runtimeName: string;
    languageId: string;
    state: string;
}

interface PackagesState {
    revision: number;
    packages: LanguageRuntimePackage[];
    activeSession?: PackagesSessionState;
    busy: boolean;
    selectedPackage?: string;
    itemSize: PackagesItemSize;
}

function toPackageSpecs(value: unknown): PackageSpec[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const specs: PackageSpec[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const candidate = entry as Record<string, unknown>;
        if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
            continue;
        }
        specs.push(
            {
                name: candidate.name.trim(),
                version: typeof candidate.version === 'string' && candidate.version.trim().length > 0
                    ? candidate.version.trim()
                    : undefined,
            }
        );
    }

    return specs;
}

function toPackageNames(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map(entry => entry.trim());
}

export class PackagesViewProvider extends BaseWebviewProvider implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _activeInstanceDisposables: vscode.Disposable[] = [];
    private _revision = 0;

    constructor(
        extensionUri: vscode.Uri,
        outputChannel: vscode.LogOutputChannel,
        private readonly _packagesService: PositronPackagesService,
        getAdditionalLocalResourceRoots: () => readonly vscode.Uri[] = () => [],
    ) {
        super(extensionUri, outputChannel, getAdditionalLocalResourceRoots);
        this._bindActiveInstance();
        this._disposables.push(
            this._packagesService.onDidChangeActivePackagesInstance(() => {
                this._bindActiveInstance();
                this._sendState();
            }),
            this._packagesService.onDidStopPackagesInstance(() => {
                this._sendState();
            }),
            this._packagesService.onDidChangeItemSize(() => {
                this._sendState();
            }),
        );
    }

    protected get _providerName(): string {
        return 'PackagesViewProvider';
    }

    protected _registerRpcHandlers(connection: MessageConnection): void {
        connection.onRequest('packages/getState', async () => {
            return this._buildState();
        });

        connection.onRequest('packages/list', async () => {
            return this._packagesService.activePackagesInstance?.packages ?? [];
        });

        connection.onRequest('packages/refresh', async (params: { sessionId?: unknown }) => {
            this._getInstance(params?.sessionId);
            const completed = await this._runOperation(vscode.l10n.t('Refreshing Packages...'),
                async token => {
                    await this._packagesService.refreshPackages(token, true);
                });
            this._sendState();
            return { ...this._buildState(), cancelled: !completed };
        });

        connection.onRequest('packages/refreshMetadata', async (params: { sessionId?: unknown }) => {
            const instance = this._getInstance(params?.sessionId);
            await instance.refreshMetadata();
            this._sendState();
            return this._buildState();
        });

        connection.onRequest('packages/install', async (params: { packages?: unknown; sessionId?: unknown; chooseVersion?: boolean }) => {
            const instance = this._getInstance(params?.sessionId);
            const session = instance.session;
            const packages = toPackageSpecs(params?.packages);
            if (params?.chooseVersion && packages.length === 1) {
                const choice = await this._pickVersion(instance, packages[0].name, true);
                if (!choice || instance.session !== session || this._packagesService.activePackagesInstance !== instance) {
                    return { ...this._buildState(), cancelled: true };
                }
                packages[0].version = choice.version;
            }
            let completed = false;
            if (packages.length > 0) {
                completed = await this._runOperation(vscode.l10n.t('Installing Packages...'),
                    token => instance.installPackages(packages, token));
            }
            this._sendState();
            return { ...this._buildState(), cancelled: !completed };
        });

        connection.onRequest('packages/uninstall', async (params: { packageNames?: unknown; sessionId?: unknown }) => {
            const instance = this._getInstance(params?.sessionId);
            const session = instance.session;
            const packageNames = toPackageNames(params?.packageNames);
            let completed = false;
            if (packageNames.length > 0) {
                const uninstall = vscode.l10n.t('Uninstall');
                const choice = await vscode.window.showWarningMessage(
                    vscode.l10n.t('Uninstall {0}?', packageNames.join(', ')),
                    { modal: true }, uninstall,
                );
                if (choice === uninstall && instance.session === session && this._packagesService.activePackagesInstance === instance) {
                    completed = await this._runOperation(vscode.l10n.t('Uninstalling Packages...'),
                        token => instance.uninstallPackages(packageNames, token));
                }
            }
            this._sendState();
            return { ...this._buildState(), cancelled: !completed };
        });

        connection.onRequest('packages/update', async (params: { packages?: unknown; sessionId?: unknown; chooseVersion?: boolean }) => {
            const instance = this._getInstance(params?.sessionId);
            const session = instance.session;
            const packages = toPackageSpecs(params?.packages);
            if (params?.chooseVersion && packages.length === 1) {
                const choice = await this._pickVersion(instance, packages[0].name, false);
                if (!choice || instance.session !== session || this._packagesService.activePackagesInstance !== instance) {
                    return { ...this._buildState(), cancelled: true };
                }
                packages[0].version = choice.version;
            }
            let completed = false;
            if (packages.length > 0) {
                completed = await this._runOperation(vscode.l10n.t('Updating Packages...'),
                    token => instance.updatePackages(packages, token));
            }
            this._sendState();
            return { ...this._buildState(), cancelled: !completed };
        });

        connection.onRequest('packages/updateAll', async (params: { sessionId?: unknown }) => {
            const instance = this._getInstance(params?.sessionId);
            const completed = await this._runOperation(vscode.l10n.t('Updating Packages...'),
                token => instance.updateAllPackages(token));
            this._sendState();
            return { ...this._buildState(), cancelled: !completed };
        });

        connection.onRequest('packages/search', async (params: { query?: unknown; sessionId?: unknown }) => {
            const instance = this._getInstance(params?.sessionId);
            const query = typeof params?.query === 'string' ? params.query.trim() : '';
            if (!query) {
                return [];
            }
            return instance.searchPackages(query);
        });

        connection.onRequest('packages/searchVersions', async (params: { name?: unknown; sessionId?: unknown }) => {
            const instance = this._getInstance(params?.sessionId);
            const name = typeof params?.name === 'string' ? params.name.trim() : '';
            if (!name) {
                return [];
            }
            return instance.searchPackageVersions(name);
        });

        connection.onNotification('packages/setSelected', (params: { name?: unknown; sessionId?: unknown }) => {
            const instance = this._packagesService.activePackagesInstance;
            if (!instance || (params?.sessionId !== undefined && params.sessionId !== instance.session.sessionId)) {
                return;
            }
            const name = typeof params?.name === 'string' && params.name.trim().length > 0
                ? params.name.trim()
                : undefined;
            this._packagesService.setSelectedPackage(name);
            this._sendState();
        });

        connection.onNotification('packages/setItemSize', (params: { itemSize?: unknown }) => {
            if (params?.itemSize === 'card' || params?.itemSize === 'row') {
                this._packagesService.setItemSize(params.itemSize);
            }
        });

        this._sendState();
    }

    protected _getHtmlContent(webview: vscode.Webview): string {
        const scriptUri = this._getWebviewUri(webview, 'webview', 'dist', 'packages', 'index.js');
        const commonStyleUri = this._getWebviewUri(webview, 'webview', 'dist', 'common', 'index.css');
        const styleUri = this._getWebviewUri(webview, 'webview', 'dist', 'packages', 'index.css');
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:;">
    <link href="${commonStyleUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>Packages</title>
</head>
<body>
    <div id="app"></div>
    ${this._getLocalizationInlineScript(nonce)}
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    dispose(): void {
        this._clearActiveInstanceDisposables();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }

    private _bindActiveInstance(): void {
        this._clearActiveInstanceDisposables();

        const instance = this._packagesService.activePackagesInstance;
        if (!instance) {
            return;
        }

        this._activeInstanceDisposables.push(
            instance.onDidRefreshPackagesInstance(() => this._sendState()),
            instance.onDidChangeRefreshState(() => this._sendState()),
            instance.onDidChangeInstallState(() => this._sendState()),
            instance.onDidChangeUpdateState(() => this._sendState()),
            instance.onDidChangeUpdateAllState(() => this._sendState()),
            instance.onDidChangeUninstallState(() => this._sendState()),
        );
    }

    private _clearActiveInstanceDisposables(): void {
        while (this._activeInstanceDisposables.length) {
            this._activeInstanceDisposables.pop()?.dispose();
        }
    }

    private _buildState(): PackagesState {
        const instance = this._packagesService.activePackagesInstance;
        const session = instance?.session;
        return {
            revision: this._revision,
            packages: instance?.packages ?? [],
            activeSession: session ? {
                id: session.sessionId,
                name: session.dynState.sessionName ||
                    session.sessionMetadata.sessionName ||
                    session.runtimeMetadata.runtimeName,
                runtimeName: session.runtimeMetadata.runtimeName,
                languageId: session.runtimeMetadata.languageId,
                state: session.state,
            } : undefined,
            busy: this._packagesService.isBusy,
            selectedPackage: this._packagesService.selectedPackage,
            itemSize: this._packagesService.itemSize,
        };
    }

    private _sendState(): void {
        this._revision++;
        this._connection?.sendNotification('packages/state', this._buildState());
    }

    private _getInstance(sessionId: unknown): IPositronPackagesInstance {
        const instance = this._packagesService.activePackagesInstance;
        if (!instance || (sessionId !== undefined && sessionId !== instance.session.sessionId)) {
            throw new Error(vscode.l10n.t('The package session changed. Please try again.'));
        }
        return instance;
    }

    private async _pickVersion(instance: IPositronPackagesInstance, name: string, install: boolean): Promise<{ version?: string } | undefined> {
        const tokenSource = new vscode.CancellationTokenSource();
        try {
            const items = instance.searchPackageVersions(name, tokenSource.token).then(versions => {
                const choices: (vscode.QuickPickItem & { version?: string })[] = [...new Set(versions)]
                    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
                    .map(version => ({ label: version, version }));
                if (install) {
                    // Only the package manager decides what "latest" means for this environment.
                    choices.unshift({ label: vscode.l10n.t('Latest available version') });
                }
                return choices;
            });
            return await vscode.window.showQuickPick(items, {
                title: vscode.l10n.t('Select a version of {0}', name),
                placeHolder: vscode.l10n.t('Select a package version'),
            }, tokenSource.token);
        } finally {
            tokenSource.cancel();
            tokenSource.dispose();
        }
    }

    private async _runOperation(title: string, operation: (token: vscode.CancellationToken) => Promise<void>): Promise<boolean> {
        try {
            return await vscode.window.withProgress({
                title, location: vscode.ProgressLocation.Notification, cancellable: true,
            }, async (_progress, token) => {
                await operation(token);
                return !token.isCancellationRequested;
            });
        } catch (error) {
            if (error instanceof vscode.CancellationError || (error instanceof Error && error.name === 'Canceled')) {
                return false;
            }
            throw error;
        }
    }
}
