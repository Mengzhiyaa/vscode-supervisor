/*---------------------------------------------------------------------------------------------
 *  PositronConsoleService Implementation
 *  1:1 replication of Positron's console service class
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ViewCommands, ViewIds } from '../../coreCommandIds';
import {
    IPositronConsoleService,
    IPositronConsoleInstance,
    SessionAttachMode,
    IConsoleCodeAttribution,
    ILanguageRuntimeCodeExecutedEvent,
    ILanguageRuntimeInputStateChangedEvent,
    RuntimeCodeExecutionMode,
    RuntimeErrorBehavior,
} from './interfaces/consoleService';
import { PositronConsoleInstance, SerializedConsoleState } from './consoleInstance';
import { ConsoleStateStore } from './consoleStateStore';
import { RuntimeSessionService } from '../../runtime/runtimeSession';
import { RuntimeSession } from '../../runtime/session';
import { RuntimeStartMode } from '../../internal/runtimeTypes';
import { RuntimeStartupService } from '../../runtime/runtimeStartup';
import { SerializedSessionMetadata } from '../../runtime/runtimeSessionService';
import {
    PromptStateEvent,
    UiFrontendEvent,
    WorkingDirectoryEvent,
} from '../../runtime/comms/positronUiComm';
import { LanguageRuntimeSessionMode } from '../../api';


/**
 * PositronConsoleService class (1:1 Positron).
 * Manages all console instances across sessions.
 */
export class PositronConsoleService implements IPositronConsoleService {
    //#region Private Properties
    private readonly _consoleInstancesBySessionId = new Map<string, PositronConsoleInstance>();
    private _activeConsoleInstance: PositronConsoleInstance | undefined;
    private _consoleWidth = 80;
    private _consoleViewProvider:
        | {
            view?: vscode.WebviewView;
            reveal?(preserveFocus: boolean): Promise<void>;
        }
        | undefined;
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _consoleStateStore?: ConsoleStateStore;

    // Event emitters (1:1 Positron naming)
    private readonly _onDidStartPositronConsoleInstanceEmitter = new vscode.EventEmitter<IPositronConsoleInstance>();
    private readonly _onDidDeletePositronConsoleInstanceEmitter = new vscode.EventEmitter<IPositronConsoleInstance>();
    private readonly _onDidChangeActivePositronConsoleInstanceEmitter = new vscode.EventEmitter<IPositronConsoleInstance | undefined>();
    private readonly _onDidChangeConsoleWidthEmitter = new vscode.EventEmitter<number>();
    private readonly _onDidExecuteCodeEmitter = new vscode.EventEmitter<ILanguageRuntimeCodeExecutedEvent>();
    private readonly _onDidChangeInputStateEmitter = new vscode.EventEmitter<ILanguageRuntimeInputStateChangedEvent>();
    private readonly _onDidRevealExecutionEmitter = new vscode.EventEmitter<{ sessionId: string; executionId: string }>();
    private readonly _onDidChangePendingInputEmitter = new vscode.EventEmitter<{ sessionId: string; code?: string; inputPrompt: string }>();
    //#endregion

    constructor(
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _outputChannel: vscode.LogOutputChannel,
        context?: vscode.ExtensionContext,
        private readonly _runtimeStartupService?: RuntimeStartupService,
    ) {
        this._outputChannel.debug('[PositronConsoleService] Created');
        if (context) {
            this._consoleStateStore = new ConsoleStateStore(context.workspaceState, this._outputChannel);
            this._disposables.push(this._consoleStateStore);
        }
    }

    //#region IPositronConsoleService Implementation
    get positronConsoleInstances(): IPositronConsoleInstance[] {
        return Array.from(this._consoleInstancesBySessionId.values());
    }

    get activePositronConsoleInstance(): IPositronConsoleInstance | undefined {
        return this._activeConsoleInstance;
    }

    readonly onDidStartPositronConsoleInstance = this._onDidStartPositronConsoleInstanceEmitter.event;
    readonly onDidDeletePositronConsoleInstance = this._onDidDeletePositronConsoleInstanceEmitter.event;
    readonly onDidChangeActivePositronConsoleInstance = this._onDidChangeActivePositronConsoleInstanceEmitter.event;
    readonly onDidChangeConsoleWidth = this._onDidChangeConsoleWidthEmitter.event;
    readonly onDidExecuteCode = this._onDidExecuteCodeEmitter.event;
    readonly onDidChangeInputState = this._onDidChangeInputStateEmitter.event;
    readonly onDidRevealExecution = this._onDidRevealExecutionEmitter.event;
    readonly onDidChangePendingInput = this._onDidChangePendingInputEmitter.event;

    /**
     * Gets the currently active code editor (1:1 Positron).
     * Returns the active text editor from VS Code's window API.
     */
    get activeCodeEditor(): vscode.TextEditor | undefined {
        return vscode.window.activeTextEditor;
    }

    initialize(): void {
        this._outputChannel.debug('[PositronConsoleService] Initializing...');

        this._subscribeToRuntimeEvents();
        void this._restorePositronConsoleInstances();

        // Listen for session starts BEFORE kernel starts (Positron pattern: onWillStartSession)
        this._disposables.push(
            this._sessionManager.onWillStartSession((e) => {
                this._outputChannel.debug(`[PositronConsoleService] Session will start: ${e.session.sessionId}, mode: ${e.startMode}`);

                // Convert RuntimeStartMode to SessionAttachMode
                let attachMode: SessionAttachMode;
                switch (e.startMode) {
                    case RuntimeStartMode.Starting:
                        attachMode = SessionAttachMode.Starting;
                        break;
                    case RuntimeStartMode.Restarting:
                        attachMode = SessionAttachMode.Restarting;
                        break;
                    case RuntimeStartMode.Reconnecting:
                        attachMode = SessionAttachMode.Reconnecting;
                        break;
                    default:
                        attachMode = SessionAttachMode.Connected;
                }

                // Check for existing instance
                const existingInstance = this._consoleInstancesBySessionId.get(e.session.sessionId);
                if (existingInstance) {
                    // Reattach to existing instance
                    existingInstance.attachRuntimeSession(e.session, attachMode);
                } else {
                    // Create new console instance
                    this.startPositronConsoleInstance(e.session, attachMode, e.activate);
                }
            })
        );

        // Follow foreground changes immediately; service handoff may finish later.
        this._disposables.push(
            this._sessionManager.onDidChangeForegroundSession((session: RuntimeSession | undefined) => {
                if (session) {
                    this._outputChannel.debug(`[PositronConsoleService] Active session changed: ${session.sessionId}`);
                    // Just activate the console, instance should already exist from onWillStartSession
                    this.setActivePositronConsoleSession(session.sessionId);
                } else {
                    this._activeConsoleInstance = undefined;
                    this._onDidChangeActivePositronConsoleInstanceEmitter.fire(undefined);
                }
            })
        );

        // Listen for session deletions (Positron pattern: onDidDeleteRuntimeSession)
        this._disposables.push(
            this._sessionManager.onDidDeleteRuntimeSession((sessionId: string) => {
                this._outputChannel.debug(`[PositronConsoleService] Session deleted: ${sessionId}`);
                this.deletePositronConsoleSession(sessionId);
            }),
            this._runtimeStartupService?.onSessionRestoreFailure((event) => {
                const instance = this._consoleInstancesBySessionId.get(event.sessionId);
                if (!instance) {
                    return;
                }

                instance.showRestoreFailure(event.error);
            }) ?? new vscode.Disposable(() => undefined),
        );

        // Create console instances for existing sessions
        for (const session of this._sessionManager.sessions) {
            if (!this._consoleInstancesBySessionId.has(session.sessionId)) {
                const activate = session.sessionId === this._sessionManager.activeSessionId;
                const attachMode = this._sessionManager.wasSessionRestored(session.sessionId)
                    ? SessionAttachMode.Reconnecting
                    : SessionAttachMode.Connected;
                this.startPositronConsoleInstance(session, attachMode, activate);
            }
        }

        this._outputChannel.debug('[PositronConsoleService] Initialized');
    }

    /**
     * Sets the console webview provider so we can reveal the console without stealing focus.
     */
    setConsoleViewProvider(
        provider:
            | {
                view?: vscode.WebviewView;
                reveal?(preserveFocus: boolean): Promise<void>;
            }
            | undefined,
    ): void {
        this._consoleViewProvider = provider;
    }

    async revealConsole(preserveFocus: boolean = false): Promise<void> {
        await this._revealConsole(preserveFocus);
    }

    async focusConsole(): Promise<void> {
        await this._revealConsole(false);
        this._activeConsoleInstance?.focusInput();
    }

    async showConsole(): Promise<void> {
        await this.focusConsole();
    }

    getConsoleWidth(): number {
        return this._consoleWidth;
    }

    setActivePositronConsoleSession(sessionId: string): void {
        const instance = this._consoleInstancesBySessionId.get(sessionId);
        if (!instance) {
            return;
        }
        this._setActivePositronConsoleInstance(instance);
    }

    deletePositronConsoleSession(sessionId: string): void {
        const instance = this._consoleInstancesBySessionId.get(sessionId);
        if (instance) {
            this._outputChannel.debug(`[PositronConsoleService] Deleting console: ${sessionId}`);
            this._consoleInstancesBySessionId.delete(sessionId);
            this._consoleStateStore?.delete(sessionId);
            this._onDidDeletePositronConsoleInstanceEmitter.fire(instance);
            instance.dispose();

            // Update active if needed
            if (this._activeConsoleInstance === instance) {
                const remaining = this.positronConsoleInstances;
                this._activeConsoleInstance = remaining.length > 0
                    ? remaining[0] as PositronConsoleInstance
                    : undefined;
                this._onDidChangeActivePositronConsoleInstanceEmitter.fire(this._activeConsoleInstance);
            }
        }
    }

    async executeCode(
        languageId: string,
        sessionId: string | undefined,
        code: string,
        attribution: IConsoleCodeAttribution,
        focus: boolean,
        allowIncomplete: boolean = false,
        mode: RuntimeCodeExecutionMode = RuntimeCodeExecutionMode.Interactive,
        errorBehavior: RuntimeErrorBehavior = RuntimeErrorBehavior.Continue,
        executionId?: string,
    ): Promise<string> {
        await this.revealConsole(!focus);

        const instance = await this._resolveConsoleInstance(languageId, sessionId, code);
        if (!instance) {
            throw new Error(`Could not find or create console for language ID ${languageId} (attempting to execute ${code})`);
        }

        if (instance !== this._activeConsoleInstance) {
            this._setActivePositronConsoleInstance(instance);

            if (instance.attachedRuntimeSession) {
                this._sessionManager.foregroundSession = instance.attachedRuntimeSession;
            }
        }

        if (focus) {
            instance.focusInput();
        }

        await instance.enqueueCode(
            code,
            attribution,
            allowIncomplete,
            mode,
            errorBehavior,
            executionId,
        );

        return instance.sessionId;
    }

    getConsoleInstance(sessionId: string): IPositronConsoleInstance | undefined {
        return this._consoleInstancesBySessionId.get(sessionId);
    }

    async flushPersistedState(): Promise<void> {
        await this._consoleStateStore?.flush();
    }

    /**
     * Gets the serialized console state for a session (for reload restore).
     */
    getSerializedState(sessionId: string): SerializedConsoleState | undefined {
        const instance = this._consoleInstancesBySessionId.get(sessionId);
        return instance?.serializeState();
    }

    /**
     * Reveals an execution in the console by its execution ID (1:1 Positron).
     */
    revealExecution(sessionId: string, executionId: string): void {
        const instance = this._consoleInstancesBySessionId.get(sessionId);
        if (!instance) {
            throw new Error(
                `Cannot reveal execution: no console instance found for session ID ${sessionId}.`,
            );
        }

        void this.revealConsole(true);
        this.setActivePositronConsoleSession(sessionId);

        if (!instance.revealExecution(executionId)) {
            throw new Error(
                `Cannot reveal execution: execution ID ${executionId} not found in session ID ${sessionId}.`,
            );
        }
    }

    /**
     * Gets a clipboard representation of the console content (1:1 Positron).
     */
    getClipboardRepresentation(sessionId: string, commentPrefix: string): string {
        const instance = this._consoleInstancesBySessionId.get(sessionId);
        if (instance) {
            return instance.getClipboardRepresentation(commentPrefix);
        }
        return '';
    }

    dispose(): void {
        this._outputChannel.debug('[PositronConsoleService] Disposing...');

        // Dispose all console instances
        for (const instance of this._consoleInstancesBySessionId.values()) {
            instance.dispose();
        }
        this._consoleInstancesBySessionId.clear();

        // Dispose event emitters
        this._onDidStartPositronConsoleInstanceEmitter.dispose();
        this._onDidDeletePositronConsoleInstanceEmitter.dispose();
        this._onDidChangeActivePositronConsoleInstanceEmitter.dispose();
        this._onDidChangeConsoleWidthEmitter.dispose();
        this._onDidExecuteCodeEmitter.dispose();
        this._onDidChangeInputStateEmitter.dispose();
        this._onDidRevealExecutionEmitter.dispose();

        // Dispose subscriptions
        this._disposables.forEach(d => d.dispose());
    }
    //#endregion

    //#region Private Methods
    private async _revealConsole(preserveFocus: boolean = false): Promise<void> {
        if (this._consoleViewProvider?.reveal) {
            await this._consoleViewProvider.reveal(preserveFocus);
            return;
        }

        const editorToRestore = preserveFocus ? vscode.window.activeTextEditor : undefined;
        const restoreFocus = async (): Promise<void> => {
            if (!editorToRestore) {
                return;
            }

            await vscode.window.showTextDocument(editorToRestore.document, {
                viewColumn: editorToRestore.viewColumn,
                preserveFocus: false
            });
        };

        const view = this._consoleViewProvider?.view;

        if (view) {
            view.show(preserveFocus);
            await restoreFocus();
            return;
        }

        if (!preserveFocus) {
            await vscode.commands.executeCommand(ViewCommands.consoleFocus);
            return;
        }

        try {
            await vscode.commands.executeCommand('workbench.views.action.showView', ViewIds.console);
        } finally {
            await restoreFocus();
        }
    }

    private _setActivePositronConsoleInstance(instance: PositronConsoleInstance): void {
        if (instance === this._activeConsoleInstance) {
            return;
        }

        this._outputChannel.debug(`[PositronConsoleService] Setting active console: ${instance.sessionId}`);
        this._activeConsoleInstance = instance;
        this._onDidChangeActivePositronConsoleInstanceEmitter.fire(instance);
    }

    private async _resolveConsoleInstance(
        languageId: string,
        sessionId: string | undefined,
        code: string,
    ): Promise<PositronConsoleInstance | undefined> {
        if (sessionId) {
            const existingInstance = this._consoleInstancesBySessionId.get(sessionId);
            if (!existingInstance) {
                throw new Error(
                    `Cannot execute code because the requested session ID ${sessionId} does not have a Positron console instance.`,
                );
            }

            if (existingInstance.runtimeMetadata.languageId !== languageId) {
                this._outputChannel.warn(
                    `Code is being executed in a console instance for language ` +
                    `${existingInstance.runtimeMetadata.languageId} (session ${sessionId}), not for requested language ${languageId}.`,
                );
            }

            return existingInstance;
        }

        if (this._activeConsoleInstance?.runtimeMetadata.languageId === languageId) {
            return this._activeConsoleInstance;
        }

        const existingLanguageInstance = this._findConsoleInstanceForLanguage(languageId);
        if (existingLanguageInstance) {
            return existingLanguageInstance;
        }

        return this._startConsoleInstanceForLanguage(languageId, code);
    }

    private _findConsoleInstanceForLanguage(languageId: string): PositronConsoleInstance | undefined {
        return Array.from(this._consoleInstancesBySessionId.values())
            .sort((a, b) => b.sessionMetadata.createdTimestamp - a.sessionMetadata.createdTimestamp)
            .find((instance) => instance.runtimeMetadata.languageId === languageId);
    }

    private async _startConsoleInstanceForLanguage(
        languageId: string,
        code: string,
    ): Promise<PositronConsoleInstance | undefined> {
        const preferredRuntime = this._runtimeStartupService?.getPreferredRuntime(languageId);
        if (preferredRuntime) {
            const sessionId = await this._sessionManager.startNewRuntimeSession(
                preferredRuntime.runtimeId,
                preferredRuntime.runtimeName,
                LanguageRuntimeSessionMode.Console,
                undefined,
                `User executed code in language ${languageId}, and no running runtime session was found for the language.`,
                RuntimeStartMode.Starting,
                true,
            );
            return sessionId ? this._consoleInstancesBySessionId.get(sessionId) : undefined;
        }

        this._outputChannel.debug(`[PositronConsoleService] No preferred runtime for ${languageId}; falling back to startConsoleSession`);
        const session = await this._sessionManager.startConsoleSession();
        const instance = this._consoleInstancesBySessionId.get(session.sessionId);
        if (!instance) {
            throw new Error(`Console instance was not created for session ${session.sessionId}`);
        }

        if (instance.runtimeMetadata.languageId !== languageId) {
            this._outputChannel.warn(
                `Started fallback console session ${session.sessionId} for language ${instance.runtimeMetadata.languageId} while executing ${languageId} code (${code}).`,
            );
        }

        return instance;
    }

    private startPositronConsoleInstance(
        session: RuntimeSession,
        mode: SessionAttachMode,
        activate: boolean = false
    ): PositronConsoleInstance {
        this._outputChannel.debug(`[PositronConsoleService] Starting console instance for: ${session.sessionId}`);

        const instance = this._createPositronConsoleInstance(
            session.sessionMetadata,
            session.runtimeMetadata,
            activate,
        );

        // Restore persisted state (if any) before attaching the runtime
        this._consoleStateStore?.restore(instance, mode);

        // Start persistence tracking for this instance
        this._consoleStateStore?.bind(instance);

        // Attach session - RuntimeSession itself is the runtime session
        instance.attachRuntimeSession(session, mode);

        return instance;
    }

    private async _restorePositronConsoleInstances(): Promise<void> {
        if (!this._runtimeStartupService) {
            return;
        }

        try {
            const restoredSessions = await this._runtimeStartupService.getRestoredSessions();
            let first = !this._activeConsoleInstance;

            for (const session of restoredSessions) {
                if (!this._shouldRestorePositronConsole(session)) {
                    continue;
                }

                if (this._consoleInstancesBySessionId.has(session.metadata.sessionId)) {
                    continue;
                }

                this._restorePositronConsole(session, first);
                first = false;
            }
        } catch (error) {
            this._outputChannel.error(`[PositronConsoleService] Failed to restore console instances: ${error}`);
        }
    }

    private _shouldRestorePositronConsole(session: SerializedSessionMetadata): boolean {
        return session.metadata.sessionMode === LanguageRuntimeSessionMode.Console ||
            session.hasConsole === true;
    }

    private _restorePositronConsole(
        session: SerializedSessionMetadata,
        activate: boolean,
    ): PositronConsoleInstance {
        const sessionMetadata = {
            ...session.metadata,
            sessionName: session.sessionName || session.metadata.sessionName || session.runtimeMetadata.runtimeName,
            workingDirectory: session.workingDirectory ?? session.metadata.workingDirectory,
        };
        const instance = this._createPositronConsoleInstance(
            sessionMetadata,
            session.runtimeMetadata,
            activate,
        );

        this._consoleStateStore?.restore(instance, SessionAttachMode.Reconnecting);
        this._consoleStateStore?.bind(instance);
        return instance;
    }

    private _createPositronConsoleInstance(
        sessionMetadata: RuntimeSession['sessionMetadata'],
        runtimeMetadata: RuntimeSession['runtimeMetadata'],
        activate: boolean,
    ): PositronConsoleInstance {
        const instance = new PositronConsoleInstance(
            sessionMetadata,
            runtimeMetadata,
            this._outputChannel
        );

        instance.setWidthInChars(this._consoleWidth);

        this._disposables.push(
            instance.onDidExecuteCode(event => {
                this._onDidExecuteCodeEmitter.fire(event);
            }),
            instance.onDidChangeInputState(event => {
                this._onDidChangeInputStateEmitter.fire({
                    sessionId: instance.sessionId,
                    executionId: event.executionId,
                    state: event.state
                });
            }),
            instance.onDidRevealExecution(executionId => {
                this._onDidRevealExecutionEmitter.fire({
                    sessionId: instance.sessionId,
                    executionId
                });
            }),
            instance.onDidChangePendingInput(event => {
                this._onDidChangePendingInputEmitter.fire({
                    sessionId: instance.sessionId,
                    code: event.code,
                    inputPrompt: event.inputPrompt
                });
            }),
        );

        this._consoleInstancesBySessionId.set(sessionMetadata.sessionId, instance);
        this._onDidStartPositronConsoleInstanceEmitter.fire(instance);

        if (activate) {
            this._activeConsoleInstance = instance;
            this._onDidChangeActivePositronConsoleInstanceEmitter.fire(instance);
        }

        return instance;
    }

    /**
     * Updates console width and notifies listeners.
     */
    setConsoleWidth(width: number): void {
        if (this._consoleWidth !== width) {
            this._consoleWidth = width;
            this._onDidChangeConsoleWidthEmitter.fire(width);

            // Update all instances
            for (const instance of this._consoleInstancesBySessionId.values()) {
                instance.setWidthInChars(width);
            }
        }
    }

    private _subscribeToRuntimeEvents(): void {
        this._disposables.push(
            this._sessionManager.onDidReceiveRuntimeEvent((runtimeEvent) => {
                const instance = this._consoleInstancesBySessionId.get(runtimeEvent.session_id);
                if (!instance) {
                    return;
                }

                switch (runtimeEvent.event.name) {
                    case UiFrontendEvent.PromptState:
                        instance.handlePromptStateChange(
                            (runtimeEvent.event.data ?? {}) as Partial<PromptStateEvent>
                        );
                        break;
                    case UiFrontendEvent.WorkingDirectory:
                        instance.handleWorkingDirectoryChange(
                            (runtimeEvent.event.data ?? {}) as Partial<WorkingDirectoryEvent>
                        );
                        break;
                }
            })
        );
    }
    //#endregion
}
