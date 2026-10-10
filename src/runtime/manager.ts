import * as vscode from 'vscode';
import {
    type IDiscoveredLanguageRuntime,
    type IRuntimeManager,
    type ILanguageRuntimeProvider,
    LanguageRuntimeSessionMode,
    type LanguageRuntimeMetadata,
    type RuntimeRootSignature,
} from '../api';
import { RuntimeStartMode } from '../internal/runtimeTypes';
import { RuntimeSessionService } from './runtimeSession';
import { RuntimeDiscoveryCache } from './runtimeDiscoveryCache';

const DISCOVERY_CACHE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Manages discovery and registration of language runtimes.
 * Providers own discovery logic; the manager owns caching and orchestration.
 */
export class RuntimeManager implements vscode.Disposable, IRuntimeManager {
    private static _nextRuntimeManagerId = 1;

    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _runtimeProviders = new Map<string, ILanguageRuntimeProvider<any>>();
    private readonly _runtimeProviderLogChannels = new Map<string, vscode.LogOutputChannel>();
    private readonly _runtimeProviderRegistrationTokens = new Map<string, { disposed: boolean }>();
    private readonly _runtimeProviderCacheIds = new Map<string, string>();
    private readonly _runtimes = new Map<string, LanguageRuntimeMetadata>();
    private readonly _installationsByLanguageId = new Map<string, unknown[]>();
    private readonly _languagesWithExternalDiscoveryManagers = new Set<string>();
    private _isDiscovering = false;
    private _discoveryComplete = false;
    private _discoveryPromise: Promise<void> | undefined;
    private readonly _providerDiscoveryPromises = new Map<object, Promise<void>>();
    private readonly _discoveryCache: RuntimeDiscoveryCache;

    readonly id = RuntimeManager._nextRuntimeManagerId++;

    private readonly _onDidDiscoverRuntime = new vscode.EventEmitter<IDiscoveredLanguageRuntime>();
    readonly onDidDiscoverRuntime = this._onDidDiscoverRuntime.event;

    private readonly _onDidFinishDiscovery = new vscode.EventEmitter<void>();
    readonly onDidFinishDiscovery = this._onDidFinishDiscovery.event;

    private readonly _onDidRegisterRuntimeProvider = new vscode.EventEmitter<string>();
    readonly onDidRegisterRuntimeProvider = this._onDidRegisterRuntimeProvider.event;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _outputChannel: vscode.LogOutputChannel
    ) {
        this._discoveryCache = new RuntimeDiscoveryCache(
            this._context.globalState,
            this._outputChannel,
        );
        this._disposables.push(this._onDidDiscoverRuntime);
        this._disposables.push(this._onDidFinishDiscovery);
        this._disposables.push(this._onDidRegisterRuntimeProvider);
    }

    registerRuntimeProvider<TInstallation>(
        provider: ILanguageRuntimeProvider<TInstallation>,
        identity?: { readonly ownerExtensionId: string; readonly revision: number },
        logChannel: vscode.LogOutputChannel = this._outputChannel,
    ): vscode.Disposable {
        const previousProvider = this._runtimeProviders.get(provider.languageId);
        const previousLogChannel = this._getProviderLogChannel(provider.languageId);
        const previousToken = this._runtimeProviderRegistrationTokens.get(provider.languageId);
        const previousCacheId = this._runtimeProviderCacheIds.get(provider.languageId);
        const registrationToken = { disposed: false };
        let registrationComplete = false;
        let previousRuntimesCleared = false;
        const clearPreviousRuntimes = () => {
            if (previousRuntimesCleared || !this._isCurrentProvider(provider, registrationToken)) {
                return;
            }
            previousRuntimesCleared = true;
            if (previousProvider && previousProvider !== provider) {
                this._clearLanguageRuntimes(provider.languageId);
            }
        };
        const handleDynamicEvent = (callback: () => void) => {
            const apply = () => {
                if (!this._isCurrentProvider(provider, registrationToken)) {
                    return;
                }
                clearPreviousRuntimes();
                callback();
            };
            // Only events emitted while listeners are being installed need
            // deferral. Established provider events retain synchronous delivery.
            if (registrationComplete) {
                apply();
            } else {
                queueMicrotask(apply);
            }
        };
        const dynamicEventDisposables: vscode.Disposable[] = [];
        const registration = new vscode.Disposable(() => {
            if (registrationToken.disposed) {
                return;
            }
            registrationToken.disposed = true;
            this._providerDiscoveryPromises.delete(registrationToken);
            for (const disposable of dynamicEventDisposables) {
                try {
                    disposable.dispose();
                } catch (error) {
                    this._outputChannel.warn(`[Discovery] Failed to dispose provider listener: ${error}`);
                }
            }
            if (this._runtimeProviderRegistrationTokens.get(provider.languageId) !== registrationToken) {
                return;
            }
            if (previousProvider && previousToken && !previousToken.disposed) {
                this._runtimeProviders.set(provider.languageId, previousProvider);
                this._runtimeProviderLogChannels.set(provider.languageId, previousLogChannel);
                this._runtimeProviderRegistrationTokens.set(provider.languageId, previousToken);
                if (previousCacheId !== undefined) {
                    this._runtimeProviderCacheIds.set(provider.languageId, previousCacheId);
                } else {
                    this._runtimeProviderCacheIds.delete(provider.languageId);
                }
            } else {
                this._runtimeProviders.delete(provider.languageId);
                this._runtimeProviderLogChannels.delete(provider.languageId);
                this._runtimeProviderRegistrationTokens.delete(provider.languageId);
                this._runtimeProviderCacheIds.delete(provider.languageId);
                this._clearLanguageRuntimes(provider.languageId);
            }
        });
        this._runtimeProviders.set(provider.languageId, provider as ILanguageRuntimeProvider<any>);
        this._runtimeProviderLogChannels.set(provider.languageId, logChannel);
        this._runtimeProviderRegistrationTokens.set(provider.languageId, registrationToken);
        this._runtimeProviderCacheIds.set(
            provider.languageId,
            identity
                ? `${identity.ownerExtensionId}@revision-${identity.revision}`
                : provider.extensionId ?? `vscode-supervisor.${provider.languageId}`,
        );
        try {
            // Defer invalidating old installation objects until a synchronous
            // bundle installation has either committed or rolled back.
            queueMicrotask(clearPreviousRuntimes);
            if (provider.onDidDiscoverInstallation) {
                dynamicEventDisposables.push(provider.onDidDiscoverInstallation(installation => {
                    handleDynamicEvent(() => {
                        try {
                            const metadata = provider.createRuntimeMetadata(
                                this._context,
                                installation,
                                logChannel,
                            );
                            this.registerDiscoveredRuntime(provider.languageId, installation, metadata);
                        } catch (error) {
                            this._outputChannel.error(
                                `[Discovery] Failed to register dynamic ${provider.languageId} installation: ${error}`,
                            );
                        }
                    });
                }));
            }
            if (provider.onDidRemoveRuntime) {
                dynamicEventDisposables.push(provider.onDidRemoveRuntime(({ runtimeId }) => {
                    handleDynamicEvent(() => this._removeRuntime(provider, runtimeId));
                }));
            }
            this._onDidRegisterRuntimeProvider.fire(provider.languageId);
            registrationComplete = true;
            return registration;
        } catch (error) {
            registration.dispose();
            throw error;
        }
    }

    getRuntimeProvider<TInstallation = unknown>(languageId: string): ILanguageRuntimeProvider<TInstallation> | undefined {
        return this._runtimeProviders.get(languageId) as ILanguageRuntimeProvider<TInstallation> | undefined;
    }

    private _getProviderLogChannel(languageId: string): vscode.LogOutputChannel {
        return this._runtimeProviderLogChannels.get(languageId) ?? this._outputChannel;
    }

    getSupportedLanguageIds(): string[] {
        return Array.from(this._runtimeProviders.keys());
    }

    get isDiscovering(): boolean {
        return this._isDiscovering;
    }

    get discoveryComplete(): boolean {
        return this._discoveryComplete;
    }

    getInstallations<TInstallation = unknown>(languageId?: string): TInstallation[] {
        if (languageId) {
            return [...(this._installationsByLanguageId.get(languageId) ?? [])] as TInstallation[];
        }

        const installations: TInstallation[] = [];
        for (const values of this._installationsByLanguageId.values()) {
            installations.push(...values as TInstallation[]);
        }
        return installations;
    }

    getBestInstallation<TInstallation = unknown>(languageId: string): TInstallation | undefined {
        return this.getInstallations<TInstallation>(languageId)[0];
    }

    async startDiscovery(): Promise<void> {
        await this.discoverAllRuntimes([]);
    }

    /** Reconciles one provider independently, including providers registered after global discovery. */
    discoverLanguageRuntime(languageId: string, force = false): Promise<void> {
        const provider = this._runtimeProviders.get(languageId);
        const registrationToken = this._runtimeProviderRegistrationTokens.get(languageId);
        if (!provider || !registrationToken || this._languagesWithExternalDiscoveryManagers.has(languageId)) {
            return Promise.resolve();
        }
        const existing = this._providerDiscoveryPromises.get(registrationToken);
        if (existing) {
            return existing;
        }
        const promise = (async () => {
            const plan = await this._createDiscoveryPlan(provider, force);
            if (!this._isCurrentProvider(provider, registrationToken)) {
                return;
            }
            if (!plan.useCache) {
                await this._discoverProvider(provider, plan.discoveryRootSignature, registrationToken);
                return;
            }
            const cached = await this._restoreCachedProvider(provider, registrationToken);
            if (!cached.restored || cached.needsRevalidation) {
                await this._discoverProvider(provider, plan.discoveryRootSignature, registrationToken);
            }
        })().finally(() => {
            if (this._providerDiscoveryPromises.get(registrationToken) === promise) {
                this._providerDiscoveryPromises.delete(registrationToken);
            }
        });
        this._providerDiscoveryPromises.set(registrationToken, promise);
        return promise;
    }

    async discoverAllRuntimes(
        disabledLanguageIds: string[],
        force = false,
    ): Promise<void> {
        if (this._discoveryPromise) {
            this._outputChannel.debug('Discovery already in progress, waiting for it...');
            await this._discoveryPromise;
            return;
        }

        this._isDiscovering = true;
        let resolveDiscovery!: () => void;
        this._discoveryPromise = new Promise<void>((resolve) => {
            resolveDiscovery = resolve;
        });
        this._outputChannel.debug('Starting incremental runtime discovery...');

        try {
            const providers = Array.from(this._runtimeProviders.values()).filter(provider => {
                if (disabledLanguageIds.includes(provider.languageId)) {
                    return false;
                }
                if (this._languagesWithExternalDiscoveryManagers.has(provider.languageId)) {
                    this._outputChannel.debug(
                        `Skipping internal discovery for ${provider.languageId}; extension-owned manager is registered.`,
                    );
                    return false;
                }
                return true;
            });
            const configuredConcurrency = vscode.workspace
                .getConfiguration('supervisor')
                .get<number>('interpreters.discoveryConcurrency', 4);
            const concurrency = Math.max(
                1,
                Math.min(8, Math.trunc(configuredConcurrency)),
            );
            await this._runWithConcurrency(providers, concurrency, async provider => {
                const registrationToken = this._runtimeProviderRegistrationTokens.get(provider.languageId);
                if (!this._isCurrentProvider(provider, registrationToken)) {
                    return;
                }
                try {
                    const plan = await this._createDiscoveryPlan(provider, force);
                    if (!this._isCurrentProvider(provider, registrationToken)) {
                        return;
                    }
                    if (!plan.useCache) {
                        this._outputChannel.debug(
                            `Running ${plan.reason} discovery for ${provider.languageName}.`,
                        );
                        await this._discoverProvider(provider, plan.discoveryRootSignature, registrationToken);
                        return;
                    }

                    const cached = await this._restoreCachedProvider(provider, registrationToken);
                    if (!cached.restored) {
                        await this._discoverProvider(provider, plan.discoveryRootSignature, registrationToken);
                    } else if (cached.needsRevalidation) {
                        this._outputChannel.debug(
                            `Revalidating cached ${provider.languageName} runtimes in the background.`,
                        );
                        void this._discoverProvider(provider, plan.discoveryRootSignature, registrationToken).catch(error => {
                            this._outputChannel.error(
                                `Error revalidating runtimes for ${provider.languageId}: ${error}`,
                            );
                        });
                    }
                } catch (error) {
                    this._outputChannel.error(
                        `Error discovering runtimes for ${provider.languageId}: ${error}`,
                    );
                }
            });
        } finally {
            this._isDiscovering = false;
            this._discoveryComplete = true;
            this._onDidFinishDiscovery.fire();
            this._outputChannel.debug(
                `Discovery complete. Found ${this.getInstallations().length} installation(s)`
            );
            this._discoveryPromise = undefined;
            resolveDiscovery();
        }
    }

    async recommendWorkspaceRuntimes(disabledLanguageIds: string[]): Promise<LanguageRuntimeMetadata[]> {
        const recommendations: LanguageRuntimeMetadata[] = [];

        for (const provider of this._runtimeProviders.values()) {
            const registrationToken = this._runtimeProviderRegistrationTokens.get(provider.languageId);
            if (disabledLanguageIds.includes(provider.languageId) || !provider.shouldRecommendForWorkspace) {
                continue;
            }
            if (this._languagesWithExternalDiscoveryManagers.has(provider.languageId)) {
                continue;
            }

            if (!(await provider.shouldRecommendForWorkspace())) {
                continue;
            }
            if (!this._isCurrentProvider(provider, registrationToken)) {
                continue;
            }

            const logChannel = this._getProviderLogChannel(provider.languageId);
            const installation = await provider.resolveInitialInstallation(logChannel) ??
                this.getBestInstallation(provider.languageId);
            if (!installation || !this._isCurrentProvider(provider, registrationToken)) {
                continue;
            }

            const metadata = provider.createRuntimeMetadata(this._context, installation, logChannel);
            this._runtimes.set(metadata.runtimeId, metadata);
            this._sessionManager.registerDiscoveredRuntime(
                provider.languageId,
                installation,
                metadata,
            );
            recommendations.push(metadata);
        }

        return recommendations;
    }

    async discoverRuntimesForLanguage(languageId: string): Promise<LanguageRuntimeMetadata[]> {
        if (!this._discoveryComplete && !this._isDiscovering) {
            await this.discoverAllRuntimes([]);
        } else if (this._isDiscovering) {
            await new Promise<void>(resolve => {
                const disposable = this._onDidFinishDiscovery.event(() => {
                    disposable.dispose();
                    resolve();
                });
            });
        }

        return this.runtimes.filter(runtime => runtime.languageId === languageId);
    }

    getRuntime(runtimeId: string): LanguageRuntimeMetadata | undefined {
        return this._runtimes.get(runtimeId);
    }

    get runtimes(): LanguageRuntimeMetadata[] {
        return Array.from(this._runtimes.values());
    }

    registerDiscoveredRuntime<TInstallation = unknown>(
        languageId: string,
        installation: TInstallation,
        metadata: LanguageRuntimeMetadata,
    ): boolean {
        const installations = this._getOrCreateInstallations(languageId);
        const provider = this._runtimeProviders.get(languageId) as ILanguageRuntimeProvider<TInstallation> | undefined;
        if (!provider) {
            throw new Error(`No runtime provider registered for language ${languageId}`);
        }

        const runtimePath = provider.getRuntimePath(installation);
        if (installations.some((existing) => provider.getRuntimePath(existing as TInstallation) === runtimePath)) {
            this._runtimes.set(metadata.runtimeId, metadata);
            this._sessionManager.registerDiscoveredRuntime(languageId, installation, metadata);
            return false;
        }

        installations.push(installation);
        this._runtimes.set(metadata.runtimeId, metadata);
        this._sessionManager.registerDiscoveredRuntime(languageId, installation, metadata);
        this._onDidDiscoverRuntime.fire({
            provider,
            installation,
            metadata,
        });
        return true;
    }

    private _removeRuntime<TInstallation>(
        provider: ILanguageRuntimeProvider<TInstallation>,
        runtimeId: string,
    ): void {
        const metadata = this._runtimes.get(runtimeId);
        if (!metadata || metadata.languageId !== provider.languageId) {
            return;
        }
        this._runtimes.delete(runtimeId);
        const installations = this._installationsByLanguageId.get(provider.languageId) ?? [];
        this._installationsByLanguageId.set(
            provider.languageId,
            installations.filter(installation =>
                provider.getRuntimePath(installation as TInstallation) !== metadata.runtimePath),
        );
        this._sessionManager.unregisterDiscoveredRuntime(runtimeId);
    }

    registerExternalDiscoveryManager(languageId: string): vscode.Disposable {
        this._languagesWithExternalDiscoveryManagers.add(languageId);
        return new vscode.Disposable(() => {
            this._languagesWithExternalDiscoveryManagers.delete(languageId);
        });
    }

    async createSession(runtimeId: string, sessionName?: string) {
        const runtime = this._runtimes.get(runtimeId);
        if (!runtime) {
            throw new Error(`Runtime ${runtimeId} not found`);
        }

        const provider = this.getRuntimeProvider(runtime.languageId);
        if (!provider) {
            throw new Error(`No runtime provider registered for language ${runtime.languageId}`);
        }

        const cachedInstallation = this.getInstallations(runtime.languageId).find(
            installation => provider.getRuntimePath(installation) === runtime.runtimePath
        );
        const installation = cachedInstallation ?? provider.restoreInstallationFromMetadata?.(runtime);

        if (!installation) {
            throw new Error(`No installation available for runtime ${runtime.runtimeName}`);
        }

        this._sessionManager.registerDiscoveredRuntime(
            runtime.languageId,
            installation,
            runtime,
        );
        const sessionId = await this._sessionManager.startNewRuntimeSession(
            runtime.runtimeId,
            sessionName || runtime.runtimeName,
            LanguageRuntimeSessionMode.Console,
            undefined,
            'RuntimeManager.createSession',
            RuntimeStartMode.Starting,
            true,
        );
        return this._sessionManager.getSession(sessionId);
    }

    private async _discoverProvider<TInstallation>(
        provider: ILanguageRuntimeProvider<TInstallation>,
        discoveryRootSignature?: RuntimeRootSignature,
        registrationToken = this._runtimeProviderRegistrationTokens.get(provider.languageId),
    ): Promise<void> {
        if (!this._isCurrentProvider(provider, registrationToken)) {
            return;
        }
        const providerId = this._getProviderId(provider);
        const logChannel = this._getProviderLogChannel(provider.languageId);
        const rootSignature = discoveryRootSignature ??
            await this._getDiscoveryRootSignature(provider);
        if (!this._isCurrentProvider(provider, registrationToken)) {
            return;
        }
        const discovered: Array<{
            installation: TInstallation;
            metadata: LanguageRuntimeMetadata;
            runtimePath: string;
        }> = [];
        const paths = new Set<string>();

        for await (const installation of provider.discoverInstallations(logChannel)) {
            if (!this._isCurrentProvider(provider, registrationToken)) {
                return;
            }
            const runtimePath = provider.getRuntimePath(installation);
            if (paths.has(runtimePath)) {
                continue;
            }
            paths.add(runtimePath);

            const metadata = provider.createRuntimeMetadata(
                this._context,
                installation,
                logChannel
            );
            discovered.push({ installation, metadata, runtimePath });
        }

        if (!this._isCurrentProvider(provider, registrationToken)) {
            return;
        }
        const previousPaths = new Set(
            this.getInstallations<TInstallation>(provider.languageId)
                .map(installation => provider.getRuntimePath(installation)),
        );
        const runtimeIds = new Set(discovered.map(entry => entry.metadata.runtimeId));
        for (const [runtimeId, metadata] of this._runtimes) {
            if (metadata.languageId === provider.languageId) {
                this._runtimes.delete(runtimeId);
                if (!runtimeIds.has(runtimeId)) {
                    this._sessionManager.unregisterDiscoveredRuntime(runtimeId);
                }
            }
        }
        this._installationsByLanguageId.set(
            provider.languageId,
            discovered.map(entry => entry.installation),
        );

        for (const entry of discovered) {
            if (!this._isCurrentProvider(provider, registrationToken)) {
                return;
            }
            this._runtimes.set(entry.metadata.runtimeId, entry.metadata);
            this._sessionManager.registerDiscoveredRuntime(
                provider.languageId,
                entry.installation,
                entry.metadata,
            );
            if (!previousPaths.has(entry.runtimePath)) {
                this._onDidDiscoverRuntime.fire({
                    provider,
                    installation: entry.installation,
                    metadata: entry.metadata,
                });
            }
            this._outputChannel.debug(
                `Discovered ${provider.languageName} ${entry.metadata.languageVersion} at ${entry.runtimePath}`,
            );
        }

        await this._discoveryCache.replaceBucket(
            providerId,
            provider.languageId,
            discovered.map(entry => entry.metadata),
            rootSignature,
            () => this._isCurrentProvider(provider, registrationToken),
        );
    }

    private async _restoreCachedProvider<TInstallation>(
        provider: ILanguageRuntimeProvider<TInstallation>,
        registrationToken = this._runtimeProviderRegistrationTokens.get(provider.languageId),
    ): Promise<{ restored: boolean; needsRevalidation: boolean }> {
        if (!this._isCurrentProvider(provider, registrationToken)) {
            return { restored: false, needsRevalidation: false };
        }
        const providerId = this._getProviderId(provider);
        const cached = this._discoveryCache.getBucket(providerId, provider.languageId);
        if (!cached || cached.entries.length === 0 || !provider.restoreInstallationFromMetadata) {
            return { restored: false, needsRevalidation: false };
        }

        let restored = false;
        let needsRevalidation = false;
        for (const entry of cached.entries) {
            if (!this._isCurrentProvider(provider, registrationToken)) {
                return { restored, needsRevalidation: false };
            }
            const installation = provider.restoreInstallationFromMetadata(entry.metadata);
            if (!installation) {
                needsRevalidation = true;
                continue;
            }
            const runtimePath = provider.getRuntimePath(installation);
            const stat = await this._discoveryCache.statRuntimePath(runtimePath);
            if (!this._isCurrentProvider(provider, registrationToken)) {
                return { restored, needsRevalidation: false };
            }
            if (!stat) {
                needsRevalidation = true;
                continue;
            }
            if (!this._discoveryCache.fingerprintsEqual(entry.fingerprint, stat.fingerprint)) {
                needsRevalidation = true;
                continue;
            }
            this.registerDiscoveredRuntime(provider.languageId, installation, entry.metadata);
            await this._discoveryCache.markValidated(
                providerId,
                provider.languageId,
                entry.metadata.runtimePath,
                stat.fingerprint,
            );
            restored = true;
        }

        if (restored) {
            this._outputChannel.debug(
                `Restored cached runtime discovery for ${provider.languageName}.`,
            );
        }
        return { restored, needsRevalidation };
    }

    private async _createDiscoveryPlan<TInstallation>(
        provider: ILanguageRuntimeProvider<TInstallation>,
        bypassCache: boolean,
    ): Promise<{
        useCache: boolean;
        reason: 'always-rediscover' | 'cold-start' | 'periodic' | 'roots-changed' | 'user-bypass' | 'warm-cache';
        discoveryRootSignature?: RuntimeRootSignature;
    }> {
        const providerId = this._getProviderId(provider);
        const bucket = this._discoveryCache.getBucket(providerId, provider.languageId);
        const discoveryRootSignature = await this._getDiscoveryRootSignature(provider);
        if (bypassCache) {
            return { useCache: false, reason: 'user-bypass', discoveryRootSignature };
        }
        if (provider.alwaysRediscover) {
            return { useCache: false, reason: 'always-rediscover', discoveryRootSignature };
        }
        if (!bucket || bucket.entries.length === 0) {
            return { useCache: false, reason: 'cold-start', discoveryRootSignature };
        }
        if (
            discoveryRootSignature !== undefined &&
            !this._discoveryRootSignaturesEqual(bucket.discoveryRootSignature, discoveryRootSignature)
        ) {
            return { useCache: false, reason: 'roots-changed', discoveryRootSignature };
        }
        if (Date.now() - bucket.lastFullDiscovery > DISCOVERY_CACHE_REFRESH_INTERVAL_MS) {
            return { useCache: false, reason: 'periodic', discoveryRootSignature };
        }
        return { useCache: true, reason: 'warm-cache', discoveryRootSignature };
    }

    private _getProviderId<TInstallation>(provider: ILanguageRuntimeProvider<TInstallation>): string {
        return this._runtimeProviderCacheIds.get(provider.languageId) ??
            provider.extensionId ?? `vscode-supervisor.${provider.languageId}`;
    }

    private _isCurrentProvider<TInstallation>(
        provider: ILanguageRuntimeProvider<TInstallation>,
        registrationToken: { disposed: boolean } | undefined,
    ): boolean {
        return !!registrationToken && !registrationToken.disposed &&
            this._runtimeProviders.get(provider.languageId) === provider &&
            this._runtimeProviderRegistrationTokens.get(provider.languageId) === registrationToken;
    }

    private _clearLanguageRuntimes(languageId: string): void {
        for (const [runtimeId, metadata] of this._runtimes) {
            if (metadata.languageId === languageId) {
                this._runtimes.delete(runtimeId);
                this._sessionManager.unregisterDiscoveredRuntime(runtimeId);
            }
        }
        this._installationsByLanguageId.delete(languageId);
    }

    private async _getDiscoveryRootSignature<TInstallation>(
        provider: ILanguageRuntimeProvider<TInstallation>,
    ): Promise<RuntimeRootSignature | undefined> {
        if (provider.getDiscoveryRootSignature) {
            try {
                const signature = await Promise.race([
                    provider.getDiscoveryRootSignature(),
                    new Promise<undefined>(resolve =>
                        setTimeout(() => resolve(undefined), 500),
                    ),
                ]);
                if (signature !== undefined) {
                    return signature;
                }
            } catch (error) {
                this._outputChannel.warn(
                    `Failed to compute discovery root signature for ${provider.languageName}: ${error}`,
                );
            }
        }

        return undefined;
    }

    private _discoveryRootSignaturesEqual(
        left: RuntimeRootSignature | undefined,
        right: RuntimeRootSignature | undefined,
    ): boolean {
        if (!left || !right || left.opaque !== right.opaque || left.entries.length !== right.entries.length) {
            return false;
        }
        return left.entries.every((entry, index) => {
            const other = right.entries[index];
            return entry.path === other.path &&
                entry.exists === other.exists &&
                entry.mtimeMs === other.mtimeMs;
        });
    }

    private async _runWithConcurrency<T>(
        values: readonly T[],
        concurrency: number,
        task: (value: T) => Promise<void>,
    ): Promise<void> {
        let index = 0;
        const workers = Array.from(
            { length: Math.min(concurrency, values.length) },
            async () => {
                for (;;) {
                    const current = index++;
                    if (current >= values.length) {
                        return;
                    }
                    await task(values[current]);
                }
            },
        );
        await Promise.all(workers);
    }

    private _getOrCreateInstallations(languageId: string): unknown[] {
        const existing = this._installationsByLanguageId.get(languageId);
        if (existing) {
            return existing;
        }

        const created: unknown[] = [];
        this._installationsByLanguageId.set(languageId, created);
        return created;
    }

    dispose(): void {
        for (const token of this._runtimeProviderRegistrationTokens.values()) {
            token.disposed = true;
        }
        this._providerDiscoveryPromises.clear();
        this._disposables.forEach(d => d.dispose());
    }
}
