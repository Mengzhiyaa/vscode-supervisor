import * as vscode from 'vscode';
import type {
    LanguageRuntimeDynState,
    LanguageRuntimeMetadata,
    IRuntimeSessionMetadata,
} from '../api';
import {
    RuntimeCodeExecutionMode,
    RuntimeErrorBehavior,
    type RuntimeResourceUsage,
} from '../shared/runtime';
import type { RuntimeClientInstance } from '../runtime/RuntimeClientInstance';
export {
    RuntimeCodeExecutionMode,
    RuntimeErrorBehavior,
    type RuntimeResourceUsage,
} from '../shared/runtime';

export enum RuntimeState {
    Uninitialized = 'uninitialized',
    Initializing = 'initializing',
    Starting = 'starting',
    Ready = 'ready',
    Idle = 'idle',
    Busy = 'busy',
    Restarting = 'restarting',
    Exiting = 'exiting',
    Exited = 'exited',
    Offline = 'offline',
    Interrupting = 'interrupting',
}

export enum RuntimeOnlineState {
    Starting = 'starting',
    Idle = 'idle',
    Busy = 'busy',
}

export enum RuntimeExitReason {
    Unknown = 'unknown',
    Shutdown = 'shutdown',
    ForcedQuit = 'forcedQuit',
    Restart = 'restart',
    Error = 'error',
    StartupFailed = 'startupFailed',
    SwitchRuntime = 'switchRuntime',
    ExtensionHost = 'extensionHost',
    Transferred = 'transferred',
}

export enum RuntimeCodeFragmentStatus {
    Complete = 'complete',
    Incomplete = 'incomplete',
    Invalid = 'invalid',
    Unknown = 'unknown',
}

export enum RuntimeClientType {
    Variables = 'positron.variables',
    Lsp = 'positron.lsp',
    Plot = 'positron.plot',
    DataExplorer = 'positron.dataExplorer',
    Ui = 'positron.ui',
    Help = 'positron.help',
    Connection = 'positron.connection',
    Reticulate = 'positron.reticulate',
    IPyWidget = 'jupyter.widget',
    IPyWidgetControl = 'jupyter.widget.control',
}

export enum RuntimeClientState {
    Uninitialized = 'uninitialized',
    Opening = 'opening',
    Connected = 'connected',
    Closing = 'closing',
    Closed = 'closed',
}

export enum RuntimeClientStatus {
    Idle = 'idle',
    Busy = 'busy',
    Disconnected = 'disconnected',
}

export type RuntimeClientHandlerCallback = (
    client: RuntimeClientInstance,
    params: Object
) => boolean;

export interface RuntimeClientHandler {
    clientType: string;
    callback: RuntimeClientHandlerCallback;
}

export enum LanguageRuntimeSessionChannel {
    Console = 'console',
    Kernel = 'kernel',
}

export enum RuntimeMethodErrorCode {
    ParseError = -32700,
    InvalidRequest = -32600,
    MethodNotFound = -32601,
    InvalidParams = -32602,
    InternalError = -32603,
}

export enum LanguageRuntimeStreamName {
    Stdout = 'stdout',
    Stderr = 'stderr',
}

export enum RuntimeStartMode {
    Starting = 'starting',
    Restarting = 'restarting',
    Reconnecting = 'reconnecting',
    Switching = 'switching',
}

export interface LanguageRuntimeInfo {
    banner: string;
    implementation_version: string;
    language_version: string;
    supported_features?: string[];
    input_prompt?: string;
    continuation_prompt?: string;
}

export interface LanguageRuntimeMessage {
    id: string;
    parent_id: string;
    when: string;
    type: LanguageRuntimeMessageType;
    metadata?: Record<string, unknown>;
    buffers?: Array<Uint8Array>;
}

export enum LanguageRuntimeMessageType {
    Output = 'output',
    Stream = 'stream',
    Result = 'result',
    Error = 'error',
    Input = 'input',
    State = 'state',
    Event = 'event',
    CommOpen = 'comm_open',
    CommData = 'comm_data',
    CommClosed = 'comm_closed',
    Prompt = 'prompt',
    ClearOutput = 'clear_output',
    IPyWidget = 'ipywidget',
    DebugEvent = 'debug_event',
    DebugReply = 'debug_reply',
    UpdateOutput = 'update_output',
}

export interface LanguageRuntimeOutput extends LanguageRuntimeMessage {
    data: Record<string, unknown>;
    output_id?: string;
}

export interface LanguageRuntimeResult extends LanguageRuntimeOutput {
}

export interface LanguageRuntimeStream extends LanguageRuntimeMessage {
    name: LanguageRuntimeStreamName;
    text: string;
}

export interface LanguageRuntimeInput extends LanguageRuntimeMessage {
    code: string;
    execution_count: number;
}

export interface LanguageRuntimePrompt extends LanguageRuntimeMessage {
    prompt: string;
    password: boolean;
}

export interface LanguageRuntimeState extends LanguageRuntimeMessage {
    state: RuntimeOnlineState;
}

export interface LanguageRuntimeClearOutput extends LanguageRuntimeMessage {
    wait: boolean;
}

export interface LanguageRuntimeUpdateOutput extends LanguageRuntimeMessage {
    data: Record<string, unknown>;
    output_id: string;
}

export interface LanguageRuntimeError extends LanguageRuntimeMessage {
    name: string;
    message: string;
    traceback: Array<string>;
}

export interface LanguageRuntimeCommOpen extends LanguageRuntimeMessage {
    comm_id: string;
    target_name: string;
    data: object;
}

export interface LanguageRuntimeCommMessage extends LanguageRuntimeMessage {
    comm_id: string;
    data: object;
    buffers?: Uint8Array[];
}

export interface LanguageRuntimeCommClosed extends LanguageRuntimeMessage {
    comm_id: string;
    data: object;
}

export type LanguageRuntimeMessageCommOpen = LanguageRuntimeCommOpen;
export type LanguageRuntimeMessageCommData = LanguageRuntimeCommMessage;
export type LanguageRuntimeMessageCommClosed = LanguageRuntimeCommClosed;

export interface LanguageRuntimeExit {
    runtime_name: string;
    session_name?: string;
    exit_code: number;
    reason: RuntimeExitReason;
    message: string;
}

export interface RuntimeMethodError {
    code: RuntimeMethodErrorCode;
    message: string;
    name: string;
    data: Record<string, unknown>;
}

export interface DebugProtocolRequest {
    seq: number;
    type: 'request';
    command: string;
    arguments?: Record<string, unknown>;
}

export interface DebugProtocolResponse {
    seq: number;
    type: 'response';
    request_seq: number;
    success: boolean;
    command: string;
    message?: string;
    body?: Record<string, unknown>;
}

export interface DebugProtocolEvent {
    seq: number;
    type: 'event';
    event: string;
    body?: Record<string, unknown>;
}

export interface LanguageRuntimeDebugEvent extends LanguageRuntimeMessage {
    content: DebugProtocolEvent;
}

export interface LanguageRuntimeDebugReply extends LanguageRuntimeMessage {
    content: DebugProtocolResponse;
}

export interface LanguageRuntimeSession extends vscode.Disposable {
    readonly metadata: IRuntimeSessionMetadata;
    readonly runtimeMetadata: LanguageRuntimeMetadata;
    readonly dynState: LanguageRuntimeDynState;
    readonly runtimeInfo?: LanguageRuntimeInfo;

    onDidReceiveRuntimeMessage: vscode.Event<LanguageRuntimeMessage>;
    onDidChangeRuntimeState: vscode.Event<RuntimeState>;
    onDidEndSession: vscode.Event<LanguageRuntimeExit>;
    onDidUpdateResourceUsage?: vscode.Event<RuntimeResourceUsage>;

    execute(
        code: string,
        id: string,
        mode: RuntimeCodeExecutionMode,
        errorBehavior: RuntimeErrorBehavior
    ): void;

    isCodeFragmentComplete(code: string): Thenable<RuntimeCodeFragmentStatus>;

    createClient(
        id: string,
        type: RuntimeClientType,
        params: Record<string, unknown>,
        metadata?: Record<string, unknown>
    ): Thenable<void>;

    listClients(type?: RuntimeClientType): Thenable<Record<string, string>>;

    removeClient(id: string): void;

    sendClientMessage(clientId: string, messageId: string, message: unknown): void;

    replyToPrompt(id: string, reply: string): void;

    start(): Promise<LanguageRuntimeInfo>;

    interrupt(): Thenable<void>;

    restart(workingDirectory?: string): Thenable<void>;

    setWorkingDirectory?(workingDirectory: string): Thenable<void>;

    shutdown(exitReason?: RuntimeExitReason): Thenable<void>;

    forceQuit(): Thenable<void>;

    showOutput?(channel?: LanguageRuntimeSessionChannel): void;

    listOutputChannels?(): LanguageRuntimeSessionChannel[];

    showProfile?(): void;

    getDynState?(): Thenable<LanguageRuntimeDynState>;
    updateSessionName?(sessionName: string): void;
}
