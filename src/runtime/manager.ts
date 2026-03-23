import * as vscode from 'vscode';
import {
    type IDiscoveredLanguageRuntime,
    type ILanguageRuntimeProvider,
} from '../api';
import type { LanguageRuntimeMetadata } from '../positronTypes';
import { SessionManager } from './sessionManager';

/**
 * Manages discovery and registration of language runtimes.
 * Providers own discovery logic; the manager owns caching and orchestration.
 */
export class RuntimeManager implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _runtimeProviders = new Map<string, ILanguageRuntimeProvider<any>>();
    private readonly _runtimes = new Map<string, LanguageRuntimeMetadata>();
    private readonly _installationsByLanguageId = new Map<string, unknown[]>();
    private _isDiscovering = false;
    private _discoveryComplete = false;

    private readonly _onDidDiscoverRuntime = new vscode.EventEmitter<IDiscoveredLanguageRuntime>();
    readonly onDidDiscoverRuntime = this._onDidDiscoverRuntime.event;

    private readonly _onDidFinishDiscovery = new vscode.EventEmitter<void>();
    readonly onDidFinishDiscovery = this._onDidFinishDiscovery.event;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _sessionManager: SessionManager,
        private readonly _outputChannel: vscode.LogOutputChannel
    ) {
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
        if (this._isDiscovering) {
            this._outputChannel.debug('Discovery already in progress, skipping...');
            return;
        }

        this._isDiscovering = true;
        this._outputChannel.debug('Starting incremental runtime discovery...');

        try {
            for (const provider of this._runtimeProviders.values()) {
                await this._discoverProvider(provider);
            }
        } catch (error) {
            this._outputChannel.error(`Error during runtime discovery: ${error}`);
        } finally {
            this._isDiscovering = false;
            this._discoveryComplete = true;
            this._onDidFinishDiscovery.fire();
            this._outputChannel.debug(
                `Discovery complete. Found ${this.getInstallations().length} installation(s)`
            );
        }
    }

    async discoverRuntimesForLanguage(languageId: string): Promise<LanguageRuntimeMetadata[]> {
        if (!this._discoveryComplete && !this._isDiscovering) {
            await this.startDiscovery();
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

        return this._sessionManager.createSessionForLanguageInstallation(
            runtime.languageId,
            installation,
            sessionName || runtime.runtimeName
        );
    }

    private async _discoverProvider<TInstallation>(
        provider: ILanguageRuntimeProvider<TInstallation>
    ): Promise<void> {
        for await (const installation of provider.discoverInstallations(this._outputChannel)) {
            const runtimePath = provider.getRuntimePath(installation);
            const installations = this._getOrCreateInstallations(provider.languageId);

            if (installations.some(existing => provider.getRuntimePath(existing as TInstallation) === runtimePath)) {
                continue;
            }

            installations.push(installation);

            const metadata = provider.createRuntimeMetadata(
                this._context,
                installation,
                this._outputChannel
            );
            this._runtimes.set(metadata.runtimeId, metadata);

            this._onDidDiscoverRuntime.fire({
                provider,
                installation,
                metadata,
            });

            this._outputChannel.debug(
                `Discovered ${provider.languageName} ${metadata.languageVersion} at ${runtimePath}`
            );
        }
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
