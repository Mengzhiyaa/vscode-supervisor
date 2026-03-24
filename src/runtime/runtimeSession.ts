import * as vscode from 'vscode';
import {
    type ILanguageInstallationPickerOptions,
    type INotebookSessionUriChangedEvent,
    type ILanguageRuntimeProvider,
    type JupyterKernelSpec,
    type LanguageRuntimeDynState,
    type LanguageRuntimeMetadata,
    LanguageRuntimeSessionLocation,
    LanguageRuntimeSessionMode,
    LanguageRuntimeStartupBehavior,
    type LanguageSessionMode,
    type IRuntimeSessionMetadata,
} from '../api';
import {
    RuntimeStartMode,
    RuntimeExitReason,
    RuntimeState,
} from '../internal/runtimeTypes';
import { ActiveRuntimeSession } from './activeRuntimeSession';
import { UiClientInstance } from './UiClientInstance';
import {
    OpenEditorKind,
    type OpenEditorEvent,
    type OpenWithSystemEvent,
    type OpenWorkspaceEvent,
    type PromptStateEvent,
    type SetEditorSelectionsEvent,
    type ShowMessageEvent,
    type WorkingDirectoryEvent,
    type BusyEvent,
    UiFrontendEvent,
} from './comms/positronUiComm';
import { LocalSupervisorApi } from './localSupervisor';
import type { ILanguageRuntimeGlobalEvent } from './runtimeEvents';
import { RuntimeSession, type RuntimeSessionProvisioningOptions } from './session';
import { createJupyterKernelExtra } from './startup';
import type {
    ILanguageRuntimeSessionStateEvent,
    IRuntimeSessionService,
    IRuntimeSessionWillStartEvent,
    IRuntimeUiClientStartedEvent,
} from './runtimeSessionService';

interface SessionStartOptions {
    startMode: RuntimeStartMode;
    activate: boolean;
    hasConsole: boolean;
}

interface RuntimeSessionCreationOptions {
    sessionMode: LanguageRuntimeSessionMode;
    notebookUri?: vscode.Uri;
    sessionName?: string;
    startReason: string;
    workingDirectory?: string;
}

function getNotebookSessionMapKey(notebookUri: vscode.Uri): string {
    return notebookUri.toString();
}

function getSessionStartKey(
    sessionMode: LanguageRuntimeSessionMode,
    runtimeId: string,
    notebookUri?: vscode.Uri,
): string {
    return `${sessionMode}:${runtimeId}:${notebookUri ? notebookUri.toString() : ''}`;
}

/**
 * Positron-aligned runtime session service.
 * Owns session lifecycle, foreground session switching, and UI client wiring.
 */
export class RuntimeSessionService implements vscode.Disposable, IRuntimeSessionService {
    private readonly _sessions = new Map<string, RuntimeSession>();
    private readonly _activeSessionsBySessionId = new Map<string, ActiveRuntimeSession>();
    private readonly _sessionLifecycleDisposables = new Map<string, vscode.Disposable[]>();
    private readonly _runtimeProviders = new Map<string, ILanguageRuntimeProvider<any>>();
    private readonly _defaultInstallationsByLanguageId = new Map<string, unknown>();
    private readonly _availableRuntimeMetadataByRuntimeId = new Map<string, LanguageRuntimeMetadata>();
    private readonly _installationsByRuntimeId = new Map<string, unknown>();
    private readonly _lastActiveConsoleSessionByLanguageId = new Map<string, RuntimeSession>();
    private readonly _notebookSessionsByNotebookUri = new Map<string, RuntimeSession>();
    private readonly _startingSessionsBySessionKey = new Map<string, Promise<string>>();
    private readonly _shuttingDownNotebookSessionsByNotebookUri = new Map<string, Promise<void>>();
    private readonly _restoredSessionIds = new Set<string>();
    private readonly _restartingSessionPromises = new Map<string, Promise<void>>();
    private readonly _disposables: vscode.Disposable[] = [];

    private _localSupervisor: LocalSupervisorApi | undefined;
    private _foregroundSessionId: string | undefined;
    private _activeSessionSwitchChain: Promise<void> = Promise.resolve();
    private _initialized = false;
    private _shutdownPromise: Promise<void> | undefined;

    private readonly _onDidChangeForegroundSession = new vscode.EventEmitter<RuntimeSession | undefined>();
    readonly onDidChangeForegroundSession = this._onDidChangeForegroundSession.event;

    private readonly _onDidCreateSession = new vscode.EventEmitter<RuntimeSession>();
    readonly onDidCreateSession = this._onDidCreateSession.event;

    private readonly _onDidDeleteSession = new vscode.EventEmitter<string>();
    readonly onDidDeleteSession = this._onDidDeleteSession.event;
    readonly onDidDeleteRuntimeSession = this._onDidDeleteSession.event;

    private readonly _onDidChangeActiveSession = new vscode.EventEmitter<RuntimeSession | undefined>();
    readonly onDidChangeActiveSession = this._onDidChangeActiveSession.event;

    private readonly _onDidUpdateSessionName = new vscode.EventEmitter<RuntimeSession>();
    readonly onDidUpdateSessionName = this._onDidUpdateSessionName.event;

    private readonly _onDidUpdateNotebookSessionUri =
        new vscode.EventEmitter<INotebookSessionUriChangedEvent>();
    readonly onDidUpdateNotebookSessionUri = this._onDidUpdateNotebookSessionUri.event;

    private readonly _onWillStartSession = new vscode.EventEmitter<IRuntimeSessionWillStartEvent>();
    readonly onWillStartSession = this._onWillStartSession.event;

    private readonly _onDidStartRuntime = new vscode.EventEmitter<RuntimeSession>();
    readonly onDidStartRuntime = this._onDidStartRuntime.event;

    private readonly _onDidFailStartRuntime = new vscode.EventEmitter<RuntimeSession>();
    readonly onDidFailStartRuntime = this._onDidFailStartRuntime.event;

    private readonly _onDidReceiveRuntimeEvent = new vscode.EventEmitter<ILanguageRuntimeGlobalEvent>();
    readonly onDidReceiveRuntimeEvent = this._onDidReceiveRuntimeEvent.event;

    private readonly _onDidChangeRuntimeState = new vscode.EventEmitter<ILanguageRuntimeSessionStateEvent>();
    readonly onDidChangeRuntimeState = this._onDidChangeRuntimeState.event;

    private readonly _onDidStartUiClient = new vscode.EventEmitter<IRuntimeUiClientStartedEvent>();
    readonly onDidStartUiClient = this._onDidStartUiClient.event;

    private readonly _onDidChangeSessionState = new vscode.EventEmitter<{ sessionId: string; state: RuntimeState }>();
    readonly onDidChangeSessionState = this._onDidChangeSessionState.event;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _outputChannel: vscode.LogOutputChannel,
    ) {
        this._disposables.push(
            this._onDidChangeForegroundSession,
            this._onDidCreateSession,
            this._onDidDeleteSession,
            this._onDidChangeActiveSession,
            this._onDidUpdateSessionName,
            this._onDidUpdateNotebookSessionUri,
            this._onWillStartSession,
            this._onDidStartRuntime,
            this._onDidFailStartRuntime,
            this._onDidReceiveRuntimeEvent,
            this._onDidChangeRuntimeState,
            this._onDidStartUiClient,
            this._onDidChangeSessionState,
        );
    }

    registerRuntimeProvider<TInstallation>(provider: ILanguageRuntimeProvider<TInstallation>): void {
        this._runtimeProviders.set(provider.languageId, provider as ILanguageRuntimeProvider<any>);
    }

    getRuntimeProvider<TInstallation = unknown>(languageId: string): ILanguageRuntimeProvider<TInstallation> | undefined {
        return this._runtimeProviders.get(languageId) as ILanguageRuntimeProvider<TInstallation> | undefined;
    }

    getDefaultInstallation<TInstallation = unknown>(languageId: string): TInstallation | undefined {
        return this._defaultInstallationsByLanguageId.get(languageId) as TInstallation | undefined;
    }

    setDefaultInstallation<TInstallation>(languageId: string, installation: TInstallation): void {
        this._defaultInstallationsByLanguageId.set(languageId, installation);
    }

    registerDiscoveredRuntime<TInstallation>(
        languageId: string,
        installation: TInstallation,
        metadata: LanguageRuntimeMetadata,
    ): void {
        this._availableRuntimeMetadataByRuntimeId.set(metadata.runtimeId, metadata);
        this._installationsByRuntimeId.set(metadata.runtimeId, installation);

        if (!this._defaultInstallationsByLanguageId.has(languageId)) {
            this._defaultInstallationsByLanguageId.set(languageId, installation);
        }
    }

    async initialize(): Promise<void> {
        if (this._initialized) {
            return;
        }

        this._outputChannel.debug('[RuntimeSession] Initializing...');

        try {
            for (const provider of this._runtimeProviders.values()) {
                this._outputChannel.debug(`[RuntimeSession] Discovering initial ${provider.languageName} installations...`);
                const installation = await provider.resolveInitialInstallation(this._outputChannel);
                if (installation) {
                    this.setDefaultInstallation(provider.languageId, installation);
                    this._outputChannel.info(
                        `[RuntimeSession] Using ${provider.languageName} at ${provider.getRuntimePath(installation)}`,
                    );
                }
            }

            if (this._defaultInstallationsByLanguageId.size === 0) {
                this._outputChannel.warn('[RuntimeSession] No language installations found during initialization');
            }

            this._localSupervisor = new LocalSupervisorApi(this._context, this._outputChannel);
            await this._localSupervisor.initialize();

            this._initialized = true;
            this._outputChannel.debug('[RuntimeSession] Initialized');
        } catch (error) {
            this._outputChannel.error(`[RuntimeSession] Error initializing: ${error}`);
            throw error;
        }
    }

    get isInitialized(): boolean {
        return this._initialized;
    }

    get isRestoringPersistedSessions(): boolean {
        return false;
    }

    restorePersistedSessionsInBackground(): Promise<void> {
        return Promise.resolve();
    }

    waitForPersistedSessionRestore(): Promise<void> {
        return Promise.resolve();
    }

    get activeSession(): RuntimeSession | undefined {
        return this.foregroundSession;
    }

    get foregroundSession(): RuntimeSession | undefined {
        return this._foregroundSessionId ? this._sessions.get(this._foregroundSessionId) : undefined;
    }

    set foregroundSession(session: RuntimeSession | undefined) {
        void this._setForegroundSession(session?.sessionId);
    }

    get activeSessions(): RuntimeSession[] {
        return this.sessions;
    }

    get sessions(): RuntimeSession[] {
        return Array.from(this._sessions.values());
    }

    get activeSessionId(): string | undefined {
        return this._foregroundSessionId;
    }

    getActiveSession(sessionId: string): ActiveRuntimeSession | undefined {
        return this._activeSessionsBySessionId.get(sessionId);
    }

    getActiveSessions(): ActiveRuntimeSession[] {
        return Array.from(this._activeSessionsBySessionId.values());
    }

    getConsoleSessionForRuntime(runtimeId: string): RuntimeSession | undefined {
        return this.sessions
            .filter((session) =>
                session.runtimeMetadata.runtimeId === runtimeId &&
                session.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console &&
                session.state !== RuntimeState.Exited,
            )
            .sort((left, right) => right.created - left.created)[0];
    }

    getConsoleSessionForLanguage(languageId: string): RuntimeSession | undefined {
        const foregroundSession = this.foregroundSession;
        if (
            foregroundSession?.runtimeMetadata.languageId === languageId &&
            foregroundSession.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console
        ) {
            return foregroundSession;
        }

        return this._lastActiveConsoleSessionByLanguageId.get(languageId);
    }

    getNotebookSessionForNotebookUri(notebookUri: vscode.Uri): RuntimeSession | undefined {
        return this._notebookSessionsByNotebookUri.get(getNotebookSessionMapKey(notebookUri));
    }

    wasSessionRestored(sessionId: string): boolean {
        return this._restoredSessionIds.has(sessionId);
    }

    async createSession(sessionName?: string): Promise<RuntimeSession> {
        const provider = this._getDefaultRuntimeProvider();
        return this.createSessionForLanguage(provider.languageId, sessionName);
    }

    async createSessionForLanguage<TInstallation>(
        languageId: string,
        sessionName?: string,
    ): Promise<RuntimeSession> {
        this._requireLocalSupervisor();

        const provider = this._requireRuntimeProvider<TInstallation>(languageId);
        const installation = await this._resolveInstallationForNewSession(provider);
        return this._createSessionWithProvider(provider, installation, {
            sessionMode: LanguageRuntimeSessionMode.Console,
            sessionName,
            startReason: 'createSessionForLanguage',
        });
    }

    async createSessionForLanguageInstallation<TInstallation>(
        languageId: string,
        installation: TInstallation,
        sessionName?: string,
    ): Promise<RuntimeSession> {
        this._requireLocalSupervisor();

        const provider = this._requireRuntimeProvider<TInstallation>(languageId);
        this.setDefaultInstallation(languageId, installation);
        return this._createSessionWithProvider(provider, installation, {
            sessionMode: LanguageRuntimeSessionMode.Console,
            sessionName,
            startReason: 'createSessionForLanguageInstallation',
        });
    }

    async startSession(
        sessionId: string,
        options: Partial<SessionStartOptions> = {},
    ): Promise<RuntimeSession> {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        switch (session.state) {
            case RuntimeState.Uninitialized:
                await this.doStartRuntimeSession(
                    session,
                    options.startMode ?? RuntimeStartMode.Starting,
                    options.hasConsole ?? true,
                    options.activate ?? true,
                );
                return session;

            case RuntimeState.Initializing:
            case RuntimeState.Starting:
            case RuntimeState.Restarting:
                await this._waitForSessionReady(session, 10000);
                return session;

            case RuntimeState.Ready:
            case RuntimeState.Idle:
            case RuntimeState.Busy:
            case RuntimeState.Interrupting:
                if (
                    (options.activate ?? true) &&
                    session.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console
                ) {
                    await this._setForegroundSession(session.sessionId);
                }
                return session;

            case RuntimeState.Exited:
                await this.doStartRuntimeSession(
                    session,
                    options.startMode ?? RuntimeStartMode.Restarting,
                    options.hasConsole ?? this._activeSessionsBySessionId.get(session.sessionId)?.hasConsole ?? true,
                    options.activate ?? true,
                );
                return session;

            default:
                throw new Error(
                    `The ${session.runtimeMetadata.languageName} session is '${session.state}' and cannot be started.`,
                );
        }
    }

    async ensureSessionForLanguage(
        languageId: string,
        sessionName?: string,
    ): Promise<RuntimeSession> {
        const activeSession = this.activeSession;
        if (
            activeSession?.runtimeMetadata.languageId === languageId &&
            activeSession.state !== RuntimeState.Exiting &&
            activeSession.state !== RuntimeState.Offline
        ) {
            await this._ensureSessionReadyForInteraction(activeSession);
            return activeSession;
        }

        const existingSession = this.sessions.find((session) =>
            session.runtimeMetadata.languageId === languageId &&
            session.state !== RuntimeState.Exiting &&
            session.state !== RuntimeState.Offline,
        );

        if (existingSession) {
            await this._ensureSessionReadyForInteraction(existingSession);
            await this._setForegroundSession(existingSession.sessionId);
            return existingSession;
        }

        const session = await this.createSessionForLanguage(languageId, sessionName);
        await this.startSession(session.sessionId);
        return session;
    }

    async createSessionFromPicker(sessionName?: string): Promise<RuntimeSession | undefined> {
        this._requireLocalSupervisor();

        const provider = this._getDefaultRuntimeProvider();
        const defaultInstallation = this.getDefaultInstallation(provider.languageId);
        const activeSession = this.activeSession;
        const preselectRuntimePath = activeSession?.runtimeMetadata.languageId === provider.languageId
            ? activeSession.runtimeMetadata.runtimePath
            : defaultInstallation
                ? provider.getRuntimePath(defaultInstallation)
                : undefined;

        const installation = await this.selectInstallation(provider.languageId, {
            forcePick: true,
            allowBrowse: true,
            persistSelection: false,
            preselectRuntimePath,
            title: `Start New ${provider.languageName} Session`,
            placeHolder: `Select ${provider.languageName} installation to start`,
        });

        if (!installation) {
            return undefined;
        }

        return this.createSessionForLanguageInstallation(
            provider.languageId,
            installation,
            sessionName,
        );
    }

    async startNewRuntimeSession(
        runtimeId: string,
        sessionName: string,
        sessionMode: LanguageRuntimeSessionMode,
        notebookUri: vscode.Uri | undefined,
        source: string,
        startMode: RuntimeStartMode = RuntimeStartMode.Starting,
        activate: boolean,
    ): Promise<string> {
        const sessionKey = getSessionStartKey(sessionMode, runtimeId, notebookUri);
        const existingStart = this._startingSessionsBySessionKey.get(sessionKey);
        if (existingStart) {
            return existingStart;
        }

        const startPromise = (async () => {
            const runtimeEntry = this._requireRuntimeEntry(runtimeId);
            const existingSession = sessionMode === LanguageRuntimeSessionMode.Console
                ? this.getConsoleSessionForRuntime(runtimeId)
                : notebookUri
                    ? this.getNotebookSessionForNotebookUri(notebookUri)
                    : undefined;

            if (existingSession) {
                if (
                    sessionMode === LanguageRuntimeSessionMode.Console &&
                    activate
                ) {
                    await this._setForegroundSession(existingSession.sessionId);
                }
                return existingSession.sessionId;
            }

            const session = await this._createSessionWithProvider(
                runtimeEntry.provider,
                runtimeEntry.installation,
                {
                    sessionMode,
                    notebookUri,
                    sessionName,
                    startReason: source,
                },
            );

            await this.startSession(session.sessionId, {
                startMode,
                activate: sessionMode === LanguageRuntimeSessionMode.Console ? activate : false,
                hasConsole: sessionMode !== LanguageRuntimeSessionMode.Background,
            });

            return session.sessionId;
        })().finally(() => {
            if (this._startingSessionsBySessionKey.get(sessionKey) === startPromise) {
                this._startingSessionsBySessionKey.delete(sessionKey);
            }
        });

        this._startingSessionsBySessionKey.set(sessionKey, startPromise);
        return startPromise;
    }

    async autoStartRuntime(
        metadata: LanguageRuntimeMetadata,
        source: string,
        activate: boolean,
    ): Promise<string> {
        this._availableRuntimeMetadataByRuntimeId.set(metadata.runtimeId, metadata);

        if (!this._resolveRuntimeEntry(metadata.runtimeId) && !this._resolveRuntimeEntryFromMetadata(metadata)) {
            this._outputChannel.warn(
                `[RuntimeSession] Cannot auto-start ${metadata.runtimeName}: installation metadata is unavailable`,
            );
            return '';
        }

        return this.startNewRuntimeSession(
            metadata.runtimeId,
            metadata.runtimeName,
            LanguageRuntimeSessionMode.Console,
            undefined,
            source,
            RuntimeStartMode.Starting,
            activate,
        );
    }

    async selectRuntime(runtimeId: string, source: string, notebookUri?: vscode.Uri): Promise<void> {
        const runtimeEntry = this._requireRuntimeEntry(runtimeId);
        const sessionMode = notebookUri
            ? LanguageRuntimeSessionMode.Notebook
            : LanguageRuntimeSessionMode.Console;

        if (notebookUri) {
            const activeNotebookSession = this.getNotebookSessionForNotebookUri(notebookUri);
            if (activeNotebookSession?.runtimeMetadata.runtimeId === runtimeId) {
                return;
            }

            if (activeNotebookSession) {
                await this.shutdownNotebookSession(
                    notebookUri,
                    RuntimeExitReason.SwitchRuntime,
                    source,
                );
            }
        } else {
            const existingConsoleSession = this.getConsoleSessionForRuntime(runtimeId);
            if (existingConsoleSession) {
                this.focusSession(existingConsoleSession.sessionId);
                return;
            }
        }

        await this.startNewRuntimeSession(
            runtimeId,
            runtimeEntry.metadata.runtimeName,
            sessionMode,
            notebookUri,
            source,
            notebookUri ? RuntimeStartMode.Switching : RuntimeStartMode.Starting,
            !notebookUri,
        );
    }

    focusSession(sessionId: string): void {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        if (session.sessionMetadata.sessionMode !== LanguageRuntimeSessionMode.Console) {
            throw new Error('Cannot focus a notebook or background session');
        }

        this.foregroundSession = session;
    }

    async selectInstallation<TInstallation>(
        languageId: string,
        options?: ILanguageInstallationPickerOptions,
    ): Promise<TInstallation | undefined> {
        const provider = this._requireRuntimeProvider<TInstallation>(languageId);
        const installation = await provider.promptForInstallation(this._outputChannel, options);
        if (installation) {
            this.setDefaultInstallation(languageId, installation);
        }
        return installation;
    }

    async validateRuntimeSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionId: string,
    ): Promise<boolean> {
        const provider = this.getRuntimeProvider(runtimeMetadata.languageId);
        if (!provider) {
            return false;
        }

        if (provider.validateMetadata) {
            runtimeMetadata = this._applyRuntimeMetadataDefaults(
                await provider.validateMetadata(runtimeMetadata),
            );
        }

        if (provider.validateSession) {
            return provider.validateSession(sessionId);
        }

        return this._requireLocalSupervisor().validateSession(sessionId);
    }

    async restoreRuntimeSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        metadata: IRuntimeSessionMetadata,
        sessionName: string,
        hasConsole: boolean,
        activate: boolean,
        workingDirectory?: string,
    ): Promise<RuntimeSession> {
        const existingSession = this._sessions.get(metadata.sessionId);
        if (existingSession) {
            await this.startSession(existingSession.sessionId, {
                startMode: RuntimeStartMode.Reconnecting,
                hasConsole,
                activate,
            });
            return existingSession;
        }

        const provider = this.getRuntimeProvider(runtimeMetadata.languageId);
        if (!provider) {
            throw new Error(`No runtime provider registered for language ${runtimeMetadata.languageId}`);
        }

        const restoredRuntimeMetadata = this._applyRuntimeMetadataDefaults(runtimeMetadata);
        const dynState: LanguageRuntimeDynState = {
            sessionName,
            inputPrompt: '>',
            continuationPrompt: '+',
            busy: false,
            currentWorkingDirectory: workingDirectory,
            currentNotebookUri: metadata.notebookUri,
        };

        const session = this._createRuntimeSession(
            restoredRuntimeMetadata,
            {
                ...metadata,
                sessionName,
                workingDirectory,
                createdTimestamp: metadata.createdTimestamp ?? Date.now(),
                startReason: metadata.startReason ?? 'restoreRuntimeSession',
            },
            provider.lspFactory,
            {
                localSupervisor: this._requireLocalSupervisor(),
                dynState,
            },
        );

        this._restoredSessionIds.add(session.sessionId);
        await this.doStartRuntimeSession(
            session,
            RuntimeStartMode.Reconnecting,
            hasConsole,
            activate,
        );

        return session;
    }

    hasStartingOrRunningConsole(languageId?: string): boolean {
        return Array.from(this._activeSessionsBySessionId.values()).some((activeSession) => {
            if (!activeSession.hasConsole) {
                return false;
            }

            if (languageId && activeSession.session.runtimeMetadata.languageId !== languageId) {
                return false;
            }

            const state = activeSession.state;
            return state !== RuntimeState.Uninitialized &&
                state !== RuntimeState.Exited &&
                state !== RuntimeState.Offline;
        });
    }

    getSession(sessionId: string): RuntimeSession | undefined {
        return this._sessions.get(sessionId);
    }

    async setActiveSession(sessionId: string): Promise<void> {
        if (this._sessions.has(sessionId)) {
            await this._setForegroundSession(sessionId);
        }
    }

    async switchSession(sessionId: string): Promise<void> {
        if (!this._sessions.has(sessionId)) {
            throw new Error(`Session ${sessionId} not found`);
        }
        await this._setForegroundSession(sessionId);
    }

    renameSession(sessionId: string, newName: string): void {
        this.updateSessionName(sessionId, newName);
    }

    updateSessionName(sessionId: string, newName: string): void {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const validatedName = newName.trim();
        if (validatedName.length === 0) {
            throw new Error('Session name cannot be empty');
        }

        session.updateSessionName(validatedName);
        this._onDidUpdateSessionName.fire(session);
    }

    async closeSession(sessionId: string): Promise<void> {
        await this.stopSession(sessionId);
    }

    async stopSession(sessionId: string): Promise<void> {
        await this.deleteSession(sessionId);
    }

    async interruptSession(sessionId: string): Promise<void> {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        await session.interrupt();
    }

    async deleteSession(sessionId: string): Promise<boolean> {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        this._outputChannel.debug(`[RuntimeSession] Deleting session ${sessionId}...`);

        if (session.state === RuntimeState.Busy) {
            const interrupted = await this._promptToInterruptSession(session, 'delete');
            if (!interrupted) {
                return false;
            }
        }

        if (session.state !== RuntimeState.Uninitialized && session.state !== RuntimeState.Exited) {
            try {
                await session.shutdown();
            } catch (error) {
                this._outputChannel.warn(`[RuntimeSession] Shutdown failed for ${sessionId}: ${error}`);
            }
        }

        await this._removeSession(session);
        this._outputChannel.debug(`[RuntimeSession] Session ${sessionId} deleted`);
        return true;
    }

    async restartSession(sessionId: string, _source: string, interrupt?: boolean): Promise<void> {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const existingRestart = this._restartingSessionPromises.get(sessionId);
        if (existingRestart) {
            return existingRestart;
        }

        const restartPromise = this._restartSession(session, interrupt).finally(() => {
            if (this._restartingSessionPromises.get(sessionId) === restartPromise) {
                this._restartingSessionPromises.delete(sessionId);
            }
        });

        this._restartingSessionPromises.set(sessionId, restartPromise);
        return restartPromise;
    }

    async shutdownNotebookSession(
        notebookUri: vscode.Uri,
        exitReason: RuntimeExitReason,
        _source: string,
    ): Promise<void> {
        const notebookKey = getNotebookSessionMapKey(notebookUri);
        const existingShutdown = this._shuttingDownNotebookSessionsByNotebookUri.get(notebookKey);
        if (existingShutdown) {
            return existingShutdown;
        }

        const shutdownPromise = (async () => {
            const session = this.getNotebookSessionForNotebookUri(notebookUri);
            if (!session) {
                return;
            }

            if (session.state !== RuntimeState.Uninitialized && session.state !== RuntimeState.Exited) {
                await session.shutdown(exitReason);
            }

            await this._removeSession(session);
        })().finally(() => {
            if (this._shuttingDownNotebookSessionsByNotebookUri.get(notebookKey) === shutdownPromise) {
                this._shuttingDownNotebookSessionsByNotebookUri.delete(notebookKey);
            }
        });

        this._shuttingDownNotebookSessionsByNotebookUri.set(notebookKey, shutdownPromise);
        return shutdownPromise;
    }

    async updateNotebookSessionUri(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<string | undefined> {
        const oldKey = getNotebookSessionMapKey(oldUri);
        const newKey = getNotebookSessionMapKey(newUri);
        const session = this._notebookSessionsByNotebookUri.get(oldKey);
        if (!session || session.state === RuntimeState.Exited) {
            return undefined;
        }

        this._notebookSessionsByNotebookUri.set(newKey, session);
        session.sessionMetadata.notebookUri = newUri;
        session.dynState.currentNotebookUri = newUri;
        this._notebookSessionsByNotebookUri.delete(oldKey);

        this._onDidUpdateNotebookSessionUri.fire({
            sessionId: session.sessionId,
            oldUri,
            newUri,
        });
        return session.sessionId;
    }

    getKallichorePath(): string | undefined {
        return this._localSupervisor?.getKallichorePath();
    }

    showSupervisorLog(): void {
        this._localSupervisor?.showLog();
    }

    getSessions(): Array<{
        id: string;
        name: string;
        runtimeName: string;
        state: string;
        runtimePath?: string;
        runtimeVersion?: string;
        runtimeSource?: string;
        base64EncodedIconSvg?: string;
    }> {
        return Array.from(this._sessions.entries()).map(([id, session]) => {
            const runtimeMetadata = this._applyRuntimeMetadataDefaults(session.runtimeMetadata);
            return {
                id,
                name: session.dynState.sessionName || session.sessionMetadata.sessionName || runtimeMetadata.runtimeName,
                runtimeName: runtimeMetadata.runtimeName,
                state: this._mapStateToString(session.state),
                runtimePath: runtimeMetadata.runtimePath,
                runtimeVersion: runtimeMetadata.languageVersion,
                runtimeSource: runtimeMetadata.runtimeSource,
                base64EncodedIconSvg: runtimeMetadata.base64EncodedIconSvg,
            };
        });
    }

    emitTestRuntimeEvent(sessionId: string, name: UiFrontendEvent, data: unknown): void {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const normalizedData = this._normalizeRuntimeEvent(session, name, data);
        this._dispatchRuntimeFrontendEvent(name, normalizedData);
        this._onDidReceiveRuntimeEvent.fire({
            session_id: sessionId,
            event: {
                name,
                data: normalizedData,
            },
        });
    }

    watchUiClient(
        sessionId: string,
        handler: (uiClient: UiClientInstance) => vscode.Disposable | void,
    ): vscode.Disposable {
        const store: vscode.Disposable[] = [];
        let handlerDisposable: vscode.Disposable | undefined;

        const runHandler = (uiClient: UiClientInstance) => {
            handlerDisposable?.dispose();
            handlerDisposable = handler(uiClient) ?? undefined;
        };

        const currentUiClient = this._activeSessionsBySessionId.get(sessionId)?.uiClient;
        if (currentUiClient) {
            runHandler(currentUiClient);
        }

        store.push(this.onDidStartUiClient((event) => {
            if (event.sessionId === sessionId) {
                runHandler(event.uiClient);
            }
        }));

        return new vscode.Disposable(() => {
            handlerDisposable?.dispose();
            for (const disposable of store) {
                disposable.dispose();
            }
        });
    }

    async shutdown(): Promise<void> {
        if (this._shutdownPromise) {
            return this._shutdownPromise;
        }

        this._shutdownPromise = (async () => {
            const sessions = Array.from(this._sessions.values());
            for (const session of sessions) {
                try {
                    await session.shutdown();
                } catch (error) {
                    this._outputChannel.warn(`[RuntimeSession] Error shutting down session ${session.sessionId}: ${error}`);
                }

                try {
                    await this._removeSession(session);
                } catch (error) {
                    this._outputChannel.warn(`[RuntimeSession] Error disposing session ${session.sessionId}: ${error}`);
                }
            }

            this._localSupervisor?.dispose();
            this._localSupervisor = undefined;
        })();

        return this._shutdownPromise;
    }

    dispose(): void {
        void this.shutdown().finally(() => {
            for (const disposable of this._disposables) {
                disposable.dispose();
            }
        });
    }

    protected async doStartRuntimeSession(
        session: RuntimeSession,
        startMode: RuntimeStartMode,
        hasConsole: boolean,
        activate: boolean,
    ): Promise<void> {
        this.prepareSessionStart(session, startMode, activate, hasConsole);
        const readyPromise = this._waitForSessionReady(session, 10000);

        try {
            await session.start();
            await readyPromise;
            this._onDidStartRuntime.fire(session);

            if (activate && session.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console) {
                await this._setForegroundSession(session.sessionId);
            }
        } catch (error) {
            this._onDidFailStartRuntime.fire(session);
            throw error;
        }
    }

    protected prepareSessionStart(
        session: RuntimeSession,
        startMode: RuntimeStartMode,
        activate: boolean,
        hasConsole: boolean,
    ): void {
        this.attachToSession(session, hasConsole, activate);
        this._onWillStartSession.fire({
            session,
            startMode,
            activate,
            hasConsole,
        });
    }

    protected attachToSession(
        session: RuntimeSession,
        hasConsole: boolean,
        activate: boolean,
    ): ActiveRuntimeSession {
        this._disposeSessionLifecycleDisposables(session.sessionId);

        const activeSession = new ActiveRuntimeSession(session, hasConsole);
        const disposables: vscode.Disposable[] = [activeSession];

        disposables.push(
            activeSession.onDidReceiveRuntimeEvent((event) => {
                this._dispatchRuntimeFrontendEvent(event.event.name, event.event.data);
                this._onDidReceiveRuntimeEvent.fire(event);
            }),
            activeSession.onUiClientStarted((uiClient) => {
                this._onDidStartUiClient.fire({ sessionId: session.sessionId, uiClient });
            }),
            session.onDidChangeRuntimeState((state) => {
                this._didChangeRuntimeState(session, activeSession, state, activate);
            }),
        );

        this._activeSessionsBySessionId.set(session.sessionId, activeSession);
        this._sessionLifecycleDisposables.set(session.sessionId, disposables);
        return activeSession;
    }

    private _getDefaultRuntimeProvider(): ILanguageRuntimeProvider<any> {
        const activeLanguageId = this.activeSession?.runtimeMetadata.languageId;
        if (activeLanguageId) {
            return this._requireRuntimeProvider(activeLanguageId);
        }

        const firstProvider = this._runtimeProviders.values().next().value;
        if (firstProvider) {
            return firstProvider;
        }

        throw new Error('No runtime providers registered');
    }

    private _requireRuntimeProvider<TInstallation>(languageId: string): ILanguageRuntimeProvider<TInstallation> {
        const provider = this.getRuntimeProvider<TInstallation>(languageId);
        if (!provider) {
            throw new Error(`No runtime provider registered for language ${languageId}`);
        }
        return provider;
    }

    private _resolveRuntimeEntry(
        runtimeId: string,
    ): {
        metadata: LanguageRuntimeMetadata;
        installation: unknown;
        provider: ILanguageRuntimeProvider<any>;
    } | undefined {
        const metadata = this._availableRuntimeMetadataByRuntimeId.get(runtimeId);
        if (!metadata) {
            return undefined;
        }

        const provider = this.getRuntimeProvider(metadata.languageId);
        if (!provider) {
            return undefined;
        }

        const installation = this._installationsByRuntimeId.get(runtimeId)
            ?? provider.restoreInstallationFromMetadata?.(metadata);
        if (!installation) {
            return undefined;
        }

        return { metadata, installation, provider };
    }

    private _resolveRuntimeEntryFromMetadata(
        metadata: LanguageRuntimeMetadata,
    ): {
        metadata: LanguageRuntimeMetadata;
        installation: unknown;
        provider: ILanguageRuntimeProvider<any>;
    } | undefined {
        const provider = this.getRuntimeProvider(metadata.languageId);
        if (!provider) {
            return undefined;
        }

        const installation = this._installationsByRuntimeId.get(metadata.runtimeId)
            ?? provider.restoreInstallationFromMetadata?.(metadata);
        if (!installation) {
            return undefined;
        }

        this._availableRuntimeMetadataByRuntimeId.set(metadata.runtimeId, metadata);
        this._installationsByRuntimeId.set(metadata.runtimeId, installation);
        return { metadata, installation, provider };
    }

    private _requireRuntimeEntry(runtimeId: string): {
        metadata: LanguageRuntimeMetadata;
        installation: unknown;
        provider: ILanguageRuntimeProvider<any>;
    } {
        const runtimeEntry = this._resolveRuntimeEntry(runtimeId);
        if (!runtimeEntry) {
            throw new Error(`No runtime with id '${runtimeId}' is available`);
        }

        return runtimeEntry;
    }

    private _requireLocalSupervisor(): LocalSupervisorApi {
        if (!this._localSupervisor) {
            throw new Error('Supervisor not initialized. Call initialize() first.');
        }
        return this._localSupervisor;
    }

    private async _resolveInstallationForNewSession<TInstallation>(
        provider: ILanguageRuntimeProvider<TInstallation>,
    ): Promise<TInstallation> {
        const cachedInstallation = this.getDefaultInstallation<TInstallation>(provider.languageId);
        if (cachedInstallation) {
            return cachedInstallation;
        }

        const installation = await provider.promptForInstallation(this._outputChannel, {
            persistSelection: true,
        });
        if (!installation) {
            throw new Error(
                `No ${provider.languageName} installation configured. Please configure a ${provider.languageName} runtime.`,
            );
        }

        this.setDefaultInstallation(provider.languageId, installation);
        return installation;
    }

    private _applyRuntimeMetadataDefaults(metadata: LanguageRuntimeMetadata): LanguageRuntimeMetadata {
        if (metadata.base64EncodedIconSvg) {
            return metadata;
        }

        const provider = this.getRuntimeProvider(metadata.languageId);
        const installation = provider?.restoreInstallationFromMetadata?.(metadata);
        if (!provider || !installation) {
            return metadata;
        }

        const defaults = provider.createRuntimeMetadata(this._context, installation, this._outputChannel);
        return {
            ...metadata,
            base64EncodedIconSvg: defaults.base64EncodedIconSvg ?? metadata.base64EncodedIconSvg,
        };
    }

    private getSessionLocation(): LanguageRuntimeSessionLocation {
        const config = vscode.workspace.getConfiguration('kernelSupervisor');
        const shutdownTimeout = config.get<string>('shutdownTimeout', 'immediately');
        return shutdownTimeout !== 'immediately'
            ? LanguageRuntimeSessionLocation.Machine
            : LanguageRuntimeSessionLocation.Workspace;
    }

    private async _createSessionWithProvider<TInstallation>(
        provider: ILanguageRuntimeProvider<TInstallation>,
        installation: TInstallation,
        options: RuntimeSessionCreationOptions,
        dynState?: LanguageRuntimeDynState,
    ): Promise<RuntimeSession> {
        const sessionMode: LanguageSessionMode = options.sessionMode === LanguageRuntimeSessionMode.Notebook
            ? 'notebook'
            : options.sessionMode === LanguageRuntimeSessionMode.Background
                ? 'background'
                : 'console';
        const sessionId = this._generateSessionId(provider.languageId, sessionMode);
        const baseRuntimeMetadata = provider.createRuntimeMetadata(
            this._context,
            installation,
            this._outputChannel,
        );
        const runtimeMetadata: LanguageRuntimeMetadata = {
            ...baseRuntimeMetadata,
            startupBehavior: LanguageRuntimeStartupBehavior.Immediate,
            sessionLocation: this.getSessionLocation(),
        };

        const sessionMetadata: IRuntimeSessionMetadata = {
            sessionId,
            sessionName: options.sessionName || runtimeMetadata.runtimeName,
            sessionMode: options.sessionMode,
            notebookUri: options.notebookUri,
            workingDirectory: options.workingDirectory ?? dynState?.currentWorkingDirectory,
            createdTimestamp: Date.now(),
            startReason: options.startReason,
        };

        const kernelSpec = await provider.createKernelSpec(
            this._context,
            installation,
            sessionMode,
            this._outputChannel,
        );

        this._outputChannel.info(`[RuntimeSession] Creating session ${sessionId}...`);
        this._outputChannel.debug(`[RuntimeSession] Kernel argv: ${kernelSpec.argv.join(' ')}`);
        this._outputChannel.trace(`[RuntimeSession] Kernel spec: ${JSON.stringify(kernelSpec, null, 2)}`);

        this.registerDiscoveredRuntime(provider.languageId, installation, runtimeMetadata);

        return this._createRuntimeSession(
            runtimeMetadata,
            sessionMetadata,
            provider.lspFactory,
            {
                localSupervisor: this._requireLocalSupervisor(),
                kernelSpec,
                kernelExtra: createJupyterKernelExtra(),
                dynState: dynState ?? {
                    sessionName: sessionMetadata.sessionName,
                    inputPrompt: '>',
                    continuationPrompt: '+',
                    busy: false,
                    currentWorkingDirectory: sessionMetadata.workingDirectory,
                    currentNotebookUri: options.notebookUri,
                },
            },
        );
    }

    private _createRuntimeSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionMetadata: IRuntimeSessionMetadata,
        lspFactory: ILanguageRuntimeProvider<any>['lspFactory'],
        provisioning?: RuntimeSessionProvisioningOptions,
    ): RuntimeSession {
        const session = new RuntimeSession(
            sessionMetadata.sessionId,
            runtimeMetadata,
            sessionMetadata,
            this._outputChannel,
            sessionMetadata.sessionName,
            lspFactory,
            provisioning,
        );

        this._availableRuntimeMetadataByRuntimeId.set(runtimeMetadata.runtimeId, runtimeMetadata);
        this._sessions.set(session.sessionId, session);
        if (sessionMetadata.notebookUri) {
            this._notebookSessionsByNotebookUri.set(
                getNotebookSessionMapKey(sessionMetadata.notebookUri),
                session,
            );
        }
        this._onDidCreateSession.fire(session);
        return session;
    }

    private async _ensureSessionReadyForInteraction(session: RuntimeSession): Promise<void> {
        switch (session.state) {
            case RuntimeState.Uninitialized:
                await this.startSession(session.sessionId);
                return;

            case RuntimeState.Initializing:
            case RuntimeState.Starting:
            case RuntimeState.Restarting:
                await this._waitForSessionReady(session, 10000);
                return;

            case RuntimeState.Exited:
                await this.restartSession(session.sessionId, 'ensureSessionForLanguage');
                return;

            case RuntimeState.Ready:
            case RuntimeState.Idle:
            case RuntimeState.Busy:
            case RuntimeState.Interrupting:
                return;

            default:
                throw new Error(
                    `The ${session.runtimeMetadata.languageName} session is '${session.state}' and cannot be activated.`,
                );
        }
    }

    private _generateSessionId(languageId: string, sessionMode: LanguageSessionMode): string {
        const provider = this.getRuntimeProvider(languageId);
        const prefix = provider?.getSessionIdPrefix?.(sessionMode) ?? languageId;
        const id = `${prefix}-${sessionMode === 'notebook' ? 'notebook-' : ''}${Math.random().toString(16).slice(2, 10)}`;

        if (this._sessions.has(id)) {
            return this._generateSessionId(languageId, sessionMode);
        }

        return id;
    }

    private async _restartSession(session: RuntimeSession, interrupt?: boolean): Promise<void> {
        const state = session.state;
        this._outputChannel.info(
            `[RuntimeSession] Restarting session ${session.sessionId} from state '${state}'...`,
        );

        if (state === RuntimeState.Busy) {
            const interrupted = interrupt
                ? await this._interruptSessionForAction(session, 'restart')
                : await this._promptToInterruptSession(session, 'restart');
            if (!interrupted) {
                return;
            }
        }

        switch (state) {
            case RuntimeState.Uninitialized:
            case RuntimeState.Exited:
                await this.startSession(session.sessionId, {
                    startMode: RuntimeStartMode.Restarting,
                    activate: true,
                    hasConsole: this._activeSessionsBySessionId.get(session.sessionId)?.hasConsole ?? true,
                });
                return;

            case RuntimeState.Ready:
            case RuntimeState.Idle:
            case RuntimeState.Busy:
                await session.restart(session.workingDirectory);
                await this._waitForSessionReady(session, 10000);
                if (session.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console) {
                    await this._setForegroundSession(session.sessionId);
                }
                return;

            case RuntimeState.Starting:
            case RuntimeState.Restarting:
                return;

            default:
                throw new Error(
                    `The ${session.runtimeMetadata.languageName} session is '${state}' and cannot be restarted.`,
                );
        }
    }

    private async _promptToInterruptSession(
        session: RuntimeSession,
        action: string,
    ): Promise<boolean> {
        const choice = await vscode.window.showWarningMessage(
            `The runtime is busy. Do you want to interrupt it and ${action}? You'll lose any unsaved objects.`,
            { modal: true },
            'Yes',
            'No',
        );

        if (choice !== 'Yes') {
            return false;
        }

        await session.interrupt();

        try {
            await this._waitForSessionReady(session, 10000);
            return true;
        } catch (error) {
            void vscode.window.showWarningMessage(
                `Failed to interrupt the ${session.runtimeMetadata.languageName} session. Reason: ${error}`,
            );
            return false;
        }
    }

    private async _interruptSessionForAction(
        session: RuntimeSession,
        action: string,
    ): Promise<boolean> {
        await session.interrupt();

        try {
            await this._waitForSessionReady(session, 10000);
            return true;
        } catch (error) {
            void vscode.window.showWarningMessage(
                `Failed to interrupt the ${session.runtimeMetadata.languageName} session before ${action}. Reason: ${error}`,
            );
            return false;
        }
    }

    private _waitForSessionReady(
        session: RuntimeSession,
        timeoutMs: number,
    ): Promise<void> {
        if (
            session.state === RuntimeState.Ready ||
            session.state === RuntimeState.Idle ||
            session.state === RuntimeState.Busy
        ) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                disposable.dispose();
                reject(
                    new Error(
                        `Timed out waiting for runtime '${session.dynState.sessionName}' to become ready`,
                    ),
                );
            }, timeoutMs);

            const disposable = session.onDidChangeRuntimeState((state) => {
                if (
                    state === RuntimeState.Ready ||
                    state === RuntimeState.Idle ||
                    state === RuntimeState.Busy
                ) {
                    clearTimeout(timeout);
                    disposable.dispose();
                    resolve();
                }
            });
        });
    }

    private async _setForegroundSession(sessionId: string | undefined): Promise<void> {
        await this._enqueueActiveSessionSwitch(() => this._setForegroundSessionInternal(sessionId));
    }

    private async _setForegroundSessionInternal(sessionId: string | undefined): Promise<void> {
        if (this._foregroundSessionId === sessionId) {
            return;
        }

        const oldSession = this.foregroundSession;
        const newSession = sessionId ? this._sessions.get(sessionId) : undefined;

        if (oldSession && oldSession.sessionId !== sessionId) {
            oldSession.setForeground(false);
        }

        this._foregroundSessionId = sessionId;

        if (newSession) {
            newSession.setForeground(true);
            if (newSession.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console) {
                this._lastActiveConsoleSessionByLanguageId.set(
                    newSession.runtimeMetadata.languageId,
                    newSession,
                );
            }
        }

        this._onDidChangeForegroundSession.fire(newSession);
        this._onDidChangeActiveSession.fire(newSession);
    }

    private async _enqueueActiveSessionSwitch(task: () => Promise<void>): Promise<void> {
        const switchPromise = this._activeSessionSwitchChain
            .catch(() => undefined)
            .then(task);

        this._activeSessionSwitchChain = switchPromise;
        await switchPromise;
    }

    private _didChangeRuntimeState(
        session: RuntimeSession,
        activeSession: ActiveRuntimeSession,
        state: RuntimeState,
        activate: boolean,
    ): void {
        const oldState = activeSession.state;
        activeSession.state = state;

        this._onDidChangeSessionState.fire({
            sessionId: session.sessionId,
            state,
        });
        this._onDidChangeRuntimeState.fire({
            session_id: session.sessionId,
            old_state: oldState,
            new_state: state,
        });

        if (state === RuntimeState.Starting && oldState === RuntimeState.Exited) {
            this._onWillStartSession.fire({
                session,
                startMode: RuntimeStartMode.Restarting,
                activate: false,
                hasConsole: activeSession.hasConsole,
            });
        }

        if (state === RuntimeState.Ready) {
            void activeSession.startUiClient().catch(() => undefined);
            if (activate && session.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console) {
                void this._setForegroundSession(session.sessionId);
            }
        }
    }

    private _normalizeRuntimeEvent(
        session: RuntimeSession,
        name: UiFrontendEvent,
        data: unknown,
    ): unknown {
        switch (name) {
            case UiFrontendEvent.Busy:
                return this._applyBusyState(session, (data ?? {}) as Partial<BusyEvent>);
            case UiFrontendEvent.PromptState:
                return this._applyPromptState(session, (data ?? {}) as Partial<PromptStateEvent>);
            case UiFrontendEvent.WorkingDirectory:
                return this._applyWorkingDirectoryState(session, (data ?? {}) as Partial<WorkingDirectoryEvent>);
            default:
                return data;
        }
    }

    private _applyPromptState(
        session: RuntimeSession,
        event: Partial<PromptStateEvent>,
    ): PromptStateEvent {
        const inputPrompt = typeof event.input_prompt === 'string'
            ? event.input_prompt.trimEnd()
            : session.dynState.inputPrompt;
        const continuationPrompt = typeof event.continuation_prompt === 'string'
            ? event.continuation_prompt.trimEnd()
            : session.dynState.continuationPrompt;

        session.dynState.inputPrompt = inputPrompt;
        session.dynState.continuationPrompt = continuationPrompt;

        return {
            input_prompt: inputPrompt,
            continuation_prompt: continuationPrompt,
        };
    }

    private _applyBusyState(
        session: RuntimeSession,
        event: Partial<BusyEvent>,
    ): BusyEvent {
        const busy = !!event.busy;
        session.dynState.busy = busy;
        return { busy };
    }

    private _applyWorkingDirectoryState(
        session: RuntimeSession,
        event: Partial<WorkingDirectoryEvent>,
    ): WorkingDirectoryEvent {
        const directory = typeof event.directory === 'string'
            ? event.directory
            : session.workingDirectory ?? session.dynState.currentWorkingDirectory ?? '';

        if (directory.length > 0) {
            session.updateWorkingDirectory(directory);
        }

        return { directory };
    }

    private _dispatchRuntimeFrontendEvent(name: UiFrontendEvent, data: unknown): void {
        switch (name) {
            case UiFrontendEvent.ShowMessage: {
                const event = data as Partial<ShowMessageEvent>;
                if (typeof event.message === 'string' && event.message.length > 0) {
                    void vscode.window.showInformationMessage(event.message);
                }
                break;
            }

            case UiFrontendEvent.OpenWorkspace: {
                const event = data as Partial<OpenWorkspaceEvent>;
                if (typeof event.path === 'string' && event.path.length > 0) {
                    void vscode.commands.executeCommand(
                        'vscode.openFolder',
                        vscode.Uri.file(event.path),
                        !!event.new_window,
                    );
                }
                break;
            }

            case UiFrontendEvent.OpenEditor:
                void this._openRuntimeEditor(data as Partial<OpenEditorEvent>);
                break;

            case UiFrontendEvent.SetEditorSelections:
                this._setActiveEditorSelections(data as Partial<SetEditorSelectionsEvent>);
                break;

            case UiFrontendEvent.OpenWithSystem: {
                const event = data as Partial<OpenWithSystemEvent>;
                if (typeof event.path === 'string' && event.path.length > 0) {
                    void vscode.env.openExternal(vscode.Uri.file(event.path));
                }
                break;
            }
        }
    }

    private async _openRuntimeEditor(event: Partial<OpenEditorEvent>): Promise<void> {
        if (typeof event.file !== 'string' || event.file.length === 0) {
            return;
        }

        const targetUri = event.kind === OpenEditorKind.Uri
            ? vscode.Uri.parse(event.file)
            : vscode.Uri.file(event.file);

        const targetLine = typeof event.line === 'number' && Number.isFinite(event.line)
            ? Math.max(Math.trunc(event.line) - 1, 0)
            : 0;
        const targetColumn = typeof event.column === 'number' && Number.isFinite(event.column)
            ? Math.max(Math.trunc(event.column) - 1, 0)
            : 0;

        const targetPosition = new vscode.Position(targetLine, targetColumn);
        const targetSelection = new vscode.Selection(targetPosition, targetPosition);

        await vscode.window.showTextDocument(targetUri, {
            selection: targetSelection,
            preview: event.pinned === false,
            preserveFocus: false,
        });
    }

    private _setActiveEditorSelections(event: Partial<SetEditorSelectionsEvent>): void {
        if (!Array.isArray(event.selections) || event.selections.length === 0) {
            return;
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return;
        }

        const selections: vscode.Selection[] = [];
        for (const selection of event.selections) {
            if (!selection || !selection.start || !selection.end) {
                continue;
            }

            selections.push(
                new vscode.Selection(
                    new vscode.Position(
                        Math.max(Math.trunc(selection.start.line), 0),
                        Math.max(Math.trunc(selection.start.character), 0),
                    ),
                    new vscode.Position(
                        Math.max(Math.trunc(selection.end.line), 0),
                        Math.max(Math.trunc(selection.end.character), 0),
                    ),
                ),
            );
        }

        if (selections.length > 0) {
            activeEditor.selections = selections;
            activeEditor.revealRange(selections[0]);
        }
    }

    private async _removeSession(session: RuntimeSession): Promise<void> {
        const sessionId = session.sessionId;
        const notebookUri = session.sessionMetadata.notebookUri;

        this._disposeSessionLifecycleDisposables(sessionId);
        this._sessions.delete(sessionId);
        this._restoredSessionIds.delete(sessionId);
        this._restartingSessionPromises.delete(sessionId);
        this._startingSessionsBySessionKey.delete(
            getSessionStartKey(
                session.sessionMetadata.sessionMode,
                session.runtimeMetadata.runtimeId,
                notebookUri,
            ),
        );

        if (notebookUri) {
            this._notebookSessionsByNotebookUri.delete(getNotebookSessionMapKey(notebookUri));
            this._shuttingDownNotebookSessionsByNotebookUri.delete(getNotebookSessionMapKey(notebookUri));
        }

        const lastActiveConsoleSession = this._lastActiveConsoleSessionByLanguageId.get(
            session.runtimeMetadata.languageId,
        );
        if (lastActiveConsoleSession?.sessionId === sessionId) {
            const nextConsoleSession = this.sessions.find((candidate) =>
                candidate.runtimeMetadata.languageId === session.runtimeMetadata.languageId &&
                candidate.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console,
            );
            if (nextConsoleSession) {
                this._lastActiveConsoleSessionByLanguageId.set(
                    session.runtimeMetadata.languageId,
                    nextConsoleSession,
                );
            } else {
                this._lastActiveConsoleSessionByLanguageId.delete(session.runtimeMetadata.languageId);
            }
        }

        if (this._foregroundSessionId === sessionId) {
            const nextSessionId = this.sessions.find((candidate) =>
                candidate.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console,
            )?.sessionId;
            await this._setForegroundSession(nextSessionId);
        }

        await session.dispose();
        this._onDidDeleteSession.fire(sessionId);
    }

    private _disposeSessionLifecycleDisposables(sessionId: string): void {
        const sessionDisposables = this._sessionLifecycleDisposables.get(sessionId);
        if (sessionDisposables) {
            for (const disposable of sessionDisposables) {
                disposable.dispose();
            }
            this._sessionLifecycleDisposables.delete(sessionId);
        }

        this._activeSessionsBySessionId.delete(sessionId);
    }

    private _mapStateToString(state: RuntimeState): string {
        switch (state) {
            case RuntimeState.Uninitialized:
                return 'uninitialized';
            case RuntimeState.Offline:
                return 'offline';
            case RuntimeState.Initializing:
            case RuntimeState.Starting:
                return 'starting';
            case RuntimeState.Ready:
            case RuntimeState.Idle:
                return 'ready';
            case RuntimeState.Busy:
                return 'busy';
            case RuntimeState.Interrupting:
                return 'interrupting';
            case RuntimeState.Restarting:
                return 'restarting';
            case RuntimeState.Exiting:
                return 'exiting';
            case RuntimeState.Exited:
                return 'exited';
            default:
                return 'uninitialized';
        }
    }
}
