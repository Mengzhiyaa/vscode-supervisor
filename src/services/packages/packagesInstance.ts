import * as vscode from 'vscode';
import {
    type ILanguageRuntimePackageManager,
    type ILanguageRuntimeSession,
    type IPositronPackagesInstance,
    type LanguageRuntimePackage,
    type PackageSpec,
    RuntimeState,
} from '../../api';
import {
    type CachedPackageMetadata,
    PackageMetadataCache,
} from './packageMetadataCache';

function isCancellationError(error: unknown): boolean {
    return error instanceof vscode.CancellationError ||
        (error instanceof Error && error.name === 'Canceled');
}

function throwIfCancellationRequested(token?: vscode.CancellationToken): void {
    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
}

export class PositronPackagesInstance implements IPositronPackagesInstance, vscode.Disposable {
    private _packages: LanguageRuntimePackage[] = [];
    private readonly _metadataCache = new Map<string, CachedPackageMetadata>();
    private _metadataTokenSource: vscode.CancellationTokenSource | undefined;
    private readonly _runtimeDisposables: vscode.Disposable[] = [];
    private readonly _disposables: vscode.Disposable[] = [];

    private readonly _onDidRefreshPackagesInstance = new vscode.EventEmitter<LanguageRuntimePackage[]>();
    private readonly _onDidChangeRefreshState = new vscode.EventEmitter<boolean>();
    private readonly _onDidChangeInstallState = new vscode.EventEmitter<boolean>();
    private readonly _onDidChangeUninstallState = new vscode.EventEmitter<boolean>();
    private readonly _onDidChangeUpdateState = new vscode.EventEmitter<boolean>();
    private readonly _onDidChangeUpdateAllState = new vscode.EventEmitter<boolean>();

    constructor(
        private _session: ILanguageRuntimeSession,
        private _packageManager: ILanguageRuntimePackageManager,
        private readonly _outputChannel: vscode.LogOutputChannel,
        private readonly _persistedMetadataCache: PackageMetadataCache,
    ) {
        this._disposables.push(
            this._onDidRefreshPackagesInstance,
            this._onDidChangeRefreshState,
            this._onDidChangeInstallState,
            this._onDidChangeUninstallState,
            this._onDidChangeUpdateState,
            this._onDidChangeUpdateAllState,
        );
        this._loadPersistedMetadata();
        this.attachRuntime();
    }

    readonly onDidRefreshPackagesInstance = this._onDidRefreshPackagesInstance.event;
    readonly onDidChangeRefreshState = this._onDidChangeRefreshState.event;
    readonly onDidChangeInstallState = this._onDidChangeInstallState.event;
    readonly onDidChangeUninstallState = this._onDidChangeUninstallState.event;
    readonly onDidChangeUpdateState = this._onDidChangeUpdateState.event;
    readonly onDidChangeUpdateAllState = this._onDidChangeUpdateAllState.event;

    get packages(): LanguageRuntimePackage[] {
        return this._packages.map(pkg => {
            const metadata = this._metadataCache.get(pkg.name.toLowerCase());
            return metadata?.version === pkg.version
                ? {
                    ...pkg,
                    outdated: metadata.outdated,
                    latestVersion: metadata.latestVersion,
                }
                : pkg;
        });
    }

    get session(): ILanguageRuntimeSession {
        return this._session;
    }

    setRuntimeSession(
        session: ILanguageRuntimeSession,
        packageManager: ILanguageRuntimePackageManager,
    ): void {
        this._session = session;
        this._packageManager = packageManager;
        this._metadataTokenSource?.cancel();
        this._metadataCache.clear();
        this._loadPersistedMetadata();
        this.attachRuntime();
    }

    async refreshPackages(token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]> {
        throwIfCancellationRequested(token);
        this._onDidChangeRefreshState.fire(true);
        try {
            await this._refreshPackagesInternal(token);
            return this.packages;
        } finally {
            this._onDidChangeRefreshState.fire(false);
        }
    }

    async refreshMetadata(token?: vscode.CancellationToken): Promise<void> {
        throwIfCancellationRequested(token);
        if (!this._packageManager.getPackageMetadata || this._packages.length === 0) {
            return;
        }

        this._metadataTokenSource?.cancel();
        this._metadataCache.clear();
        await this._fetchAndMergeMetadata(token, true);
    }

    async installPackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        throwIfCancellationRequested(token);
        this._onDidChangeInstallState.fire(true);
        try {
            await this._packageManager.installPackages(packages, token);
            throwIfCancellationRequested(token);
            this._evictPackagesFromCache(packages.map(pkg => pkg.name));
            await this._refreshPackagesInternal(token);
        } finally {
            this._onDidChangeInstallState.fire(false);
        }
    }

    async uninstallPackages(packageNames: string[], token?: vscode.CancellationToken): Promise<void> {
        throwIfCancellationRequested(token);
        this._onDidChangeUninstallState.fire(true);
        try {
            await this._packageManager.uninstallPackages(packageNames, token);
            throwIfCancellationRequested(token);
            this._evictPackagesFromCache(packageNames);
            await this._refreshPackagesInternal(token);
        } finally {
            this._onDidChangeUninstallState.fire(false);
        }
    }

    async updatePackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        throwIfCancellationRequested(token);
        this._onDidChangeUpdateState.fire(true);
        try {
            await this._packageManager.updatePackages(packages, token);
            throwIfCancellationRequested(token);
            this._evictPackagesFromCache(packages.map(pkg => pkg.name));
            await this._refreshPackagesInternal(token);
        } finally {
            this._onDidChangeUpdateState.fire(false);
        }
    }

    async updateAllPackages(token?: vscode.CancellationToken): Promise<void> {
        throwIfCancellationRequested(token);
        this._onDidChangeUpdateAllState.fire(true);
        try {
            await this._packageManager.updateAllPackages(token);
            throwIfCancellationRequested(token);
            this._metadataTokenSource?.cancel();
            this._metadataCache.clear();
            this._persistedMetadataCache.clear(this._runtimeId);
            await this._refreshPackagesInternal(token);
        } finally {
            this._onDidChangeUpdateAllState.fire(false);
        }
    }

    async searchPackages(query: string, token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]> {
        throwIfCancellationRequested(token);
        const packages = await this._packageManager.searchPackages(query, token);
        throwIfCancellationRequested(token);
        return packages;
    }

    async searchPackageVersions(name: string, token?: vscode.CancellationToken): Promise<string[]> {
        throwIfCancellationRequested(token);
        const versions = await this._packageManager.searchPackageVersions(name, token);
        throwIfCancellationRequested(token);
        return versions;
    }

    attachRuntime(): void {
        this.detachRuntime();
        this._runtimeDisposables.push(
            this._session.onDidChangeRuntimeState(state => {
                if (state === RuntimeState.Ready) {
                    void this.refreshPackages().catch(error => {
                        this._outputChannel.warn(`[Packages] Failed to refresh packages: ${error}`);
                    });
                } else if (state === RuntimeState.Exited) {
                    this.detachRuntime();
                }
            })
        );

        const currentState = this._session.getRuntimeState();
        if (currentState === RuntimeState.Ready ||
            currentState === RuntimeState.Idle ||
            currentState === RuntimeState.Busy) {
            void this.refreshPackages().catch(error => {
                this._outputChannel.warn(`[Packages] Failed to refresh packages on attach: ${error}`);
            });
        }
    }

    detachRuntime(): void {
        while (this._runtimeDisposables.length) {
            this._runtimeDisposables.pop()?.dispose();
        }
    }

    dispose(): void {
        this._metadataTokenSource?.cancel();
        this._metadataTokenSource?.dispose();
        this.detachRuntime();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }

    private async _refreshPackagesInternal(token?: vscode.CancellationToken): Promise<void> {
        this._packages = await this._packageManager.getPackages(token);
        throwIfCancellationRequested(token);
        this._onDidRefreshPackagesInstance.fire(this.packages);

        if (this._packageManager.getPackageMetadata && this._packages.length > 0) {
            const fetchAll = !this._persistedMetadataCache.isFresh(this._runtimeId);
            void this._fetchAndMergeMetadata(undefined, fetchAll).catch(error => {
                if (!isCancellationError(error)) {
                    this._outputChannel.warn(`[Packages] Failed to fetch package metadata: ${error}`);
                }
            });
        }
    }

    private async _fetchAndMergeMetadata(
        externalToken?: vscode.CancellationToken,
        fetchAll = false,
    ): Promise<void> {
        if (!this._packageManager.getPackageMetadata) {
            return;
        }

        this._metadataTokenSource?.cancel();
        this._metadataTokenSource?.dispose();
        const tokenSource = new vscode.CancellationTokenSource();
        this._metadataTokenSource = tokenSource;

        const externalDisposable = externalToken?.onCancellationRequested(() => tokenSource.cancel());
        if (externalToken?.isCancellationRequested) {
            tokenSource.cancel();
        }
        const uncachedPackages = fetchAll
            ? this._packages
            : this._packages.filter(pkg => {
                const metadata = this._metadataCache.get(pkg.name.toLowerCase());
                return metadata?.version !== pkg.version;
            });

        if (uncachedPackages.length === 0) {
            this._onDidRefreshPackagesInstance.fire(this.packages);
            externalDisposable?.dispose();
            tokenSource.dispose();
            if (this._metadataTokenSource === tokenSource) {
                this._metadataTokenSource = undefined;
            }
            return;
        }

        try {
            const metadata = await this._packageManager.getPackageMetadata(
                uncachedPackages.map(pkg => pkg.name),
                tokenSource.token,
            );

            if (tokenSource.token.isCancellationRequested || !metadata || metadata.size === 0) {
                return;
            }

            const versionByName = new Map(
                this._packages.map(pkg => [pkg.name.toLowerCase(), pkg.version]),
            );
            for (const [name, packageMetadata] of metadata) {
                const key = name.toLowerCase();
                const version = versionByName.get(key);
                if (version === undefined) {
                    continue;
                }
                this._metadataCache.set(key, {
                    version,
                    outdated: packageMetadata.outdated,
                    latestVersion: packageMetadata.latestVersion,
                });
            }

            this._persistedMetadataCache.upsert(
                this._runtimeId,
                this._snapshotForPersist(),
            );
            this._onDidRefreshPackagesInstance.fire(this.packages);
        } finally {
            externalDisposable?.dispose();
            tokenSource.dispose();
            if (this._metadataTokenSource === tokenSource) {
                this._metadataTokenSource = undefined;
            }
        }
    }

    private _evictPackagesFromCache(packageNames: readonly string[]): void {
        if (packageNames.length === 0) {
            return;
        }

        this._metadataTokenSource?.cancel();
        for (const name of packageNames) {
            this._metadataCache.delete(name.toLowerCase());
        }
        this._persistedMetadataCache.evict(this._runtimeId, packageNames);
    }

    private get _runtimeId(): string {
        return this._session.runtimeMetadata.runtimeId;
    }

    private _loadPersistedMetadata(): void {
        const environment = this._persistedMetadataCache.get(this._runtimeId);
        if (!environment) {
            return;
        }
        for (const [name, metadata] of Object.entries(environment.packages)) {
            this._metadataCache.set(name, metadata);
        }
    }

    private _snapshotForPersist(): Record<string, CachedPackageMetadata> {
        const snapshot: Record<string, CachedPackageMetadata> = {};
        for (const pkg of this._packages) {
            const key = pkg.name.toLowerCase();
            const metadata = this._metadataCache.get(key);
            if (metadata?.version === pkg.version) {
                snapshot[key] = metadata;
            }
        }
        return snapshot;
    }
}
