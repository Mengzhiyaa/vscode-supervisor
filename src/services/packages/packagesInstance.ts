import { getErrorMessage } from '../../shared/errors';
import * as vscode from 'vscode';
import {
    type ILanguageRuntimePackageManager,
    type ILanguageRuntimeSession,
    type IPositronPackagesInstance,
    type LanguageRuntimePackage,
    type PackageSpec,
    RuntimeState,
    LanguageRuntimeSessionMode,
    type PackagesSnapshot,
    type PackagesSnapshotOptions,
    type PackagesMetadataStatus,
    type PackagesVulnerabilityStatus,
} from '../../api';
import { PackageVulnerabilityLookup } from './packageVulnerabilityLookup';
import { CancellationToken, raceCancellationError, raceTimeout } from './packageAsync';
import { type CachedPackageMetadata, PackageMetadataCache } from './packageMetadataCache';

function isCancellationError(error: unknown): boolean {
    return (
        error instanceof vscode.CancellationError ||
        (error instanceof Error && error.name === 'Canceled')
    );
}

function throwIfCancellationRequested(token?: vscode.CancellationToken): void {
    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
}

async function withCancellation<T>(
    promise: Promise<T>,
    token: vscode.CancellationToken,
): Promise<T> {
    let subscription: vscode.Disposable | undefined;
    try {
        return await new Promise<T>((resolve, reject) => {
            subscription = token.onCancellationRequested(() =>
                reject(new vscode.CancellationError()),
            );
            if (token.isCancellationRequested) {
                reject(new vscode.CancellationError());
            }
            promise.then(resolve, reject);
        });
    } finally {
        subscription?.dispose();
    }
}

export class PositronPackagesInstance implements IPositronPackagesInstance, vscode.Disposable {
    private _packages: LanguageRuntimePackage[] = [];
    private readonly _metadataCache = new Map<string, CachedPackageMetadata>();
    private _metadataTokenSource: vscode.CancellationTokenSource | undefined;
    private _metadataFetch: Promise<boolean> | undefined;
    private _metadataFetchAll = false;
    private _vulnerabilityTokenSource: vscode.CancellationTokenSource | undefined;
    private _vulnerabilityFetch: Promise<PackagesVulnerabilityStatus> | undefined;
    private readonly _runtimeDisposables: vscode.Disposable[] = [];
    private readonly _disposables: vscode.Disposable[] = [];
    private _runtimeGeneration = 0;
    private _refreshGeneration = 0;
    private readonly _operations = new Map<vscode.EventEmitter<boolean>, number>();
    private readonly _operationTokens = new Set<vscode.CancellationTokenSource>();

    private readonly _onDidRefreshPackagesInstance = new vscode.EventEmitter<
        LanguageRuntimePackage[]
    >();
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
        private readonly _vulnerabilityLookup?: PackageVulnerabilityLookup,
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
        return this._packages.map((pkg) => {
            const metadata = this._metadataCache.get(pkg.name.toLowerCase());
            return metadata?.version === pkg.version
                ? {
                      ...pkg,
                      outdated: metadata.outdated ?? pkg.outdated,
                      latestVersion: metadata.latestVersion ?? pkg.latestVersion,
                      vulnerabilities: this._vulnerabilityLookup?.enabled
                          ? metadata.vulnerabilities
                          : undefined,
                  }
                : pkg;
        });
    }

    get session(): ILanguageRuntimeSession {
        return this._session;
    }

    get isBusy(): boolean {
        return this._operations.size > 0;
    }

    setRuntimeSession(
        session: ILanguageRuntimeSession,
        packageManager: ILanguageRuntimePackageManager,
    ): void {
        this.detachRuntime();
        if (this._packageManager !== packageManager) {
            this._packageManager.dispose?.();
        }
        this._session = session;
        this._packageManager = packageManager;
        this._packages = [];
        this._metadataCache.clear();
        this._loadPersistedMetadata();
        this._onDidRefreshPackagesInstance.fire(this.packages);
        this.attachRuntime();
    }

    async refreshPackages(
        token?: vscode.CancellationToken,
        forceMetadata = false,
    ): Promise<LanguageRuntimePackage[]> {
        return this._runOperation(this._onDidChangeRefreshState, token, async (effectiveToken) => {
            await this._refreshPackagesInternal(effectiveToken, forceMetadata);
            return this.packages;
        });
    }

    async refreshMetadata(token?: vscode.CancellationToken): Promise<void> {
        throwIfCancellationRequested(token);
        if (!this._packageManager.getPackageMetadata || this._packages.length === 0) {
            return;
        }

        // Keep the last known metadata if a repository is temporarily unavailable.
        await this._fetchAndMergeMetadata(token, true);
    }

    async installPackages(
        packages: PackageSpec[],
        token?: vscode.CancellationToken,
    ): Promise<void> {
        await this._runOperation(this._onDidChangeInstallState, token, async (effectiveToken) => {
            await this._packageManager.installPackages(packages, effectiveToken);
            throwIfCancellationRequested(effectiveToken);
            this._evictPackagesFromCache(packages.map((pkg) => pkg.name));
            await this._refreshPackagesInternal(effectiveToken);
        });
    }

    async uninstallPackages(
        packageNames: string[],
        token?: vscode.CancellationToken,
    ): Promise<void> {
        await this._runOperation(this._onDidChangeUninstallState, token, async (effectiveToken) => {
            await this._packageManager.uninstallPackages(packageNames, effectiveToken);
            throwIfCancellationRequested(effectiveToken);
            this._evictPackagesFromCache(packageNames);
            await this._refreshPackagesInternal(effectiveToken);
        });
    }

    async updatePackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        await this._runOperation(this._onDidChangeUpdateState, token, async (effectiveToken) => {
            await this._packageManager.updatePackages(packages, effectiveToken);
            throwIfCancellationRequested(effectiveToken);
            this._evictPackagesFromCache(packages.map((pkg) => pkg.name));
            await this._refreshPackagesInternal(effectiveToken);
        });
    }

    async updateAllPackages(token?: vscode.CancellationToken): Promise<void> {
        await this._runOperation(this._onDidChangeUpdateAllState, token, async (effectiveToken) => {
            await this._packageManager.updateAllPackages(effectiveToken);
            throwIfCancellationRequested(effectiveToken);
            this._metadataTokenSource?.cancel();
            this._metadataCache.clear();
            this._persistedMetadataCache.clear(this._runtimeId);
            await this._refreshPackagesInternal(effectiveToken);
        });
    }

    async searchPackages(
        query: string,
        token?: vscode.CancellationToken,
    ): Promise<LanguageRuntimePackage[]> {
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

    async getPackageDetail(
        name: string,
        token?: vscode.CancellationToken,
    ): Promise<Partial<LanguageRuntimePackage> | undefined> {
        throwIfCancellationRequested(token);
        const generation = this._runtimeGeneration;
        const request = this._packageManager.getPackageDetail?.(name, token);
        const detail = request
            ? await (token ? withCancellation(request, token) : request)
            : undefined;
        throwIfCancellationRequested(token);
        if (generation !== this._runtimeGeneration) {
            throw new vscode.CancellationError();
        }
        return detail;
    }

    async resolveLatestVersion(
        name: string,
        token?: vscode.CancellationToken,
    ): Promise<string | undefined> {
        if (!this._packageManager.getPackageMetadata) {
            return undefined;
        }
        if (this._packages.length === 0) {
            this._packages = await this._packageManager.getPackages(token);
        }
        await this._fetchAndMergeMetadata(token, true);
        throwIfCancellationRequested(token);
        return this.packages.find((pkg) => pkg.name.toLowerCase() === name.toLowerCase())
            ?.latestVersion;
    }

    async getPackagesSnapshot(
        token: vscode.CancellationToken = CancellationToken.None,
        options: PackagesSnapshotOptions = {},
    ): Promise<PackagesSnapshot> {
        const generation = this._runtimeGeneration;
        const source = new vscode.CancellationTokenSource();
        const subscription = token.onCancellationRequested(() => source.cancel());
        try {
            const list = await raceTimeout(
                raceCancellationError(this._packageManager.getPackages(source.token), token),
                options.listTimeoutMs ?? 5000,
            );
            if (!list) {
                source.cancel();
                throw new Error('Timed out reading the installed packages.');
            }
            throwIfCancellationRequested(token);
            if (generation !== this._runtimeGeneration) {
                throw new vscode.CancellationError();
            }
            this._packages = list;
            this._onDidRefreshPackagesInstance.fire(this.packages);
            let metadataStatus: PackagesMetadataStatus = 'unsupported';
            if (this._packageManager.getPackageMetadata) {
                const visible = [
                    ...new Map(
                        [...list].reverse().map((pkg) => [pkg.name.toLowerCase(), pkg]),
                    ).values(),
                ];
                const cached =
                    this._persistedMetadataCache.isFresh(this._runtimeId) &&
                    visible.every((pkg) => {
                        const metadata = this._metadataCache.get(pkg.name.toLowerCase());
                        return metadata?.version === pkg.version && metadata.outdated !== undefined;
                    });
                if (cached) {
                    metadataStatus = 'cached';
                } else {
                    try {
                        const fetched = await raceTimeout(
                            raceCancellationError(
                                this._fetchAndMergeMetadata(source.token, true),
                                token,
                            ),
                            options.metadataTimeoutMs ?? 10000,
                        );
                        metadataStatus =
                            fetched === undefined
                                ? 'timed-out'
                                : fetched
                                  ? 'fresh'
                                  : 'fetch-failed';
                        if (fetched === undefined) {
                            source.cancel();
                        }
                    } catch (error) {
                        if (isCancellationError(error)) {
                            throw error;
                        }
                        metadataStatus = 'fetch-failed';
                    }
                }
            }
            const vulnerabilityPolicy = this._vulnerabilityPolicy;
            const cachedVulnerabilities =
                this._vulnerabilityLookup?.enabled &&
                this._packages.every((pkg) => {
                    const cached = this._metadataCache.get(pkg.name.toLowerCase());
                    return (
                        cached?.version === pkg.version &&
                        cached.vulnerabilityPolicy === vulnerabilityPolicy &&
                        cached.vulnerabilitiesCheckedAt !== undefined &&
                        Date.now() - cached.vulnerabilitiesCheckedAt < 24 * 60 * 60 * 1000
                    );
                });
            const vulnerabilityStatus = !this._vulnerabilityLookup?.enabled
                ? 'disabled'
                : cachedVulnerabilities
                  ? 'cached'
                  : options.includeVulnerabilities === false
                    ? 'unavailable'
                    : await this.refreshVulnerabilities(
                          token,
                          options.vulnerabilityTimeoutMs ?? 15000,
                      );
            throwIfCancellationRequested(token);
            if (generation !== this._runtimeGeneration) {
                throw new vscode.CancellationError();
            }
            const vulnerabilitySource =
                options.includeVulnerabilities === false
                    ? undefined
                    : this._packages
                          .map((pkg) => {
                              const cached = this._metadataCache.get(pkg.name.toLowerCase());
                              return cached?.version === pkg.version ? cached : undefined;
                          })
                          .find((metadata) => metadata?.vulnerabilitiesCheckedAt !== undefined)
                          ?.vulnerabilitySource;
            return {
                packages:
                    options.includeVulnerabilities === false
                        ? this.packages.map(({ vulnerabilities: _advisories, ...pkg }) => pkg)
                        : this.packages,
                metadataStatus,
                vulnerabilityStatus,
                vulnerabilitySource,
            };
        } finally {
            subscription.dispose();
            source.dispose();
        }
    }

    refreshVulnerabilities(
        token: vscode.CancellationToken = CancellationToken.None,
        budgetMs = 90000,
    ): Promise<PackagesVulnerabilityStatus> {
        if (!this._vulnerabilityLookup?.enabled) {
            this._onDidRefreshPackagesInstance.fire(this.packages);
            return Promise.resolve('disabled');
        }
        if (!this._packageManager.repositoryRequest || !this._packageManager.packageRepositoryUrl) {
            return Promise.resolve('unavailable');
        }
        const current = this._vulnerabilityFetch;
        if (current) {
            return raceTimeout(raceCancellationError(current, token), budgetMs).then(
                (status) => status ?? 'timed-out',
            );
        }
        const fetch = this._fetchVulnerabilities(token, budgetMs);
        this._vulnerabilityFetch = fetch;
        void fetch
            .finally(() => {
                if (this._vulnerabilityFetch === fetch) {
                    this._vulnerabilityFetch = undefined;
                }
            })
            .catch(() => undefined);
        return fetch;
    }

    private async _fetchVulnerabilities(
        token: vscode.CancellationToken,
        budgetMs: number,
    ): Promise<PackagesVulnerabilityStatus> {
        const manager = this._packageManager;
        const generation = this._runtimeGeneration;
        const vulnerabilityPolicy = this._vulnerabilityPolicy;
        const versions = new Map<string, LanguageRuntimePackage>();
        for (const pkg of this._packages) {
            if (!versions.has(pkg.name.toLowerCase())) {
                versions.set(pkg.name.toLowerCase(), pkg);
            }
        }
        const source = new vscode.CancellationTokenSource();
        this._vulnerabilityTokenSource = source;
        const subscription = token.onCancellationRequested(() => source.cancel());
        try {
            const outcome = await raceTimeout(
                raceCancellationError(
                    this._vulnerabilityLookup!.getVulnerabilities(
                        this._session.runtimeMetadata.languageId,
                        {
                            resolveUrl: (requestToken) =>
                                manager.packageRepositoryUrl!(requestToken),
                            request: (request, requestToken) =>
                                manager.repositoryRequest!(request, requestToken),
                        },
                        [...versions.values()].map((pkg) => ({
                            name: pkg.name,
                            version: pkg.version,
                        })),
                        source.token,
                        budgetMs,
                    ).then((result) => ({ result })),
                    token,
                ),
                budgetMs + Math.min(1000, budgetMs),
            );
            throwIfCancellationRequested(token);
            if (generation !== this._runtimeGeneration) {
                throw new vscode.CancellationError();
            }
            if (!outcome) {
                source.cancel();
                return 'timed-out';
            }
            const result = outcome.result;
            if (!result) {
                return 'unavailable';
            }
            for (const [key, pkg] of versions) {
                if (!result.queried.has(key)) {
                    continue;
                }
                const current = this._packages.find((item) => item.name.toLowerCase() === key);
                if (current?.version !== pkg.version) {
                    continue;
                }
                const previous = this._metadataCache.get(key);
                this._metadataCache.set(key, {
                    ...(previous?.version === pkg.version ? previous : { version: pkg.version }),
                    vulnerabilities: result.vulnerabilities.get(key),
                    vulnerabilitiesCheckedAt: result.source.fetchedAt,
                    vulnerabilitySource: result.source,
                    vulnerabilityPolicy,
                });
            }
            this._persistedMetadataCache.upsert(
                this._runtimeId,
                this._snapshotForPersist(),
                this._persistedMetadataCache.get(this._runtimeId)?.lastFetched ?? 0,
            );
            this._onDidRefreshPackagesInstance.fire(this.packages);
            return result.queried.size >=
                [...versions.values()].filter((pkg) => !!pkg.version).length
                ? 'fresh'
                : 'timed-out';
        } finally {
            source.cancel();
            subscription.dispose();
            source.dispose();
            if (this._vulnerabilityTokenSource === source) {
                this._vulnerabilityTokenSource = undefined;
            }
        }
    }

    attachRuntime(): void {
        if (this._runtimeDisposables.length > 0) {
            return;
        }
        this._runtimeDisposables.push(
            this._session.onDidChangeRuntimeState((state) => {
                if (state === RuntimeState.Ready) {
                    void this.refreshPackages().catch((error) => {
                        this._outputChannel.warn(
                            `[Packages] Failed to refresh packages: ${getErrorMessage(error)}`,
                        );
                    });
                } else if (state === RuntimeState.Exited) {
                    this.detachRuntime();
                }
            }),
        );

        const currentState = this._session.getRuntimeState();
        if (
            currentState === RuntimeState.Ready ||
            currentState === RuntimeState.Idle ||
            currentState === RuntimeState.Busy
        ) {
            void this.refreshPackages().catch((error) => {
                this._outputChannel.warn(
                    `[Packages] Failed to refresh packages on attach: ${getErrorMessage(error)}`,
                );
            });
        }
    }

    detachRuntime(): void {
        this._metadataFetch = undefined;
        this._vulnerabilityTokenSource?.cancel();
        this._vulnerabilityFetch = undefined;
        this._runtimeGeneration++;
        this._refreshGeneration++;
        this._metadataTokenSource?.cancel();
        for (const tokenSource of this._operationTokens) {
            tokenSource.cancel();
        }
        this._operationTokens.clear();
        const events = [...this._operations.keys()];
        this._operations.clear();
        for (const event of events) {
            event.fire(false);
        }
        while (this._runtimeDisposables.length) {
            this._runtimeDisposables.pop()?.dispose();
        }
    }

    dispose(): void {
        this._metadataTokenSource?.cancel();
        this._metadataTokenSource?.dispose();
        this.detachRuntime();
        this._packageManager.dispose?.();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }

    private async _runOperation<T>(
        event: vscode.EventEmitter<boolean>,
        token: vscode.CancellationToken | undefined,
        operation: (token: vscode.CancellationToken) => Promise<T>,
    ): Promise<T> {
        throwIfCancellationRequested(token);
        const generation = this._runtimeGeneration;
        const tokenSource = new vscode.CancellationTokenSource();
        const subscription = token?.onCancellationRequested(() => tokenSource.cancel());
        this._operationTokens.add(tokenSource);
        this._operations.set(event, (this._operations.get(event) ?? 0) + 1);
        event.fire(true);
        try {
            return await withCancellation(operation(tokenSource.token), tokenSource.token);
        } finally {
            this._operationTokens.delete(tokenSource);
            subscription?.dispose();
            tokenSource.dispose();
            if (generation === this._runtimeGeneration) {
                const remaining = (this._operations.get(event) ?? 1) - 1;
                if (remaining > 0) {
                    this._operations.set(event, remaining);
                } else {
                    this._operations.delete(event);
                }
                event.fire(remaining > 0);
            }
        }
    }

    private async _refreshPackagesInternal(
        token?: vscode.CancellationToken,
        forceMetadata = false,
    ): Promise<void> {
        const generation = ++this._refreshGeneration;
        this._metadataTokenSource?.cancel();
        this._metadataFetch = undefined;
        const packages = await this._packageManager.getPackages(token);
        throwIfCancellationRequested(token);
        if (generation !== this._refreshGeneration) {
            return;
        }
        this._packages = packages;
        this._onDidRefreshPackagesInstance.fire(this.packages);

        if (this._session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
            void this.refreshVulnerabilities().catch((error) => {
                if (!isCancellationError(error)) {
                    this._outputChannel.warn(getErrorMessage(error));
                }
            });
        }
        if (this._packageManager.getPackageMetadata && this._packages.length > 0) {
            const fetchAll =
                forceMetadata || !this._persistedMetadataCache.isFresh(this._runtimeId);
            void this._fetchAndMergeMetadata(undefined, fetchAll).catch((error) => {
                if (!isCancellationError(error)) {
                    this._outputChannel.warn(
                        `[Packages] Failed to fetch package metadata: ${getErrorMessage(error)}`,
                    );
                }
            });
        }
    }

    private _fetchAndMergeMetadata(
        externalToken?: vscode.CancellationToken,
        fetchAll = false,
    ): Promise<boolean> {
        if (this._metadataFetch) {
            if (fetchAll && !this._metadataFetchAll) {
                const current = this._metadataFetch;
                const fullFetch = current.then(() =>
                    this._fetchAndMergeMetadata(externalToken, true),
                );
                return externalToken ? raceCancellationError(fullFetch, externalToken) : fullFetch;
            }
            return externalToken
                ? raceCancellationError(this._metadataFetch, externalToken)
                : this._metadataFetch;
        }
        const fetch = this._doFetchAndMergeMetadata(externalToken, fetchAll);
        this._metadataFetch = fetch;
        this._metadataFetchAll = fetchAll;
        void fetch
            .finally(() => {
                if (this._metadataFetch === fetch) {
                    this._metadataFetch = undefined;
                }
            })
            .catch(() => undefined);
        return externalToken ? raceCancellationError(fetch, externalToken) : fetch;
    }

    private async _doFetchAndMergeMetadata(
        externalToken?: vscode.CancellationToken,
        fetchAll = false,
    ): Promise<boolean> {
        if (!this._packageManager.getPackageMetadata) {
            return false;
        }

        this._metadataTokenSource?.cancel();
        this._metadataTokenSource?.dispose();
        const tokenSource = new vscode.CancellationTokenSource();
        this._metadataTokenSource = tokenSource;

        const externalDisposable = externalToken?.onCancellationRequested(() =>
            tokenSource.cancel(),
        );
        if (externalToken?.isCancellationRequested) {
            tokenSource.cancel();
        }
        // R resolves the first copy in library-path order. Anchor metadata to
        // that version before awaiting the repository, never to a later list.
        const visiblePackages = new Map<string, LanguageRuntimePackage>();
        for (const pkg of this._packages) {
            const key = pkg.name.toLowerCase();
            if (!visiblePackages.has(key)) {
                visiblePackages.set(key, pkg);
            }
        }
        const uncachedPackages = [...visiblePackages.values()].filter((pkg) => {
            const metadata = this._metadataCache.get(pkg.name.toLowerCase());
            return (
                fetchAll ||
                metadata === undefined ||
                metadata.version !== pkg.version ||
                metadata.outdated === undefined
            );
        });
        const versionByName = new Map(
            uncachedPackages.map((pkg) => [pkg.name.toLowerCase(), pkg.version]),
        );

        if (uncachedPackages.length === 0) {
            this._onDidRefreshPackagesInstance.fire(this.packages);
            externalDisposable?.dispose();
            tokenSource.dispose();
            if (this._metadataTokenSource === tokenSource) {
                this._metadataTokenSource = undefined;
            }
            return true;
        }

        try {
            const metadata = await this._packageManager.getPackageMetadata(
                uncachedPackages.map((pkg) => pkg.name),
                tokenSource.token,
            );

            if (tokenSource.token.isCancellationRequested || !metadata || metadata.size === 0) {
                return false;
            }

            for (const [name, packageMetadata] of metadata) {
                const key = name.toLowerCase();
                const version = versionByName.get(key);
                if (version === undefined) {
                    continue;
                }
                const current = this._packages.find((pkg) => pkg.name.toLowerCase() === key);
                if (current?.version !== version) {
                    continue;
                }
                this._metadataCache.set(key, {
                    ...(this._metadataCache.get(key)?.version === version
                        ? this._metadataCache.get(key)
                        : {}),
                    version,
                    outdated: packageMetadata.outdated,
                    latestVersion: packageMetadata.latestVersion,
                });
            }

            this._persistedMetadataCache.upsert(
                this._runtimeId,
                this._snapshotForPersist(),
                fetchAll
                    ? Date.now()
                    : (this._persistedMetadataCache.get(this._runtimeId)?.lastFetched ??
                          Date.now()),
            );
            this._onDidRefreshPackagesInstance.fire(this.packages);
            return uncachedPackages.every((pkg) => {
                const cached = this._metadataCache.get(pkg.name.toLowerCase());
                return cached?.version === pkg.version && cached.outdated !== undefined;
            });
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
        this._metadataFetch = undefined;
        for (const name of packageNames) {
            this._metadataCache.delete(name.toLowerCase());
        }
        this._persistedMetadataCache.evict(this._runtimeId, packageNames);
    }

    private get _vulnerabilityPolicy(): 'auto' | 'environment' {
        return vscode.workspace
            .getConfiguration()
            .get<string>('packages.vulnerabilities.source') === 'environment'
            ? 'environment'
            : 'auto';
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
