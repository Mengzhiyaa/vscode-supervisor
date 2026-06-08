import * as vscode from 'vscode';
import { MessageConnection } from 'vscode-jsonrpc';
import { BaseWebviewProvider } from './baseProvider';
import {
    type LanguageRuntimePackage,
    type PackageSpec,
    type PackagesItemSize,
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
    packages: LanguageRuntimePackage[];
    activeSession?: PackagesSessionState;
    busy: boolean;
    selectedPackage?: string;
    itemSize: PackagesItemSize;
}

interface LoadingState {
    refresh: boolean;
    install: boolean;
    update: boolean;
    updateAll: boolean;
    uninstall: boolean;
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
    private _loadingState: LoadingState = {
        refresh: false,
        install: false,
        update: false,
        updateAll: false,
        uninstall: false,
    };

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

        connection.onRequest('packages/refresh', async () => {
            await this._packagesService.refreshPackages();
            this._sendState();
            return this._buildState();
        });

        connection.onRequest('packages/refreshMetadata', async () => {
            await this._packagesService.refreshMetadata();
            this._sendState();
            return this._buildState();
        });

        connection.onRequest('packages/install', async (params: { packages?: unknown }) => {
            const packages = toPackageSpecs(params?.packages);
            if (packages.length > 0) {
                await this._packagesService.installPackages(packages);
            }
            this._sendState();
            return this._buildState();
        });

        connection.onRequest('packages/uninstall', async (params: { packageNames?: unknown }) => {
            const packageNames = toPackageNames(params?.packageNames);
            if (packageNames.length > 0) {
                await this._packagesService.uninstallPackages(packageNames);
            }
            this._sendState();
            return this._buildState();
        });

        connection.onRequest('packages/update', async (params: { packages?: unknown }) => {
            const packages = toPackageSpecs(params?.packages);
            if (packages.length > 0) {
                await this._packagesService.updatePackages(packages);
            }
            this._sendState();
            return this._buildState();
        });

        connection.onRequest('packages/updateAll', async () => {
            await this._packagesService.updateAllPackages();
            this._sendState();
            return this._buildState();
        });

        connection.onRequest('packages/search', async (params: { query?: unknown }) => {
            const query = typeof params?.query === 'string' ? params.query.trim() : '';
            if (!query) {
                return [];
            }
            return this._packagesService.searchPackages(query);
        });

        connection.onRequest('packages/searchVersions', async (params: { name?: unknown }) => {
            const name = typeof params?.name === 'string' ? params.name.trim() : '';
            if (!name) {
                return [];
            }
            return this._packagesService.searchPackageVersions(name);
        });

        connection.onNotification('packages/setSelected', (params: { name?: unknown }) => {
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
        const styleUri = this._getWebviewUri(webview, 'webview', 'dist', 'packages', 'index.css');
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:;">
    <link href="${styleUri}" rel="stylesheet">
    <title>Packages</title>
</head>
<body>
    <div id="app"></div>
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
        this._loadingState = {
            refresh: false,
            install: false,
            update: false,
            updateAll: false,
            uninstall: false,
        };

        const instance = this._packagesService.activePackagesInstance;
        if (!instance) {
            return;
        }

        this._activeInstanceDisposables.push(
            instance.onDidRefreshPackagesInstance(() => this._sendState()),
            instance.onDidChangeRefreshState(isLoading => {
                this._loadingState.refresh = isLoading;
                this._sendState();
            }),
            instance.onDidChangeInstallState(isLoading => {
                this._loadingState.install = isLoading;
                this._sendState();
            }),
            instance.onDidChangeUpdateState(isLoading => {
                this._loadingState.update = isLoading;
                this._sendState();
            }),
            instance.onDidChangeUpdateAllState(isLoading => {
                this._loadingState.updateAll = isLoading;
                this._sendState();
            }),
            instance.onDidChangeUninstallState(isLoading => {
                this._loadingState.uninstall = isLoading;
                this._sendState();
            }),
        );
    }

    private _clearActiveInstanceDisposables(): void {
        while (this._activeInstanceDisposables.length) {
            this._activeInstanceDisposables.pop()?.dispose();
        }
    }

    private _isBusy(): boolean {
        return Object.values(this._loadingState).some(Boolean);
    }

    private _buildState(): PackagesState {
        const instance = this._packagesService.activePackagesInstance;
        const session = instance?.session;
        return {
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
            busy: this._isBusy(),
            selectedPackage: this._packagesService.selectedPackage,
            itemSize: this._packagesService.itemSize,
        };
    }

    private _sendState(): void {
        this._connection?.sendNotification('packages/state', this._buildState());
    }
}
