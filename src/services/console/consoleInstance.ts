/*---------------------------------------------------------------------------------------------
 *  PositronConsoleInstance Implementation
 *  1:1 replication of Positron's console instance class
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    IPositronConsoleInstance,
    PositronConsoleState,
    SessionAttachMode,
    IConsoleCodeAttribution,
    ILanguageRuntimeCodeExecutedEvent,
    ConsoleRuntimeItemsChangeEvent,
    DidNavigateInputHistoryEventArgs,
    RuntimeCodeExecutionMode,
    RuntimeErrorBehavior,
} from './interfaces/consoleService';
import {
    RuntimeItem,
    RuntimeItemActivity,
    RuntimeItemStarted,
    RuntimeItemRestarted,
    RuntimeItemStartup,
    RuntimeItemStartupFailure,
    RuntimeItemExited,
    RuntimeItemOffline,
    RuntimeItemPendingInput,
    RuntimeItemTrace,
    RuntimeItemStarting,
    RuntimeItemReconnected,
    ActivityItem,
    ActivityItemInput,
    ActivityItemInputState,
    ActivityItemStream,
    ActivityItemStreamType,
    ActivityItemErrorMessage,
    ActivityItemOutputMessage,
    ActivityItemOutputHtml,
    ActivityItemOutputPlot,
    ActivityItemPrompt,
    ActivityItemPromptState,
    ILanguageRuntimeMessageOutputData
} from './classes/runtimeItem';
import { ThrottledEmitter } from './classes/throttledEmitter';
import { LanguageRuntimeStartupFailure, RuntimeSession } from '../../runtime/session';
import type {
    PromptStateEvent,
    WorkingDirectoryEvent,
} from '../../runtime/comms/positronUiComm';
import type {
    LanguageRuntimeMetadata,
    RuntimeSessionMetadata,
} from '../../api';
import {
    RuntimeOutputKind,
    type LanguageRuntimeOutputWithKind,
    type LanguageRuntimeResultWithKind,
    type LanguageRuntimeUpdateOutputWithKind,
} from '../../runtime/runtimeOutputKind';
import type {
    LanguageRuntimeError as LanguageRuntimeErrorMessage,
    LanguageRuntimeInput,
    LanguageRuntimePrompt,
    LanguageRuntimeClearOutput,
    LanguageRuntimeState,
    LanguageRuntimeStream,
    RuntimeOnlineState,
} from '../../internal/runtimeTypes';
import {
    RuntimeCodeFragmentStatus,
    RuntimeExitReason,
    RuntimeState,
} from '../../internal/runtimeTypes';

const ON_DID_CHANGE_RUNTIME_ITEMS_THROTTLE_THRESHOLD = 20;
const ON_DID_CHANGE_RUNTIME_ITEMS_THROTTLE_INTERVAL = 50;

function mergeRuntimeItemsChanges(
    pending: ConsoleRuntimeItemsChangeEvent[] | undefined,
    next: ConsoleRuntimeItemsChangeEvent[],
): ConsoleRuntimeItemsChangeEvent[] {
    const merged = [...(pending ?? []), ...next];
    return merged.some((change) => change.kind === 'restore')
        ? [{ kind: 'restore' }]
        : merged;
}

export interface SerializedConsoleState {
    version: 1 | 2;
    items: SerializedRuntimeItem[];
    inputHistory: string[];
    trace: boolean;
    wordWrap: boolean;
    inputPrompt?: string;
    continuationPrompt?: string;
    workingDirectory?: string;
}

export type SerializedRuntimeItem =
    | SerializedRuntimeActivity
    | SerializedRuntimeStarted
    | SerializedRuntimeRestarted
    | SerializedRuntimeStartup
    | SerializedRuntimeStartupFailure
    | SerializedRuntimeExited
    | SerializedRuntimeOffline
    | SerializedRuntimePendingInput
    | SerializedRuntimeTrace
    | SerializedRuntimeStarting
    | SerializedRuntimeReconnected;

export interface SerializedRuntimeActivity {
    type: 'activity';
    parentId: string;
    items: SerializedActivityItem[];
}

export interface SerializedRuntimeStarted {
    type: 'started';
    id: string;
    when: number;
    sessionName: string;
}

export interface SerializedRuntimeRestarted {
    type: 'restarted';
    id: string;
    when: number;
    sessionName: string;
}

export interface SerializedRuntimeStartup {
    type: 'startup';
    id: string;
    when: number;
    banner: string;
    version: string;
}

export interface SerializedRuntimeStartupFailure {
    type: 'startupFailure';
    id: string;
    when: number;
    message: string;
    details: string;
}

export interface SerializedRuntimeExited {
    type: 'exited';
    id: string;
    when: number;
    sessionName: string;
    exitCode: number;
    reason: string;
}

export interface SerializedRuntimeOffline {
    type: 'offline';
    id: string;
    when: number;
    sessionName: string;
    reason: string;
}

export interface SerializedRuntimePendingInput {
    type: 'pendingInput';
    id: string;
    when: number;
    inputPrompt: string;
    code: string;
}

export interface SerializedRuntimeTrace {
    type: 'trace';
    id: string;
    when: number;
    trace: string;
}

export interface SerializedRuntimeStarting {
    type: 'starting';
    id: string;
    when: number;
    message: string;
    attachMode: string;
    sessionName?: string; // Legacy compat
}

export interface SerializedRuntimeReconnected {
    type: 'reconnected';
    id: string;
    when: number;
    sessionName: string;
}

export type SerializedActivityItem =
    | SerializedActivityInput
    | SerializedActivityStream
    | SerializedActivityError
    | SerializedActivityOutput
    | SerializedActivityOutputHtml
    | SerializedActivityOutputPlot
    | SerializedActivityPrompt;

export interface SerializedActivityInput {
    type: 'input';
    id: string;
    parentId: string;
    when: number;
    state: ActivityItemInputState;
    inputPrompt: string;
    continuationPrompt: string;
    code: string;
}

export interface SerializedActivityStream {
    type: 'stream';
    id: string;
    parentId: string;
    when: number;
    streamType: ActivityItemStreamType;
    text: string;
}

export interface SerializedActivityError {
    type: 'error';
    id: string;
    parentId: string;
    when: number;
    name: string;
    message: string;
    traceback: string[];
}

export interface SerializedActivityOutput {
    type: 'output';
    id: string;
    parentId: string;
    when: number;
    data: ILanguageRuntimeMessageOutputData;
    outputId?: string;
}

export interface SerializedActivityOutputHtml {
    type: 'outputHtml';
    id: string;
    parentId: string;
    when: number;
    html: string;
    resource?: string;
    outputId?: string;
}

export interface SerializedActivityOutputPlot {
    type: 'outputPlot';
    id: string;
    parentId: string;
    when: number;
    data: ILanguageRuntimeMessageOutputData;
    outputId?: string;
}

export interface SerializedActivityPrompt {
    type: 'prompt';
    id: string;
    parentId: string;
    when: number;
    prompt: string;
    password: boolean;
    state?: ActivityItemPromptState;
    answer?: string;
}

interface IPendingCodeFragment {
    code: string;
    attribution: IConsoleCodeAttribution;
    executionId?: string;
    mode: RuntimeCodeExecutionMode;
    errorBehavior: RuntimeErrorBehavior;
}

/**
 * PositronConsoleInstance class (1:1 Positron).
 * Manages console state and output for a single session.
 */
export class PositronConsoleInstance implements IPositronConsoleInstance {
    //#region Private Properties
    private _state: PositronConsoleState = PositronConsoleState.Uninitialized;
    private _session: RuntimeSession | undefined;
    private _runtimeItems: RuntimeItem[] = [];
    private _runtimeItemActivities = new Map<string, RuntimeItemActivity>();
    private _trace = false;
    private _wordWrap = true;
    private _promptActive = false;
    private _inputPrompt = '>';
    private _continuationPrompt = '+';
    private _workingDirectory: string | undefined;
    private _activeActivityItemPrompt: ActivityItemPrompt | undefined;
    private _runtimeAttached = false;
    private _scrollbackSize = 1000;
    private _widthInChars = 80;
    private _nextId = 0;
    private _startupFailureHandled = false;
    private _startupFailureFallbackHandle: ReturnType<typeof setTimeout> | undefined;
    private readonly _disposables: vscode.Disposable[] = [];

    // Pending code queue (Positron pattern)
    private _pendingCodeQueue: IPendingCodeFragment[] = [];
    private _pendingExecutionIds = new Map<string, string>();
    private _externalExecutionIds = new Set<string>();
    private _pendingInputState: 'Idle' | 'Processing' | 'Interrupted' = 'Idle';
    private _pendingCode: string | undefined;
    private _runtimeItemPendingInput: RuntimeItemPendingInput | undefined;

    // Input history (1:1 Positron)
    private _inputHistory: string[] = [];
    private _inputHistoryIndex = -1;
    private _savedCurrentInput = '';

    // Event emitters (1:1 Positron naming)
    private readonly _onFocusInputEmitter = new vscode.EventEmitter<void>();
    private readonly _onDidChangeStateEmitter = new vscode.EventEmitter<PositronConsoleState>();
    private readonly _onDidChangeWordWrapEmitter = new vscode.EventEmitter<boolean>();
    private readonly _onDidChangeTraceEmitter = new vscode.EventEmitter<boolean>();
    private readonly _onDidChangeRuntimeItemsEmitter = new ThrottledEmitter<ConsoleRuntimeItemsChangeEvent[]>(
        ON_DID_CHANGE_RUNTIME_ITEMS_THROTTLE_THRESHOLD,
        ON_DID_CHANGE_RUNTIME_ITEMS_THROTTLE_INTERVAL,
        mergeRuntimeItemsChanges,
    );
    private readonly _onDidPasteTextEmitter = new vscode.EventEmitter<string>();
    private readonly _onDidSelectAllEmitter = new vscode.EventEmitter<void>();
    private readonly _onDidClearConsoleEmitter = new vscode.EventEmitter<void>();
    private readonly _onDidExecuteCodeEmitter = new vscode.EventEmitter<ILanguageRuntimeCodeExecutedEvent>();
    private readonly _onDidAttachSessionEmitter = new vscode.EventEmitter<RuntimeSession | undefined>();
    private readonly _onDidChangeInputStateEmitter = new vscode.EventEmitter<{ executionId: string; state: 'busy' | 'idle' }>();
    private readonly _onDidSetPendingCodeEmitter = new vscode.EventEmitter<string | undefined>();
    private readonly _onDidChangePendingInputEmitter = new vscode.EventEmitter<{ code?: string; inputPrompt: string }>();
    private readonly _onDidChangePromptEmitter = new vscode.EventEmitter<void>();
    private readonly _onDidChangeWorkingDirectoryEmitter = new vscode.EventEmitter<string | undefined>();

    // New event emitters for history and reveal (1:1 Positron)
    private readonly _onDidNavigateInputHistoryUpEmitter = new vscode.EventEmitter<DidNavigateInputHistoryEventArgs>();
    private readonly _onDidNavigateInputHistoryDownEmitter = new vscode.EventEmitter<DidNavigateInputHistoryEventArgs>();
    private readonly _onDidClearInputHistoryEmitter = new vscode.EventEmitter<void>();
    private readonly _onDidRevealExecutionEmitter = new vscode.EventEmitter<string>();
    //#endregion

    constructor(
        private readonly _sessionMetadata: RuntimeSessionMetadata,
        private readonly _runtimeMetadata: LanguageRuntimeMetadata,
        private readonly _outputChannel: vscode.LogOutputChannel
    ) {
        this._outputChannel.debug(`[ConsoleInstance] Created for session ${_sessionMetadata.sessionId}`);
    }

    //#region IPositronConsoleInstance Implementation
    get state(): PositronConsoleState { return this._state; }
    get sessionMetadata(): RuntimeSessionMetadata { return this._sessionMetadata; }
    get runtimeMetadata(): LanguageRuntimeMetadata { return this._runtimeMetadata; }
    get sessionId(): string { return this._sessionMetadata.sessionId; }
    get sessionName(): string { return this._sessionMetadata.sessionName || this._runtimeMetadata.runtimeName; }
    get runtimeItems(): RuntimeItem[] { return this._runtimeItems; }
    get trace(): boolean { return this._trace; }
    get wordWrap(): boolean { return this._wordWrap; }
    get promptActive(): boolean { return this._promptActive; }
    get runtimeAttached(): boolean { return this._runtimeAttached; }
    get inputPrompt(): string { return this._inputPrompt; }
    get continuationPrompt(): string { return this._continuationPrompt; }
    get workingDirectory(): string | undefined { return this._workingDirectory; }

    scrollLocked = false;
    lastScrollTop = 0;

    // Input history property (1:1 Positron)
    get inputHistory(): string[] { return [...this._inputHistory]; }

    // Events
    readonly onFocusInput = this._onFocusInputEmitter.event;
    readonly onDidChangeState = this._onDidChangeStateEmitter.event;
    readonly onDidChangeWordWrap = this._onDidChangeWordWrapEmitter.event;
    readonly onDidChangeTrace = this._onDidChangeTraceEmitter.event;
    readonly onDidChangeRuntimeItems = this._onDidChangeRuntimeItemsEmitter.event;
    readonly onDidPasteText = this._onDidPasteTextEmitter.event;
    readonly onDidSelectAll = this._onDidSelectAllEmitter.event;
    readonly onDidClearConsole = this._onDidClearConsoleEmitter.event;
    readonly onDidExecuteCode = this._onDidExecuteCodeEmitter.event;
    readonly onDidAttachSession = this._onDidAttachSessionEmitter.event;
    readonly onDidChangeInputState = this._onDidChangeInputStateEmitter.event;
    readonly onDidSetPendingCode = this._onDidSetPendingCodeEmitter.event;
    readonly onDidChangePendingInput = this._onDidChangePendingInputEmitter.event;
    readonly onDidChangePrompt = this._onDidChangePromptEmitter.event;
    readonly onDidChangeWorkingDirectory = this._onDidChangeWorkingDirectoryEmitter.event;

    // New events for history and reveal (1:1 Positron)
    readonly onDidNavigateInputHistoryUp = this._onDidNavigateInputHistoryUpEmitter.event;
    readonly onDidNavigateInputHistoryDown = this._onDidNavigateInputHistoryDownEmitter.event;
    readonly onDidClearInputHistory = this._onDidClearInputHistoryEmitter.event;
    readonly onDidRevealExecution = this._onDidRevealExecutionEmitter.event;

    /**
     * Serializes the console state for persistence.
     */
    serializeState(): SerializedConsoleState {
        const items: SerializedRuntimeItem[] = [];
        for (const item of this._runtimeItems) {
            const serialized = this._serializeRuntimeItem(item);
            if (serialized) {
                items.push(serialized);
            }
        }

        // Input history is stored oldest -> newest for easier replay
        const inputHistory = [...this._inputHistory].reverse();

        return {
            version: 2,
            items,
            inputHistory,
            trace: this._trace,
            wordWrap: this._wordWrap,
            inputPrompt: this._inputPrompt,
            continuationPrompt: this._continuationPrompt,
            workingDirectory: this._workingDirectory,
        };
    }

    private _emitRuntimeItemsChange(change: ConsoleRuntimeItemsChangeEvent): void {
        this._onDidChangeRuntimeItemsEmitter.fire([change]);
    }

    private _emitRuntimeItemsRestoreRequired(): void {
        this._emitRuntimeItemsChange({ kind: 'restore' });
    }

    private _emitAppendRuntimeItem(item: RuntimeItem): void {
        const serialized = this._serializeRuntimeItem(item);
        if (!serialized) {
            this._emitRuntimeItemsRestoreRequired();
            return;
        }

        this._emitRuntimeItemsChange({
            kind: 'appendRuntimeItem',
            item: serialized,
        });
    }

    private _emitAppendActivityItem(parentId: string, item: ActivityItem): void {
        const serialized = this._serializeActivityItem(item);
        if (!serialized) {
            this._emitRuntimeItemsRestoreRequired();
            return;
        }

        this._emitRuntimeItemsChange({
            kind: 'appendActivityItem',
            parentId,
            item: serialized,
        });
    }

    private _emitReplaceActivityOutput(parentId: string, outputId: string, item: ActivityItem): void {
        const serialized = this._serializeActivityItem(item);
        if (!serialized) {
            this._emitRuntimeItemsRestoreRequired();
            return;
        }

        this._emitRuntimeItemsChange({
            kind: 'replaceActivityOutput',
            parentId,
            outputId,
            item: serialized,
        });
    }

    private _emitUpdateActivityInputState(parentId: string, state: ActivityItemInputState): void {
        this._emitRuntimeItemsChange({
            kind: 'updateActivityInputState',
            parentId,
            state,
        });
    }

    /**
     * Restores the console state from persisted data.
     */
    restoreState(state: SerializedConsoleState): void {
        if (!state || (state.version !== 1 && state.version !== 2)) {
            return;
        }

        this._runtimeItems = [];
        this._runtimeItemActivities.clear();
        this._runtimeItemPendingInput = undefined;
        this._pendingCodeQueue = [];
        this._pendingCode = undefined;

        for (const item of state.items) {
            switch (item.type) {
                case 'activity': {
                    const activityItems = item.items
                        .map(serialized => this._deserializeActivityItem(serialized))
                        .filter((entry): entry is ActivityItem => entry !== undefined);

                    if (activityItems.length === 0) {
                        break;
                    }

                    const activity = new RuntimeItemActivity(item.parentId, activityItems[0]);
                    for (let i = 1; i < activityItems.length; i++) {
                        activity.addActivityItem(activityItems[i]);
                    }

                    this._runtimeItemActivities.set(item.parentId, activity);
                    this._runtimeItems.push(activity);
                    break;
                }
                case 'started':
                    this._runtimeItems.push(new RuntimeItemStarted(
                        item.id,
                        new Date(item.when),
                        item.sessionName
                    ));
                    break;
                case 'restarted':
                    this._runtimeItems.push(new RuntimeItemRestarted(
                        item.id,
                        new Date(item.when),
                        item.sessionName
                    ));
                    break;
                case 'startup':
                    this._runtimeItems.push(new RuntimeItemStartup(
                        item.id,
                        new Date(item.when),
                        item.banner,
                        item.version
                    ));
                    break;
                case 'startupFailure':
                    this._runtimeItems.push(new RuntimeItemStartupFailure(
                        item.id,
                        new Date(item.when),
                        item.message,
                        item.details
                    ));
                    break;
                case 'exited':
                    this._runtimeItems.push(new RuntimeItemExited(
                        item.id,
                        new Date(item.when),
                        item.sessionName || this.sessionName,
                        item.exitCode,
                        item.reason
                    ));
                    break;
                case 'offline':
                    this._runtimeItems.push(new RuntimeItemOffline(
                        item.id,
                        new Date(item.when),
                        item.sessionName,
                        item.reason
                    ));
                    break;
                case 'pendingInput': {
                    const inputPrompt = (item as SerializedRuntimePendingInput).inputPrompt ?? (item as any).prompt ?? '';
                    const code = (item as SerializedRuntimePendingInput).code ?? '';
                    const pendingInput = new RuntimeItemPendingInput(
                        item.id,
                        new Date(item.when),
                        inputPrompt,
                        { source: 'console' },
                        undefined,
                        code,
                        RuntimeCodeExecutionMode.Interactive
                    );
                    this._runtimeItems.push(pendingInput);
                    this._runtimeItemPendingInput = pendingInput;
                    break;
                }
                case 'trace':
                    this._runtimeItems.push(new RuntimeItemTrace(
                        item.id,
                        new Date(item.when),
                        item.trace
                    ));
                    break;
                case 'starting':
                    this._runtimeItems.push(new RuntimeItemStarting(
                        item.id,
                        new Date(item.when),
                        item.message || item.sessionName || '',
                        (item.attachMode as SessionAttachMode) || SessionAttachMode.Starting
                    ));
                    break;
                case 'reconnected':
                    this._runtimeItems.push(new RuntimeItemReconnected(
                        item.id,
                        new Date(item.when),
                        item.sessionName
                    ));
                    break;
            }
        }

        this._inputHistory = [...state.inputHistory].reverse();
        this._inputHistoryIndex = -1;
        this._savedCurrentInput = '';
        this._trace = state.trace;
        this._wordWrap = state.wordWrap;
        this._inputPrompt = state.inputPrompt ?? '>';
        this._continuationPrompt = state.continuationPrompt ?? '+';
        this._workingDirectory = state.workingDirectory;

        this._emitRuntimeItemsRestoreRequired();
        this._onDidChangeTraceEmitter.fire(this._trace);
        this._onDidChangeWordWrapEmitter.fire(this._wordWrap);
    }

    focusInput(): void { this._onFocusInputEmitter.fire(); }

    setWidthInChars(newWidth: number): void {
        if (this._widthInChars !== newWidth) {
            this._widthInChars = newWidth;
        }
    }

    getWidthInChars(): number { return this._widthInChars; }

    toggleTrace(): void {
        this._trace = !this._trace;
        this._onDidChangeTraceEmitter.fire(this._trace);
    }

    toggleWordWrap(): void {
        this._wordWrap = !this._wordWrap;
        this._onDidChangeWordWrapEmitter.fire(this._wordWrap);
    }

    pasteText(text: string): void { this._onDidPasteTextEmitter.fire(text); }
    selectAll(): void { this._onDidSelectAllEmitter.fire(); }

    clearConsole(): boolean {
        // Cannot clear console while prompt is active (Positron pattern)
        if (this._activeActivityItemPrompt) {
            void vscode.window.showInformationMessage(
                'Cannot clear console. A prompt is active.',
            );
            return false;
        }
        this._runtimeItems = [];
        this._runtimeItemActivities.clear();
        this._runtimeItemPendingInput = undefined;
        this._pendingCodeQueue = [];
        this._pendingCode = undefined;
        this._onDidClearConsoleEmitter.fire();
        this._emitRuntimeItemsRestoreRequired();
        return true;
    }

    completeStartup(): void {
        if (
            this._state === PositronConsoleState.Starting ||
            this._state === PositronConsoleState.Restarting ||
            (this._state === PositronConsoleState.Busy && this.hasStartingItem())
        ) {
            this.setState(PositronConsoleState.Ready);
        }
    }

    addRuntimeStartupBanner(banner: string, version: string = ''): void {
        if (!banner) {
            return;
        }

        const lastItem = this._runtimeItems[this._runtimeItems.length - 1];
        if (
            lastItem instanceof RuntimeItemStartup &&
            lastItem.banner === banner &&
            lastItem.version === version
        ) {
            return;
        }

        this._runtimeItems.push(
            new RuntimeItemStartup(this.generateId(), new Date(), banner, version)
        );
        this._emitAppendRuntimeItem(this._runtimeItems[this._runtimeItems.length - 1]);
    }

    interrupt(code?: string): void {
        // If a prompt is active, interrupt it (Positron pattern)
        if (this._activeActivityItemPrompt) {
            this._activeActivityItemPrompt.state = ActivityItemPromptState.Interrupted;
            this._emitRuntimeItemsRestoreRequired();
            this._activeActivityItemPrompt = undefined;
            this._promptActive = false;
        }

        const runtimeState = this._session?.state ?? RuntimeState.Uninitialized;

        if (this._session) {
            this._session.interrupt();
        }

        this.clearPendingInput();
        this.setPendingCode();

        if (
            this._session &&
            (runtimeState === RuntimeState.Ready || runtimeState === RuntimeState.Idle)
        ) {
            const executionId = this.generateExecutionId(code);
            const inputItem = new ActivityItemInput(
                this.generateId(),
                executionId,
                new Date(),
                ActivityItemInputState.Cancelled,
                this._inputPrompt,
                this._continuationPrompt,
                code ?? '',
            );
            this.addOrUpdateRuntimeItemActivity(executionId, inputItem);
        }

        setTimeout(() => {
            this.focusInput();
        }, 0);
    }

    /**
     * Enqueues code for execution (Positron pattern).
     * Handles queueing, pending input visuals, and completeness checks.
     */
    async enqueueCode(
        code: string,
        attribution: IConsoleCodeAttribution,
        allowIncomplete: boolean = false,
        mode: RuntimeCodeExecutionMode = RuntimeCodeExecutionMode.Interactive,
        errorBehavior: RuntimeErrorBehavior = RuntimeErrorBehavior.Continue,
        executionId?: string,
    ): Promise<void> {
        if (executionId) {
            this._externalExecutionIds.add(executionId);
        }

        if (this._runtimeItemPendingInput) {
            this.addPendingInput(code, attribution, executionId, mode, errorBehavior);
            return;
        }

        const runtimeState = this._session?.state ?? RuntimeState.Uninitialized;
        if (!(runtimeState === RuntimeState.Idle || runtimeState === RuntimeState.Ready)) {
            this.addPendingInput(code, attribution, executionId, mode, errorBehavior);
            return;
        }

        const shouldExecuteCode = async (codeToCheck: string): Promise<boolean> => {
            if (!this._session) {
                return false;
            }
            if (allowIncomplete) {
                return true;
            }

            try {
                return (
                    (await this._session.isCodeFragmentComplete(codeToCheck)) ===
                    RuntimeCodeFragmentStatus.Complete
                );
            } catch (error) {
                this._outputChannel.warn(
                    `[ConsoleInstance] Failed code completeness check: ${String(error)}`,
                );
                return false;
            }
        };

        // `allowIncomplete` is only used by console input execution.
        // In that path, the webview already sends the full current editor text.
        // Avoid re-prepending stale pending code from a prior incomplete submission.
        if (mode === RuntimeCodeExecutionMode.Interactive && !allowIncomplete) {
            let pendingCode = this._pendingCode;
            if (pendingCode) {
                if (!executionId) {
                    const storedExecutionId = this._pendingExecutionIds.get(code);
                    if (storedExecutionId) {
                        executionId = storedExecutionId;
                    }
                }

                pendingCode += '\n' + code;
                if (await shouldExecuteCode(pendingCode)) {
                    this.setPendingCode();
                    this.doExecuteCode(
                        pendingCode,
                        attribution,
                        executionId,
                        mode,
                        errorBehavior,
                    );
                } else {
                    this.setPendingCode(pendingCode, executionId);
                }
                return;
            }
        }

        if (await shouldExecuteCode(code)) {
            this.doExecuteCode(code, attribution, executionId, mode, errorBehavior);
        } else {
            this.setPendingCode(code, executionId);
        }
    }

    /**
     * Executes code immediately.
     */
    executeCode(
        code: string,
        attribution: IConsoleCodeAttribution,
        mode: RuntimeCodeExecutionMode = RuntimeCodeExecutionMode.Interactive,
        errorBehavior: RuntimeErrorBehavior = RuntimeErrorBehavior.Continue,
        executionId?: string,
    ): void {
        this.setPendingCode();
        this.doExecuteCode(code, attribution, executionId, mode, errorBehavior);
    }

    /**
     * Internal method to actually execute code.
     */
    private doExecuteCode(
        code: string,
        attribution: IConsoleCodeAttribution,
        executionId?: string,
        mode: RuntimeCodeExecutionMode = RuntimeCodeExecutionMode.Interactive,
        errorBehavior: RuntimeErrorBehavior = RuntimeErrorBehavior.Continue,
    ): void {
        if (!this._session) {
            this._outputChannel.warn('[ConsoleInstance] Cannot execute code: no session attached');
            return;
        }

        const execId = executionId || this.generateExecutionId(code);

        if (mode !== RuntimeCodeExecutionMode.Silent) {
            const inputPrompt = this._inputPrompt;
            const continuationPrompt = this._continuationPrompt;
            const inputItem = new ActivityItemInput(
                this.generateId(),
                execId,
                new Date(),
                ActivityItemInputState.Provisional,
                inputPrompt,
                continuationPrompt,
                code,
            );
            this.addOrUpdateRuntimeItemActivity(execId, inputItem);
        }

        this.setPendingCode();
        this._session.execute(code, execId, mode, errorBehavior);

        if (mode !== RuntimeCodeExecutionMode.Silent) {
            this.addToInputHistory(code);
        }

        this._onDidExecuteCodeEmitter.fire({
            executionId: execId,
            sessionId: this.sessionId,
            code,
            mode,
            attribution,
            errorBehavior,
            languageId: this._runtimeMetadata.languageId,
            runtimeName: this._runtimeMetadata.runtimeName,
        });
    }

    private setPendingCode(pendingCode?: string, executionId?: string): void {
        this._pendingCode = pendingCode;

        if (pendingCode && executionId) {
            this._pendingExecutionIds.set(pendingCode, executionId);
        } else if (!pendingCode) {
            this._pendingExecutionIds.clear();
        }

        this._onDidSetPendingCodeEmitter.fire(pendingCode);
    }

    private addPendingInput(
        code: string,
        attribution: IConsoleCodeAttribution,
        executionId: string | undefined,
        mode: RuntimeCodeExecutionMode,
        errorBehavior: RuntimeErrorBehavior,
    ): void {
        this._pendingCodeQueue.push({
            code,
            attribution,
            executionId,
            mode,
            errorBehavior,
        });

        if (mode === RuntimeCodeExecutionMode.Silent) {
            return;
        }

        this.removePendingInputRuntimeItem();

        const interactiveCode = this._pendingCodeQueue
            .filter((item) => item.mode === RuntimeCodeExecutionMode.Interactive)
            .map((item) => item.code.trimEnd())
            .join('\n');

        if (!interactiveCode) {
            this._emitRuntimeItemsRestoreRequired();
            return;
        }

        const inputPrompt = this._inputPrompt;
        this._runtimeItemPendingInput = new RuntimeItemPendingInput(
            this.generateId(),
            new Date(),
            inputPrompt,
            attribution,
            executionId,
            interactiveCode,
            mode,
        );
        this._runtimeItems.push(this._runtimeItemPendingInput);
        this._emitRuntimeItemsRestoreRequired();
        this._onDidChangePendingInputEmitter.fire({ code: interactiveCode, inputPrompt });
    }

    private clearPendingInput(): void {
        this._pendingCodeQueue = [];

        const removed = this.removePendingInputRuntimeItem();
        if (removed) {
            this._emitRuntimeItemsRestoreRequired();
            this._onDidChangePendingInputEmitter.fire({ code: undefined, inputPrompt: this._inputPrompt });
        }

        if (this._pendingInputState === 'Processing') {
            this._pendingInputState = 'Interrupted';
        }
    }

    private async processPendingInput(): Promise<void> {
        if (this._pendingInputState !== 'Idle') {
            return;
        }

        this._pendingInputState = 'Processing';

        try {
            await this.processPendingInputImpl();
        } finally {
            this._pendingInputState = 'Idle';
        }
    }

    private async processPendingInputImpl(): Promise<void> {
        if (this._pendingCodeQueue.length === 0 || !this._session) {
            return;
        }

        const pendingItem = this._pendingCodeQueue[0];
        const codeFragmentStatus = await this._session.isCodeFragmentComplete(pendingItem.code);

        if (this._pendingInputState === 'Interrupted') {
            return;
        }

        if (codeFragmentStatus !== RuntimeCodeFragmentStatus.Complete) {
            this._pendingCodeQueue.shift();

            const removed = this.removePendingInputRuntimeItem();
            if (removed) {
                this._emitRuntimeItemsRestoreRequired();
            }

            this.setPendingCode(pendingItem.code, pendingItem.executionId);
            return;
        }

        // The code is complete, so execute it (Positron inline pattern).
        const id = pendingItem.executionId || this.generateExecutionId(pendingItem.code);

        // Create the provisional ActivityItemInput inline (not via doExecuteCode).
        // This ensures the activity block appears in-place after the pending input
        // is removed, rather than creating a new block at the end of the list.
        if (pendingItem.mode !== RuntimeCodeExecutionMode.Silent) {
            const runtimeItemActivity = new RuntimeItemActivity(
                id,
                new ActivityItemInput(
                    this.generateId(),
                    id,
                    new Date(),
                    ActivityItemInputState.Provisional,
                    this._inputPrompt,
                    this._continuationPrompt,
                    pendingItem.code
                )
            );
            this._runtimeItems.push(runtimeItemActivity);
            this._runtimeItemActivities.set(id, runtimeItemActivity);
        }

        this._pendingCodeQueue.shift();

        // Remove the pending input visual item
        if (this._runtimeItemPendingInput) {
            const index = this._runtimeItems.indexOf(this._runtimeItemPendingInput);
            if (index > -1) {
                this._runtimeItems.splice(index, 1);
            }
        }

        if (this._pendingCodeQueue.length > 0) {
            const nextItem = this._pendingCodeQueue[0];
            if (nextItem.mode !== RuntimeCodeExecutionMode.Silent) {
                this._runtimeItemPendingInput = new RuntimeItemPendingInput(
                    this.generateId(),
                    new Date(),
                    this._inputPrompt,
                    nextItem.attribution,
                    nextItem.executionId,
                    nextItem.code,
                    nextItem.mode,
                );
                this._runtimeItems.push(this._runtimeItemPendingInput);
            } else {
                this._runtimeItemPendingInput = undefined;
            }
        } else {
            this._runtimeItemPendingInput = undefined;
        }

        // Fire events
        const pendingInputPrompt = this._inputPrompt;
        this._emitRuntimeItemsRestoreRequired();
        this._onDidChangePendingInputEmitter.fire({
            code: this._runtimeItemPendingInput?.code,
            inputPrompt: pendingInputPrompt,
        });

        // Execute directly (Positron pattern - don't use doExecuteCode)
        this.setPendingCode();
        this._session.execute(pendingItem.code, id, pendingItem.mode, pendingItem.errorBehavior);

        if (pendingItem.mode !== RuntimeCodeExecutionMode.Silent) {
            this.addToInputHistory(pendingItem.code);
        }

        this._onDidExecuteCodeEmitter.fire({
            executionId: id,
            sessionId: this.sessionId,
            code: pendingItem.code,
            mode: pendingItem.mode as RuntimeCodeExecutionMode,
            attribution: pendingItem.attribution,
            errorBehavior: pendingItem.errorBehavior as RuntimeErrorBehavior,
            languageId: this._runtimeMetadata.languageId,
            runtimeName: this._runtimeMetadata.runtimeName,
        });
    }

    private removePendingInputRuntimeItem(): boolean {
        if (!this._runtimeItemPendingInput) {
            return false;
        }

        const index = this._runtimeItems.indexOf(this._runtimeItemPendingInput);
        this._runtimeItemPendingInput = undefined;

        if (index > -1) {
            this._runtimeItems.splice(index, 1);
            return true;
        }

        return false;
    }

    replyToPrompt(value: string): void {
        if (this._session && this._activeActivityItemPrompt) {
            const id = this._activeActivityItemPrompt.id;
            this._activeActivityItemPrompt.state = ActivityItemPromptState.Answered;
            this._activeActivityItemPrompt.answer = !this._activeActivityItemPrompt.password ? value : '';
            this._activeActivityItemPrompt = undefined;
            this._promptActive = false;
            this._emitRuntimeItemsRestoreRequired();
            this._session.replyToPrompt(id, value);
        }
    }

    // =========================================================================
    // Typed message handlers (1:1 Positron pattern)
    // Each handler receives a properly typed message — no `as any` casts.
    // =========================================================================

    handleStream(message: LanguageRuntimeStream): void {
        this.handleStreamOutput(message.parent_id, message.name, message.text);
    }

    handleError(message: LanguageRuntimeErrorMessage): void {
        this.handleErrorMessage(
            message.parent_id,
            message.name,
            message.message,
            message.traceback || []
        );
    }

    handleOutput(message: LanguageRuntimeOutputWithKind): void {
        const activityItem = this.createActivityItemOutput(message);
        if (!activityItem) {
            return;
        }
        this.addOrUpdateRuntimeItemActivity(message.parent_id, activityItem);
    }

    handleResult(message: LanguageRuntimeResultWithKind): void {
        const activityItem = this.createActivityItemOutput(message);
        if (!activityItem) {
            return;
        }
        this.addOrUpdateRuntimeItemActivity(message.parent_id, activityItem);
    }

    handleUpdateOutput(message: LanguageRuntimeUpdateOutputWithKind): void {
        const activityItem = this.createActivityItemOutput(message);
        if (!activityItem) {
            return;
        }

        const outputId = message.output_id;
        if (!outputId) {
            this.addOrUpdateRuntimeItemActivity(message.parent_id, activityItem);
            return;
        }

        const preferredActivity = this._runtimeItemActivities.get(message.parent_id);
        const preferredReplacement = this.createActivityItemOutput(message, message.parent_id);
        if (preferredActivity && preferredReplacement && preferredActivity.replaceOutputItemByOutputId(outputId, preferredReplacement)) {
            this._emitReplaceActivityOutput(message.parent_id, outputId, preferredReplacement);
            return;
        }

        for (const [activityParentId, activity] of this._runtimeItemActivities.entries()) {
            if (activityParentId === message.parent_id) {
                continue;
            }

            const replacement = this.createActivityItemOutput(message, activityParentId);
            if (replacement && activity.replaceOutputItemByOutputId(outputId, replacement)) {
                this._emitReplaceActivityOutput(activityParentId, outputId, replacement);
                return;
            }
        }

        this.addOrUpdateRuntimeItemActivity(message.parent_id, activityItem);
    }

    handleInput(message: LanguageRuntimeInput): void {
        const inputPrompt = this._inputPrompt;
        const continuationPrompt = this._continuationPrompt;
        const inputItem = new ActivityItemInput(
            message.id || this.generateId(),
            message.parent_id,
            message.when ? new Date(message.when) : new Date(),
            ActivityItemInputState.Executing,
            inputPrompt,
            continuationPrompt,
            message.code
        );
        this.addOrUpdateRuntimeItemActivity(message.parent_id, inputItem);

        // Update input history for runtime-driven executions
        this.addToInputHistory(message.code);

        // If this was direct injection, fire execute event for history (Positron pattern)
        if (
            typeof message.parent_id === 'string' &&
            message.parent_id.startsWith('direct-injection-')
        ) {
            this._onDidExecuteCodeEmitter.fire({
                executionId: message.parent_id,
                sessionId: this.sessionId,
                code: message.code,
                mode: RuntimeCodeExecutionMode.Interactive,
                attribution: { source: 'direct-injection' },
                errorBehavior: RuntimeErrorBehavior.Continue,
                languageId: this._runtimeMetadata.languageId,
                runtimeName: this._runtimeMetadata.runtimeName,
            });
        }
    }

    handlePrompt(message: LanguageRuntimePrompt): void {
        this._promptActive = true;
        this._activeActivityItemPrompt = new ActivityItemPrompt(
            message.id || this.generateId(),
            message.parent_id,
            message.when ? new Date(message.when) : new Date(),
            message.prompt,
            message.password
        );
        this.addOrUpdateRuntimeItemActivity(message.parent_id, this._activeActivityItemPrompt);
    }

    handleClearOutput(message: LanguageRuntimeClearOutput): void {
        // Jupyter clear_output clears the output area of the current cell,
        // NOT the entire console. Console clearing comes from UI ClearConsole event.
        const activity = this._runtimeItemActivities.get(message.parent_id);
        if (activity) {
            activity.clearOutputItems();
            this.optimizeScrollback();
            this._emitRuntimeItemsChange({
                kind: 'clearActivityOutput',
                parentId: message.parent_id,
            });
        }
    }

    handleState(message: LanguageRuntimeState): void {
        const CONSOLE_EXEC_PREFIX = 'fragment-';
        if (message.state === 'busy' as RuntimeOnlineState) {
            // Positron 1:1: Only update console state for our own executions
            // or tracked external ones (Positron pattern)
            if (message.parent_id.startsWith(CONSOLE_EXEC_PREFIX) ||
                this._externalExecutionIds.has(message.parent_id) ||
                this._state === PositronConsoleState.Offline ||
                this._state === PositronConsoleState.Starting ||
                this._state === PositronConsoleState.Restarting) {
                this.setState(PositronConsoleState.Busy);
            }
            this.markInputBusyState(message.parent_id, true);
        } else if (message.state === 'idle' as RuntimeOnlineState) {
            if (message.parent_id.startsWith(CONSOLE_EXEC_PREFIX) ||
                this._externalExecutionIds.has(message.parent_id) ||
                this._state === PositronConsoleState.Offline ||
                this._state === PositronConsoleState.Restarting) {
                this.setState(PositronConsoleState.Ready);
            }
            this.markExecutionCompleted(message.parent_id);
        }
    }

    handlePromptStateChange(data: Partial<PromptStateEvent>): void {
        let changed = false;

        if (typeof data.input_prompt === 'string') {
            const inputPrompt = data.input_prompt.trimEnd();
            if (inputPrompt !== this._inputPrompt) {
                this._inputPrompt = inputPrompt;
                changed = true;
            }
        }

        if (typeof data.continuation_prompt === 'string') {
            const continuationPrompt = data.continuation_prompt.trimEnd();
            if (continuationPrompt !== this._continuationPrompt) {
                this._continuationPrompt = continuationPrompt;
                changed = true;
            }
        }

        if (changed) {
            this._onDidChangePromptEmitter.fire();
        }
    }

    handleWorkingDirectoryChange(data: Partial<WorkingDirectoryEvent>): void {
        if (typeof data.directory !== 'string' || data.directory === this._workingDirectory) {
            return;
        }

        this._workingDirectory = data.directory;
        this._onDidChangeWorkingDirectoryEmitter.fire(this._workingDirectory);
    }

    attachRuntimeSession(session: RuntimeSession | undefined, mode: SessionAttachMode): void {
        this._outputChannel.debug(`[ConsoleInstance] Attaching session: ${session?.sessionId}, mode: ${mode}`);

        // Detach from old session
        if (this._session) {
            this.detachRuntimeSession();
        }

        this._session = session;
        this._runtimeAttached = true;
        this._startupFailureHandled = false;
        this._clearStartupFailureFallback();

        if (session) {
            const inputPrompt = session.dynState.inputPrompt?.trimEnd();
            const continuationPrompt = session.dynState.continuationPrompt?.trimEnd();
            const workingDirectory = session.workingDirectory;
            let promptChanged = false;

            if (typeof inputPrompt === 'string' && inputPrompt !== this._inputPrompt) {
                this._inputPrompt = inputPrompt;
                promptChanged = true;
            }

            if (typeof continuationPrompt === 'string' && continuationPrompt !== this._continuationPrompt) {
                this._continuationPrompt = continuationPrompt;
                promptChanged = true;
            }

            if (promptChanged) {
                this._onDidChangePromptEmitter.fire();
            }

            if (workingDirectory !== this._workingDirectory) {
                this._workingDirectory = workingDirectory;
                this._onDidChangeWorkingDirectoryEmitter.fire(this._workingDirectory);
            }

            // Emit start runtime items (Positron pattern: show "Starting..." first)
            if (mode !== SessionAttachMode.Reconnecting) {
                this.emitStartRuntimeItems(mode);
            }
            this.subscribeToSessionEvents(session);

            // Seed the console state from the currently attached runtime when the
            // runtime already has meaningful state. Without this, reconnect/
            // attach flows can lag behind runtime truth until the next event.
            if (session.state !== RuntimeState.Uninitialized) {
                this.handleRuntimeStateChange(session.state);
            }
        } else {
            this._runtimeAttached = false;
            this.setState(PositronConsoleState.Disconnected);
        }

        this._onDidAttachSessionEmitter.fire(session);
    }

    get attachedRuntimeSession(): RuntimeSession | undefined { return this._session; }

    //#region Input History Methods (1:1 Positron)
    /**
     * Navigate up in input history.
     * @param currentInput The current text in the input
     * @param usePrefixMatch If true, only match history items starting with currentInput
     * @returns The history item, or undefined if at end of history
     */
    navigateInputHistoryUp(currentInput: string, usePrefixMatch?: boolean): string | undefined {
        if (this._inputHistory.length === 0) {
            return undefined;
        }

        // Save current input when starting navigation
        if (this._inputHistoryIndex === -1) {
            this._savedCurrentInput = currentInput;
        }

        // Find next matching item in history
        for (let i = this._inputHistoryIndex + 1; i < this._inputHistory.length; i++) {
            const item = this._inputHistory[i];
            if (!usePrefixMatch || item.startsWith(currentInput)) {
                this._inputHistoryIndex = i;
                this._onDidNavigateInputHistoryUpEmitter.fire({ currentInput, usePrefixMatch: usePrefixMatch ?? false });
                return item;
            }
        }

        return undefined;
    }

    /**
     * Navigate down in input history.
     * @param currentInput The current text in the input
     * @param usePrefixMatch If true, only match history items starting with savedCurrentInput
     * @returns The history item or the saved current input, or undefined if already at current
     */
    navigateInputHistoryDown(currentInput: string, usePrefixMatch?: boolean): string | undefined {
        if (this._inputHistoryIndex <= 0) {
            // Back to current input
            if (this._inputHistoryIndex === 0) {
                this._inputHistoryIndex = -1;
                this._onDidNavigateInputHistoryDownEmitter.fire({ currentInput, usePrefixMatch: usePrefixMatch ?? false });
                return this._savedCurrentInput;
            }
            return undefined;
        }

        // Find previous matching item in history
        for (let i = this._inputHistoryIndex - 1; i >= 0; i--) {
            const item = this._inputHistory[i];
            if (!usePrefixMatch || item.startsWith(this._savedCurrentInput)) {
                this._inputHistoryIndex = i;
                this._onDidNavigateInputHistoryDownEmitter.fire({ currentInput, usePrefixMatch: usePrefixMatch ?? false });
                return item;
            }
        }

        // No match found, return to current input
        this._inputHistoryIndex = -1;
        return this._savedCurrentInput;
    }

    /**
     * Clear input history.
     */
    clearInputHistory(): void {
        this._inputHistory = [];
        this._inputHistoryIndex = -1;
        this._savedCurrentInput = '';
        this._onDidClearInputHistoryEmitter.fire();
        this._outputChannel.debug('[ConsoleInstance] Input history cleared');
    }

    /**
     * Add entry to input history.
     * @param code The code to add to history
     */
    addToInputHistory(code: string): void {
        // Don't add empty strings or duplicates of last entry
        if (!code.trim() || (this._inputHistory.length > 0 && this._inputHistory[0] === code)) {
            return;
        }

        // Add to beginning of history (most recent first)
        this._inputHistory.unshift(code);

        // Limit history size (Positron uses 1000)
        const maxHistorySize = 1000;
        if (this._inputHistory.length > maxHistorySize) {
            this._inputHistory.pop();
        }

        // Reset navigation index
        this._inputHistoryIndex = -1;
        this._savedCurrentInput = '';
    }
    //#endregion

    //#region Reveal and Clipboard Methods (1:1 Positron)
    /**
     * Reveal (scroll to and highlight) a specific execution.
     * @param executionId The execution ID to reveal
     */
    revealExecution(executionId: string): boolean {
        const activity = this._runtimeItemActivities.get(executionId);
        if (!activity) {
            return false;
        }

        this._onDidRevealExecutionEmitter.fire(executionId);
        this._outputChannel.debug(`[ConsoleInstance] Revealing execution: ${executionId}`);
        return true;
    }

    /**
     * Get clipboard representation of console content.
     * @param commentPrefix The prefix to use for comment lines (e.g., "# " for R)
     * @returns Formatted string suitable for clipboard
     */
    getClipboardRepresentation(commentPrefix: string): string {
        return this._runtimeItems
            .flatMap((item) => item.getClipboardRepresentation(commentPrefix))
            .join('\n');
    }
    //#endregion

    private _serializeRuntimeItem(item: RuntimeItem): SerializedRuntimeItem | undefined {
        if (item instanceof RuntimeItemActivity) {
            const activityItems = item.activityItems
                .map(activity => this._serializeActivityItem(activity))
                .filter((entry): entry is SerializedActivityItem => entry !== undefined);
            return {
                type: 'activity',
                parentId: item.parentId,
                items: activityItems
            };
        }

        if (item instanceof RuntimeItemStarted) {
            return {
                type: 'started',
                id: item.id,
                when: item.when.getTime(),
                sessionName: item.sessionName
            };
        }

        if (item instanceof RuntimeItemRestarted) {
            return {
                type: 'restarted',
                id: item.id,
                when: item.when.getTime(),
                sessionName: item.sessionName
            };
        }

        if (item instanceof RuntimeItemStartup) {
            return {
                type: 'startup',
                id: item.id,
                when: item.when.getTime(),
                banner: item.banner,
                version: item.version
            };
        }

        if (item instanceof RuntimeItemStartupFailure) {
            return {
                type: 'startupFailure',
                id: item.id,
                when: item.when.getTime(),
                message: item.message,
                details: item.getClipboardRepresentation('').join('\n')
            };
        }

        if (item instanceof RuntimeItemExited) {
            return {
                type: 'exited',
                id: item.id,
                when: item.when.getTime(),
                sessionName: item.sessionName,
                exitCode: item.exitCode,
                reason: item.reason
            };
        }

        if (item instanceof RuntimeItemOffline) {
            return {
                type: 'offline',
                id: item.id,
                when: item.when.getTime(),
                sessionName: item.sessionName,
                reason: item.reason
            };
        }

        if (item instanceof RuntimeItemPendingInput) {
            return {
                type: 'pendingInput',
                id: item.id,
                when: item.when.getTime(),
                inputPrompt: item.inputPrompt,
                code: item.code
            };
        }

        if (item instanceof RuntimeItemTrace) {
            return {
                type: 'trace',
                id: item.id,
                when: item.when.getTime(),
                trace: item.trace
            };
        }

        if (item instanceof RuntimeItemStarting) {
            return {
                type: 'starting',
                id: item.id,
                when: item.when.getTime(),
                message: item.message,
                attachMode: item.attachMode
            };
        }

        if (item instanceof RuntimeItemReconnected) {
            return {
                type: 'reconnected',
                id: item.id,
                when: item.when.getTime(),
                sessionName: item.sessionName
            };
        }

        return undefined;
    }

    private _serializeActivityItem(item: ActivityItem): SerializedActivityItem | undefined {
        if (item instanceof ActivityItemInput) {
            return {
                type: 'input',
                id: item.id,
                parentId: item.parentId,
                when: item.when.getTime(),
                state: item.state,
                inputPrompt: item.inputPrompt,
                continuationPrompt: item.continuationPrompt,
                code: item.code
            };
        }

        if (item instanceof ActivityItemStream) {
            return {
                type: 'stream',
                id: item.id,
                parentId: item.parentId,
                when: item.when.getTime(),
                streamType: item.streamType,
                text: item.text
            };
        }

        if (item instanceof ActivityItemErrorMessage) {
            return {
                type: 'error',
                id: item.id,
                parentId: item.parentId,
                when: item.when.getTime(),
                name: item.name,
                message: item.message,
                traceback: item.traceback
            };
        }

        if (item instanceof ActivityItemOutputHtml) {
            return {
                type: 'outputHtml',
                id: item.id,
                parentId: item.parentId,
                when: item.when.getTime(),
                html: item.html,
                resource: item.resource,
                outputId: item.outputId
            };
        }

        if (item instanceof ActivityItemOutputPlot) {
            // Strip large image data from restore state to reduce traffic.
            // The webview will show a placeholder for restored plot outputs.
            const strippedData: Record<string, string> = {};
            for (const [mimeType, value] of Object.entries(item.data)) {
                if (mimeType.startsWith('image/')) {
                    // Replace base64 image with a tiny placeholder marker
                    strippedData[mimeType] = 'data:image/png;base64,';
                } else {
                    strippedData[mimeType] = typeof value === 'string' ? value : String(value);
                }
            }
            return {
                type: 'outputPlot',
                id: item.id,
                parentId: item.parentId,
                when: item.when.getTime(),
                data: strippedData,
                outputId: item.outputId
            };
        }

        if (item instanceof ActivityItemOutputMessage) {
            // Strip image data from output messages to reduce restore state traffic.
            const strippedData: Record<string, string> = {};
            let hasNonImageData = false;
            for (const [mimeType, value] of Object.entries(item.data)) {
                if (mimeType.startsWith('image/')) {
                    // Skip image MIME types entirely from restore state
                    continue;
                }
                strippedData[mimeType] = typeof value === 'string' ? value : String(value);
                hasNonImageData = true;
            }
            // If there's no non-image data, skip this item entirely
            if (!hasNonImageData) {
                return undefined;
            }
            return {
                type: 'output',
                id: item.id,
                parentId: item.parentId,
                when: item.when.getTime(),
                data: strippedData,
                outputId: item.outputId
            };
        }

        if (item instanceof ActivityItemPrompt) {
            return {
                type: 'prompt',
                id: item.id,
                parentId: item.parentId,
                when: item.when.getTime(),
                prompt: item.prompt,
                password: item.password,
                state: item.state,
                answer: item.answer
            };
        }

        return undefined;
    }

    private _deserializeActivityItem(item: SerializedActivityItem): ActivityItem | undefined {
        switch (item.type) {
            case 'input':
                return new ActivityItemInput(
                    item.id,
                    item.parentId,
                    new Date(item.when),
                    item.state,
                    item.inputPrompt,
                    item.continuationPrompt,
                    item.code
                );
            case 'stream':
                return new ActivityItemStream(
                    item.id,
                    item.parentId,
                    new Date(item.when),
                    item.streamType,
                    item.text
                );
            case 'error':
                return new ActivityItemErrorMessage(
                    item.id,
                    item.parentId,
                    new Date(item.when),
                    item.name,
                    item.message,
                    item.traceback
                );
            case 'output':
                return new ActivityItemOutputMessage(
                    item.id,
                    item.parentId,
                    new Date(item.when),
                    item.data,
                    item.outputId
                );
            case 'outputHtml':
                return new ActivityItemOutputHtml(
                    item.id,
                    item.parentId,
                    new Date(item.when),
                    item.html,
                    item.resource,
                    item.outputId
                );
            case 'outputPlot':
                return new ActivityItemOutputPlot(
                    item.id,
                    item.parentId,
                    new Date(item.when),
                    item.data,
                    () => { /* no-op on restore */ },
                    item.outputId
                );
            case 'prompt':
                {
                    const promptItem = new ActivityItemPrompt(
                        item.id,
                        item.parentId,
                        new Date(item.when),
                        item.prompt,
                        item.password
                    );
                    if (typeof item.state === 'string') {
                        promptItem.state = item.state as ActivityItemPromptState;
                    }
                    if (typeof item.answer === 'string') {
                        promptItem.answer = item.answer;
                    }
                    return promptItem;
                }
        }
        return undefined;
    }

    dispose(): void {
        this.detachRuntimeSession();
        this._disposables.forEach(d => d.dispose());
        this._onFocusInputEmitter.dispose();
        this._onDidChangeStateEmitter.dispose();
        this._onDidChangeWordWrapEmitter.dispose();
        this._onDidChangeTraceEmitter.dispose();
        this._onDidChangeRuntimeItemsEmitter.dispose();
        this._onDidPasteTextEmitter.dispose();
        this._onDidSelectAllEmitter.dispose();
        this._onDidClearConsoleEmitter.dispose();
        this._onDidExecuteCodeEmitter.dispose();
        this._onDidAttachSessionEmitter.dispose();
        this._onDidChangeInputStateEmitter.dispose();
        this._onDidSetPendingCodeEmitter.dispose();
        this._onDidChangePendingInputEmitter.dispose();
        this._onDidChangePromptEmitter.dispose();
        this._onDidChangeWorkingDirectoryEmitter.dispose();
        this._onDidNavigateInputHistoryUpEmitter.dispose();
        this._onDidNavigateInputHistoryDownEmitter.dispose();
        this._onDidClearInputHistoryEmitter.dispose();
        this._onDidRevealExecutionEmitter.dispose();
    }
    //#endregion

    //#region Public Methods for Service Integration
    handleStreamOutput(parentId: string, streamType: 'stdout' | 'stderr', text: string): void {
        const type = streamType === 'stderr' ? ActivityItemStreamType.ERROR : ActivityItemStreamType.OUTPUT;
        const stream = new ActivityItemStream(this.generateId(), parentId, new Date(), type, text);
        this.addOrUpdateRuntimeItemActivity(parentId, stream);
    }

    handleErrorMessage(parentId: string, name: string, message: string, traceback: string[]): void {
        const errorItem = new ActivityItemErrorMessage(this.generateId(), parentId, new Date(), name, message, traceback);
        this.addOrUpdateRuntimeItemActivity(parentId, errorItem);
    }

    handleDisplayData(parentId: string, data: ILanguageRuntimeMessageOutputData, outputId?: string): void {
        const activityItem = this.createDisplayDataActivityItem(parentId, data, outputId);
        this.addOrUpdateRuntimeItemActivity(parentId, activityItem);
    }

    handleUpdateDisplayData(parentId: string, data: ILanguageRuntimeMessageOutputData, outputId?: string): void {
        if (!outputId) {
            this.handleDisplayData(parentId, data);
            return;
        }

        const preferredActivity = this._runtimeItemActivities.get(parentId);
        const preferredReplacement = this.createDisplayDataActivityItem(parentId, data, outputId);
        if (
            preferredActivity?.replaceOutputItemByOutputId(
                outputId,
                preferredReplacement,
            )
        ) {
            this._emitReplaceActivityOutput(
                parentId,
                outputId,
                preferredReplacement,
            );
            return;
        }

        for (const [activityParentId, activity] of this._runtimeItemActivities.entries()) {
            const replacement = this.createDisplayDataActivityItem(activityParentId, data, outputId);
            if (
                activity.replaceOutputItemByOutputId(
                    outputId,
                    replacement,
                )
            ) {
                this._emitReplaceActivityOutput(
                    activityParentId,
                    outputId,
                    replacement,
                );
                return;
            }
        }

        this.handleDisplayData(parentId, data, outputId);
    }

    handlePromptRequest(parentId: string, prompt: string, password: boolean): void {
        this._promptActive = true;
        const promptItem = new ActivityItemPrompt(this.generateId(), parentId, new Date(), prompt, password);
        this.addOrUpdateRuntimeItemActivity(parentId, promptItem);
    }

    /**
     * Marks the input activity item as busy or completed.
     */
    markInputBusyState(executionId: string, busy: boolean): void {
        const activity = this._runtimeItemActivities.get(executionId);
        if (activity) {
            const inputItem = activity.activityItems.find(item => item instanceof ActivityItemInput) as ActivityItemInput | undefined;
            if (inputItem && inputItem.state !== ActivityItemInputState.Provisional) {
                inputItem.state = busy ? ActivityItemInputState.Executing : ActivityItemInputState.Completed;
                this._emitUpdateActivityInputState(executionId, inputItem.state);
            }
        }

        this._onDidChangeInputStateEmitter.fire({
            executionId,
            state: busy ? 'busy' : 'idle'
        });
    }

    markExecutionCompleted(executionId: string): void {
        this.markInputBusyState(executionId, false);
        this._externalExecutionIds.delete(executionId);
    }
    //#endregion

    //#region Private Methods

    /**
     * Adds a runtime item and fires the change event (Positron pattern).
     */
    private addRuntimeItem(item: RuntimeItem): void {
        this._runtimeItems.push(item);
        this.optimizeScrollback();
        this._emitAppendRuntimeItem(item);
    }

    /**
     * Adds a trace runtime item for debugging (Positron pattern).
     */
    private addRuntimeItemTrace(message: string): void {
        const item = new RuntimeItemTrace(this.generateId(), new Date(), message);
        this._runtimeItems.push(item);
        this._emitAppendRuntimeItem(item);
    }

    /**
     * Find and remove the runtime item marking the runtime as Starting (Positron pattern).
     */
    private clearStartingItem(): void {
        for (let i = this._runtimeItems.length - 1; i >= 0; i--) {
            if (this._runtimeItems[i] instanceof RuntimeItemStarting) {
                this._runtimeItems.splice(i, 1);
                break;
            }
        }
    }

    private hasStartingItem(): boolean {
        return this._runtimeItems.some(item => item instanceof RuntimeItemStarting);
    }

    /**
     * Emits start runtime items based on attach mode (Positron pattern).
     */
    private emitStartRuntimeItems(attachMode: SessionAttachMode): void {
        const sessionName = this.sessionName;
        if (attachMode === SessionAttachMode.Restarting ||
            (attachMode === SessionAttachMode.Starting && this._state === PositronConsoleState.Exited)) {
            this.setState(PositronConsoleState.Restarting);
            this.addRuntimeItem(new RuntimeItemStarting(
                this.generateId(), new Date(),
                `${sessionName} restarting.`, SessionAttachMode.Restarting));
        } else if (attachMode === SessionAttachMode.Starting ||
            attachMode === SessionAttachMode.Switching) {
            this.setState(PositronConsoleState.Starting);
            this.addRuntimeItem(new RuntimeItemStarting(
                this.generateId(), new Date(),
                `${sessionName} starting.`, attachMode));
        } else if (attachMode === SessionAttachMode.Reconnecting) {
            this.setState(PositronConsoleState.Starting);
            this.addRuntimeItem(new RuntimeItemStarting(
                this.generateId(), new Date(),
                `${sessionName} reconnecting.`, attachMode));
        } else if (attachMode === SessionAttachMode.Connected) {
            this.setState(PositronConsoleState.Ready);
            this.addRuntimeItem(new RuntimeItemReconnected(
                this.generateId(), new Date(), `${sessionName} reconnected.`));
        }
    }

    /**
     * Sets the console state and fires the state change event (Positron pattern).
     */
    private setState(state: PositronConsoleState): void {
        // Trace state transitions (Positron pattern)
        if (this._trace && this._state !== state) {
            this.addRuntimeItemTrace(`Console state change: ${this._state} => ${state}`);
        }

        // Process visual state transitions (Positron pattern)
        switch (state) {
            case PositronConsoleState.Ready:
                switch (this._state) {
                    case PositronConsoleState.Starting:
                    case PositronConsoleState.Restarting:
                    case PositronConsoleState.Busy:
                        // Replace RuntimeItemStarting with RuntimeItemStarted
                        for (let i = this._runtimeItems.length - 1; i >= 0; i--) {
                            if (this._runtimeItems[i] instanceof RuntimeItemStarting) {
                                const startingItem = this._runtimeItems[i] as RuntimeItemStarting;
                                let msg = '';
                                switch (startingItem.attachMode) {
                                    case SessionAttachMode.Starting:
                                    case SessionAttachMode.Switching:
                                        msg = `${this.sessionName} started.`;
                                        break;
                                    case SessionAttachMode.Restarting:
                                        msg = `${this.sessionName} restarted.`;
                                        break;
                                    case SessionAttachMode.Connected:
                                        msg = `${this.sessionName} connected.`;
                                        break;
                                }
                                if (msg) {
                                    this._runtimeItems[i] = new RuntimeItemStarted(
                                        this.generateId(), new Date(), msg);
                                    this._emitRuntimeItemsRestoreRequired();
                                } else {
                                    this._runtimeItems.splice(i, 1);
                                    this._emitRuntimeItemsRestoreRequired();
                                }
                            }
                        }
                        break;
                    case PositronConsoleState.Offline:
                        this.addRuntimeItem(new RuntimeItemReconnected(
                            this.generateId(), new Date(), `${this.sessionName} reconnected.`));
                        break;
                }
                break;

            case PositronConsoleState.Offline:
                this.addRuntimeItem(new RuntimeItemOffline(
                    this.generateId(), new Date(), this.sessionName,
                    `${this.sessionName} offline. Waiting to reconnect.`));
                break;
        }

        // Set the new state and fire the event
        this._state = state;
        this._onDidChangeStateEmitter.fire(this._state);
    }

    private detachRuntimeSession(): void {
        this._runtimeAttached = false;
        this._activeActivityItemPrompt = undefined;
        this._promptActive = false;
        this._clearStartupFailureFallback();

        // Clear executing state for all inputs when detaching (Positron pattern).
        for (const [executionId, activity] of this._runtimeItemActivities.entries()) {
            const inputItem = activity.activityItems.find(
                item => item instanceof ActivityItemInput
            ) as ActivityItemInput | undefined;
            if (inputItem && inputItem.state === ActivityItemInputState.Executing) {
                inputItem.state = ActivityItemInputState.Completed;
                this._onDidChangeInputStateEmitter.fire({
                    executionId,
                    state: 'idle'
                });
            }
        }
        this._emitRuntimeItemsRestoreRequired();

        this._disposables.forEach(d => d.dispose());
        this._disposables.length = 0;
        this._session = undefined;

        this._onDidAttachSessionEmitter.fire(undefined);
    }

    private subscribeToSessionEvents(session: RuntimeSession): void {
        // Subscribe to runtime state changes
        this._disposables.push(
            session.onDidChangeRuntimeState((state: RuntimeState) => this.handleRuntimeStateChange(state))
        );

        // Direct typed message subscriptions (1:1 Positron pattern)
        this._disposables.push(
            session.onDidReceiveRuntimeMessageStream((msg) => this.handleStream(msg))
        );
        this._disposables.push(
            session.onDidReceiveRuntimeMessageInput((msg) => this.handleInput(msg))
        );
        this._disposables.push(
            session.onDidReceiveRuntimeMessageError((msg) => this.handleError(msg))
        );
        this._disposables.push(
            session.onDidReceiveRuntimeMessageOutput((msg) => this.handleOutput(msg))
        );
        this._disposables.push(
            session.onDidReceiveRuntimeMessageResult((msg) => this.handleResult(msg))
        );
        this._disposables.push(
            session.onDidReceiveRuntimeMessageState((msg) => this.handleState(msg))
        );
        this._disposables.push(
            session.onDidReceiveRuntimeMessagePrompt((msg) => this.handlePrompt(msg))
        );
        this._disposables.push(
            session.onDidReceiveRuntimeMessageClearOutput((msg) => this.handleClearOutput(msg))
        );
        this._disposables.push(
            session.onDidReceiveRuntimeMessageUpdateOutput((msg) => this.handleUpdateOutput(msg))
        );
        // Subscribe to session end (Positron pattern)
        if (session.onDidEndSession) {
            this._disposables.push(
                session.onDidEndSession((exit: { exit_code: number; reason: string; message?: string }) => {
                    if (this._trace) {
                        this.addRuntimeItemTrace(`onDidEndSession (code ${exit.exit_code}, reason '${exit.reason}')`);
                    }

                    if (exit.reason === RuntimeExitReason.StartupFailed) {
                        if (this._startupFailureHandled) {
                            if (this._runtimeAttached) {
                                this.detachRuntimeSession();
                            }
                            return;
                        }

                        this._clearStartupFailureFallback();
                        this._startupFailureFallbackHandle = setTimeout(() => {
                            this._startupFailureFallbackHandle = undefined;
                            this._startupFailureHandled = true;
                            this.clearStartingItem();

                            const fallbackMessage = exit.message || `${this.sessionName} failed to start.`;
                            this.addRuntimeItem(new RuntimeItemExited(
                                this.generateId(),
                                new Date(),
                                this.sessionName,
                                exit.exit_code,
                                fallbackMessage,
                            ));

                            if (this._runtimeAttached) {
                                this.detachRuntimeSession();
                            }

                            this.setState(PositronConsoleState.Exited);
                        }, 1000);
                        return;
                    }

                    this.clearStartingItem();
                    const message = `${this.sessionName} exited (code ${exit.exit_code}).`;
                    this.addRuntimeItem(new RuntimeItemExited(
                        this.generateId(),
                        new Date(),
                        this.sessionName,
                        exit.exit_code,
                        exit.reason || message,
                    ));
                    this.detachRuntimeSession();
                    this.setState(PositronConsoleState.Exited);
                })
            );
        }

        this._disposables.push(
            session.onDidEncounterStartupFailure((startupFailure) => {
                this._handleStartupFailure(startupFailure);
            })
        );
    }

    private _clearStartupFailureFallback(): void {
        if (this._startupFailureFallbackHandle) {
            clearTimeout(this._startupFailureFallbackHandle);
            this._startupFailureFallbackHandle = undefined;
        }
    }

    private _handleStartupFailure(startupFailure: LanguageRuntimeStartupFailure): void {
        if (this._trace) {
            this.addRuntimeItemTrace('onDidEncounterStartupFailure');
        }

        this._startupFailureHandled = true;
        this._clearStartupFailureFallback();
        this.clearStartingItem();

        this.addRuntimeItem(new RuntimeItemExited(
            this.generateId(),
            new Date(),
            this.sessionName,
            0,
            startupFailure.message,
        ));
        this.addRuntimeItem(new RuntimeItemStartupFailure(
            this.generateId(),
            new Date(),
            startupFailure.message,
            startupFailure.details,
        ));

        if (
            (this._session?.state === RuntimeState.Exited ||
                this._session?.state === RuntimeState.Uninitialized) &&
            this._runtimeAttached
        ) {
            this.detachRuntimeSession();
        }

        this.setState(PositronConsoleState.Exited);
    }

    private handleRuntimeStateChange(state: RuntimeState): void {
        if (this._trace) {
            this.addRuntimeItemTrace(`onDidChangeRuntimeState (${state})`);
        }

        // When the runtime goes idle or ready, process pending input (Positron pattern)
        if (state === RuntimeState.Idle || state === RuntimeState.Ready) {
            void this.processPendingInput();
            this.completeStartup();
        }

        const mappedState = this.mapRuntimeState(state);
        if (mappedState === PositronConsoleState.Disconnected) {
            return;
        }

        // Let completeStartup() perform the final starting/restarting -> ready
        // transition so startup items and pending input stay consistent.
        if (
            mappedState === PositronConsoleState.Ready &&
            (this._state === PositronConsoleState.Starting ||
                this._state === PositronConsoleState.Restarting)
        ) {
            return;
        }

        this.setState(mappedState);
    }

    private mapRuntimeState(state: RuntimeState): PositronConsoleState {
        switch (state) {
            case RuntimeState.Uninitialized: return PositronConsoleState.Uninitialized;
            case RuntimeState.Initializing: return PositronConsoleState.Starting;
            case RuntimeState.Starting: return PositronConsoleState.Starting;
            case RuntimeState.Restarting: return PositronConsoleState.Restarting;
            case RuntimeState.Busy: return PositronConsoleState.Busy;
            case RuntimeState.Interrupting: return PositronConsoleState.Interrupting;
            case RuntimeState.Ready:
            case RuntimeState.Idle: return PositronConsoleState.Ready;
            case RuntimeState.Offline: return PositronConsoleState.Offline;
            case RuntimeState.Exiting: return PositronConsoleState.Exiting;
            case RuntimeState.Exited: return PositronConsoleState.Exited;
            default: return PositronConsoleState.Disconnected;
        }
    }

    private addOrUpdateRuntimeItemActivity(parentId: string, activityItem: ActivityItem): void {
        const existing = this._runtimeItemActivities.get(parentId);
        if (existing) {
            existing.addActivityItem(activityItem);
            this.optimizeScrollback();
            this._emitAppendActivityItem(parentId, activityItem);
        } else {
            const newActivity = new RuntimeItemActivity(parentId, activityItem);
            this._runtimeItemActivities.set(parentId, newActivity);
            this._runtimeItems = [...this._runtimeItems, newActivity];
            this.optimizeScrollback();
            this._emitAppendRuntimeItem(newActivity);
        }
    }

    /**
     * Optimizes scrollback by iterating runtime items in reverse order (1:1 Positron).
     * Items beyond the scrollback budget are hidden.
     */
    private optimizeScrollback(): void {
        for (let scrollbackSize = this._scrollbackSize, i = this._runtimeItems.length - 1; i >= 0; i--) {
            scrollbackSize = this._runtimeItems[i].optimizeScrollback(scrollbackSize);
        }
    }

    private createDisplayDataActivityItem(
        parentId: string,
        data: ILanguageRuntimeMessageOutputData,
        outputId?: string,
        id: string = this.generateId(),
        when: Date = new Date(),
    ): ActivityItemOutputMessage | ActivityItemOutputHtml | ActivityItemOutputPlot {
        const imageMimeType = Object.keys(data).find((mimeType) => mimeType.startsWith('image/'));
        if (imageMimeType) {
            return new ActivityItemOutputPlot(
                id,
                parentId,
                when,
                data,
                () => this._outputChannel.debug('[ConsoleInstance] Plot selected: ' + parentId),
                outputId
            );
        }

        const htmlValue = data['text/html'];
        if (this.isSafeInlineHtml(htmlValue)) {
            const plainText = data['text/plain'];
            return new ActivityItemOutputHtml(
                id,
                parentId,
                when,
                htmlValue,
                plainText,
                outputId
            );
        }

        return new ActivityItemOutputMessage(id, parentId, when, data, outputId);
    }

    private createActivityItemOutput(
        message: LanguageRuntimeOutputWithKind | LanguageRuntimeResultWithKind | LanguageRuntimeUpdateOutputWithKind,
        parentId: string = message.parent_id,
    ): ActivityItemOutputMessage | ActivityItemOutputHtml | ActivityItemOutputPlot | undefined {
        // Positron: don't show outputs explicitly routed to Viewer/IPyWidgets in Console.
        if (
            message.kind === RuntimeOutputKind.ViewerWidget ||
            message.kind === RuntimeOutputKind.IPyWidget
        ) {
            return undefined;
        }

        const data = this.normalizeOutputData(message.data);
        return this.createDisplayDataActivityItem(
            parentId,
            data,
            message.output_id,
            message.id || this.generateId(),
            message.when ? new Date(message.when) : new Date(),
        );
    }

    private normalizeOutputData(data: Record<string, unknown> | undefined): ILanguageRuntimeMessageOutputData {
        const normalized: ILanguageRuntimeMessageOutputData = {};
        if (!data) {
            return normalized;
        }

        for (const [mimeType, value] of Object.entries(data)) {
            normalized[mimeType] = this.coerceDisplayValue(value);
        }

        return normalized;
    }

    private isSafeInlineHtml(value: string | undefined): value is string {
        if (typeof value !== 'string') {
            return false;
        }

        const htmlContent = value.toLowerCase();
        return !(
            htmlContent.includes('<script') ||
            htmlContent.includes('<body') ||
            htmlContent.includes('<html') ||
            htmlContent.includes('<iframe') ||
            htmlContent.includes('<!doctype')
        );
    }

    private coerceDisplayValue(value: unknown): string {
        if (typeof value === 'string') {
            return value;
        }

        if (value === undefined || value === null) {
            return '';
        }

        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        }

        return String(value);
    }

    private generateId(): string { return `item-${Date.now()}-${this._nextId++}`; }
    private generateExecutionId(code?: string): string {
        if (code) {
            const storedExecutionId = this._pendingExecutionIds.get(code);
            if (storedExecutionId) {
                this._pendingExecutionIds.delete(code);
                return storedExecutionId;
            }
        }

        return `fragment-${Date.now()}-${this._nextId++}`;
    }
    //#endregion
}
