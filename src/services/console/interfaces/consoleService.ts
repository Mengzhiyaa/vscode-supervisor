/*---------------------------------------------------------------------------------------------
 *  Service-Class Session Management - Console Interfaces
 *  1:1 replication of Positron's IPositronConsoleService and IPositronConsoleInstance
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RuntimeItem } from '../classes/runtimeItem';
import { RuntimeSession } from '../../../runtime/session';
import type {
    LanguageRuntimeOutputWithKind,
    LanguageRuntimeResultWithKind,
    LanguageRuntimeUpdateOutputWithKind,
} from '../../../runtime/runtimeOutputKind';
import type {
    LanguageRuntimeClearOutput,
    LanguageRuntimeError as LanguageRuntimeErrorMessage,
    LanguageRuntimeInput,
    LanguageRuntimeMessage,
    LanguageRuntimeMetadata,
    LanguageRuntimePrompt,
    LanguageRuntimeState,
    LanguageRuntimeStream,
    RuntimeSessionMetadata,
} from '../../../positronTypes';
import type {
    PromptStateEvent,
    WorkingDirectoryEvent,
} from '../../../runtime/comms/positronUiComm';

/**
 * PositronConsoleState enumeration (1:1 Positron).
 */
export const enum PositronConsoleState {
    Uninitialized = 'Uninitialized',
    Starting = 'Starting',
    Busy = 'Busy',
    Ready = 'Ready',
    Offline = 'Offline',
    Interrupting = 'Interrupting',
    Restarting = 'Restarting',
    Exiting = 'Exiting',
    Exited = 'Exited',
    Disconnected = 'Disconnected'
}

/**
 * SessionAttachMode enumeration (1:1 Positron).
 */
export enum SessionAttachMode {
    /** The console is attaching to a new, starting session */
    Starting = 'starting',
    /** The console is attaching to a restarting session */
    Restarting = 'restarting',
    /** The console is switching to a different session */
    Switching = 'switching',
    /** The console is attaching to a session that is being reconnected */
    Reconnecting = 'reconnecting',
    /** The console is reattaching to a connected session */
    Connected = 'connected',
}

/**
 * RuntimeCodeExecutionMode enumeration (1:1 Positron).
 * Determines how code execution should be handled.
 */
export enum RuntimeCodeExecutionMode {
    /** Interactive execution - shows input in console */
    Interactive = 'interactive',
    /** Non-interactive execution - tracked but not treated as REPL input */
    NonInteractive = 'non-interactive',
    /** Silent execution - doesn't show input in console */
    Silent = 'silent',
    /** Transient execution - runtime-defined ephemeral evaluation */
    Transient = 'transient',
}

/**
 * RuntimeErrorBehavior enumeration (1:1 Positron).
 * Determines behavior when code execution encounters an error.
 */
export enum RuntimeErrorBehavior {
    /** Continue executing remaining code after an error */
    Continue = 'continue',
    /** Stop executing remaining code when error is encountered */
    Stop = 'stop',
}

/**
 * Console code attribution interface.
 */
export interface IConsoleCodeAttribution {
    /** Source of the code (e.g., 'user', 'file', 'extension') */
    source: string;
    /** Optional file URI if code came from a file */
    fileUri?: vscode.Uri;
    /** Optional line number in the source file */
    lineNumber?: number;
    /** Additional metadata for the code execution */
    metadata?: Record<string, unknown>;
}

/**
 * Code executed event interface (1:1 Positron).
 */
export interface ILanguageRuntimeCodeExecutedEvent {
    executionId: string;
    sessionId: string;
    code: string;
    mode: RuntimeCodeExecutionMode;
    attribution: IConsoleCodeAttribution;
    errorBehavior: RuntimeErrorBehavior;
    languageId: string;
    runtimeName: string;
}

/**
 * Input execution state change event (busy/idle).
 */
export interface ILanguageRuntimeInputStateChangedEvent {
    sessionId: string;
    executionId: string;
    state: 'busy' | 'idle';
}

export interface SerializedConsoleRuntimeItemPayload {
    type: string;
}

export interface SerializedConsoleActivityItemPayload {
    type: string;
}

export type ConsoleRuntimeItemsChangeEvent =
    | { kind: 'restore' }
    | { kind: 'appendRuntimeItem'; item: SerializedConsoleRuntimeItemPayload }
    | { kind: 'appendActivityItem'; parentId: string; item: SerializedConsoleActivityItemPayload }
    | { kind: 'replaceActivityOutput'; parentId: string; outputId: string; item: SerializedConsoleActivityItemPayload }
    | { kind: 'clearActivityOutput'; parentId: string }
    | { kind: 'updateActivityInputState'; parentId: string; state: 'provisional' | 'executing' | 'completed' | 'cancelled' };

/**
 * Input history navigation event args (1:1 Positron pattern).
 */
export interface DidNavigateInputHistoryEventArgs {
    /** The current input text at time of navigation */
    currentInput: string;
    /** Whether to use prefix matching */
    usePrefixMatch: boolean;
}

/**
 * IPositronConsoleService interface (1:1 Positron).
 * Manages all console instances across sessions.
 */
export interface IPositronConsoleService extends vscode.Disposable {
    readonly positronConsoleInstances: IPositronConsoleInstance[];
    readonly activePositronConsoleInstance: IPositronConsoleInstance | undefined;
    readonly onDidStartPositronConsoleInstance: vscode.Event<IPositronConsoleInstance>;
    readonly onDidDeletePositronConsoleInstance: vscode.Event<IPositronConsoleInstance>;
    readonly onDidChangeActivePositronConsoleInstance: vscode.Event<IPositronConsoleInstance | undefined>;
    readonly onDidChangeConsoleWidth: vscode.Event<number>;
    readonly onDidExecuteCode: vscode.Event<ILanguageRuntimeCodeExecutedEvent>;
    readonly onDidChangeInputState: vscode.Event<ILanguageRuntimeInputStateChangedEvent>;
    readonly onDidRevealExecution: vscode.Event<{ sessionId: string; executionId: string }>;

    /**
     * Gets the currently active code editor (1:1 Positron).
     * This is used for editor integration features like executing selected code.
     */
    readonly activeCodeEditor: vscode.TextEditor | undefined;

    initialize(): void;
    getConsoleWidth(): number;
    setActivePositronConsoleSession(sessionId: string): void;
    deletePositronConsoleSession(sessionId: string): void;
    executeCode(
        languageId: string,
        sessionId: string | undefined,
        code: string,
        attribution: IConsoleCodeAttribution,
        focus: boolean,
        allowIncomplete?: boolean,
        mode?: RuntimeCodeExecutionMode,
        errorBehavior?: RuntimeErrorBehavior,
        executionId?: string,
    ): Promise<string>;
    getConsoleInstance(sessionId: string): IPositronConsoleInstance | undefined;

    /**
     * Reveals an execution in the console by its execution ID (1:1 Positron).
     * Scrolls to and highlights the specified execution.
     */
    revealExecution(sessionId: string, executionId: string): void;

    /**
     * Gets a clipboard representation of the console content (1:1 Positron).
     * @param commentPrefix The prefix to use for comment lines
     * @returns Formatted string suitable for clipboard
     */
    getClipboardRepresentation(sessionId: string, commentPrefix: string): string;
}

/**
 * IPositronConsoleInstance interface (1:1 Positron).
 * Represents a single console session instance.
 */
export interface IPositronConsoleInstance extends vscode.Disposable {
    readonly state: PositronConsoleState;
    readonly sessionMetadata: RuntimeSessionMetadata;
    readonly runtimeMetadata: LanguageRuntimeMetadata;
    readonly sessionId: string;
    readonly sessionName: string;
    readonly trace: boolean;
    readonly wordWrap: boolean;
    readonly runtimeItems: RuntimeItem[];
    readonly promptActive: boolean;
    readonly runtimeAttached: boolean;
    readonly inputPrompt: string;
    readonly continuationPrompt: string;
    readonly workingDirectory: string | undefined;
    scrollLocked: boolean;
    lastScrollTop: number;

    /** Input history for this console instance */
    readonly inputHistory: string[];

    // Events (1:1 Positron)
    readonly onFocusInput: vscode.Event<void>;
    readonly onDidChangeState: vscode.Event<PositronConsoleState>;
    readonly onDidChangeWordWrap: vscode.Event<boolean>;
    readonly onDidChangeTrace: vscode.Event<boolean>;
    readonly onDidChangeRuntimeItems: vscode.Event<ConsoleRuntimeItemsChangeEvent[]>;
    readonly onDidPasteText: vscode.Event<string>;
    readonly onDidSelectAll: vscode.Event<void>;
    readonly onDidClearConsole: vscode.Event<void>;
    readonly onDidExecuteCode: vscode.Event<ILanguageRuntimeCodeExecutedEvent>;
    readonly onDidAttachSession: vscode.Event<RuntimeSession | undefined>;
    readonly onDidChangeInputState: vscode.Event<{ executionId: string; state: 'busy' | 'idle' }>;
    readonly onDidChangePrompt: vscode.Event<void>;
    readonly onDidChangeWorkingDirectory: vscode.Event<string | undefined>;

    // New events for input history navigation (1:1 Positron)
    readonly onDidNavigateInputHistoryUp: vscode.Event<DidNavigateInputHistoryEventArgs>;
    readonly onDidNavigateInputHistoryDown: vscode.Event<DidNavigateInputHistoryEventArgs>;
    readonly onDidClearInputHistory: vscode.Event<void>;
    readonly onDidSetPendingCode: vscode.Event<string | undefined>;

    // Reveal execution event (1:1 Positron)
    readonly onDidRevealExecution: vscode.Event<string>;

    // Methods (1:1 Positron)
    focusInput(): void;
    setWidthInChars(newWidth: number): void;
    getWidthInChars(): number;
    toggleTrace(): void;
    toggleWordWrap(): void;
    pasteText(text: string): void;
    selectAll(): void;
    clearConsole(): boolean;
    completeStartup(): void;
    interrupt(code?: string): void;
    enqueueCode(
        code: string,
        attribution: IConsoleCodeAttribution,
        allowIncomplete?: boolean,
        mode?: RuntimeCodeExecutionMode,
        errorBehavior?: RuntimeErrorBehavior,
        executionId?: string,
    ): Promise<void>;
    executeCode(
        code: string,
        attribution: IConsoleCodeAttribution,
        mode?: RuntimeCodeExecutionMode,
        errorBehavior?: RuntimeErrorBehavior,
        executionId?: string,
    ): void;
    replyToPrompt(value: string): void;
    attachRuntimeSession(session: RuntimeSession | undefined, mode: SessionAttachMode): void;
    handleStream(message: LanguageRuntimeStream): void;
    handleInput(message: LanguageRuntimeInput): void;
    handleError(message: LanguageRuntimeErrorMessage): void;
    handleOutput(message: LanguageRuntimeOutputWithKind): void;
    handleResult(message: LanguageRuntimeResultWithKind): void;
    handleState(message: LanguageRuntimeState): void;
    handlePrompt(message: LanguageRuntimePrompt): void;
    handleClearOutput(message: LanguageRuntimeClearOutput): void;
    handleUpdateOutput(message: LanguageRuntimeUpdateOutputWithKind): void;
    handlePromptStateChange(data: Partial<PromptStateEvent>): void;
    handleWorkingDirectoryChange(data: Partial<WorkingDirectoryEvent>): void;
    /** Add runtime startup banner to console output */
    addRuntimeStartupBanner(banner: string, version?: string): void;
    readonly attachedRuntimeSession: RuntimeSession | undefined;

    // New methods for input history (1:1 Positron)
    /** Navigate up in input history */
    navigateInputHistoryUp(currentInput: string, usePrefixMatch?: boolean): string | undefined;
    /** Navigate down in input history */
    navigateInputHistoryDown(currentInput: string, usePrefixMatch?: boolean): string | undefined;
    /** Clear input history */
    clearInputHistory(): void;
    /** Add entry to input history */
    addToInputHistory(code: string): void;

    // New methods for reveal and clipboard (1:1 Positron)
    /** Reveal (scroll to and highlight) a specific execution */
    revealExecution(executionId: string): boolean;
    /** Get clipboard representation of console content */
    getClipboardRepresentation(commentPrefix: string): string;
}
