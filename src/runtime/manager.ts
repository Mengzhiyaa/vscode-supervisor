import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import {
    type IDiscoveredLanguageRuntime,
    type IRuntimeManager,
    type ILanguageRuntimeProvider,
    LanguageRuntimeSessionMode,
    type LanguageRuntimeMetadata,
} from '../api';
import { RuntimeStartMode } from '../internal/runtimeTypes';
import { RuntimeSessionService } from './runtimeSession';

const DISCOVERY_CACHE_KEY = 'vscode-supervisor.runtimeDiscoveryCache.v1';
const DISCOVERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface RuntimePathFingerprint {
    size: number;
    mtimeMs: number;
    ctimeMs: number;
}

interface CachedRuntime {
    metadata: LanguageRuntimeMetadata;
    fingerprint?: RuntimePathFingerprint;
}

interface CachedLanguageDiscovery {
    discoveredAt: number;
    runtimes: CachedRuntime[];
}

interface RuntimeDiscoveryCache {
    version: 1;
    languages: Record<string, CachedLanguageDiscovery>;
}

/**
 * Manages discovery and registration of language runtimes.
 * Providers own discovery logic; the manager owns caching and orchestration.
 */
export class RuntimeManager implements vscode.Disposable, IRuntimeManager {
    private static _nextRuntimeManagerId = 1;

    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _runtimeProviders = new Map<string, ILanguageRuntimeProvider<any>>();
    private readonly _runtimes = new Map<string, LanguageRuntimeMetadata>();
    private readonly _installationsByLanguageId = new Map<string, unknown[]>();
    private readonly _languagesWithExternalDiscoveryManagers = new Set<string>();
    private _isDiscovering = false;
    private _discoveryComplete = false;
    private _discoveryPromise: Promise<void> | undefined;
    private readonly _discoveryCache: RuntimeDiscoveryCache;
    private _cacheWriteChain = Promise.resolve();

    readonly id = RuntimeManager._nextRuntimeManagerId++;

    private readonly _onDidDiscoverRuntime = new vscode.EventEmitter<IDiscoveredLanguageRuntime>();
    readonly onDidDiscoverRuntime = this._onDidDiscoverRuntime.event;

    private readonly _onDidFinishDiscovery = new vscode.EventEmitter<void>();
    readonly onDidFinishDiscovery = this._onDidFinishDiscovery.event;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _outputChannel: vscode.LogOutputChannel
    ) {
        this._discoveryCache = this._context.globalState.get<RuntimeDiscoveryCache>(
            DISCOVERY_CACHE_KEY,
            { version: 1, languages: {} },
        );
        this._disposables.push(this._onDidDiscoverRuntime);
        this._disposables.push(this._onDidFinishDiscovery);
    }

    registerRuntimeProvider<TInstallation>(provider: ILanguageRuntimeProvider<TInstallation>): void {
        this._runtimeProviders.set(provider.languageId, provider as ILanguageRuntimeProvider<any>);
    }

    getRuntimeProvider<TInstallation = unknown>(languageId: string): ILanguageRuntimeProvider<TInstallation> | undefined {
        return this._runtimeProviders.get(languageId) as ILanguageRuntimeProvider<TInstallation> | undefined;
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
                try {
                    const cached = force
                        ? { restored: false, needsRevalidation: false }
                        : await this._restoreCachedProvider(provider);
                    if (!cached.restored) {
                        await this._discoverProvider(provider);
                    } else if (cached.needsRevalidation) {
                        this._outputChannel.debug(
                            `Revalidating cached ${provider.languageName} runtimes in the background.`,
                        );
                        void this._discoverProvider(provider).catch(error => {
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
            if (disabledLanguageIds.includes(provider.languageId) || !provider.shouldRecommendForWorkspace) {
                continue;
            }
            if (this._languagesWithExternalDiscoveryManagers.has(provider.languageId)) {
                continue;
            }

            if (!(await provider.shouldRecommendForWorkspace())) {
                continue;
            }

            const installation = this.getBestInstallation(provider.languageId) ??
                await provider.resolveInitialInstallation(this._outputChannel);
            if (!installation) {
                continue;
            }

            const metadata = provider.createRuntimeMetadata(this._context, installation, this._outputChannel);
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
        provider: ILanguageRuntimeProvider<TInstallation>
    ): Promise<void> {
        const discovered: Array<{
            installation: TInstallation;
            metadata: LanguageRuntimeMetadata;
            runtimePath: string;
        }> = [];
        const paths = new Set<string>();

        for await (const installation of provider.discoverInstallations(this._outputChannel)) {
            const runtimePath = provider.getRuntimePath(installation);
            if (paths.has(runtimePath)) {
                continue;
            }
            paths.add(runtimePath);

            const metadata = provider.createRuntimeMetadata(
                this._context,
                installation,
                this._outputChannel
            );
            discovered.push({ installation, metadata, runtimePath });
        }

        const previousPaths = new Set(
            this.getInstallations<TInstallation>(provider.languageId)
                .map(installation => provider.getRuntimePath(installation)),
        );
        for (const [runtimeId, metadata] of this._runtimes) {
            if (metadata.languageId === provider.languageId) {
                this._runtimes.delete(runtimeId);
            }
        }
        this._installationsByLanguageId.set(
            provider.languageId,
            discovered.map(entry => entry.installation),
        );

        for (const entry of discovered) {
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

        const cachedRuntimes = await Promise.all(discovered.map(async entry => ({
            metadata: entry.metadata,
            fingerprint: await this._fingerprint(entry.runtimePath),
        })));
        this._discoveryCache.languages[provider.languageId] = {
            discoveredAt: Date.now(),
            runtimes: cachedRuntimes,
        };
        await this._writeDiscoveryCache();
    }

    private async _restoreCachedProvider<TInstallation>(
        provider: ILanguageRuntimeProvider<TInstallation>,
    ): Promise<{ restored: boolean; needsRevalidation: boolean }> {
        const cached = this._discoveryCache.languages[provider.languageId];
        if (!cached || cached.runtimes.length === 0 || !provider.restoreInstallationFromMetadata) {
            return { restored: false, needsRevalidation: false };
        }

        let restored = false;
        let needsRevalidation =
            Date.now() - cached.discoveredAt > DISCOVERY_CACHE_MAX_AGE_MS;
        for (const entry of cached.runtimes) {
            const installation = provider.restoreInstallationFromMetadata(entry.metadata);
            if (!installation) {
                needsRevalidation = true;
                continue;
            }
            const runtimePath = provider.getRuntimePath(installation);
            const fingerprint = await this._fingerprint(runtimePath);
            if (!fingerprint) {
                needsRevalidation = true;
                continue;
            }
            if (!entry.fingerprint || !this._fingerprintsEqual(entry.fingerprint, fingerprint)) {
                needsRevalidation = true;
            }
            this.registerDiscoveredRuntime(provider.languageId, installation, entry.metadata);
            restored = true;
        }

        if (restored) {
            this._outputChannel.debug(
                `Restored cached runtime discovery for ${provider.languageName}.`,
            );
        }
        return { restored, needsRevalidation };
    }

    private async _fingerprint(runtimePath: string): Promise<RuntimePathFingerprint | undefined> {
        try {
            const stat = await fs.stat(runtimePath);
            return {
                size: stat.size,
                mtimeMs: stat.mtimeMs,
                ctimeMs: stat.ctimeMs,
            };
        } catch {
            return undefined;
        }
    }

    private _fingerprintsEqual(
        left: RuntimePathFingerprint,
        right: RuntimePathFingerprint,
    ): boolean {
        return left.size === right.size &&
            left.mtimeMs === right.mtimeMs &&
            left.ctimeMs === right.ctimeMs;
    }

    private async _writeDiscoveryCache(): Promise<void> {
        const write = this._cacheWriteChain.then(() =>
            this._context.globalState.update(DISCOVERY_CACHE_KEY, this._discoveryCache),
        );
        this._cacheWriteChain = write.then(() => undefined, () => undefined);
        await write;
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
        this._disposables.forEach(d => d.dispose());
    }
}
