import * as fs from 'fs';
import * as vscode from 'vscode';
import {
    type IRuntimeManager,
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
const DISMISSED_ARCHITECTURE_MISMATCH_KEY_PREFIX = 'vscode-supervisor.dismissedArchMismatch.v1';

interface IAffiliatedRuntimeMetadata {
    metadata: LanguageRuntimeMetadata;
    lastUsed: number;
    lastStarted: number;
}

interface INewFolderInitTaskRegistration {
    readonly id: number;
    readonly label: string;
    readonly task: () => Promise<void>;
    readonly affiliatedRuntimeMetadata?: LanguageRuntimeMetadata;
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
    NewFolderTasks = 'newFolderTasks',
    Discovering = 'discovering',
    Complete = 'complete',
}

export interface IRuntimeAutoStartEvent {
    runtime: LanguageRuntimeMetadata;
    newSession: boolean;
    activate: boolean;
}

/**
 * Positron-aligned runtime startup service.
 * Owns persisted session restore/save and runtime auto-start orchestration.
 */
export class RuntimeStartupService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _sessionLifecycleDisposables = new Map<string, vscode.Disposable[]>();
    private readonly _runtimeManagerDisposablesById = new Map<number, vscode.Disposable[]>();
    private readonly _mostRecentlyStartedRuntimesByLanguageId = new Map<string, LanguageRuntimeMetadata>();
    private readonly _runtimeManagers: IRuntimeManager[] = [];
    private readonly _discoveryCompleteByExtHostId = new Map<number, boolean>();
    private readonly _newFolderInitTaskRegistrations = new Map<number, INewFolderInitTaskRegistration>();
    private readonly _newFolderInitTaskPromises = new Map<number, Promise<void>>();

    private readonly _onDidChangeRuntimeStartupPhase = new vscode.EventEmitter<RuntimeStartupPhase>();
    readonly onDidChangeRuntimeStartupPhase = this._onDidChangeRuntimeStartupPhase.event;

    private readonly _onWillAutoStartRuntime = new vscode.EventEmitter<IRuntimeAutoStartEvent>();
    readonly onWillAutoStartRuntime = this._onWillAutoStartRuntime.event;

    private readonly _onSessionRestoreFailure = new vscode.EventEmitter<ISessionRestoreFailedEvent>();
    readonly onSessionRestoreFailure = this._onSessionRestoreFailure.event;

    private readonly _localWindowId = `window-${Math.random().toString(16).slice(2, 10)}`;
    private readonly _shownArchitectureMismatchWarnings = new Set<string>();

    private _startupPhase = RuntimeStartupPhase.Initializing;
    private _startupPromise: Promise<void> | undefined;
    private _restoredSessions: SerializedSessionMetadata[] = [];
    private readonly _restoredSessionsLoadedPromise: Promise<void>;
    private _resolveRestoredSessionsLoaded!: () => void;
    private _nextNewFolderInitTaskId = 1;
    private _hasStartedNewFolderInitTasks = false;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _runtimeManager: RuntimeManager,
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _outputChannel: vscode.LogOutputChannel,
    ) {
        this._restoredSessionsLoadedPromise = new Promise<void>((resolve) => {
            this._resolveRestoredSessionsLoaded = resolve;
        });

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
                void this._warnAboutArchitectureMismatch(session);
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

        this._sessionManager.registerPersistedSessionRestoreHandler(() => {
            return this._restorePersistedSessionsInBackground();
        });
        void this._loadRestoredSessions();
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

    resetArchitectureMismatchWarning(languageId?: string): void {
        if (languageId) {
            this._shownArchitectureMismatchWarnings.delete(languageId);
            void this._context.globalState.update(
                this._architectureMismatchStorageKey(languageId),
                undefined,
            );
            return;
        }

        this._shownArchitectureMismatchWarnings.clear();
        for (const key of this._context.globalState.keys()) {
            if (key.startsWith(`${DISMISSED_ARCHITECTURE_MISMATCH_KEY_PREFIX}.`)) {
                void this._context.globalState.update(key, undefined);
            }
        }
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

    registerNewFolderInitTask(
        task: Promise<void> | (() => Promise<void>),
        options?: {
            label?: string;
            affiliatedRuntimeMetadata?: LanguageRuntimeMetadata;
        },
    ): vscode.Disposable {
        const id = this._nextNewFolderInitTaskId++;
        const registration: INewFolderInitTaskRegistration = {
            id,
            label: options?.label ?? `task-${id}`,
            task: typeof task === 'function'
                ? task
                : () => task,
            affiliatedRuntimeMetadata: options?.affiliatedRuntimeMetadata,
        };

        this._newFolderInitTaskRegistrations.set(registration.id, registration);

        if (this._hasStartedNewFolderInitTasks) {
            this._startRegisteredNewFolderInitTask(registration);
        }

        return new vscode.Disposable(() => {
            this._newFolderInitTaskRegistrations.delete(registration.id);
        });
    }

    async getRestoredSessions(): Promise<SerializedSessionMetadata[]> {
        await this._restoredSessionsLoadedPromise;
        return [...this._restoredSessions];
    }

    completeDiscovery(id: number): void {
        if (!this._discoveryCompleteByExtHostId.has(id)) {
            return;
        }

        this._discoveryCompleteByExtHostId.set(id, true);
        const discoveryComplete = Array.from(this._discoveryCompleteByExtHostId.values())
            .every((completed) => completed);

        if (discoveryComplete) {
            this._setStartupPhase(RuntimeStartupPhase.Complete);
            this._sessionManager.implicitStartupSuppressed = false;
            this._resetDiscoveryCompletionState();
        }
    }

    registerRuntimeManager(manager: IRuntimeManager): vscode.Disposable {
        this._runtimeManagers.push(manager);
        this._discoveryCompleteByExtHostId.set(manager.id, false);
        const runtimeManagerDisposables: vscode.Disposable[] = [];

        if (manager.onDidFinishDiscovery) {
            runtimeManagerDisposables.push(
                manager.onDidFinishDiscovery(() => {
                    this.completeDiscovery(manager.id);
                }),
            );
        }

        if (manager.onDidDiscoverRuntime) {
            runtimeManagerDisposables.push(
                manager.onDidDiscoverRuntime(({ metadata }) => {
                    if (this._startupPhase !== RuntimeStartupPhase.Complete) {
                        return;
                    }

                    void this._autoStartDiscoveredRuntime(metadata);
                }),
            );
        }

        this._runtimeManagerDisposablesById.set(manager.id, runtimeManagerDisposables);

        return new vscode.Disposable(() => {
            const index = this._runtimeManagers.indexOf(manager);
            if (index >= 0) {
                this._runtimeManagers.splice(index, 1);
            }
            for (const disposable of this._runtimeManagerDisposablesById.get(manager.id) ?? []) {
                disposable.dispose();
            }
            this._runtimeManagerDisposablesById.delete(manager.id);
            this._discoveryCompleteByExtHostId.delete(manager.id);
        });
    }

    async rediscoverAllRuntimes(): Promise<void> {
        this._resetDiscoveryCompletionState();
        this._setStartupPhase(RuntimeStartupPhase.Discovering);
        await this._discoverAllRuntimes();
        await this._autoStartAfterDiscovery();
    }

    private async _startupSequence(): Promise<void> {
        this._sessionManager.implicitStartupSuppressed = true;
        this._sessionManager.updateActiveLanguages();
        await this._awaitWorkspaceTrust();

        await this._sessionManager.restorePersistedSessionsInBackground();

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

        await this._runNewFolderTasks();

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

        this._resetDiscoveryCompletionState();
        this._setStartupPhase(RuntimeStartupPhase.Discovering);
        await this._discoverAllRuntimes();
        await this._autoStartAfterDiscovery();
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

    private async _loadRestoredSessions(): Promise<void> {
        try {
            this._restoredSessions = await this._readStoredSessions();
        } finally {
            this._resolveRestoredSessionsLoaded();
        }
    }

    private async _restorePersistedSessionsInBackground(): Promise<void> {
        this._restoredSessions = await this.getRestoredSessions();
        if (this._restoredSessions.length === 0) {
            return;
        }

        this._setStartupPhase(RuntimeStartupPhase.Reconnecting);
        await this._restoreSessions(this._restoredSessions);
    }

    private async _runNewFolderTasks(): Promise<void> {
        this._hasStartedNewFolderInitTasks = true;
        if (this._newFolderInitTaskRegistrations.size === 0) {
            this._sessionManager.updateActiveLanguages();
            return;
        }

        this._setStartupPhase(RuntimeStartupPhase.NewFolderTasks);
        for (const registration of this._newFolderInitTaskRegistrations.values()) {
            this._startRegisteredNewFolderInitTask(registration);
        }
        await this._waitForRegisteredNewFolderInitTasks();
        this._sessionManager.updateActiveLanguages();
    }

    private _startRegisteredNewFolderInitTask(
        registration: INewFolderInitTaskRegistration,
    ): void {
        if (this._newFolderInitTaskPromises.has(registration.id)) {
            return;
        }

        const taskPromise = this._runRegisteredNewFolderInitTask(registration)
            .finally(() => {
                this._newFolderInitTaskPromises.delete(registration.id);
            });
        this._newFolderInitTaskPromises.set(registration.id, taskPromise);
    }

    private async _waitForRegisteredNewFolderInitTasks(): Promise<void> {
        while (this._newFolderInitTaskPromises.size > 0) {
            await Promise.allSettled(Array.from(this._newFolderInitTaskPromises.values()));
        }
    }

    private async _runRegisteredNewFolderInitTask(
        registration: INewFolderInitTaskRegistration,
    ): Promise<void> {
        this._outputChannel.debug(`[RuntimeStartup] Running new-folder init task '${registration.label}'`);
        try {
            await registration.task();
            if (registration.affiliatedRuntimeMetadata) {
                await this._saveRuntimeAffiliation(registration.affiliatedRuntimeMetadata);
            }
        } catch (error) {
            this._outputChannel.error(
                `[RuntimeStartup] New-folder init task '${registration.label}' failed: ${error}`,
            );
        } finally {
            this._newFolderInitTaskRegistrations.delete(registration.id);
        }
    }

    private _architectureMismatchStorageKey(languageId: string): string {
        return `${DISMISSED_ARCHITECTURE_MISMATCH_KEY_PREFIX}.${languageId}`;
    }

    private _normalizeArchitecture(value: unknown): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }

        switch (value.toLowerCase()) {
            case 'x64':
            case 'amd64':
            case 'x86_64':
                return 'x64';
            case 'arm64':
            case 'aarch64':
                return 'arm64';
            case 'ia32':
            case 'x86':
                return 'ia32';
            default:
                return value.toLowerCase();
        }
    }

    private async _warnAboutArchitectureMismatch(session: RuntimeSession): Promise<void> {
        const languageId = session.runtimeMetadata.languageId;
        if (this._shownArchitectureMismatchWarnings.has(languageId)) {
            return;
        }

        const dismissed = this._context.globalState.get<boolean>(
            this._architectureMismatchStorageKey(languageId),
            false,
        );
        if (dismissed) {
            return;
        }

        const interpreterArch = this._normalizeArchitecture(
            (session.runtimeMetadata.extraRuntimeData as { arch?: unknown } | undefined)?.arch,
        );
        const systemArch = this._normalizeArchitecture(process.arch);
        if (!interpreterArch || !systemArch || interpreterArch === systemArch) {
            return;
        }

        this._shownArchitectureMismatchWarnings.add(languageId);
        const languageDisplayName = languageId === 'r'
            ? 'R'
            : languageId.charAt(0).toUpperCase() + languageId.slice(1);
        const dismissAction = `Don't show again for ${languageDisplayName}`;
        const selection = await vscode.window.showWarningMessage(
            `The interpreter "${session.runtimeMetadata.runtimeName}" has architecture ` +
            `"${interpreterArch}" but this system is "${systemArch}". This can cause performance ` +
            `or package compatibility problems.`,
            dismissAction,
        );
        if (selection === dismissAction) {
            await this._context.globalState.update(
                this._architectureMismatchStorageKey(languageId),
                true,
            );
        }
    }

    private _resetDiscoveryCompletionState(): void {
        for (const manager of this._runtimeManagers) {
            this._discoveryCompleteByExtHostId.set(manager.id, false);
        }
    }

    private async _discoverAllRuntimes(): Promise<void> {
        if (this._runtimeManagers.length === 0) {
            this._sessionManager.implicitStartupSuppressed = false;
            this._setStartupPhase(RuntimeStartupPhase.Complete);
            return;
        }

        await Promise.all(this._runtimeManagers.map(async (manager) => {
            try {
                await manager.discoverAllRuntimes(this._getDisabledLanguageIds());
            } finally {
                if (!manager.onDidFinishDiscovery) {
                    this.completeDiscovery(manager.id);
                }
            }
        }));
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

    private _getDisabledLanguageIds(): string[] {
        return this._runtimeManager.getSupportedLanguageIds().filter(
            (languageId) => this._getStartupBehavior(languageId) === LanguageStartupBehavior.Disabled,
        );
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
                createdTimestamp: typeof metadata.createdTimestamp === 'number'
                    ? metadata.createdTimestamp
                    : Date.now(),
                startReason: typeof metadata.startReason === 'string'
                    ? metadata.startReason
                    : 'restoreRuntimeSession',
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
        const recommendedRuntimes = await this._getRecommendedRuntimes(this._getDisabledLanguageIds());
        for (const recommendedRuntime of recommendedRuntimes) {
            const startupBehavior = this._getStartupBehavior(recommendedRuntime.languageId);
            if (startupBehavior === LanguageStartupBehavior.Disabled ||
                startupBehavior === LanguageStartupBehavior.Manual) {
                continue;
            }

            await this._autoStartRuntime(
                recommendedRuntime,
                'Recommended runtime for workspace',
                true,
            );
            return;
        }
    }

    private async _autoStartAfterDiscovery(): Promise<void> {
        if (this._runtimeManager.runtimes.length === 0) {
            void vscode.window.showWarningMessage(
                'No interpreters found. Configure a runtime path or install a supported runtime.',
            );
            return;
        }

        if (!this._sessionManager.hasStartingOrRunningConsole()) {
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

        await this._startEncounteredLanguageRuntime();
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
        if (provider) {
            const installation = provider.restoreInstallationFromMetadata?.(metadata);
            if (installation) {
                const runtimePath = provider.getRuntimePath(installation);
                if (!fs.existsSync(runtimePath)) {
                    this._outputChannel.warn(
                        `[RuntimeStartup] Affiliated runtime binary does not exist: ${runtimePath}. Clearing stale affiliation.`,
                    );
                    this.clearAffiliatedRuntime(metadata.languageId);
                    return;
                }
            }
        }

        this._outputChannel.info(
            `[RuntimeStartup] Automatically starting ${metadata.runtimeName}. Source: ${source}`,
        );

        this._fireRuntimeStartupEvent({
            runtime: metadata,
            newSession: true,
            activate,
        });

        await this._sessionManager.autoStartRuntime(metadata, source, activate);
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

        const metadata = provider.createRuntimeMetadata(
            this._context,
            installation,
            this._outputChannel,
        );

        await this._autoStartRuntime(
            {
                ...metadata,
                runtimeName: sessionName || metadata.runtimeName,
            },
            source,
            activate,
        );
    }

    private _createRuntimeStartupEventForSession(
        session: RuntimeSession,
        newSession: boolean,
    ): IRuntimeAutoStartEvent {
        return {
            runtime: {
                ...session.runtimeMetadata,
                runtimeName:
                    session.dynState.sessionName ||
                    session.sessionMetadata.sessionName ||
                    session.runtimeMetadata.runtimeName,
            },
            newSession,
            activate: session.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console,
        };
    }

    private _createRuntimeStartupEventFromSerializedSession(
        session: SerializedSessionMetadata,
        newSession: boolean,
    ): IRuntimeAutoStartEvent {
        return {
            runtime: {
                ...session.runtimeMetadata,
                runtimeName: session.sessionName || session.metadata.sessionName || session.runtimeMetadata.runtimeName,
            },
            newSession,
            activate: session.metadata.sessionMode === LanguageRuntimeSessionMode.Console,
        };
    }

    private _fireRuntimeStartupEvent(event: IRuntimeAutoStartEvent): void {
        this._onWillAutoStartRuntime.fire(event);
    }

    private async _getRecommendedRuntimes(disabledLanguageIds: string[]): Promise<LanguageRuntimeMetadata[]> {
        const metadata = await Promise.all(
            this._runtimeManagers.map((manager) => manager.recommendWorkspaceRuntimes(disabledLanguageIds)),
        );
        return metadata.flat();
    }

    private async _startEncounteredLanguageRuntime(): Promise<void> {
        if (this._sessionManager.implicitStartupSuppressed) {
            return;
        }

        for (const languageId of this._sessionManager.encounteredLanguages) {
            if (this._sessionManager.hasStartingOrRunningConsole(languageId) ||
                this.getAffiliatedRuntimeMetadata(languageId)) {
                continue;
            }

            const runtime = this._runtimeManager.runtimes.find((metadata) =>
                metadata.languageId === languageId &&
                metadata.startupBehavior === LanguageRuntimeStartupBehavior.Implicit,
            );
            if (!runtime) {
                continue;
            }

            try {
                await this._autoStartRuntime(
                    runtime,
                    `A file with the language ID ${languageId} was open when runtime discovery completed.`,
                    true,
                );
            } catch (error) {
                this._outputChannel.warn(
                    `[RuntimeStartup] Failed to auto-start implicit runtime ${runtime.runtimeName}: ${error}`,
                );
            }
            return;
        }
    }

    private async _autoStartDiscoveredRuntime(metadata: LanguageRuntimeMetadata): Promise<void> {
        if (metadata.startupBehavior === LanguageRuntimeStartupBehavior.Immediate &&
            !this._sessionManager.hasStartingOrRunningConsole()) {
            await this._autoStartRuntime(
                metadata,
                'A runtime requested immediate startup after being discovered.',
                true,
            );
            return;
        }

        if (metadata.startupBehavior === LanguageRuntimeStartupBehavior.Implicit &&
            this._sessionManager.hasEncounteredLanguage(metadata.languageId) &&
            !this._sessionManager.hasStartingOrRunningConsole(metadata.languageId) &&
            !this.getAffiliatedRuntimeMetadata(metadata.languageId) &&
            !this._sessionManager.implicitStartupSuppressed) {
            await this._autoStartRuntime(
                metadata,
                `A file with the language ID ${metadata.languageId} was already open when the runtime was discovered.`,
                true,
            );
        }
    }

    dispose(): void {
        for (const disposables of this._runtimeManagerDisposablesById.values()) {
            for (const disposable of disposables) {
                disposable.dispose();
            }
        }
        this._runtimeManagerDisposablesById.clear();

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
