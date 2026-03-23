/*---------------------------------------------------------------------------------------------
 *  PositronConsoleService Implementation
 *  1:1 replication of Positron's console service class
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ViewCommands } from '../../coreCommandIds';
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
import { SessionManager } from '../../runtime/sessionManager';
import { RuntimeSession } from '../../runtime/session';
import { RuntimeStartMode } from '../../positronTypes';
import {
    PromptStateEvent,
    UiFrontendEvent,
    WorkingDirectoryEvent,
} from '../../runtime/comms/positronUiComm';


/**
 * PositronConsoleService class (1:1 Positron).
 * Manages all console instances across sessions.
 */
export class PositronConsoleService implements IPositronConsoleService {
    //#region Private Properties
    private readonly _consoleInstancesBySessionId = new Map<string, PositronConsoleInstance>();
    private _activeConsoleInstance: PositronConsoleInstance | undefined;
    private _consoleWidth = 80;
    private _consoleViewProvider: { view?: vscode.WebviewView } | undefined;
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
        private readonly _sessionManager: SessionManager,
        private readonly _outputChannel: vscode.LogOutputChannel,
        context?: vscode.ExtensionContext
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
            })
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
    setConsoleViewProvider(provider: { view?: vscode.WebviewView } | undefined): void {
        this._consoleViewProvider = provider;
    }

    getConsoleWidth(): number {
        return this._consoleWidth;
    }

    setActivePositronConsoleSession(sessionId: string): void {
        const instance = this._consoleInstancesBySessionId.get(sessionId);
        if (!instance) {
            return;
        }

        // Dedup: skip if already the active instance to prevent
        // oscillation feedback loops between backend and webview.
        if (instance === this._activeConsoleInstance) {
            return;
        }

        this._outputChannel.debug(`[PositronConsoleService] Setting active console: ${sessionId}`);
        this._activeConsoleInstance = instance;
        this._onDidChangeActivePositronConsoleInstanceEmitter.fire(instance);
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
        // Always reveal the console panel so the user sees output.
        // When focus is false (e.g. Ctrl+Enter from editor), reveal
        // without stealing keyboard focus from the editor.
        await this._revealConsoleIfHidden(!focus);

        // Find or create appropriate console instance
        let instance = sessionId
            ? this._consoleInstancesBySessionId.get(sessionId)
            : this._activeConsoleInstance;

        if (!instance) {
            // Create new session if needed
            this._outputChannel.debug('[PositronConsoleService] No active console, creating new session');
            const session = await this._sessionManager.createSession();
            instance = this.startPositronConsoleInstance(session, SessionAttachMode.Starting, true);
            await session.start();
        }

        // Execute code
        await instance.enqueueCode(
            code,
            attribution,
            allowIncomplete,
            mode,
            errorBehavior,
            executionId,
        );

        // Focus if requested
        if (focus) {
            instance.focusInput();
        }

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

        void this._revealConsoleIfHidden(false);
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
    private async _revealConsoleIfHidden(preserveFocus: boolean = false): Promise<void> {
        const view = this._consoleViewProvider?.view;

        if (view) {
            if (!view.visible) {
                view.show(preserveFocus);
            }
            return;
        }

        if (!preserveFocus) {
            await vscode.commands.executeCommand(ViewCommands.consoleFocus);
        }
    }

    private startPositronConsoleInstance(
        session: RuntimeSession,
        mode: SessionAttachMode,
        activate: boolean = false
    ): PositronConsoleInstance {
        this._outputChannel.debug(`[PositronConsoleService] Starting console instance for: ${session.sessionId}`);

        const instance = new PositronConsoleInstance(
            session.sessionMetadata,
            session.runtimeMetadata,
            this._outputChannel
        );

        // Listen for execute events from instance
        this._disposables.push(
            instance.onDidExecuteCode(event => {
                this._onDidExecuteCodeEmitter.fire(event);
            })
        );

        // Listen for input state changes from instance
        this._disposables.push(
            instance.onDidChangeInputState(event => {
                this._onDidChangeInputStateEmitter.fire({
                    sessionId: instance.sessionId,
                    executionId: event.executionId,
                    state: event.state
                });
            })
        );

        // Listen for reveal execution requests from instance
        this._disposables.push(
            instance.onDidRevealExecution(executionId => {
                this._onDidRevealExecutionEmitter.fire({
                    sessionId: instance.sessionId,
                    executionId
                });
            })
        );

        // Listen for pending input changes from instance
        this._disposables.push(
            instance.onDidChangePendingInput(event => {
                this._onDidChangePendingInputEmitter.fire({
                    sessionId: instance.sessionId,
                    code: event.code,
                    inputPrompt: event.inputPrompt
                });
            })
        );

        // Restore persisted state (if any) before attaching the runtime
        this._consoleStateStore?.restore(instance, mode);

        // Start persistence tracking for this instance
        this._consoleStateStore?.bind(instance);

        // Attach session - RuntimeSession itself is the runtime session
        instance.attachRuntimeSession(session, mode);

        // Track instance
        this._consoleInstancesBySessionId.set(session.sessionId, instance);

        // Fire event
        this._onDidStartPositronConsoleInstanceEmitter.fire(instance);

        // Set as active if requested (Positron pattern)
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
