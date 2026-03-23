import * as fs from 'fs';
import * as vscode from 'vscode';
import { CoreConfigurationSections } from '../coreCommandIds';
import { RuntimeManager } from './manager';
import { RuntimeSession } from './session';
import { SessionManager } from './sessionManager';
import {
    LanguageRuntimeMetadata,
    LanguageRuntimeStartupBehavior,
    RuntimeState,
} from '../positronTypes';

const AFFILIATED_RUNTIME_KEY_PREFIX = 'vscode-supervisor.affiliatedRuntimeMetadata.v1';

interface IAffiliatedRuntimeMetadata {
    metadata: LanguageRuntimeMetadata;
    lastUsed: number;
    lastStarted: number;
}

export enum LanguageStartupBehavior {
    Always = 'always',
    Auto = 'auto',
    Recommended = 'recommended',
    Manual = 'manual',
    Disabled = 'disabled',
}

export enum RuntimeStartupPhase {
    Initializing = 'initializing',
    AwaitingTrust = 'awaitingTrust',
    Reconnecting = 'reconnecting',
    Starting = 'starting',
    Discovering = 'discovering',
    Complete = 'complete',
}

export interface IRuntimeAutoStartEvent {
    runtimeName: string;
    languageName: string;
    base64EncodedIconSvg?: string;
    newSession: boolean;
}

/**
 * Coordinates runtime startup behavior (Positron-style) for the supervisor framework.
 */
export class RuntimeStartupService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _sessionStateDisposables = new Map<string, vscode.Disposable>();
    private readonly _mostRecentlyStartedRuntimesByLanguageId = new Map<string, LanguageRuntimeMetadata>();

    private readonly _onDidChangeRuntimeStartupPhase = new vscode.EventEmitter<RuntimeStartupPhase>();
    readonly onDidChangeRuntimeStartupPhase = this._onDidChangeRuntimeStartupPhase.event;
    private readonly _onWillAutoStartRuntime = new vscode.EventEmitter<IRuntimeAutoStartEvent>();
    readonly onWillAutoStartRuntime = this._onWillAutoStartRuntime.event;

    private _startupPhase = RuntimeStartupPhase.Initializing;
    private _startupPromise: Promise<void> | undefined;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _runtimeManager: RuntimeManager,
        private readonly _sessionManager: SessionManager,
        private readonly _outputChannel: vscode.LogOutputChannel,
    ) {
        this._disposables.push(this._onDidChangeRuntimeStartupPhase);
        this._disposables.push(this._onWillAutoStartRuntime);

        this._disposables.push(
            this._sessionManager.onWillStartSession((e) => {
                this._attachSessionStateListener(e.session);
            }),
            this._sessionManager.onDidChangeForegroundSession((session) => {
                if (!session) {
                    return;
                }

                this._mostRecentlyStartedRuntimesByLanguageId.set(
                    session.runtimeMetadata.languageId,
                    session.runtimeMetadata as LanguageRuntimeMetadata
                );

                void this._saveRuntimeAffiliation(session.runtimeMetadata as LanguageRuntimeMetadata);
            }),
            this._sessionManager.onDidDeleteRuntimeSession((sessionId) => {
                this._disposeSessionStateListener(sessionId);
            })
        );

        for (const session of this._sessionManager.sessions) {
            this._attachSessionStateListener(session);
        }
    }

    get startupPhase(): RuntimeStartupPhase {
        return this._startupPhase;
    }

    get discoveredRuntimeCount(): number {
        return this._runtimeManager.getInstallations().length;
    }

    async startup(): Promise<void> {
        if (this._startupPromise) {
            return this._startupPromise;
        }

        this._startupPromise = this._startupSequence();
        return this._startupPromise;
    }

    hasAffiliatedRuntime(): boolean {
        return this.getAffiliatedRuntimeLanguageIds().length > 0;
    }

    getAffiliatedRuntimeMetadata(languageId: string): LanguageRuntimeMetadata | undefined {
        const affiliated = this._getAffiliatedRuntime(languageId);
        return affiliated?.metadata;
    }

    getAffiliatedRuntimes(): Array<LanguageRuntimeMetadata> {
        const runtimes: LanguageRuntimeMetadata[] = [];
        for (const languageId of this.getAffiliatedRuntimeLanguageIds()) {
            const metadata = this.getAffiliatedRuntimeMetadata(languageId);
            if (metadata) {
                runtimes.push(metadata);
            }
        }
        return runtimes;
    }

    clearAffiliatedRuntime(languageId: string): void {
        void this._context.workspaceState.update(this._storageKeyForLanguage(languageId), undefined);
    }

    getPreferredRuntime(languageId: string): LanguageRuntimeMetadata | undefined {
        const activeSession = this._sessionManager.activeSession;
        if (activeSession && activeSession.runtimeMetadata.languageId === languageId) {
            return activeSession.runtimeMetadata as LanguageRuntimeMetadata;
        }

        const affiliatedRuntimeMetadata = this.getAffiliatedRuntimeMetadata(languageId);
        if (affiliatedRuntimeMetadata) {
            const runtime = this._runtimeManager.getRuntime(affiliatedRuntimeMetadata.runtimeId);
            if (runtime) {
                return runtime as LanguageRuntimeMetadata;
            }
        }

        const mostRecentlyStartedRuntime = this._mostRecentlyStartedRuntimesByLanguageId.get(languageId);
        if (mostRecentlyStartedRuntime) {
            return mostRecentlyStartedRuntime;
        }

        const registeredRuntimes = this._runtimeManager.runtimes
            .filter(runtime => runtime.languageId === languageId);

        return registeredRuntimes.length ? registeredRuntimes[0] as LanguageRuntimeMetadata : undefined;
    }

    async rediscoverAllRuntimes(): Promise<void> {
        this._setStartupPhase(RuntimeStartupPhase.Discovering);
        await this._runtimeManager.startDiscovery();
        await this._autoStartAfterDiscovery();
        this._setStartupPhase(RuntimeStartupPhase.Complete);
    }

    private async _startupSequence(): Promise<void> {
        await this._awaitWorkspaceTrust();

        if (this._sessionManager.sessions.length > 0) {
            this._setStartupPhase(RuntimeStartupPhase.Reconnecting);
            const restoredSession =
                this._sessionManager.activeSession ?? this._sessionManager.sessions[0];
            if (restoredSession) {
                this._fireRuntimeStartupEvent(
                    this._createRuntimeStartupEventForSession(restoredSession, false)
                );
            }
        } else {
            this._setStartupPhase(RuntimeStartupPhase.Starting);
        }

        try {
            if (!this._hasStartingOrRunningConsole()) {
                await this._startAffiliatedLanguageRuntimes();
            }

            if (!this._hasStartingOrRunningConsole()) {
                await this._startRecommendedLanguageRuntime();
            }
        } catch (error) {
            this._outputChannel.error('[RuntimeStartup] Error while auto-starting runtimes: ' + error);
        }

        this._setStartupPhase(RuntimeStartupPhase.Discovering);
        await this._runtimeManager.startDiscovery();
        await this._autoStartAfterDiscovery();
        this._setStartupPhase(RuntimeStartupPhase.Complete);
    }

    private async _awaitWorkspaceTrust(): Promise<void> {
        if (vscode.workspace.isTrusted) {
            return;
        }

        this._setStartupPhase(RuntimeStartupPhase.AwaitingTrust);

        await new Promise<void>((resolve) => {
            const disposable = vscode.workspace.onDidGrantWorkspaceTrust(() => {
                disposable.dispose();
                resolve();
            });
        });
    }

    private _setStartupPhase(phase: RuntimeStartupPhase): void {
        if (this._startupPhase === phase) {
            return;
        }

        this._startupPhase = phase;
        this._onDidChangeRuntimeStartupPhase.fire(phase);
        this._outputChannel.debug(`[RuntimeStartup] Phase changed to '${phase}'`);
    }

    private getAffiliatedRuntimeLanguageIds(): string[] {
        const languageIds = new Set<string>();
        for (const key of this._context.workspaceState.keys()) {
            if (key.startsWith(`${AFFILIATED_RUNTIME_KEY_PREFIX}.`)) {
                languageIds.add(key.replace(`${AFFILIATED_RUNTIME_KEY_PREFIX}.`, ''));
            }
        }

        return Array.from(languageIds);
    }

    private _storageKeyForLanguage(languageId: string): string {
        return `${AFFILIATED_RUNTIME_KEY_PREFIX}.${languageId}`;
    }

    private _getAffiliatedRuntime(languageId: string): IAffiliatedRuntimeMetadata | undefined {
        const stored = this._context.workspaceState.get<IAffiliatedRuntimeMetadata>(
            this._storageKeyForLanguage(languageId)
        );

        if (!stored || !stored.metadata || !stored.metadata.languageId) {
            return undefined;
        }

        return stored;
    }

    private async _saveRuntimeAffiliation(metadata: LanguageRuntimeMetadata): Promise<void> {
        if (!metadata || !metadata.languageId) {
            return;
        }

        const oldAffiliation = this._getAffiliatedRuntime(metadata.languageId);
        const lastStarted = oldAffiliation?.metadata.runtimeId === metadata.runtimeId
            ? oldAffiliation.lastStarted
            : Date.now();

        const affiliated: IAffiliatedRuntimeMetadata = {
            metadata,
            lastUsed: Date.now(),
            lastStarted,
        };

        await this._context.workspaceState.update(this._storageKeyForLanguage(metadata.languageId), affiliated);
    }

    private _attachSessionStateListener(session: RuntimeSession): void {
        const sessionId = session.sessionId;
        if (this._sessionStateDisposables.has(sessionId)) {
            return;
        }

        const disposable = session.onDidChangeRuntimeState((newState) => {
            if (newState !== RuntimeState.Exiting) {
                return;
            }

            const affiliated = this._getAffiliatedRuntime(session.runtimeMetadata.languageId);
            if (!affiliated) {
                return;
            }

            if (affiliated.metadata.runtimeId === session.runtimeMetadata.runtimeId) {
                void this._context.workspaceState.update(
                    this._storageKeyForLanguage(session.runtimeMetadata.languageId),
                    undefined
                );
            }
        });

        this._sessionStateDisposables.set(sessionId, disposable);
    }

    private _disposeSessionStateListener(sessionId: string): void {
        const disposable = this._sessionStateDisposables.get(sessionId);
        if (disposable) {
            disposable.dispose();
            this._sessionStateDisposables.delete(sessionId);
        }
    }

    private _getStartupBehavior(languageId: string): LanguageStartupBehavior {
        const config = vscode.workspace.getConfiguration(CoreConfigurationSections.supervisor, { languageId });
        const configured = config.get<string>('interpreters.startupBehavior', LanguageStartupBehavior.Auto);

        switch (configured) {
            case LanguageStartupBehavior.Always:
            case LanguageStartupBehavior.Auto:
            case LanguageStartupBehavior.Recommended:
            case LanguageStartupBehavior.Manual:
            case LanguageStartupBehavior.Disabled:
                return configured;
            default:
                return LanguageStartupBehavior.Auto;
        }
    }

    private _isAutoStartupAllowed(languageId: string): boolean {
        const startupBehavior = this._getStartupBehavior(languageId);
        return startupBehavior !== LanguageStartupBehavior.Disabled &&
            startupBehavior !== LanguageStartupBehavior.Manual;
    }

    private _hasStartingOrRunningConsole(languageId?: string): boolean {
        return this._sessionManager.sessions.some(session => {
            if (languageId && session.runtimeMetadata.languageId !== languageId) {
                return false;
            }

            return session.state !== RuntimeState.Uninitialized &&
                session.state !== RuntimeState.Exited;
        });
    }

    private async _startAffiliatedLanguageRuntimes(): Promise<void> {
        let languageIds = this.getAffiliatedRuntimeLanguageIds()
            .filter(languageId => this._isAutoStartupAllowed(languageId));

        languageIds = languageIds.filter(languageId => {
            const startupBehavior = this._getStartupBehavior(languageId);
            return startupBehavior === LanguageStartupBehavior.Always || startupBehavior === LanguageStartupBehavior.Auto;
        });

        if (languageIds.length === 0) {
            return;
        }

        const affiliations = languageIds
            .map(languageId => this._getAffiliatedRuntime(languageId))
            .filter((value): value is IAffiliatedRuntimeMetadata => !!value)
            .filter(affiliation => {
                if (languageIds.length === 1) {
                    return true;
                }

                if (affiliation.lastStarted === 0 && affiliation.lastUsed === 0) {
                    return false;
                }

                return affiliation.lastStarted <= affiliation.lastUsed;
            })
            .sort((a, b) => b.lastUsed - a.lastUsed);

        for (let index = 0; index < affiliations.length; index += 1) {
            const affiliation = affiliations[index];
            try {
                await this._startAffiliatedRuntime(affiliation, index === 0);
            } catch (error) {
                this._outputChannel.warn(
                    '[RuntimeStartup] Failed to start affiliated runtime ' + affiliation.metadata.runtimeName + ': ' + error
                );
                continue;
            }

            if (this._hasStartingOrRunningConsole(affiliation.metadata.languageId)) {
                break;
            }
        }
    }

    private async _startAffiliatedRuntime(
        affiliation: IAffiliatedRuntimeMetadata,
        activate: boolean
    ): Promise<void> {
        const metadata = affiliation.metadata;

        if (metadata.startupBehavior === LanguageRuntimeStartupBehavior.Manual) {
            return;
        }

        affiliation.lastStarted = Date.now();
        await this._context.workspaceState.update(this._storageKeyForLanguage(metadata.languageId), affiliation);

        await this._autoStartRuntime(
            metadata,
            `Affiliated ${metadata.languageName} runtime for workspace`,
            activate
        );
    }

    private async _startRecommendedLanguageRuntime(): Promise<void> {
        for (const languageId of this._runtimeManager.getSupportedLanguageIds()) {
            const startupBehavior = this._getStartupBehavior(languageId);
            if (startupBehavior === LanguageStartupBehavior.Disabled ||
                startupBehavior === LanguageStartupBehavior.Manual) {
                continue;
            }

            const provider = this._runtimeManager.getRuntimeProvider(languageId);
            if (!provider?.shouldRecommendForWorkspace) {
                continue;
            }

            if (!(await provider.shouldRecommendForWorkspace())) {
                continue;
            }

            const installation = this._sessionManager.getDefaultInstallation(languageId)
                ?? this._runtimeManager.getBestInstallation(languageId);
            if (!installation) {
                continue;
            }

            await this._autoStartInstallation(
                languageId,
                installation,
                'Recommended runtime for workspace',
                true,
                provider.formatRuntimeName(installation)
            );
            return;
        }
    }

    private async _autoStartAfterDiscovery(): Promise<void> {
        if (this._hasStartingOrRunningConsole()) {
            return;
        }

        if (this._runtimeManager.runtimes.length === 0) {
            vscode.window.showWarningMessage('No interpreters found. Configure a runtime path or install a supported runtime.');
            return;
        }

        for (const languageId of this._runtimeManager.getSupportedLanguageIds()) {
            const startupBehavior = this._getStartupBehavior(languageId);
            if (startupBehavior === LanguageStartupBehavior.Disabled ||
                startupBehavior === LanguageStartupBehavior.Manual) {
                continue;
            }

            const runtimes = this._runtimeManager.runtimes
                .filter(metadata => metadata.languageId === languageId) as LanguageRuntimeMetadata[];

            if (runtimes.length === 0) {
                continue;
            }

            const immediateRuntime = runtimes.find(
                runtime => runtime.startupBehavior === LanguageRuntimeStartupBehavior.Immediate
            );

            if (immediateRuntime) {
                try {
                    await this._autoStartRuntime(
                        immediateRuntime,
                        'The runtime metadata requested immediate startup.',
                        true
                    );
                } catch (error) {
                    this._outputChannel.warn(
                        '[RuntimeStartup] Failed to auto-start immediate runtime ' + immediateRuntime.runtimeName + ': ' + error
                    );
                }
                return;
            }

            if (startupBehavior === LanguageStartupBehavior.Always) {
                try {
                    await this._autoStartRuntime(
                        runtimes[0],
                        `The configuration specifies that a runtime should always start for '${languageId}'.`,
                        true
                    );
                } catch (error) {
                    this._outputChannel.warn(
                        '[RuntimeStartup] Failed to auto-start runtime ' + runtimes[0].runtimeName + ' for always behavior: ' + error
                    );
                }
                return;
            }
        }
    }

    private async _autoStartRuntime(
        metadata: LanguageRuntimeMetadata,
        source: string,
        activate: boolean
    ): Promise<void> {
        if (!this._isAutoStartupAllowed(metadata.languageId)) {
            return;
        }

        const provider = this._runtimeManager.getRuntimeProvider(metadata.languageId);
        if (!provider) {
            return;
        }

        const installation = provider?.restoreInstallationFromMetadata?.(metadata);
        if (!installation) {
            this._outputChannel.warn(`[RuntimeStartup] Cannot auto-start ${metadata.runtimeName}: missing installation metadata`);
            return;
        }

        const runtimePath = provider.getRuntimePath(installation);

        // Validate that the runtime binary exists on this machine before attempting to start.
        if (!fs.existsSync(runtimePath)) {
            this._outputChannel.warn(
                `[RuntimeStartup] Affiliated runtime binary does not exist: ${runtimePath}. ` +
                `This may happen when switching between local and remote environments. ` +
                `Clearing stale affiliation and falling through to fresh discovery.`
            );
            this.clearAffiliatedRuntime(metadata.languageId);
            return;
        }

        await this._autoStartInstallation(metadata.languageId, installation, source, activate, metadata.runtimeName);
    }

    private async _autoStartInstallation<TInstallation>(
        languageId: string,
        installation: TInstallation,
        source: string,
        activate: boolean,
        sessionName: string
    ): Promise<void> {
        if (this._hasStartingOrRunningConsole(languageId)) {
            return;
        }

        const provider = this._runtimeManager.getRuntimeProvider<TInstallation>(languageId);
        if (!provider) {
            return;
        }

        const previousActiveSessionId = this._sessionManager.activeSessionId;
        const runtimePath = provider.getRuntimePath(installation);

        this._outputChannel.info(
            `[RuntimeStartup] Automatically starting ${provider.languageName} at ${runtimePath}. Source: ${source}`
        );

        this._fireRuntimeStartupEvent({
            runtimeName: sessionName,
            languageName: provider.languageName,
            base64EncodedIconSvg: this._runtimeManager.runtimes.find(
                runtime => runtime.runtimePath === runtimePath
            )?.base64EncodedIconSvg,
            newSession: true,
        });

        const session = await this._sessionManager.createSessionForLanguageInstallation(
            languageId,
            installation,
            sessionName
        );
        await session.start();

        if (!activate && previousActiveSessionId && previousActiveSessionId !== session.sessionId) {
            await this._sessionManager.setActiveSession(previousActiveSessionId);
        }
    }

    private _createRuntimeStartupEventForSession(
        session: RuntimeSession,
        newSession: boolean
    ): IRuntimeAutoStartEvent {
        return {
            runtimeName:
                session.dynState.sessionName ||
                session.sessionMetadata.sessionName ||
                session.runtimeMetadata.runtimeName,
            languageName: session.runtimeMetadata.languageName,
            base64EncodedIconSvg: session.runtimeMetadata.base64EncodedIconSvg,
            newSession,
        };
    }

    private _fireRuntimeStartupEvent(event: IRuntimeAutoStartEvent): void {
        this._onWillAutoStartRuntime.fire(event);
    }

    dispose(): void {
        this._sessionStateDisposables.forEach(disposable => disposable.dispose());
        this._sessionStateDisposables.clear();
        this._disposables.forEach(disposable => disposable.dispose());
    }
}
