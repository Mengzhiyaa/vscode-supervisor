import * as fs from 'fs';
import * as vscode from 'vscode';
import {
    LanguageRuntimeSessionMode,
    type LanguageRuntimeMetadata,
    LanguageRuntimeStartupBehavior,
    type IRuntimeSessionMetadata,
} from '../api';
import { CoreConfigurationSections } from '../coreCommandIds';
import { RuntimeState } from '../internal/runtimeTypes';
import { RuntimeManager } from './manager';
import { RuntimeSession } from './session';
import { type SerializedSessionMetadata } from './runtimeSessionService';
import { RuntimeSessionService } from './runtimeSession';

const AFFILIATED_RUNTIME_KEY_PREFIX = 'vscode-supervisor.affiliatedRuntimeMetadata.v1';
const PERSISTENT_WORKSPACE_SESSIONS = 'vscode-supervisor.workspaceSessionList.v1';

interface IAffiliatedRuntimeMetadata {
    metadata: LanguageRuntimeMetadata;
    lastUsed: number;
    lastStarted: number;
}

export interface ISessionRestoreFailedEvent {
    sessionId: string;
    error: Error;
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
 * Positron-aligned runtime startup service.
 * Owns persisted session restore/save and runtime auto-start orchestration.
 */
export class RuntimeStartupService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _sessionLifecycleDisposables = new Map<string, vscode.Disposable[]>();
    private readonly _mostRecentlyStartedRuntimesByLanguageId = new Map<string, LanguageRuntimeMetadata>();

    private readonly _onDidChangeRuntimeStartupPhase = new vscode.EventEmitter<RuntimeStartupPhase>();
    readonly onDidChangeRuntimeStartupPhase = this._onDidChangeRuntimeStartupPhase.event;

    private readonly _onWillAutoStartRuntime = new vscode.EventEmitter<IRuntimeAutoStartEvent>();
    readonly onWillAutoStartRuntime = this._onWillAutoStartRuntime.event;

    private readonly _onSessionRestoreFailure = new vscode.EventEmitter<ISessionRestoreFailedEvent>();
    readonly onSessionRestoreFailure = this._onSessionRestoreFailure.event;

    private readonly _localWindowId = `window-${Math.random().toString(16).slice(2, 10)}`;

    private _startupPhase = RuntimeStartupPhase.Initializing;
    private _startupPromise: Promise<void> | undefined;
    private _restoredSessions: SerializedSessionMetadata[] = [];

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _runtimeManager: RuntimeManager,
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _outputChannel: vscode.LogOutputChannel,
    ) {
        this._disposables.push(
            this._onDidChangeRuntimeStartupPhase,
            this._onWillAutoStartRuntime,
            this._onSessionRestoreFailure,
            this._sessionManager.onWillStartSession((event) => {
                this._attachSessionLifecycleListeners(event.session);
            }),
            this._sessionManager.onDidStartRuntime((session) => {
                this._mostRecentlyStartedRuntimesByLanguageId.set(
                    session.runtimeMetadata.languageId,
                    session.runtimeMetadata,
                );
                void this._saveRuntimeAffiliation(session.runtimeMetadata);
                void this.saveWorkspaceSessions();
            }),
            this._sessionManager.onDidFailStartRuntime((session) => {
                void this.saveWorkspaceSessions(session.sessionId);
            }),
            this._sessionManager.onDidChangeForegroundSession((session) => {
                if (!session) {
                    return;
                }

                this._mostRecentlyStartedRuntimesByLanguageId.set(
                    session.runtimeMetadata.languageId,
                    session.runtimeMetadata,
                );
                void this._saveRuntimeAffiliation(session.runtimeMetadata);
                void this.saveWorkspaceSessions();
            }),
            this._sessionManager.onDidDeleteRuntimeSession((sessionId) => {
                this._disposeSessionLifecycleListeners(sessionId);
                void this.saveWorkspaceSessions(sessionId);
            }),
            this._sessionManager.onDidUpdateSessionName(() => {
                void this.saveWorkspaceSessions();
            }),
        );

        for (const session of this._sessionManager.sessions) {
            this._attachSessionLifecycleListeners(session);
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
        return this._getAffiliatedRuntime(languageId)?.metadata;
    }

    getAffiliatedRuntimes(): LanguageRuntimeMetadata[] {
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
            return activeSession.runtimeMetadata;
        }

        const affiliatedRuntimeMetadata = this.getAffiliatedRuntimeMetadata(languageId);
        if (affiliatedRuntimeMetadata) {
            const runtime = this._runtimeManager.getRuntime(affiliatedRuntimeMetadata.runtimeId);
            if (runtime) {
                return runtime;
            }
        }

        const mostRecentlyStartedRuntime = this._mostRecentlyStartedRuntimesByLanguageId.get(languageId);
        if (mostRecentlyStartedRuntime) {
            return mostRecentlyStartedRuntime;
        }

        return this._runtimeManager.runtimes.find((runtime) => runtime.languageId === languageId);
    }

    getRestoredSessions(): SerializedSessionMetadata[] {
        return [...this._restoredSessions];
    }

    async rediscoverAllRuntimes(): Promise<void> {
        this._setStartupPhase(RuntimeStartupPhase.Discovering);
        await this._runtimeManager.startDiscovery();
        await this._autoStartAfterDiscovery();
        this._setStartupPhase(RuntimeStartupPhase.Complete);
    }

    private async _startupSequence(): Promise<void> {
        await this._awaitWorkspaceTrust();

        this._restoredSessions = await this._readStoredSessions();
        if (this._restoredSessions.length > 0) {
            this._setStartupPhase(RuntimeStartupPhase.Reconnecting);
            await this._restoreSessions(this._restoredSessions);
        }

        if (this._sessionManager.sessions.length > 0) {
            this._setStartupPhase(RuntimeStartupPhase.Reconnecting);
            const restoredSession =
                this._sessionManager.activeSession ?? this._sessionManager.sessions[0];
            if (restoredSession) {
                this._fireRuntimeStartupEvent(
                    this._createRuntimeStartupEventForSession(restoredSession, false),
                );
            }
        } else {
            this._setStartupPhase(RuntimeStartupPhase.Starting);
        }

        try {
            if (!this._sessionManager.hasStartingOrRunningConsole()) {
                await this._startAffiliatedLanguageRuntimes();
            }

            if (!this._sessionManager.hasStartingOrRunningConsole()) {
                await this._startRecommendedLanguageRuntime();
            }
        } catch (error) {
            this._outputChannel.error(`[RuntimeStartup] Error while auto-starting runtimes: ${error}`);
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
        return this._context.workspaceState.get<IAffiliatedRuntimeMetadata>(
            this._storageKeyForLanguage(languageId),
        );
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

    private _attachSessionLifecycleListeners(session: RuntimeSession): void {
        const sessionId = session.sessionId;
        if (this._sessionLifecycleDisposables.has(sessionId)) {
            return;
        }

        const disposables: vscode.Disposable[] = [];

        disposables.push(
            session.onDidChangeRuntimeState((newState) => {
                if (newState === RuntimeState.Exiting) {
                    const affiliated = this._getAffiliatedRuntime(session.runtimeMetadata.languageId);
                    if (affiliated?.metadata.runtimeId === session.runtimeMetadata.runtimeId) {
                        void this._context.workspaceState.update(
                            this._storageKeyForLanguage(session.runtimeMetadata.languageId),
                            undefined,
                        );
                    }
                }

                if (newState === RuntimeState.Exited) {
                    void this.saveWorkspaceSessions(session.sessionId);
                } else {
                    void this.saveWorkspaceSessions();
                }
            }),
            session.onDidChangeWorkingDirectory(() => {
                void this.saveWorkspaceSessions();
            }),
        );

        this._sessionLifecycleDisposables.set(sessionId, disposables);
    }

    private _disposeSessionLifecycleListeners(sessionId: string): void {
        const disposables = this._sessionLifecycleDisposables.get(sessionId);
        if (disposables) {
            for (const disposable of disposables) {
                disposable.dispose();
            }
            this._sessionLifecycleDisposables.delete(sessionId);
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

    private async _restoreSessions(sessions: SerializedSessionMetadata[]): Promise<void> {
        if (sessions.length === 0) {
            return;
        }

        this._outputChannel.info(`[RuntimeStartup] Found ${sessions.length} persisted session(s) to restore`);

        for (let index = 0; index < sessions.length; index += 1) {
            const persisted = sessions[index];
            const activate = index === 0;

            try {
                const provider = this._runtimeManager.getRuntimeProvider(persisted.runtimeMetadata.languageId);
                if (!provider) {
                    this._outputChannel.debug(
                        `[RuntimeStartup] Deferring restore for ${persisted.metadata.sessionId}: language support for ` +
                        `${persisted.runtimeMetadata.languageId} is not registered yet`,
                    );
                    continue;
                }

                let runtimeMetadata = persisted.runtimeMetadata;
                if (provider.validateMetadata) {
                    runtimeMetadata = await provider.validateMetadata(runtimeMetadata);
                }

                const isValid = await this._sessionManager.validateRuntimeSession(
                    runtimeMetadata,
                    persisted.metadata.sessionId,
                );
                if (!isValid) {
                    this._outputChannel.debug(
                        `[RuntimeStartup] Session ${persisted.metadata.sessionId} is no longer valid, skipping`,
                    );
                    continue;
                }

                this._fireRuntimeStartupEvent(this._createRuntimeStartupEventFromSerializedSession(persisted, false));

                await this._sessionManager.restoreRuntimeSession(
                    runtimeMetadata,
                    persisted.metadata,
                    persisted.sessionName,
                    persisted.hasConsole ?? true,
                    activate,
                    persisted.workingDirectory,
                );
            } catch (error) {
                const normalizedError = error instanceof Error ? error : new Error(String(error));
                this._outputChannel.error(
                    `[RuntimeStartup] Failed to restore session ${persisted.metadata.sessionId}: ${normalizedError}`,
                );
                this._onSessionRestoreFailure.fire({
                    sessionId: persisted.metadata.sessionId,
                    error: normalizedError,
                });
            }
        }

        await this.saveWorkspaceSessions();
    }

    private async saveWorkspaceSessions(removeSessionId?: string): Promise<boolean> {
        const nextPersistedSessions = new Map<string, SerializedSessionMetadata>();

        for (const persisted of await this._readStoredSessions()) {
            if (removeSessionId && persisted.metadata.sessionId === removeSessionId) {
                continue;
            }

            if (this._sessionManager.getSession(persisted.metadata.sessionId)) {
                continue;
            }

            if (!this._runtimeManager.getRuntimeProvider(persisted.runtimeMetadata.languageId)) {
                nextPersistedSessions.set(persisted.metadata.sessionId, persisted);
            }
        }

        for (const session of this._sessionManager.sessions) {
            if (removeSessionId && session.sessionId === removeSessionId) {
                continue;
            }

            if (!this._isSessionRestorable(session)) {
                continue;
            }

            const activeSession = this._sessionManager.getActiveSession(session.sessionId);
            const metadata: SerializedSessionMetadata = {
                sessionName: session.dynState.sessionName || session.sessionMetadata.sessionName,
                runtimeMetadata: session.runtimeMetadata,
                metadata: {
                    ...session.sessionMetadata,
                    sessionName: session.dynState.sessionName || session.sessionMetadata.sessionName,
                    workingDirectory: session.workingDirectory,
                },
                sessionState: session.state,
                workingDirectory: session.workingDirectory ?? '',
                hasConsole: activeSession?.hasConsole ?? session.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console,
                lastUsed: session.sessionId === this._sessionManager.activeSessionId ? Date.now() : session.created,
                localWindowId: this._localWindowId,
            };

            nextPersistedSessions.set(session.sessionId, metadata);
        }

        const persistedSessions = Array.from(nextPersistedSessions.values())
            .sort((a, b) => b.lastUsed - a.lastUsed);

        await this._context.workspaceState.update(PERSISTENT_WORKSPACE_SESSIONS, persistedSessions);
        return true;
    }

    private _isSessionRestorable(session: RuntimeSession): boolean {
        return session.state !== RuntimeState.Uninitialized &&
            session.state !== RuntimeState.Initializing &&
            session.state !== RuntimeState.Exited &&
            session.state !== RuntimeState.Offline;
    }

    private async _readStoredSessions(): Promise<SerializedSessionMetadata[]> {
        const stored = this._context.workspaceState.get<unknown[]>(PERSISTENT_WORKSPACE_SESSIONS) ?? [];
        const sessions: SerializedSessionMetadata[] = [];

        for (const entry of stored) {
            const session = this._normalizeSerializedSession(entry);
            if (session) {
                sessions.push(session);
            }
        }

        sessions.sort((a, b) => b.lastUsed - a.lastUsed);
        return sessions;
    }

    private _normalizeSerializedSession(entry: unknown): SerializedSessionMetadata | undefined {
        if (!entry || typeof entry !== 'object') {
            return undefined;
        }

        const raw = entry as Record<string, unknown>;
        const metadata = (raw.metadata ?? raw.sessionMetadata) as IRuntimeSessionMetadata | undefined;
        const runtimeMetadata = raw.runtimeMetadata as LanguageRuntimeMetadata | undefined;
        if (!metadata || !runtimeMetadata || typeof metadata.sessionId !== 'string') {
            return undefined;
        }

        return {
            sessionName: typeof raw.sessionName === 'string' ? raw.sessionName : metadata.sessionName,
            runtimeMetadata,
            metadata: {
                ...metadata,
                notebookUri: metadata.notebookUri ? vscode.Uri.from(metadata.notebookUri as vscode.Uri) : undefined,
            },
            sessionState: (raw.sessionState as RuntimeState | undefined) ?? RuntimeState.Exited,
            workingDirectory: typeof raw.workingDirectory === 'string'
                ? raw.workingDirectory
                : metadata.workingDirectory,
            hasConsole: typeof raw.hasConsole === 'boolean' ? raw.hasConsole : true,
            lastUsed: typeof raw.lastUsed === 'number' ? raw.lastUsed : 0,
            localWindowId: typeof raw.localWindowId === 'string' ? raw.localWindowId : undefined,
        };
    }

    private async _startAffiliatedLanguageRuntimes(): Promise<void> {
        let languageIds = this.getAffiliatedRuntimeLanguageIds()
            .filter((languageId) => this._isAutoStartupAllowed(languageId));

        languageIds = languageIds.filter((languageId) => {
            const startupBehavior = this._getStartupBehavior(languageId);
            return startupBehavior === LanguageStartupBehavior.Always || startupBehavior === LanguageStartupBehavior.Auto;
        });

        if (languageIds.length === 0) {
            return;
        }

        const affiliations = languageIds
            .map((languageId) => this._getAffiliatedRuntime(languageId))
            .filter((value): value is IAffiliatedRuntimeMetadata => !!value)
            .filter((affiliation) => {
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
                    `[RuntimeStartup] Failed to start affiliated runtime ${affiliation.metadata.runtimeName}: ${error}`,
                );
                continue;
            }

            if (this._sessionManager.hasStartingOrRunningConsole(affiliation.metadata.languageId)) {
                break;
            }
        }
    }

    private async _startAffiliatedRuntime(
        affiliation: IAffiliatedRuntimeMetadata,
        activate: boolean,
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
            activate,
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
                provider.formatRuntimeName(installation),
            );
            return;
        }
    }

    private async _autoStartAfterDiscovery(): Promise<void> {
        if (this._sessionManager.hasStartingOrRunningConsole()) {
            return;
        }

        if (this._runtimeManager.runtimes.length === 0) {
            void vscode.window.showWarningMessage(
                'No interpreters found. Configure a runtime path or install a supported runtime.',
            );
            return;
        }

        for (const languageId of this._runtimeManager.getSupportedLanguageIds()) {
            const startupBehavior = this._getStartupBehavior(languageId);
            if (startupBehavior === LanguageStartupBehavior.Disabled ||
                startupBehavior === LanguageStartupBehavior.Manual) {
                continue;
            }

            const runtimes = this._runtimeManager.runtimes
                .filter((metadata) => metadata.languageId === languageId);
            if (runtimes.length === 0) {
                continue;
            }

            const immediateRuntime = runtimes.find(
                (runtime) => runtime.startupBehavior === LanguageRuntimeStartupBehavior.Immediate,
            );
            if (immediateRuntime) {
                try {
                    await this._autoStartRuntime(
                        immediateRuntime,
                        'The runtime metadata requested immediate startup.',
                        true,
                    );
                } catch (error) {
                    this._outputChannel.warn(
                        `[RuntimeStartup] Failed to auto-start immediate runtime ${immediateRuntime.runtimeName}: ${error}`,
                    );
                }
                return;
            }

            if (startupBehavior === LanguageStartupBehavior.Always) {
                try {
                    await this._autoStartRuntime(
                        runtimes[0],
                        `The configuration specifies that a runtime should always start for '${languageId}'.`,
                        true,
                    );
                } catch (error) {
                    this._outputChannel.warn(
                        `[RuntimeStartup] Failed to auto-start runtime ${runtimes[0].runtimeName}: ${error}`,
                    );
                }
                return;
            }
        }
    }

    private async _autoStartRuntime(
        metadata: LanguageRuntimeMetadata,
        source: string,
        activate: boolean,
    ): Promise<void> {
        if (!this._isAutoStartupAllowed(metadata.languageId)) {
            return;
        }

        const provider = this._runtimeManager.getRuntimeProvider(metadata.languageId);
        if (!provider) {
            return;
        }

        const installation = provider.restoreInstallationFromMetadata?.(metadata);
        if (!installation) {
            this._outputChannel.warn(`[RuntimeStartup] Cannot auto-start ${metadata.runtimeName}: missing installation metadata`);
            return;
        }

        const runtimePath = provider.getRuntimePath(installation);
        if (!fs.existsSync(runtimePath)) {
            this._outputChannel.warn(
                `[RuntimeStartup] Affiliated runtime binary does not exist: ${runtimePath}. Clearing stale affiliation.`,
            );
            this.clearAffiliatedRuntime(metadata.languageId);
            return;
        }

        await this._autoStartInstallation(
            metadata.languageId,
            installation,
            source,
            activate,
            metadata.runtimeName,
        );
    }

    private async _autoStartInstallation<TInstallation>(
        languageId: string,
        installation: TInstallation,
        source: string,
        activate: boolean,
        sessionName: string,
    ): Promise<void> {
        if (this._sessionManager.hasStartingOrRunningConsole(languageId)) {
            return;
        }

        const provider = this._runtimeManager.getRuntimeProvider<TInstallation>(languageId);
        if (!provider) {
            return;
        }

        const previousActiveSessionId = this._sessionManager.activeSessionId;
        const runtimePath = provider.getRuntimePath(installation);

        this._outputChannel.info(
            `[RuntimeStartup] Automatically starting ${provider.languageName} at ${runtimePath}. Source: ${source}`,
        );

        this._fireRuntimeStartupEvent({
            runtimeName: sessionName,
            languageName: provider.languageName,
            base64EncodedIconSvg: this._runtimeManager.runtimes.find(
                (runtime) => runtime.runtimePath === runtimePath,
            )?.base64EncodedIconSvg,
            newSession: true,
        });

        const session = await this._sessionManager.createSessionForLanguageInstallation(
            languageId,
            installation,
            sessionName,
        );
        await this._sessionManager.startSession(session.sessionId, {
            activate,
            hasConsole: true,
        });

        if (!activate && previousActiveSessionId && previousActiveSessionId !== session.sessionId) {
            await this._sessionManager.setActiveSession(previousActiveSessionId);
        }
    }

    private _createRuntimeStartupEventForSession(
        session: RuntimeSession,
        newSession: boolean,
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

    private _createRuntimeStartupEventFromSerializedSession(
        session: SerializedSessionMetadata,
        newSession: boolean,
    ): IRuntimeAutoStartEvent {
        return {
            runtimeName: session.sessionName || session.metadata.sessionName || session.runtimeMetadata.runtimeName,
            languageName: session.runtimeMetadata.languageName,
            base64EncodedIconSvg: session.runtimeMetadata.base64EncodedIconSvg,
            newSession,
        };
    }

    private _fireRuntimeStartupEvent(event: IRuntimeAutoStartEvent): void {
        this._onWillAutoStartRuntime.fire(event);
    }

    dispose(): void {
        for (const disposables of this._sessionLifecycleDisposables.values()) {
            for (const disposable of disposables) {
                disposable.dispose();
            }
        }
        this._sessionLifecycleDisposables.clear();

        for (const disposable of this._disposables) {
            disposable.dispose();
        }
    }
}
