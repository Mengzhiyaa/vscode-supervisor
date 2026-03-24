import * as vscode from 'vscode';
import {
    type ILanguageInstallationPickerOptions,
    type ILanguageRuntimeProvider,
    type LanguageRuntimeDynState,
    type LanguageRuntimeMetadata,
    LanguageRuntimeSessionLocation,
    LanguageRuntimeSessionMode,
    LanguageRuntimeStartupBehavior,
    type LanguageSessionMode,
    type RuntimeSessionMetadata,
} from '../api';
import { RuntimeSession } from './session';
import { LocalSupervisorApi } from './localSupervisor';
import { createJupyterKernelExtra } from './startup';
import {
    RuntimeClientType,
    RuntimeStartMode,
    RuntimeState,
} from '../internal/runtimeTypes';
import { RuntimeClientInstance } from './RuntimeClientInstance';
import {
    type BusyEvent,
    type ClearConsoleEvent,
    OpenEditorKind,
    type OpenEditorEvent,
    type OpenWorkspaceEvent,
    type PromptStateEvent,
    type SetEditorSelectionsEvent,
    type ShowHtmlFileEvent,
    type ShowMessageEvent,
    type ShowUrlEvent,
    type WorkingDirectoryEvent,
    type OpenWithSystemEvent,
    type ClearWebviewPreloadsEvent,
    UiFrontendEvent,
} from './comms/positronUiComm';
import { UiClientInstance } from './UiClientInstance';
import { RuntimeClientManager } from './runtimeClientManager';
import type {
    ILanguageRuntimeGlobalEvent,
} from './runtimeEvents';

/**
 * Key for storing the list of persisted sessions in workspace state.
 */
const PERSISTED_SESSIONS_KEY = 'vscode-supervisor.persistedSessions';
const PERSISTED_SESSION_RESTORE_TIMEOUT_MS = 15_000;

/**
 * Serialized session metadata for persistence.
 * Contains all information needed to restore a session after reload/restart.
 */
interface SerializedRuntimeSession {
    sessionId: string;
    sessionName: string;
    runtimeMetadata: LanguageRuntimeMetadata;
    sessionMetadata: RuntimeSessionMetadata;
    sessionState: RuntimeState;
    workingDirectory?: string;
    hasConsole?: boolean;
    lastUsed: number;
}

/**
 * Manages the lifecycle of runtime sessions.
 * Uses the local Kallichore supervisor and registered language runtimes.
 */
export class SessionManager implements vscode.Disposable {
    private readonly _sessions = new Map<string, RuntimeSession>();
    private readonly _sessionRuntimeStates = new Map<string, RuntimeState>();
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _runtimeProviders = new Map<string, ILanguageRuntimeProvider<any>>();
    private readonly _defaultInstallationsByLanguageId = new Map<string, unknown>();
    private _localSupervisor: LocalSupervisorApi | undefined;
    private _activeSessionId: string | undefined;
    private _initialized = false;
    private readonly _restoredSessionIds = new Set<string>();
    private readonly _sessionLifecycleDisposables = new Map<string, vscode.Disposable[]>();
    private readonly _runtimeEventManagerDisposables = new Map<string, vscode.Disposable[]>();
    private readonly _runtimeEventUiDisposables = new Map<string, vscode.Disposable[]>();
    private readonly _restartingSessionPromises = new Map<string, Promise<void>>();
    private _activeSessionSwitchChain: Promise<void> = Promise.resolve();
    private _shutdownPromise: Promise<void> | undefined;
    private _isRestoringPersistedSessions = false;
    private _restorePersistedSessionsPromise: Promise<void> | undefined;

    private readonly _onDidChangeForegroundSession = new vscode.EventEmitter<RuntimeSession | undefined>();
    readonly onDidChangeForegroundSession = this._onDidChangeForegroundSession.event;

    private readonly _onDidCreateSession = new vscode.EventEmitter<RuntimeSession>();
    readonly onDidCreateSession = this._onDidCreateSession.event;

    private readonly _onDidDeleteSession = new vscode.EventEmitter<string>();
    readonly onDidDeleteSession = this._onDidDeleteSession.event;

    private readonly _onDidChangeActiveSession = new vscode.EventEmitter<RuntimeSession | undefined>();
    readonly onDidChangeActiveSession = this._onDidChangeActiveSession.event;

    readonly onDidDeleteRuntimeSession = this._onDidDeleteSession.event;

    private readonly _onDidUpdateSessionName = new vscode.EventEmitter<RuntimeSession>();
    readonly onDidUpdateSessionName = this._onDidUpdateSessionName.event;

    // Session lifecycle events (Positron pattern)
    private readonly _onWillStartSession = new vscode.EventEmitter<{
        session: RuntimeSession;
        startMode: RuntimeStartMode;
        activate: boolean;
    }>();
    readonly onWillStartSession = this._onWillStartSession.event;

    private readonly _onDidReceiveRuntimeEvent = new vscode.EventEmitter<ILanguageRuntimeGlobalEvent>();
    readonly onDidReceiveRuntimeEvent = this._onDidReceiveRuntimeEvent.event;

    private readonly _onDidChangeSessionState = new vscode.EventEmitter<{
        sessionId: string;
        state: RuntimeState;
    }>();
    readonly onDidChangeSessionState = this._onDidChangeSessionState.event;



    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _outputChannel: vscode.LogOutputChannel
    ) {
        this._disposables.push(this._onDidChangeForegroundSession);
        this._disposables.push(this._onDidCreateSession);
        this._disposables.push(this._onDidDeleteSession);
        this._disposables.push(this._onDidChangeActiveSession);
        this._disposables.push(this._onDidUpdateSessionName);
        this._disposables.push(this._onWillStartSession);
        this._disposables.push(this._onDidReceiveRuntimeEvent);
        this._disposables.push(this._onDidChangeSessionState);
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

    /**
     * Initializes the manager: discovers initial installations and sets up Kallichore supervisor.
     */
    async initialize(): Promise<void> {
        if (this._initialized) {
            return;
        }

        this._outputChannel.debug('[SessionManager] Initializing...');

        try {
            for (const provider of this._runtimeProviders.values()) {
                this._outputChannel.debug(`[SessionManager] Discovering initial ${provider.languageName} installations...`);
                const installation = await provider.resolveInitialInstallation(this._outputChannel);
                if (installation) {
                    this.setDefaultInstallation(provider.languageId, installation);
                    this._outputChannel.info(
                        `[SessionManager] Using ${provider.languageName} at ${provider.getRuntimePath(installation)}`
                    );
                }
            }

            if (this._defaultInstallationsByLanguageId.size === 0) {
                this._outputChannel.warn('[SessionManager] No language installations found during initialization');
                this._outputChannel.warn('[SessionManager] Language-specific providers can prompt for installation later');
            }

            // Create and initialize the local supervisor
            this._localSupervisor = new LocalSupervisorApi(
                this._context,
                this._outputChannel
            );
            await this._localSupervisor.initialize();

            this._initialized = true;
            this._outputChannel.debug('[SessionManager] Initialized');

        } catch (error) {
            this._outputChannel.error(`[SessionManager] Error initializing: ${error}`);
            throw error;
        }
    }

    /**
     * Gets whether the manager is initialized
     */
    get isInitialized(): boolean {
        return this._initialized;
    }

    get isRestoringPersistedSessions(): boolean {
        return this._isRestoringPersistedSessions;
    }

    restorePersistedSessionsInBackground(): Promise<void> {
        if (this._shutdownPromise) {
            return Promise.resolve();
        }

        if (this._isRestoringPersistedSessions && this._restorePersistedSessionsPromise) {
            return this._restorePersistedSessionsPromise;
        }

        this._restorePersistedSessionsPromise = this.restorePersistedSessions();
        return this._restorePersistedSessionsPromise;
    }

    waitForPersistedSessionRestore(): Promise<void> {
        return this._restorePersistedSessionsPromise?.catch(() => undefined) ?? Promise.resolve();
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

    private async _resolveInstallationForNewSession<TInstallation>(
        provider: ILanguageRuntimeProvider<TInstallation>
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
                `No ${provider.languageName} installation configured. Please configure a ${provider.languageName} runtime.`
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

    /**
     * Gets the active session
     */
    get activeSession(): RuntimeSession | undefined {
        if (this._activeSessionId) {
            return this._sessions.get(this._activeSessionId);
        }
        return undefined;
    }

    get foregroundSession(): RuntimeSession | undefined {
        return this.activeSession;
    }

    /**
     * Gets all sessions
     */
    get sessions(): RuntimeSession[] {
        return Array.from(this._sessions.values());
    }

    /**
     * Returns true if the session was restored from persisted state.
     */
    wasSessionRestored(sessionId: string): boolean {
        return this._restoredSessionIds.has(sessionId);
    }

    /**
     * Creates a new session using the preferred registered language runtime.
     */
    async createSession(sessionName?: string): Promise<RuntimeSession> {
        const provider = this._getDefaultRuntimeProvider();
        return this.createSessionForLanguage(provider.languageId, sessionName);
    }

    /**
     * Creates a new session for a specific registered language.
     */
    async createSessionForLanguage<TInstallation>(
        languageId: string,
        sessionName?: string
    ): Promise<RuntimeSession> {
        if (!this._localSupervisor) {
            throw new Error('Supervisor not initialized. Call initialize() first.');
        }

        const provider = this._requireRuntimeProvider<TInstallation>(languageId);
        const installation = await this._resolveInstallationForNewSession(provider);
        return this._createSessionWithProvider(provider, installation, sessionName);
    }

    async createSessionForLanguageInstallation<TInstallation>(
        languageId: string,
        installation: TInstallation,
        sessionName?: string
    ): Promise<RuntimeSession> {
        if (!this._localSupervisor) {
            throw new Error('Supervisor not initialized. Call initialize() first.');
        }

        const provider = this._requireRuntimeProvider<TInstallation>(languageId);
        this.setDefaultInstallation(languageId, installation);
        return this._createSessionWithProvider(provider, installation, sessionName);
    }

    async ensureSessionForLanguage(
        languageId: string,
        sessionName?: string
    ): Promise<RuntimeSession> {
        const activeSession = this.activeSession;
        if (activeSession?.runtimeMetadata.languageId === languageId &&
            activeSession.state !== RuntimeState.Exiting &&
            activeSession.state !== RuntimeState.Offline) {
            await this._ensureSessionReadyForInteraction(activeSession);
            return activeSession;
        }

        const existingSession = this.sessions.find(session =>
            session.runtimeMetadata.languageId === languageId &&
            session.state !== RuntimeState.Exiting &&
            session.state !== RuntimeState.Offline
        );

        if (existingSession) {
            await this._setActiveSession(existingSession.sessionId);
            await this._ensureSessionReadyForInteraction(existingSession);
            return existingSession;
        }

        const session = await this.createSessionForLanguage(languageId, sessionName);
        await this._ensureSessionReadyForInteraction(session);
        return session;
    }

    /**
     * Prompts the user to pick an installation for a new session.
     * Returns undefined if the user cancels.
     */
    async createSessionFromPicker(sessionName?: string): Promise<RuntimeSession | undefined> {
        if (!this._localSupervisor) {
            throw new Error('Supervisor not initialized. Call initialize() first.');
        }

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
            sessionName
        );
    }

    /**
     * Determines the session location based on the shutdown timeout configuration.
     * Sessions use 'machine' location when persistence is enabled (shutdownTimeout != 'immediately'),
     * allowing them to survive across Positron restarts.
     */
    private getSessionLocation(): LanguageRuntimeSessionLocation {
        const config = vscode.workspace.getConfiguration('kernelSupervisor');
        const shutdownTimeout = config.get<string>('shutdownTimeout', 'immediately');
        return shutdownTimeout !== 'immediately'
            ? LanguageRuntimeSessionLocation.Machine
            : LanguageRuntimeSessionLocation.Workspace;
    }

    async selectInstallation<TInstallation>(
        languageId: string,
        options?: ILanguageInstallationPickerOptions
    ): Promise<TInstallation | undefined> {
        const provider = this._requireRuntimeProvider<TInstallation>(languageId);
        const installation = await provider.promptForInstallation(this._outputChannel, options);
        if (installation) {
            this.setDefaultInstallation(languageId, installation);
        }
        return installation;
    }

    private async _createSessionWithProvider<TInstallation>(
        provider: ILanguageRuntimeProvider<TInstallation>,
        installation: TInstallation,
        sessionName?: string
    ): Promise<RuntimeSession> {
        const sessionMode: LanguageSessionMode = 'console';
        const sessionId = this._generateSessionId(provider.languageId, sessionMode);
        const baseRuntimeMetadata = provider.createRuntimeMetadata(
            this._context,
            installation,
            this._outputChannel
        );
        const runtimeMetadata: LanguageRuntimeMetadata = {
            ...baseRuntimeMetadata,
            startupBehavior: LanguageRuntimeStartupBehavior.Immediate,
            sessionLocation: this.getSessionLocation(),
        };

        const sessionMetadata: RuntimeSessionMetadata = {
            sessionId,
            sessionName: sessionName || runtimeMetadata.runtimeName,
            sessionMode: LanguageRuntimeSessionMode.Console,
        };

        const dynState: LanguageRuntimeDynState = {
            sessionName: sessionMetadata.sessionName,
            inputPrompt: '>',
            continuationPrompt: '+',
            busy: false,
            currentWorkingDirectory: undefined,
        };

        // Create proper kernel spec using ARK kernel
        const kernelSpec = await provider.createKernelSpec(
            this._context,
            installation,
            sessionMode,
            this._outputChannel
        );

        // Log detailed kernel spec for debugging
        this._outputChannel.info(`[SessionManager] Creating session ${sessionId}...`);
        this._outputChannel.debug(`[SessionManager] Kernel argv: ${kernelSpec.argv.join(' ')}`);
        this._outputChannel.trace(`[SessionManager] Kernel spec: ${JSON.stringify(kernelSpec, null, 2)}`);

        // Create session wrapper with logger
        const session = new RuntimeSession(
            sessionId,
            runtimeMetadata,
            sessionMetadata,
            this._outputChannel,
            sessionMetadata.sessionName,
            provider.lspFactory
        );
        this._sessions.set(sessionId, session);

        // Fire onWillStartSession BEFORE starting kernel (Positron pattern)
        // This allows consoleService to create/reattach console instances
        this._onWillStartSession.fire({
            session,
            startMode: RuntimeStartMode.Starting,
            activate: true
        });

        try {
            const supervisor = this._localSupervisor;
            if (!supervisor) {
                throw new Error('Supervisor not initialized. Call initialize() first.');
            }

            // Create Jupyter session via local supervisor
            const kernel = await supervisor.createSession(
                runtimeMetadata,
                sessionMetadata,
                kernelSpec,
                dynState,
                createJupyterKernelExtra()
            );

            // Attach kernel to session
            session.attachKernel(kernel);
            this._outputChannel.debug(`[SessionManager] ${sessionId}: kernel attached`);

            // Register state/working directory listeners
            this.registerSessionStateListener(session);
            this._outputChannel.debug(`[SessionManager] ${sessionId}: session lifecycle listeners registered`);
            this._onDidCreateSession.fire(session);

            // Set as active foreground session.
            this._outputChannel.debug(`[SessionManager] ${sessionId}: switching to foreground`);
            await this._logSlowOperation(
                `[SessionManager] ${sessionId}: set active session`,
                () => this._setActiveSession(sessionId),
            );
            this._outputChannel.debug(`[SessionManager] ${sessionId}: foreground switch complete`);

            // Save session list for persistence
            this._outputChannel.debug(`[SessionManager] ${sessionId}: saving workspace sessions`);
            await this._logSlowOperation(
                `[SessionManager] ${sessionId}: save workspace sessions`,
                () => this.saveWorkspaceSessions(),
            );
            this._outputChannel.debug(`[SessionManager] ${sessionId}: workspace sessions saved`);

            this._outputChannel.info(`[SessionManager] Session ${sessionId} created successfully`);
            return session;

        } catch (error) {
            this._sessions.delete(sessionId);
            this._onDidDeleteSession.fire(sessionId);
            try {
                await session.dispose();
            } catch (disposeError) {
                this._outputChannel.warn(`[SessionManager] Failed to dispose session after create error: ${disposeError}`);
            }
            this._outputChannel.error(`[SessionManager] Failed to create session: ${error}`);
            throw error;
        }
    }

    private async _ensureSessionReadyForInteraction(session: RuntimeSession): Promise<void> {
        switch (session.state) {
            case RuntimeState.Uninitialized:
                await session.start();
                return;

            case RuntimeState.Initializing:
            case RuntimeState.Starting:
            case RuntimeState.Restarting:
                await this._waitForSessionReady(session, 10000);
                return;

            case RuntimeState.Exited:
                await this.restartSession(session.sessionId);
                return;

            case RuntimeState.Ready:
            case RuntimeState.Idle:
            case RuntimeState.Busy:
            case RuntimeState.Interrupting:
                return;

            default:
                throw new Error(
                    `The ${session.runtimeMetadata.languageName} session is '${session.state}' and cannot be activated.`
                );
        }
    }

    private _generateSessionId(languageId: string, sessionMode: LanguageSessionMode): string {
        const provider = this.getRuntimeProvider(languageId);
        const prefix = provider?.getSessionIdPrefix?.(sessionMode) ?? languageId;
        const id = `${prefix}-${sessionMode === 'notebook' ? 'notebook-' : ''}${Math.random().toString(16).slice(2, 10)}`;

        // Extremely small chance of collision; retry if it happens.
        if (this._sessions.has(id)) {
            return this._generateSessionId(languageId, sessionMode);
        }

        return id;
    }

    /**
     * Gets a session by ID
     */
    getSession(sessionId: string): RuntimeSession | undefined {
        return this._sessions.get(sessionId);
    }

    /**
     * Sets the active session
     */
    async setActiveSession(sessionId: string): Promise<void> {
        if (this._sessions.has(sessionId)) {
            await this._setActiveSession(sessionId);
        }
    }

    /**
     * Closes a session
     */
    async closeSession(sessionId: string): Promise<void> {
        const session = this._sessions.get(sessionId);
        if (session) {
            this._outputChannel.debug(`[SessionManager] Closing session ${sessionId}...`);
            try {
                await session.shutdown();
            } catch (err) {
                this._outputChannel.warn(`[SessionManager] Shutdown failed for ${sessionId} (kernel may have already exited): ${err}`);
            }
            this._disposeRuntimeEventSession(sessionId);
            await session.dispose();
            this._sessions.delete(sessionId);
            this._restoredSessionIds.delete(sessionId);

            // Fire deletion event so services can clean up
            this._onDidDeleteSession.fire(sessionId);

            if (this._activeSessionId === sessionId) {
                // Switch to another session or undefined
                const remaining = Array.from(this._sessions.keys());
                await this._setActiveSession(remaining[0]);
            }

            // Save session list (excluding the closed session)
            await this.saveWorkspaceSessions(sessionId);

            this._outputChannel.debug(`[SessionManager] Session ${sessionId} closed`);
        }
    }

    /**
     * Gets the Kallichore binary path if available
     */
    getKallichorePath(): string | undefined {
        return this._localSupervisor?.getKallichorePath();
    }

    /**
     * Shows the supervisor log in the output panel
     */
    showSupervisorLog(): void {
        this._localSupervisor?.showLog();
    }

    /**
     * Gets all sessions with their info
     */
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

    /**
     * Gets the active session ID
     */
    get activeSessionId(): string | undefined {
        return this._activeSessionId;
    }

    emitTestRuntimeEvent(sessionId: string, name: UiFrontendEvent, data: unknown): void {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error('Session ' + sessionId + ' not found');
        }

        let normalizedData: unknown = data;
        switch (name) {
            case UiFrontendEvent.Busy:
                normalizedData = this._applyBusyState(session, (data ?? {}) as BusyEvent);
                break;
            case UiFrontendEvent.PromptState:
                normalizedData = this._applyPromptState(session, (data ?? {}) as Partial<PromptStateEvent>);
                break;
            case UiFrontendEvent.WorkingDirectory:
                normalizedData = this._applyWorkingDirectoryState(session, (data ?? {}) as Partial<WorkingDirectoryEvent>);
                break;
        }

        this._dispatchRuntimeFrontendEvent(name, normalizedData);
        this._onDidReceiveRuntimeEvent.fire({
            session_id: sessionId,
            event: {
                name,
                data: normalizedData,
            },
        });
    }

    /**
     * Stops a session
     */
    async stopSession(sessionId: string): Promise<void> {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        this._outputChannel.debug(`[SessionManager] Stopping session ${sessionId}...`);
        try {
            await session.shutdown();
        } catch (err) {
            this._outputChannel.warn(`[SessionManager] Shutdown failed for ${sessionId} (kernel may have already exited): ${err}`);
        }
        this._disposeRuntimeEventSession(sessionId);
        this._sessions.delete(sessionId);
        this._restoredSessionIds.delete(sessionId);

        // Fire deletion event so services can clean up
        this._onDidDeleteSession.fire(sessionId);

        // If this was the active session, clear it
        if (this._activeSessionId === sessionId) {
            // Switch to another session if available
            const remaining = Array.from(this._sessions.keys());
            await this._setActiveSession(remaining.length > 0 ? remaining[0] : undefined);
        }

        await session.dispose();

        this._outputChannel.debug(`[SessionManager] Session ${sessionId} stopped`);
    }

    /**
     * Restarts a session
     */
    async restartSession(sessionId: string): Promise<void> {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const existingRestart = this._restartingSessionPromises.get(sessionId);
        if (existingRestart) {
            return existingRestart;
        }

        const restartPromise = this._restartSession(session).finally(() => {
            if (this._restartingSessionPromises.get(sessionId) === restartPromise) {
                this._restartingSessionPromises.delete(sessionId);
            }
        });

        this._restartingSessionPromises.set(sessionId, restartPromise);
        return restartPromise;
    }

    private async _restartSession(session: RuntimeSession): Promise<void> {
        const sessionId = session.sessionId;
        const state = session.state;

        this._outputChannel.info(
            `[SessionManager] Restarting session ${sessionId} from state '${state}'...`
        );

        if (state === RuntimeState.Busy) {
            const interrupted = await this._promptToInterruptSession(session, 'restart');
            if (!interrupted) {
                this._outputChannel.debug(
                    `[SessionManager] Restart of session ${sessionId} cancelled while busy`
                );
                return;
            }
        }

        switch (state) {
            case RuntimeState.Busy:
            case RuntimeState.Idle:
            case RuntimeState.Ready:
            case RuntimeState.Exited:
                this._onWillStartSession.fire({
                    session,
                    startMode: RuntimeStartMode.Restarting,
                    activate: true,
                });
                await this._startOrRestartSession(session, state === RuntimeState.Exited);
                this._outputChannel.info(`[SessionManager] Session ${sessionId} restarted`);
                return;

            case RuntimeState.Uninitialized:
                this._onWillStartSession.fire({
                    session,
                    startMode: RuntimeStartMode.Starting,
                    activate: true,
                });
                await this._startOrRestartSession(session, true);
                this._outputChannel.info(
                    `[SessionManager] Session ${sessionId} started from uninitialized state`
                );
                return;

            case RuntimeState.Starting:
            case RuntimeState.Restarting:
                this._outputChannel.debug(
                    `[SessionManager] Session ${sessionId} is already '${state}', ignoring restart request`
                );
                return;

            default:
                throw new Error(
                    `The ${session.runtimeMetadata.languageName} session is '${state}' and cannot be restarted.`
                );
        }
    }

    private async _startOrRestartSession(
        session: RuntimeSession,
        useStart: boolean
    ): Promise<void> {
        const readyPromise = this._waitForSessionReady(session, 10000);

        try {
            if (useStart) {
                await session.start();
            } else {
                await session.restart();
            }
        } catch (error) {
            readyPromise.catch(() => undefined);
            throw error;
        }

        await readyPromise;
    }

    private async _promptToInterruptSession(
        session: RuntimeSession,
        action: string
    ): Promise<boolean> {
        const languageName = session.runtimeMetadata.languageName;
        const choice = await vscode.window.showWarningMessage(
            `The runtime is busy. Do you want to interrupt it and ${action}? You'll lose any unsaved objects.`,
            { modal: true },
            'Yes',
            'No'
        );

        if (choice !== 'Yes') {
            return false;
        }

        await session.interrupt();

        try {
            await this._waitForSessionReady(session, 10000);
            return true;
        } catch (error) {
            vscode.window.showWarningMessage(
                `Failed to interrupt the ${languageName} session. Reason: ${error}`
            );
            return false;
        }
    }

    private _waitForSessionReady(
        session: RuntimeSession,
        timeoutMs: number
    ): Promise<void> {
        if (session.state === RuntimeState.Ready || session.state === RuntimeState.Idle) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                disposable.dispose();
                reject(
                    new Error(
                        `Timed out waiting for runtime '${session.dynState.sessionName}' to become ready`
                    )
                );
            }, timeoutMs);

            const disposable = session.onDidChangeRuntimeState((state) => {
                if (state === RuntimeState.Ready || state === RuntimeState.Idle) {
                    clearTimeout(timeout);
                    disposable.dispose();
                    resolve();
                }
            });
        });
    }

    /**
     * Switches the active session (with service switching).
     */
    async switchSession(sessionId: string): Promise<void> {
        if (!this._sessions.has(sessionId)) {
            throw new Error(`Session ${sessionId} not found`);
        }
        await this._setActiveSession(sessionId);
        this._outputChannel.debug(`[SessionManager] Switched to session ${sessionId}`);
    }

    /**
     * Renames a session
     */
    renameSession(sessionId: string, newName: string): void {
        const session = this._sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        const validatedName = newName.trim();
        if (validatedName.length === 0) {
            throw new Error('Session name cannot be empty');
        }

        session.updateSessionName(validatedName);
        this._outputChannel.debug(`[SessionManager] Renamed session ${sessionId} to "${session.dynState.sessionName}"`);
        this._onDidUpdateSessionName.fire(session);
        void this.saveWorkspaceSessions();
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

    /**
     * Sets the foreground session and serializes any service handoff work.
     *
     * Calls are serialized to avoid interleaved foreground/service transitions
     * during restore and rapid user-triggered session switching.
     */
    private async _setActiveSession(sessionId: string | undefined): Promise<void> {
        await this._enqueueActiveSessionSwitch(() => this._setActiveSessionInternal(sessionId));
    }

    private async _setActiveSessionInternal(sessionId: string | undefined): Promise<void> {
        const oldSession = this.activeSession;
        const newSession = sessionId ? this._sessions.get(sessionId) : undefined;
        this._outputChannel.debug(
            `[SessionManager] Foreground switch start: ${oldSession?.sessionId ?? 'none'} -> ${newSession?.sessionId ?? 'none'}`
        );

        // Skip if no change
        if (this._activeSessionId === sessionId) {
            this._outputChannel.debug(
                `[SessionManager] Foreground switch skipped; ${sessionId ?? 'none'} already active`
            );
            return;
        }

        if (oldSession && oldSession.sessionId !== sessionId) {
            this._outputChannel.debug(`[SessionManager] Session ${oldSession.sessionId} moved to background`);
            oldSession.setForeground(false);
        }

        this._activeSessionId = sessionId;

        if (newSession) {
            this._outputChannel.debug(`[SessionManager] Session ${newSession.sessionId} is now foreground`);
            newSession.setForeground(true);
        }

        this._outputChannel.debug(
            `[SessionManager] Firing foreground change event for ${newSession?.sessionId ?? 'none'}`
        );
        this._onDidChangeForegroundSession.fire(newSession);
        this._onDidChangeActiveSession.fire(newSession);
        this._outputChannel.debug(
            `[SessionManager] Foreground change event completed for ${newSession?.sessionId ?? 'none'}`
        );
        this._outputChannel.debug(
            `[SessionManager] Foreground switch finished: ${oldSession?.sessionId ?? 'none'} -> ${newSession?.sessionId ?? 'none'}`
        );
    }

    private async _enqueueActiveSessionSwitch(task: () => Promise<void>): Promise<void> {
        const switchPromise = this._activeSessionSwitchChain
            .catch(() => undefined)
            .then(task);

        this._activeSessionSwitchChain = switchPromise;
        await switchPromise;
    }

    // =============================================
    // Session Persistence (Positron pattern)
    // =============================================

    /**
     * Gets the list of persisted sessions from workspace state.
     * Used to restore sessions after reload/restart.
     */
    private getPersistedSessions(): SerializedRuntimeSession[] {
        return this._context.workspaceState.get<SerializedRuntimeSession[]>(PERSISTED_SESSIONS_KEY)
            ?? [];
    }

    /**
     * Saves the current sessions to workspace state for later restoration.
     * Filters out sessions that are not in a restorable state.
     * @param removeSessionId Optional session ID to exclude from persistence (for removal)
     */
    private async saveWorkspaceSessions(removeSessionId?: string): Promise<void> {
        const nextPersistedSessions = new Map<string, SerializedRuntimeSession>();

        for (const persisted of this.getPersistedSessions()) {
            if (removeSessionId && persisted.sessionId === removeSessionId) {
                continue;
            }

            if (this._sessions.has(persisted.sessionId)) {
                continue;
            }

            // Preserve persisted sessions for languages that have not
            // registered a runtime provider in this extension host yet.
            if (!this._runtimeProviders.has(persisted.runtimeMetadata.languageId)) {
                nextPersistedSessions.set(persisted.sessionId, persisted);
            }
        }

        const activeSessions = Array.from(this._sessions.values())
            .filter(session => {
                // Skip the session being removed
                if (removeSessionId && session.sessionId === removeSessionId) {
                    return false;
                }
                // Only persist sessions in a saveable state
                const state = session.state;
                return state !== RuntimeState.Uninitialized &&
                    state !== RuntimeState.Exited &&
                    state !== RuntimeState.Initializing;
            })
            .map(session => ({
                sessionId: session.sessionId,
                sessionName: session.dynState.sessionName,
                runtimeMetadata: session.runtimeMetadata,
                sessionMetadata: session.sessionMetadata,
                sessionState: session.state,
                workingDirectory: session.workingDirectory,
                hasConsole: true,
                lastUsed: Date.now()
            }));

        for (const persisted of activeSessions) {
            nextPersistedSessions.set(persisted.sessionId, persisted);
        }

        const persistedSessions = Array.from(nextPersistedSessions.values());
        await this._logSlowOperation(
            `[SessionManager] workspaceState.update(persistedSessions=${persistedSessions.length})`,
            () => this._context.workspaceState.update(PERSISTED_SESSIONS_KEY, persistedSessions),
        );
        this._outputChannel.trace(`[SessionManager] Saved ${persistedSessions.length} session(s) for persistence`);
    }

    private async _logSlowOperation<T>(
        label: string,
        operation: () => PromiseLike<T>,
        warnAfterMs = 3000,
    ): Promise<T> {
        const started = Date.now();
        let warned = false;
        const timer = setTimeout(() => {
            warned = true;
            this._outputChannel.warn(`${label} is still pending after ${warnAfterMs}ms`);
        }, warnAfterMs);

        try {
            const result = await operation();
            const elapsed = Date.now() - started;
            this._outputChannel.debug(`${label} completed in ${elapsed}ms`);
            return result;
        } catch (error) {
            const elapsed = Date.now() - started;
            this._outputChannel.warn(`${label} failed after ${elapsed}ms: ${error}`);
            throw error;
        } finally {
            clearTimeout(timer);
            if (warned) {
                const elapsed = Date.now() - started;
                this._outputChannel.warn(`${label} eventually completed after ${elapsed}ms`);
            }
        }
    }

    private _withOperationTimeout<T>(
        operation: () => Promise<T>,
        timeoutMs: number,
        message: string,
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(message));
            }, timeoutMs);

            void operation().then(
                (value) => {
                    clearTimeout(timeout);
                    resolve(value);
                },
                (error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
            );
        });
    }

    /**
     * Registers a state change listener for a session.
     * Used to reactivate services when a restored session becomes Ready.
     */
    private registerSessionStateListener(session: RuntimeSession): void {
        const sessionId = session.sessionId;
        this._disposeSessionLifecycleDisposables(sessionId);
        this._sessionRuntimeStates.set(sessionId, session.state);

        const sessionDisposables: vscode.Disposable[] = [];

        sessionDisposables.push(session.onDidChangeRuntimeState(async (state) => {
            await this.didChangeSessionRuntimeState(session, state);
        }));

        sessionDisposables.push(session.onDidChangeWorkingDirectory(async () => {
            await this.saveWorkspaceSessions();
        }));

        this._registerSessionRuntimeEventListener(session, sessionDisposables);
        this._sessionLifecycleDisposables.set(sessionId, sessionDisposables);
    }

    /**
     * Registers runtime UI event forwarding for a session.
     */
    private _registerSessionRuntimeEventListener(
        session: RuntimeSession,
        sessionDisposables: vscode.Disposable[]
    ): void {
        const tryAttach = (manager?: RuntimeClientManager, reason?: string) => {
            if (!manager) {
                return;
            }
            this._attachRuntimeClientManager(session, manager, reason ?? 'unknown');
        };

        tryAttach(session.clientManager, 'initial');

        sessionDisposables.push(session.onDidCreateClientManager((manager) => {
            tryAttach(manager, 'clientManagerCreated');
        }));
    }

    /**
     * Attaches runtime UI client event forwarding to a client manager.
     */
    private _attachRuntimeClientManager(
        session: RuntimeSession,
        manager: RuntimeClientManager,
        reason: string
    ): void {
        const sessionId = session.sessionId;
        if (this._runtimeEventManagerDisposables.has(sessionId)) {
            return;
        }

        this._outputChannel.debug(
            `[SessionManager] Registering runtime UI forwarding for ${sessionId} (${reason})`
        );

        const disposables: vscode.Disposable[] = [];
        disposables.push(
            manager.watchClient(RuntimeClientType.Ui, (client) => {
                this._attachUiClientInstance(session, client);
            })
        );

        this._runtimeEventManagerDisposables.set(sessionId, disposables);

    }

    /**
     * Attaches a UiClientInstance and forwards all UiFrontendEvents.
     */
    private _attachUiClientInstance(session: RuntimeSession, client: RuntimeClientInstance): void {
        const sessionId = session.sessionId;

        this._disposeRuntimeEventUiClient(sessionId);

        const uiClient = new UiClientInstance(client);
        const disposables: vscode.Disposable[] = [uiClient];

        const emitRuntimeEvent = (name: UiFrontendEvent, data: unknown) => {
            this._dispatchRuntimeFrontendEvent(name, data);
            this._onDidReceiveRuntimeEvent.fire({
                session_id: sessionId,
                event: {
                    name,
                    data,
                },
            });
        };

        disposables.push(
            uiClient.onDidBusy((event: BusyEvent) => {
                const normalizedBusyEvent = this._applyBusyState(session, event);
                emitRuntimeEvent(UiFrontendEvent.Busy, normalizedBusyEvent);
            }),
            uiClient.onDidClearConsole((event: ClearConsoleEvent) => {
                emitRuntimeEvent(UiFrontendEvent.ClearConsole, event);
            }),
            uiClient.onDidOpenEditor((event: OpenEditorEvent) => {
                emitRuntimeEvent(UiFrontendEvent.OpenEditor, event);
            }),
            uiClient.onDidShowMessage((event: ShowMessageEvent) => {
                emitRuntimeEvent(UiFrontendEvent.ShowMessage, event);
            }),
            uiClient.onDidPromptState((event: PromptStateEvent) => {
                const normalizedPromptState = this._applyPromptState(session, event);
                emitRuntimeEvent(UiFrontendEvent.PromptState, normalizedPromptState);
            }),
            uiClient.onDidWorkingDirectory((event: WorkingDirectoryEvent) => {
                const normalizedWorkingDirectory = this._applyWorkingDirectoryState(session, event);
                emitRuntimeEvent(UiFrontendEvent.WorkingDirectory, normalizedWorkingDirectory);
            }),
            uiClient.onDidOpenWorkspace((event: OpenWorkspaceEvent) => {
                emitRuntimeEvent(UiFrontendEvent.OpenWorkspace, event);
            }),
            uiClient.onDidSetEditorSelections((event: SetEditorSelectionsEvent) => {
                emitRuntimeEvent(UiFrontendEvent.SetEditorSelections, event);
            }),
            uiClient.onDidShowUrl((event: ShowUrlEvent) => {
                emitRuntimeEvent(UiFrontendEvent.ShowUrl, event);
            }),
            uiClient.onDidShowHtmlFile((event: ShowHtmlFileEvent) => {
                emitRuntimeEvent(UiFrontendEvent.ShowHtmlFile, event);
            }),
            uiClient.onDidOpenWithSystem((event: OpenWithSystemEvent) => {
                emitRuntimeEvent(UiFrontendEvent.OpenWithSystem, event);
            }),
            uiClient.onDidClearWebviewPreloads((event: ClearWebviewPreloadsEvent) => {
                emitRuntimeEvent(UiFrontendEvent.ClearWebviewPreloads, event);
            })
        );

        this._runtimeEventUiDisposables.set(sessionId, disposables);
    }

    /**
     * Applies prompt_state updates to session dynState with partial update support.
     */
    private _applyPromptState(
        session: RuntimeSession,
        event: Partial<PromptStateEvent>
    ): PromptStateEvent {
        let inputPrompt = session.dynState.inputPrompt;
        let continuationPrompt = session.dynState.continuationPrompt;

        if (typeof event.input_prompt === 'string') {
            inputPrompt = event.input_prompt.trimEnd();
            session.dynState.inputPrompt = inputPrompt;
        }

        if (typeof event.continuation_prompt === 'string') {
            continuationPrompt = event.continuation_prompt.trimEnd();
            session.dynState.continuationPrompt = continuationPrompt;
        }

        return {
            input_prompt: inputPrompt,
            continuation_prompt: continuationPrompt,
        };
    }

    /**
     * Normalizes a busy event and persists it to session dynState.
     */
    private _applyBusyState(session: RuntimeSession, event: Partial<BusyEvent>): BusyEvent {
        const busy = !!event.busy;
        session.dynState.busy = busy;
        return { busy };
    }

    /**
     * Normalizes a working_directory event and persists it to session dynState.
     */
    private _applyWorkingDirectoryState(
        session: RuntimeSession,
        event: Partial<WorkingDirectoryEvent>
    ): WorkingDirectoryEvent {
        const directory = typeof event.directory === 'string'
            ? event.directory
            : (session.workingDirectory ?? session.dynState.currentWorkingDirectory ?? '');

        if (directory.length > 0) {
            session.updateWorkingDirectory(directory);
        }

        return { directory };
    }

    /**
     * Dispatches runtime frontend events that should be handled at extension level.
     */
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
                if (typeof event.path !== 'string' || event.path.length === 0) {
                    break;
                }

                const workspaceUri = vscode.Uri.file(event.path);
                void vscode.commands.executeCommand(
                    'vscode.openFolder',
                    workspaceUri,
                    !!event.new_window
                );
                break;
            }

            case UiFrontendEvent.OpenEditor: {
                const event = data as Partial<OpenEditorEvent>;
                void this._openRuntimeEditor(event);
                break;
            }

            case UiFrontendEvent.SetEditorSelections: {
                const event = data as Partial<SetEditorSelectionsEvent>;
                this._setActiveEditorSelections(event);
                break;
            }

            case UiFrontendEvent.OpenWithSystem: {
                const event = data as Partial<OpenWithSystemEvent>;
                if (typeof event.path !== 'string' || event.path.length === 0) {
                    break;
                }

                void vscode.env.openExternal(vscode.Uri.file(event.path));
                break;
            }
        }
    }

    /**
     * Opens an editor from a runtime UI event.
     */
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

    /**
     * Applies runtime-provided selections to the active editor.
     */
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

            const start = new vscode.Position(
                Math.max(Math.trunc(selection.start.line), 0),
                Math.max(Math.trunc(selection.start.character), 0)
            );
            const end = new vscode.Position(
                Math.max(Math.trunc(selection.end.line), 0),
                Math.max(Math.trunc(selection.end.character), 0)
            );
            selections.push(new vscode.Selection(start, end));
        }

        if (selections.length > 0) {
            activeEditor.selections = selections;
            activeEditor.revealRange(selections[0]);
        }
    }

    private _disposeSessionLifecycleDisposables(sessionId: string): void {
        const sessionDisposables = this._sessionLifecycleDisposables.get(sessionId);
        if (sessionDisposables) {
            sessionDisposables.forEach((disposable) => disposable.dispose());
            this._sessionLifecycleDisposables.delete(sessionId);
        }
    }

    /**
     * Disposes runtime event forwarding resources for one session.
     */
    private _disposeRuntimeEventSession(sessionId: string): void {
        this._disposeSessionLifecycleDisposables(sessionId);
        this._sessionRuntimeStates.delete(sessionId);

        const managerDisposables = this._runtimeEventManagerDisposables.get(sessionId);
        if (managerDisposables) {
            managerDisposables.forEach((disposable) => disposable.dispose());
            this._runtimeEventManagerDisposables.delete(sessionId);
        }

        this._disposeRuntimeEventUiClient(sessionId);
    }

    /**
     * Disposes runtime UI client event resources for one session.
     */
    private _disposeRuntimeEventUiClient(sessionId: string): void {
        const uiDisposables = this._runtimeEventUiDisposables.get(sessionId);
        if (uiDisposables) {
            uiDisposables.forEach((disposable) => disposable.dispose());
            this._runtimeEventUiDisposables.delete(sessionId);
        }
    }

    /**
     * Handles session runtime state changes.
     * Reactivates services when a restored foreground session becomes Ready.
     */
    private async didChangeSessionRuntimeState(
        session: RuntimeSession,
        state: RuntimeState
    ): Promise<void> {
        const previousState =
            this._sessionRuntimeStates.get(session.sessionId) ?? RuntimeState.Uninitialized;
        this._sessionRuntimeStates.set(session.sessionId, state);
        this._onDidChangeSessionState.fire({
            sessionId: session.sessionId,
            state,
        });

        // Match Positron's restart flow: when the same session comes back from
        // Exited to Starting during a restart, fire onWillStartSession again so
        // console/runtime services can reattach after the temporary detach.
        if (state === RuntimeState.Starting && previousState === RuntimeState.Exited) {
            this._outputChannel.debug(
                `[SessionManager] Session ${session.sessionId} re-entered Starting from Exited; reattaching restart listeners`
            );
            this._onWillStartSession.fire({
                session,
                startMode: RuntimeStartMode.Restarting,
                activate: false,
            });
        }
        // Update saved sessions on state change (for state tracking)
        if (state === RuntimeState.Exited) {
            await this.saveWorkspaceSessions(session.sessionId);
        }
    }

    /**
     * Restores persisted sessions from workspace state.
     * Called during initialization to reconnect to sessions that survived reload/restart.
     */
    private async restorePersistedSessions(): Promise<void> {
        const persistedSessions = this.getPersistedSessions();

        if (persistedSessions.length === 0) {
            this._outputChannel.debug('[SessionManager] No persisted sessions to restore');
            return;
        }

        this._outputChannel.info(`[SessionManager] Found ${persistedSessions.length} persisted session(s) to restore`);
        this._isRestoringPersistedSessions = true;
        try {
            const supervisor = this._localSupervisor;
            if (!supervisor) {
                this._outputChannel.warn('[SessionManager] Cannot restore sessions: supervisor not initialized');
                return;
            }

            for (const persisted of persistedSessions) {
                let session: RuntimeSession | undefined;
                try {
                    this._outputChannel.debug(`[SessionManager] Restoring session ${persisted.sessionId} (${persisted.sessionName})`);
                    persisted.runtimeMetadata = this._applyRuntimeMetadataDefaults(persisted.runtimeMetadata);
                    const provider = this.getRuntimeProvider(persisted.runtimeMetadata.languageId);
                    if (!provider) {
                        this._outputChannel.debug(
                            `[SessionManager] Deferring restore for ${persisted.sessionId}: language support for ` +
                            `${persisted.runtimeMetadata.languageId} is not registered yet`
                        );
                        continue;
                    }

                    if (provider.validateMetadata) {
                        persisted.runtimeMetadata = this._applyRuntimeMetadataDefaults(
                            await this._withOperationTimeout(
                                () => provider.validateMetadata!(persisted.runtimeMetadata),
                                PERSISTED_SESSION_RESTORE_TIMEOUT_MS,
                                `Timed out validating persisted runtime metadata ${persisted.runtimeMetadata.runtimeId}`,
                            )
                        );
                    }

                    const validateSession = provider.validateSession
                        ? () => provider.validateSession!(persisted.sessionId)
                        : () => supervisor.validateSession(persisted.sessionId);

                    const isValid = await this._withOperationTimeout(
                        validateSession,
                        PERSISTED_SESSION_RESTORE_TIMEOUT_MS,
                        `Timed out validating persisted session ${persisted.sessionId}`,
                    );

                    if (!isValid) {
                        this._outputChannel.debug(`[SessionManager] Session ${persisted.sessionId} is no longer valid, skipping`);
                        continue;
                    }

                    // Create session wrapper
                    session = new RuntimeSession(
                        persisted.sessionId,
                        persisted.runtimeMetadata,
                        persisted.sessionMetadata,
                        this._outputChannel,
                        persisted.sessionName,
                        provider?.lspFactory
                    );

                    // Restore the session via supervisor
                    const restoredKernel = await this._withOperationTimeout(
                        () => supervisor.restoreSession(
                            persisted.runtimeMetadata,
                            persisted.sessionMetadata,
                            {
                                sessionName: persisted.sessionName,
                                inputPrompt: '>',
                                continuationPrompt: '+',
                                busy: false,
                                currentWorkingDirectory: persisted.workingDirectory,
                            }
                        ),
                        PERSISTED_SESSION_RESTORE_TIMEOUT_MS,
                        `Timed out attaching to persisted session ${persisted.sessionId}`,
                    );

                    // Attach the restored kernel
                    session.attachKernel(restoredKernel);

                    if (persisted.workingDirectory) {
                        session.updateWorkingDirectory(persisted.workingDirectory);
                    }

                    // Register with session manager
                    this._sessions.set(persisted.sessionId, session);
                    this._restoredSessionIds.add(persisted.sessionId);

                    // Register state listener for service reactivation.
                    this.registerSessionStateListener(session);
                    this._onDidCreateSession.fire(session);

                    // Fire onWillStartSession with Reconnecting mode.
                    // Fired after restoreSession succeeds to avoid creating orphan console instances.
                    this._onWillStartSession.fire({
                        session,
                        startMode: RuntimeStartMode.Reconnecting,
                        activate: false
                    });

                    // Reconnect to the restored session (Positron pattern)
                    try {
                        const restoringSession = session;
                        this._outputChannel.debug(`[SessionManager] Reconnecting to session ${persisted.sessionId}...`);
                        await this._withOperationTimeout(
                            () => restoringSession.start(),
                            PERSISTED_SESSION_RESTORE_TIMEOUT_MS,
                            `Timed out reconnecting persisted session ${persisted.sessionId}`,
                        );
                        this._outputChannel.info(`[SessionManager] Session ${persisted.sessionId} restored successfully`);
                    } catch (err) {
                        this._outputChannel.error(`[SessionManager] Failed to reconnect session ${persisted.sessionId}: ${err}`);
                        await this._cleanupFailedRestoredSession(session);
                        continue;
                    }

                } catch (err) {
                    this._outputChannel.error(`[SessionManager] Failed to restore session ${persisted.sessionId}: ${err}`);
                    if (session) {
                        if (this._sessions.has(session.sessionId)) {
                            await this._cleanupFailedRestoredSession(session);
                        } else {
                            try {
                                await session.dispose();
                            } catch (disposeError) {
                                this._outputChannel.warn(`[SessionManager] Failed to dispose incomplete restored session ${persisted.sessionId}: ${disposeError}`);
                            }
                        }
                    }
                }
            }

            // Restore foreground focus to the first available session. Language-specific
            // foreground ownership is handled in the language extension layer.
            if (this._sessions.size > 0) {
                // Activate the first available session
                const firstSessionId = Array.from(this._sessions.keys())[0];
                await this._setActiveSession(firstSessionId);
            }

            // Update saved sessions after restoration
            await this.saveWorkspaceSessions();
        } finally {
            this._isRestoringPersistedSessions = false;
        }
    }

    private async _cleanupFailedRestoredSession(session: RuntimeSession): Promise<void> {
        const sessionId = session.sessionId;

        this._disposeRuntimeEventSession(sessionId);
        const removed = this._sessions.delete(sessionId);
        this._restoredSessionIds.delete(sessionId);

        if (this._activeSessionId === sessionId) {
            this._activeSessionId = undefined;
        }

        if (removed) {
            this._onDidDeleteSession.fire(sessionId);
        }

        try {
            await session.dispose();
        } catch (error) {
            this._outputChannel.warn(`[SessionManager] Failed to dispose restored session ${sessionId}: ${error}`);
        }
    }

    async shutdown(): Promise<void> {
        if (this._shutdownPromise) {
            return this._shutdownPromise;
        }

        this._shutdownPromise = (async () => {
            const sessions = Array.from(this._sessions.entries());
            this._sessions.clear();
            this._restoredSessionIds.clear();

            for (const [sessionId, session] of sessions) {
                this._disposeRuntimeEventSession(sessionId);
                try {
                    await session.dispose();
                } catch (error) {
                    this._outputChannel.warn(`[SessionManager] Error disposing session ${sessionId}: ${error}`);
                }
            }

            this._activeSessionId = undefined;
            this._localSupervisor?.dispose();
            this._localSupervisor = undefined;
            this._disposables.forEach(d => d.dispose());
        })();

        return this._shutdownPromise;
    }

    dispose(): void {
        void this.shutdown();
    }
}
