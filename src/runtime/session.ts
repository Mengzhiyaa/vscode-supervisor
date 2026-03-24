import * as vscode from 'vscode';
import {
    type LanguageRuntimeDynState,
    type LanguageRuntimeMetadata,
    type RuntimeSessionMetadata,
    type ILanguageLsp,
    type ILanguageLspFactory,
    type ILanguageRuntimeClientInstance,
    LanguageRuntimeClientType,
    LanguageLspState,
} from '../api';
import {
    DapComm,
    EvaluateCodeResult,
    JupyterLanguageRuntimeSession,
    RuntimeLaunchInfo,
} from '../supervisor/positron-supervisor';
import {
    RuntimeState,
    RuntimeCodeFragmentStatus,
    LanguageRuntimeInfo,
    LanguageRuntimeExit,
    RuntimeResourceUsage,
    type LanguageRuntimeMessage,
    type LanguageRuntimeMessageCommClosed,
    type LanguageRuntimeMessageCommData,
    type LanguageRuntimeMessageCommOpen,
    type LanguageRuntimeStream,
    type LanguageRuntimeInput,
    type LanguageRuntimeError as LanguageRuntimeErrorMessage,
    type LanguageRuntimeOutput,
    type LanguageRuntimeResult,
    type LanguageRuntimeState,
    type LanguageRuntimePrompt,
    type LanguageRuntimeClearOutput,
    type LanguageRuntimeUpdateOutput,
    type LanguageRuntimeDebugEvent,
    type LanguageRuntimeDebugReply,
    LanguageRuntimeMessageType,
    RuntimeClientType as InternalRuntimeClientType,
    RuntimeClientState,
    RuntimeExitReason,
    RuntimeCodeExecutionMode,
    RuntimeErrorBehavior,
    LanguageRuntimeSessionChannel,
} from '../internal/runtimeTypes';
import { RuntimeClientManager } from './runtimeClientManager';
import { inferPositronOutputKind, type LanguageRuntimeOutputWithKind, type LanguageRuntimeResultWithKind, type LanguageRuntimeUpdateOutputWithKind } from './runtimeOutputKind';
import { PositronUiComm, UiParam } from './comms/positronUiComm';
import {
    QueuedRuntimeEvent,
    QueuedRuntimeMessageEvent,
    QueuedRuntimeStateEvent,
    type RuntimeMessageEnvelope,
} from './runtimeMessageEnvelope';
import type { PlotRenderSettings } from './comms/positronPlotComm';

export interface LanguageRuntimeStartupFailure {
    message: string;
    details: string;
}

function toLanguageRuntimeStartupFailure(error: unknown): LanguageRuntimeStartupFailure {
    if (error instanceof Error) {
        const errorWithMetadata = error as Error & {
            details?: unknown;
            errors?: unknown[];
        };
        const details: string[] = [];

        if (typeof errorWithMetadata.details === 'string' && errorWithMetadata.details.trim().length > 0) {
            details.push(errorWithMetadata.details.trim());
        }

        if (Array.isArray(errorWithMetadata.errors) && errorWithMetadata.errors.length > 0) {
            details.push(
                errorWithMetadata.errors
                    .map(entry => entry instanceof Error ? entry.toString() : String(entry))
                    .join('\n\n')
            );
        }

        if (typeof error.stack === 'string' && error.stack.trim().length > 0) {
            details.push(error.stack.trim());
        }

        return {
            message: error.message || error.name || String(error),
            details: details.join('\n\n'),
        };
    }

    return {
        message: String(error),
        details: '',
    };
}

class NullLanguageLsp implements ILanguageLsp {
    readonly state = LanguageLspState.Stopped;
    readonly statementRangeProvider = undefined;
    readonly helpTopicProvider = undefined;

    async activate(): Promise<void> {
        return;
    }

    async deactivate(): Promise<void> {
        return;
    }

    async wait(): Promise<boolean> {
        return false;
    }

    showOutput(): void {
        return;
    }

    async requestCompletion(): Promise<any[]> {
        return [];
    }

    async requestHover(): Promise<any | null> {
        return null;
    }

    async requestSignatureHelp(): Promise<any | null> {
        return null;
    }

    dispose(): void {
        return;
    }
}

type RuntimeSessionOutputChannel = LanguageRuntimeSessionChannel | 'lsp';

/**
 * Represents an active runtime session.
 * Wraps a JupyterLanguageRuntimeSession from positron-supervisor.
 */
export class RuntimeSession implements vscode.Disposable {
    private readonly _stateEmitter = new vscode.EventEmitter<RuntimeState>();
    private readonly _exitEmitter = new vscode.EventEmitter<LanguageRuntimeExit>();
    private readonly _startupCompleteEmitter = new vscode.EventEmitter<LanguageRuntimeInfo>();
    private readonly _startupFailureEmitter = new vscode.EventEmitter<LanguageRuntimeStartupFailure>();
    private readonly _workingDirectoryEmitter = new vscode.EventEmitter<string>();
    private readonly _clientManagerEmitter = new vscode.EventEmitter<RuntimeClientManager>();
    private readonly _resourceUsageEmitter = new vscode.EventEmitter<RuntimeResourceUsage>();

    // Typed emitters (1:1 Positron mainThreadLanguageRuntime)
    private readonly _onDidReceiveRuntimeMessageStreamEmitter = new vscode.EventEmitter<LanguageRuntimeStream>();
    private readonly _onDidReceiveRuntimeMessageInputEmitter = new vscode.EventEmitter<LanguageRuntimeInput>();
    private readonly _onDidReceiveRuntimeMessageErrorEmitter = new vscode.EventEmitter<LanguageRuntimeErrorMessage>();
    private readonly _onDidReceiveRuntimeMessageOutputEmitter = new vscode.EventEmitter<LanguageRuntimeOutputWithKind>();
    private readonly _onDidReceiveRuntimeMessageResultEmitter = new vscode.EventEmitter<LanguageRuntimeResultWithKind>();
    private readonly _onDidReceiveRuntimeMessageStateEmitter = new vscode.EventEmitter<LanguageRuntimeState>();
    private readonly _onDidReceiveRuntimeMessagePromptEmitter = new vscode.EventEmitter<LanguageRuntimePrompt>();
    private readonly _onDidReceiveRuntimeMessageClearOutputEmitter = new vscode.EventEmitter<LanguageRuntimeClearOutput>();
    private readonly _onDidReceiveRuntimeMessageUpdateOutputEmitter = new vscode.EventEmitter<LanguageRuntimeUpdateOutputWithKind>();
    private readonly _onDidReceiveRuntimeMessageDebugEventEmitter = new vscode.EventEmitter<LanguageRuntimeDebugEvent>();
    private readonly _onDidReceiveRuntimeMessageDebugReplyEmitter = new vscode.EventEmitter<LanguageRuntimeDebugReply>();
    private readonly _disposables: vscode.Disposable[] = [];

    private _state: RuntimeState = RuntimeState.Uninitialized;
    private _kernel: JupyterLanguageRuntimeSession | undefined;
    private _clientManager: RuntimeClientManager | undefined;
    private _workingDirectory: string | undefined;
    private _pendingConsoleWidthInChars: number | undefined;
    private _applyingConsoleWidthPromise: Promise<void> | undefined;
    private readonly _created = Date.now();

    /** Event clock of the last processed runtime event. */
    private _eventClock = 0;

    /** Monotonic counter used when stamping incoming runtime events. */
    private _nextEventClock = 0;

    /** Queue of runtime events waiting to be processed. */
    private _eventQueue: QueuedRuntimeEvent[] = [];

    /** Deferred queue processing timer for out-of-order tolerance. */
    private _eventQueueTimer: ReturnType<typeof setTimeout> | undefined;

    // LSP/DAP support (from positron-r)
    private _lsp: ILanguageLsp;
    private readonly _supportsLsp: boolean;
    private _dapComm?: Promise<DapComm>;
    private _lspStartingPromise: Promise<number> = Promise.resolve(0);
    private _lspClientId?: string;
    private _lspTransportKind: 'serverComm' | undefined;
    public dynState: LanguageRuntimeDynState;

    // Flag to indicate if this session is the foreground (active) session
    private _isForeground: boolean = false;

    readonly onDidChangeRuntimeState = this._stateEmitter.event;
    readonly onDidEndSession = this._exitEmitter.event;
    readonly onDidCompleteStartup = this._startupCompleteEmitter.event;
    readonly onDidEncounterStartupFailure = this._startupFailureEmitter.event;
    readonly onDidChangeWorkingDirectory = this._workingDirectoryEmitter.event;
    readonly onDidCreateClientManager = this._clientManagerEmitter.event;
    readonly onDidUpdateResourceUsage = this._resourceUsageEmitter.event;

    // Typed events (1:1 Positron mainThreadLanguageRuntime)
    readonly onDidReceiveRuntimeMessageStream = this._onDidReceiveRuntimeMessageStreamEmitter.event;
    readonly onDidReceiveRuntimeMessageInput = this._onDidReceiveRuntimeMessageInputEmitter.event;
    readonly onDidReceiveRuntimeMessageError = this._onDidReceiveRuntimeMessageErrorEmitter.event;
    readonly onDidReceiveRuntimeMessageOutput = this._onDidReceiveRuntimeMessageOutputEmitter.event;
    readonly onDidReceiveRuntimeMessageResult = this._onDidReceiveRuntimeMessageResultEmitter.event;
    readonly onDidReceiveRuntimeMessageState = this._onDidReceiveRuntimeMessageStateEmitter.event;
    readonly onDidReceiveRuntimeMessagePrompt = this._onDidReceiveRuntimeMessagePromptEmitter.event;
    readonly onDidReceiveRuntimeMessageClearOutput = this._onDidReceiveRuntimeMessageClearOutputEmitter.event;
    readonly onDidReceiveRuntimeMessageUpdateOutput = this._onDidReceiveRuntimeMessageUpdateOutputEmitter.event;
    readonly onDidReceiveRuntimeMessageDebugEvent = this._onDidReceiveRuntimeMessageDebugEventEmitter.event;
    readonly onDidReceiveRuntimeMessageDebugReply = this._onDidReceiveRuntimeMessageDebugReplyEmitter.event;

    constructor(
        readonly sessionId: string,
        readonly runtimeMetadata: LanguageRuntimeMetadata,
        readonly sessionMetadata: RuntimeSessionMetadata,
        private readonly _logChannel: vscode.LogOutputChannel,
        sessionName?: string,
        lspFactory?: ILanguageLspFactory
    ) {
        // Set the initial dynamic state
        this.dynState = {
            sessionName: sessionName || runtimeMetadata.runtimeName,
            continuationPrompt: '+',
            inputPrompt: '>',
            busy: false,
            currentWorkingDirectory: undefined,
        };

        // Initialize LSP and services queue
        this._supportsLsp = !!lspFactory;
        this._lsp = lspFactory?.create(
            runtimeMetadata,
            sessionMetadata,
            this.dynState,
            this._logChannel
        ) ?? new NullLanguageLsp();
        this._disposables.push(this._stateEmitter);
        this._disposables.push(this._exitEmitter);
        this._disposables.push(this._startupCompleteEmitter);
        this._disposables.push(this._startupFailureEmitter);
        this._disposables.push(this._workingDirectoryEmitter);
        this._disposables.push(this._clientManagerEmitter);
        this._disposables.push(this._resourceUsageEmitter);
        // Typed emitters
        this._disposables.push(this._onDidReceiveRuntimeMessageStreamEmitter);
        this._disposables.push(this._onDidReceiveRuntimeMessageInputEmitter);
        this._disposables.push(this._onDidReceiveRuntimeMessageErrorEmitter);
        this._disposables.push(this._onDidReceiveRuntimeMessageOutputEmitter);
        this._disposables.push(this._onDidReceiveRuntimeMessageResultEmitter);
        this._disposables.push(this._onDidReceiveRuntimeMessageStateEmitter);
        this._disposables.push(this._onDidReceiveRuntimeMessagePromptEmitter);
        this._disposables.push(this._onDidReceiveRuntimeMessageClearOutputEmitter);
        this._disposables.push(this._onDidReceiveRuntimeMessageUpdateOutputEmitter);
        this._disposables.push(this._onDidReceiveRuntimeMessageDebugEventEmitter);
        this._disposables.push(this._onDidReceiveRuntimeMessageDebugReplyEmitter);
    }

    /**
     * Gets a short session ID prefix for logging.
     * If the session ID is already language-scoped (for example `r-fed6ae6d`),
     * reuse it directly to avoid duplicating the language prefix in logs.
     */
    private get _shortSessionId(): string {
        const prefix = this.runtimeMetadata.languageId.substring(0, 1);
        const scopedPrefix = `${prefix}-`;
        if (this.sessionId.startsWith(scopedPrefix)) {
            return this.sessionId;
        }

        const shortId = this.sessionId.substring(0, 8);
        return `${scopedPrefix}${shortId}`;
    }

    /**
     * Logs a message to the output channel.
     * Follows Positron's KallichoreSession.log() pattern:
     * - Prefixes with short session ID (e.g., "r-5c0060c7")
     * - Truncates messages over 2048 characters
     * - Dispatches to appropriate log level method
     * 
     * @param msg The message to log
     * @param logLevel The log level (default: Debug)
     */
    public log(msg: string, logLevel?: vscode.LogLevel): void {
        // Ensure message isn't over the maximum length
        if (msg.length > 2048) {
            msg = msg.substring(0, 2048) + '... (truncated)';
        }

        // Add short session ID prefix like Positron
        const formattedMsg = `${this._shortSessionId} ${msg}`;

        switch (logLevel) {
            case vscode.LogLevel.Error:
                this._logChannel.error(formattedMsg);
                break;
            case vscode.LogLevel.Warning:
                this._logChannel.warn(formattedMsg);
                break;
            case vscode.LogLevel.Info:
                this._logChannel.info(formattedMsg);
                break;
            case vscode.LogLevel.Debug:
                this._logChannel.debug(formattedMsg);
                break;
            case vscode.LogLevel.Trace:
                this._logChannel.trace(formattedMsg);
                break;
            default:
                this._logChannel.appendLine(formattedMsg);
        }
    }

    /**
     * Gets the current runtime state
     */
    get state(): RuntimeState {
        return this._state;
    }

    get created(): number {
        return this._created;
    }

    /**
     * Gets the RuntimeClientManager for comm handling.
     * Used by ConsoleViewProvider to route comm messages.
     */
    get clientManager(): RuntimeClientManager | undefined {
        return this._clientManager;
    }

    /**
     * Gets the attached kernel session for compatibility paths that need the
     * Positron-facing runtime session surface.
     */
    get kernelSession(): JupyterLanguageRuntimeSession | undefined {
        return this._kernel;
    }

    /**
     * Gets the last known working directory for the session.
     */
    get workingDirectory(): string | undefined {
        return this._workingDirectory;
    }

    /**
     * Gets the transport currently used for LSP startup.
     * Exposed for diagnostics and tests.
     */
    get lspTransportKind(): 'serverComm' | undefined {
        return this._lspTransportKind;
    }

    /**
     * Updates the current working directory and fires the change event.
     * Called when receiving working_directory update from UI comm.
     * 
     * @param directory The new working directory path
     */
    updateWorkingDirectory(directory: string): void {
        this._workingDirectory = directory;
        this.dynState.currentWorkingDirectory = directory;
        this.log(`Working directory changed: ${directory}`, vscode.LogLevel.Debug);
        this._workingDirectoryEmitter.fire(directory);
    }

    /**
     * Updates the user-visible session name in both metadata and dynamic state.
     */
    updateSessionName(sessionName: string): void {
        this.sessionMetadata.sessionName = sessionName;
        this.dynState.sessionName = sessionName;

        if (this._kernel && typeof this._kernel.updateSessionName === 'function') {
            this._kernel.updateSessionName(sessionName);
        }
    }

    /**
     * Attaches the underlying Jupyter kernel session
     */
    attachKernel(kernel: JupyterLanguageRuntimeSession): void {
        this._kernel = kernel;
        this.log(`Kernel attached`, vscode.LogLevel.Info);

        // Create the RuntimeClientManager for Positron client (comm) management
        this._clientManager = new RuntimeClientManager(kernel, this._logChannel);
        this._disposables.push(this._clientManager);
        this._clientManagerEmitter.fire(this._clientManager);

        // Track previous state for state transition logging
        let previousState = this._state;

        // Forward events
        this._disposables.push(
            kernel.onDidChangeRuntimeState((state) => {
                // Positron-style state logging: State: idle => busy (reason)
                this.log(`State: ${previousState} => ${state}`, vscode.LogLevel.Debug);
                previousState = state;
                this._state = state;

                const tick = this._nextRuntimeEventClock();
                this._addToEventQueue(new QueuedRuntimeStateEvent(tick, state));

                // Ensure Positron clients when kernel reaches Ready.
                // Do not trigger on every Idle transition; initializeClients() may
                // call comm_info_request, which itself produces busy/idle transitions.
                if (state === RuntimeState.Ready) {
                    this._initializeClientsAsync();
                }
            })
        );

        this._disposables.push(
            kernel.onDidReceiveRuntimeMessage((message) => {
                // Positron-style logging: <<< RECV msg_type [channel]: content
                const rawMessage = message as unknown as Record<string, unknown>;
                const channel = typeof rawMessage.channel === 'string' ? rawMessage.channel : 'iopub';
                const msgContent = JSON.stringify(rawMessage.data ?? message);
                this.log(`<<< RECV ${message.type} [${channel}]: ${msgContent}`, vscode.LogLevel.Debug);

                const runtimeMessage = message as LanguageRuntimeMessage;
                const tick = this._nextRuntimeEventClock();
                const envelope: RuntimeMessageEnvelope = {
                    event_clock: tick,
                    message: runtimeMessage,
                };

                this._addToEventQueue(
                    new QueuedRuntimeMessageEvent(tick, envelope)
                );
            })
        );

        this._disposables.push(
            kernel.onDidEndSession((exit) => {
                this.log(`Session ended: exit_code=${exit.exit_code}, reason=${exit.reason}`, vscode.LogLevel.Info);

                const dapComm = this._dapComm;
                void Promise.all([
                    this._deactivateLsp(),
                    dapComm?.then((dap) => dap.dispose()),
                ])
                    .catch((error) => {
                        this.log(`Failed to clean up session services after runtime end: ${error}`, vscode.LogLevel.Warning);
                    })
                    .finally(() => {
                        if (this._dapComm === dapComm) {
                            this._dapComm = undefined;
                        }
                    });

                if (
                    exit.reason === RuntimeExitReason.ExtensionHost ||
                    exit.reason === RuntimeExitReason.Transferred
                ) {
                    this._state = RuntimeState.Offline;
                    this._stateEmitter.fire(this._state);
                }

                this._exitEmitter.fire(exit);
            })
        );

        // Forward resource usage updates if provided by the kernel.
        if (kernel.onDidUpdateResourceUsage) {
            this._disposables.push(
                kernel.onDidUpdateResourceUsage((usage) => {
                    this._resourceUsageEmitter.fire(usage);
                })
            );
        }
    }

    /**
     * Gets the next monotonically increasing runtime event clock value.
     */
    private _nextRuntimeEventClock(): number {
        this._nextEventClock += 1;
        return this._nextEventClock;
    }

    /**
     * Adds an event to the runtime queue and processes/debounces queue delivery.
     */
    private _addToEventQueue(event: QueuedRuntimeEvent): void {
        const clock = event.clock;

        if (clock < this._eventClock) {
            if (event instanceof QueuedRuntimeMessageEvent) {
                this.log(
                    `Received '${event.summary()}' at tick ${clock} while waiting for tick ${this._eventClock + 1}; emitting anyway`,
                    vscode.LogLevel.Warning
                );
                this._processRuntimeMessage(event.envelope.message);
            }
            return;
        }

        this._eventQueue.push(event);

        if (clock === this._eventClock + 1 || this._eventClock === 0) {
            this._processEventQueue();
        } else {
            this.log(
                `Received '${event.summary()}' at tick ${clock} while waiting for tick ${this._eventClock + 1}; deferring`,
                vscode.LogLevel.Info
            );

            if (this._eventQueueTimer) {
                clearTimeout(this._eventQueueTimer);
                this._eventQueueTimer = undefined;
            }

            this._eventQueueTimer = setTimeout(() => {
                this.log(
                    'Processing runtime event queue after timeout; event ordering issues possible.',
                    vscode.LogLevel.Warning
                );
                this._processEventQueue();
            }, 250);
        }
    }

    /**
     * Processes queued runtime events in event_clock order.
     */
    private _processEventQueue(): void {
        if (this._eventQueueTimer) {
            clearTimeout(this._eventQueueTimer);
            this._eventQueueTimer = undefined;
        }

        if (this._eventQueue.length > 1) {
            this._eventQueue.sort((a, b) => a.clock - b.clock);
            this.log(
                `Processing ${this._eventQueue.length} runtime events. Clocks: ${this._eventQueue.map((event) => `${event.clock}: ${event.summary()}`).join(', ')}`,
                vscode.LogLevel.Info
            );
        }

        this._eventQueue.forEach((event) => {
            this._eventClock = event.clock;
            this._handleQueuedRuntimeEvent(event);
        });

        this._eventQueue = [];
    }

    /**
     * Handles an individual queued runtime event.
     */
    private _handleQueuedRuntimeEvent(event: QueuedRuntimeEvent): void {
        if (event instanceof QueuedRuntimeMessageEvent) {
            this._processRuntimeMessage(event.envelope.message);
            return;
        }

        if (event instanceof QueuedRuntimeStateEvent) {
            this._stateEmitter.fire(event.state);
        }
    }

    /**
     * Dispatches a runtime message to typed event emitters.
     * (1:1 Positron mainThreadLanguageRuntime.processMessage)
     *
     * Comm messages are pre-handled first; if handled, no typed event is fired.
     */
    private _processRuntimeMessage(message: LanguageRuntimeMessage): void {
        // Pre-handle comm messages (Positron pattern: handle after dequeue)
        if (this._preHandleCommMessage(message)) {
            return;
        }

        // Typed dispatch (1:1 Positron processMessage)
        switch (message.type) {
            case LanguageRuntimeMessageType.Stream:
                this._onDidReceiveRuntimeMessageStreamEmitter.fire(message as LanguageRuntimeStream);
                break;
            case LanguageRuntimeMessageType.Input:
                this._onDidReceiveRuntimeMessageInputEmitter.fire(message as LanguageRuntimeInput);
                break;
            case LanguageRuntimeMessageType.Error:
                this._onDidReceiveRuntimeMessageErrorEmitter.fire(message as LanguageRuntimeErrorMessage);
                break;
            case LanguageRuntimeMessageType.Output: {
                const outputMsg = message as LanguageRuntimeOutput;
                const kind = inferPositronOutputKind(outputMsg);
                this._onDidReceiveRuntimeMessageOutputEmitter.fire({ ...outputMsg, kind });
                break;
            }
            case LanguageRuntimeMessageType.Result: {
                const resultMsg = message as LanguageRuntimeResult;
                const kind = inferPositronOutputKind(resultMsg);
                this._onDidReceiveRuntimeMessageResultEmitter.fire({ ...resultMsg, kind });
                break;
            }
            case LanguageRuntimeMessageType.State:
                if (this._clientManager) {
                    this._clientManager.updatePendingRpcState(message as LanguageRuntimeState);
                }
                this._onDidReceiveRuntimeMessageStateEmitter.fire(message as LanguageRuntimeState);
                break;
            case LanguageRuntimeMessageType.Prompt:
                this._onDidReceiveRuntimeMessagePromptEmitter.fire(message as LanguageRuntimePrompt);
                break;
            case LanguageRuntimeMessageType.ClearOutput:
                this._onDidReceiveRuntimeMessageClearOutputEmitter.fire(message as LanguageRuntimeClearOutput);
                break;
            case LanguageRuntimeMessageType.UpdateOutput: {
                const updateMsg = message as LanguageRuntimeUpdateOutput;
                const kind = inferPositronOutputKind(updateMsg);
                this._onDidReceiveRuntimeMessageUpdateOutputEmitter.fire({ ...updateMsg, kind });
                break;
            }
            case LanguageRuntimeMessageType.DebugEvent:
                this._onDidReceiveRuntimeMessageDebugEventEmitter.fire(message as LanguageRuntimeDebugEvent);
                break;
            case LanguageRuntimeMessageType.DebugReply:
                this._onDidReceiveRuntimeMessageDebugReplyEmitter.fire(message as LanguageRuntimeDebugReply);
                break;
        }
    }

    /**
     * Invoke a typed UI comm call when a UI client exists.
     */
    private async _invokeTypedUiComm<T>(
        invoke: (uiComm: PositronUiComm) => Promise<T>
    ): Promise<{ available: boolean; value?: T }> {
        const uiClient = this._clientManager?.clientInstances.find(
            (client) => client.getClientType() === InternalRuntimeClientType.Ui
        );
        if (!uiClient) {
            return { available: false };
        }

        const uiComm = new PositronUiComm(uiClient);
        try {
            return {
                available: true,
                value: await invoke(uiComm),
            };
        } finally {
            uiComm.dispose();
        }
    }

    /**
     * Performs Positron-style pre-handling of comm messages in the runtime layer.
     */
    private _preHandleCommMessage(message: LanguageRuntimeMessage): boolean {
        if (!this._clientManager) {
            return false;
        }

        switch (message.type) {
            case LanguageRuntimeMessageType.CommOpen:
                return this._clientManager.openClientInstance(
                    message as LanguageRuntimeMessageCommOpen
                );

            case LanguageRuntimeMessageType.CommData:
                return this._clientManager.emitDidReceiveClientMessage(
                    message as LanguageRuntimeMessageCommData
                );

            case LanguageRuntimeMessageType.CommClosed: {
                const commClosedMessage = message as LanguageRuntimeMessageCommClosed;
                return this._clientManager.emitClientState(
                    commClosedMessage.comm_id,
                    RuntimeClientState.Closed
                );
            }

            default:
                return false;
        }
    }

    /**
     * Initializes Positron clients (comms) asynchronously.
     * Called when the kernel becomes ready.
     */
    private async _initializeClientsAsync(): Promise<void> {
        if (!this._clientManager) {
            this.log('Cannot initialize clients: no client manager', vscode.LogLevel.Warning);
            return;
        }

        try {
            await this._clientManager.initializeClients();
            await this._flushPendingConsoleWidth();
        } catch (error) {
            this.log(`Failed to initialize Positron clients: ${error}`, vscode.LogLevel.Error);
        }
    }

    /**
     * Starts the session and fires startup complete event.
     * Returns LanguageRuntimeInfo containing banner, version info, etc.
     */
    async start(): Promise<LanguageRuntimeInfo> {
        if (!this._kernel) {
            throw new Error('Kernel not attached');
        }
        let info: LanguageRuntimeInfo;
        try {
            info = await this._kernel.start();
        } catch (error) {
            const startupFailure = toLanguageRuntimeStartupFailure(error);
            this.log(`Startup failed: ${startupFailure.message}`, vscode.LogLevel.Error);
            this._startupFailureEmitter.fire(startupFailure);
            throw error;
        }

        if (typeof info.input_prompt === 'string') {
            this.dynState.inputPrompt = info.input_prompt.trimEnd();
        }
        if (typeof info.continuation_prompt === 'string') {
            this.dynState.continuationPrompt = info.continuation_prompt.trimEnd();
        }

        // Fire startup complete event (Positron pattern: onDidCompleteStartup)
        this.log(`Startup complete: ${info.banner?.substring(0, 100) || 'no banner'}`, vscode.LogLevel.Info);
        this._startupCompleteEmitter.fire(info);

        return info;
    }

    /**
     * Executes code in the session
     */
    execute(
        code: string,
        id: string,
        mode: RuntimeCodeExecutionMode = RuntimeCodeExecutionMode.Interactive,
        errorBehavior: RuntimeErrorBehavior = RuntimeErrorBehavior.Continue,
    ): void {
        if (!this._kernel) {
            throw new Error('Kernel not attached');
        }
        const codePreview = code.length > 100 ? code.substring(0, 100) + '...' : code;
        this.log(`>>> SEND execute_request [${id}]: ${codePreview}`, vscode.LogLevel.Debug);
        this._kernel.execute(code, id, mode, errorBehavior);
    }

    /**
     * Checks if a code fragment is complete
     */
    async isCodeFragmentComplete(code: string): Promise<RuntimeCodeFragmentStatus> {
        if (!this._kernel) {
            return RuntimeCodeFragmentStatus.Unknown;
        }
        return this._kernel.isCodeFragmentComplete(code);
    }

    /**
     * Evaluates code silently and returns the structured result.
     */
    async evaluate(code: string): Promise<EvaluateCodeResult> {
        if (!this._kernel) {
            throw new Error('Kernel not attached');
        }

        return this._kernel.evaluate(code);
    }

    /**
     * Returns the launch metadata for the attached kernel, if available.
     */
    async getLaunchInfo(): Promise<RuntimeLaunchInfo | undefined> {
        if (!this._kernel) {
            return undefined;
        }

        return this._kernel.getLaunchInfo();
    }

    /**
     * Gets code completions at a position
     */
    async getCompletions(code: string, cursorPos: number): Promise<any[]> {
        if (!this._kernel) {
            return [];
        }
        try {
            // Use typed UI comm call_method path only.
            const request = { code, cursor_pos: cursorPos };
            const typed = await this._invokeTypedUiComm((uiComm) =>
                uiComm.callMethod('complete_request', [request as UiParam])
            );
            if (!typed.available) {
                this.log('Skipping complete_request: UI comm not available', vscode.LogLevel.Debug);
                return [];
            }
            const result = typed.value;
            return result?.matches || [];
        } catch {
            return [];
        }
    }

    /**
     * Interrupts the current execution
     */
    async interrupt(): Promise<void> {
        if (!this._kernel) {
            throw new Error('Kernel not attached');
        }
        return this._kernel.interrupt();
    }

    /**
     * Sets the working directory for the session and persists the new value locally.
     */
    async setWorkingDirectory(workingDirectory: string): Promise<void> {
        if (!this._kernel || typeof this._kernel.setWorkingDirectory !== 'function') {
            throw new Error('Kernel does not support setting the working directory');
        }

        await this._kernel.setWorkingDirectory(workingDirectory);
        this.updateWorkingDirectory(
            this._kernel.dynState.currentWorkingDirectory ?? workingDirectory,
        );
    }

    /**
     * Updates the plot render settings via the UI comm.
     */
    async updatePlotsRenderSettings(settings: PlotRenderSettings): Promise<void> {
        if (!this._kernel) {
            this.log('Cannot update plots render settings: no kernel', vscode.LogLevel.Debug);
            return;
        }

        try {
            const typed = await this._invokeTypedUiComm((uiComm) =>
                uiComm.didChangePlotsRenderSettings(settings)
            );
            if (typed.available) {
                return;
            }

            this.log(
                'Skipping did_change_plots_render_settings: UI comm not available',
                vscode.LogLevel.Debug
            );
        } catch (error) {
            this.log(`Failed to update plots render settings: ${error}`, vscode.LogLevel.Debug);
        }
    }

    /**
     * Restarts the session
     */
    async restart(): Promise<void> {
        if (!this._kernel) {
            throw new Error('Kernel not attached');
        }
        await this._kernel.restart(this._workingDirectory);

        // Match startup behavior so UI can show "restarted" completion feedback.
        const info = this._kernel.runtimeInfo;

        if (typeof info?.input_prompt === 'string') {
            this.dynState.inputPrompt = info.input_prompt.trimEnd();
        }
        if (typeof info?.continuation_prompt === 'string') {
            this.dynState.continuationPrompt = info.continuation_prompt.trimEnd();
        }

        this.log(
            `Restart complete: ${info?.banner?.substring(0, 100) || 'no banner'}`,
            vscode.LogLevel.Info
        );

        if (info) {
            this._startupCompleteEmitter.fire(info);
        }
    }

    /**
     * Replies to an input prompt (e.g., readline).
     * @param id The prompt ID
     * @param value The value to send
     */
    async replyToPrompt(id: string, value: string): Promise<void> {
        if (!this._kernel) {
            throw new Error('Kernel not attached');
        }
        this.log(`Replying to prompt ${id}`, vscode.LogLevel.Debug);
        await this._kernel.replyToPrompt(id, value);
    }

    /**
     * Shuts down the session
     */
    async shutdown(exitReason: RuntimeExitReason = RuntimeExitReason.Shutdown): Promise<void> {
        if (!this._kernel) {
            return;
        }
        await Promise.all([
            this._deactivateLsp(),
            this.disconnectDap(),
        ]);
        return this._kernel.shutdown(exitReason);
    }

    /**
     * Sets the console width in characters.
     * Called when the console container is resized.
     * @param widthInChars The new console width in characters
     */
    async setConsoleWidth(widthInChars: number): Promise<void> {
        if (!this._kernel) {
            return;
        }
        const normalizedWidth = Math.max(1, Math.trunc(widthInChars));
        this._pendingConsoleWidthInChars = normalizedWidth;
        await this._flushPendingConsoleWidth();
    }

    watchRuntimeClient(
        clientType: LanguageRuntimeClientType,
        handler: (client: ILanguageRuntimeClientInstance) => void
    ): vscode.Disposable {
        const disposables: vscode.Disposable[] = [];

        const attach = (manager?: RuntimeClientManager) => {
            if (!manager) {
                return;
            }

            disposables.push(
                manager.watchClient(
                    clientType as unknown as InternalRuntimeClientType,
                    (client) => handler(client as unknown as ILanguageRuntimeClientInstance)
                )
            );
        };

        attach(this._clientManager);
        disposables.push(this.onDidCreateClientManager((manager) => {
            attach(manager);
        }));

        return new vscode.Disposable(() => {
            disposables.forEach((disposable) => disposable.dispose());
        });
    }

    /**
     * Applies the latest pending console width when the UI comm is available.
     * If the comm is not ready yet, keep the pending value and retry later.
     */
    private async _flushPendingConsoleWidth(): Promise<void> {
        if (this._applyingConsoleWidthPromise) {
            await this._applyingConsoleWidthPromise;
            return;
        }

        this._applyingConsoleWidthPromise = (async () => {
            while (this._pendingConsoleWidthInChars !== undefined) {
                const widthToApply = this._pendingConsoleWidthInChars;

                try {
                    const typed = await this._invokeTypedUiComm((uiComm) =>
                        uiComm.callMethod('setConsoleWidth', [widthToApply])
                    );

                    if (!typed.available) {
                        this.log(
                            `Deferring setConsoleWidth(${widthToApply}): UI comm not available`,
                            vscode.LogLevel.Debug
                        );
                        return;
                    }

                    if (this._pendingConsoleWidthInChars === widthToApply) {
                        this._pendingConsoleWidthInChars = undefined;
                    }

                    this.log(`Console width set to ${widthToApply}`, vscode.LogLevel.Debug);
                } catch (error) {
                    // Silently ignore if kernel doesn't support this method.
                    this.log(`Failed to set console width: ${error}`, vscode.LogLevel.Debug);
                    return;
                }
            }
        })();

        try {
            await this._applyingConsoleWidthPromise;
        } finally {
            this._applyingConsoleWidthPromise = undefined;
        }
    }

    // =============================================
    // Foreground Session Management
    // =============================================

    /**
     * Sets whether this session is the foreground (active) session.
     */
    public setForeground(isForeground: boolean): void {
        this._isForeground = isForeground;
    }

    /**
     * Gets whether this session is the foreground (active) session.
     */
    public get isForeground(): boolean {
        return this._isForeground;
    }

    /**
     * Gets the LSP instance for this session.
     * Used to access LSP providers like StatementRangeProvider.
     */
    public get lsp(): ILanguageLsp {
        return this._lsp;
    }

    public activateLsp(): Promise<void> {
        return this._activateLsp();
    }

    public deactivateLsp(): Promise<void> {
        return this._deactivateLsp();
    }

    public async startDap(
        targetName: string,
        debugType: string,
        debugName: string,
    ): Promise<void> {
        if (!this._kernel) {
            this.log('Cannot start DAP: kernel not started', vscode.LogLevel.Warning);
            return;
        }

        if (this._dapComm) {
            await this._dapComm;
            return;
        }

        try {
            this._dapComm = this._kernel.createDapComm(targetName, debugType, debugName);
            await this._dapComm;
            void this.startDapMessageLoop();
        } catch (error) {
            this.log(`Error starting DAP: ${error}`, vscode.LogLevel.Error);
            this._dapComm = undefined;
            throw error;
        }
    }

    public async connectDap(): Promise<boolean> {
        if (!this._dapComm) {
            this.log('Skipping DAP connect: comm not initialized', vscode.LogLevel.Debug);
            return false;
        }

        return (await this._dapComm).connect();
    }

    public async disconnectDap(): Promise<void> {
        if (!this._dapComm) {
            return;
        }

        await (await this._dapComm).disconnect();
    }

    private async _activateLsp(): Promise<void> {
        if (!this._supportsLsp) {
            return;
        }

        if (!this._kernel) {
            return;
        }

        if (this._lsp.state !== LanguageLspState.Stopped && this._lsp.state !== LanguageLspState.Uninitialized) {
            this.log('LSP already active', vscode.LogLevel.Debug);
            return;
        }

        this.log('Starting LSP', vscode.LogLevel.Info);

        // Create the LSP comm, which also starts the LSP server.
        this._lspClientId = this._kernel.createPositronLspClientId();
        this._lspStartingPromise = this._kernel.startPositronLsp(this._lspClientId, '127.0.0.1');

        let port: number;
        try {
            port = await this._lspStartingPromise;
        } catch (err) {
            this.log(`Error starting Positron LSP: ${err}`, vscode.LogLevel.Error);
            return;
        }

        this._lspTransportKind = 'serverComm';

        this.log(`Starting Positron LSP client on port ${port}`, vscode.LogLevel.Info);

        await this._lsp.activate(port);
    }

    private async _deactivateLsp(): Promise<void> {
        if (!this._supportsLsp || this._lsp.state !== LanguageLspState.Running) {
            this.log('LSP already deactivated', vscode.LogLevel.Debug);
            return;
        }

        this.log('Stopping LSP', vscode.LogLevel.Info);
        await this._lsp.deactivate();

        if (this._lspClientId) {
            this._kernel?.removeClient(this._lspClientId);
            this._lspClientId = undefined;
        }
        this.log('LSP stopped', vscode.LogLevel.Debug);
    }

    /**
     * Wait for the LSP to be connected.
     * Resolves to the language LSP if connected, undefined if stopped.
     */
    async waitLsp(): Promise<ILanguageLsp | undefined> {
        if (await this._lsp.wait()) {
            return this._lsp;
        } else {
            return undefined;
        }
    }

    /**
     * Handle DAP messages in an infinite loop.
     */
    private async startDapMessageLoop(): Promise<void> {
        this.log('Starting DAP loop', vscode.LogLevel.Info);

        try {
            const dapComm = await this._dapComm;
            if (!dapComm?.comm) {
                throw new Error('Must create DAP comm before use');
            }

            for await (const message of dapComm.comm.receiver) {
                this.log(`Received DAP message: ${JSON.stringify(message)}`, vscode.LogLevel.Trace);

                if (!await dapComm.handleMessage(message)) {
                    this.log(`Unknown DAP message: ${message?.method}`, vscode.LogLevel.Info);

                    if (message?.kind === 'request' && typeof message.handle === 'function') {
                        message.handle(() => {
                            throw new Error(`Unknown request '${message.method}' for DAP comm`);
                        });
                    }
                }
            }
        } catch (err) {
            this.log(`Error in DAP loop: ${err}`, vscode.LogLevel.Error);
        }

        this.log('Exiting DAP loop', vscode.LogLevel.Info);
        await this._dapComm?.then((dap) => dap.dispose());
        this._dapComm = undefined;
    }

    /**
     * Returns the output channels available for this session.
     * Mirrors Positron's info popup actions and adds LSP when a kernel exists.
     */
    listOutputChannels(): RuntimeSessionOutputChannel[] {
        if (!this._kernel) {
            return [];
        }

        const nativeChannels = (this._kernel.listOutputChannels?.() ?? []).filter(
            (channel): channel is LanguageRuntimeSessionChannel =>
                channel === LanguageRuntimeSessionChannel.Console ||
                channel === LanguageRuntimeSessionChannel.Kernel
        );
        const channels = new Set<RuntimeSessionOutputChannel>(nativeChannels);
        if (this._supportsLsp) {
            channels.add('lsp');
        }
        return Array.from(channels);
    }

    /**
     * Shows one of the runtime's native output channels.
     */
    showOutput(channel: LanguageRuntimeSessionChannel): void {
        this._kernel?.showOutput(channel);
    }

    /**
     * Shows the LSP output channel
     */
    showLspOutput(): void {
        this._lsp.showOutput();
    }

    /**
     * Disposes the session
     */
    async dispose(): Promise<void> {
        if (this._eventQueueTimer) {
            clearTimeout(this._eventQueueTimer);
            this._eventQueueTimer = undefined;
        }

        await this._dapComm?.then((dap) => dap.dispose());
        this._dapComm = undefined;
        await this._lsp.dispose();
        this._disposables.forEach(d => d.dispose());
        const kernel = this._kernel as ({ dispose?: () => void | Promise<void> } | undefined);
        await kernel?.dispose?.();
    }
}
