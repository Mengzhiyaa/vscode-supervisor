/**
 * Type definitions for integration with positron-supervisor extension.
 * These are simplified versions of the types from positron-supervisor.d.ts.
 */

import * as vscode from 'vscode';
import type { Comm } from '../supervisor/positron-supervisor';
import {
    LanguageRuntimeDynState,
    LanguageRuntimeInfo,
    LanguageRuntimeMetadata,
    LanguageRuntimeSessionMode,
    LanguageRuntimeExit,
    RuntimeSessionMetadata,
    RuntimeClientType,
    RuntimeCodeExecutionMode,
    RuntimeCodeFragmentStatus,
    RuntimeErrorBehavior,
    RuntimeExitReason,
    RuntimeResourceUsage,
    RuntimeState,
    RuntimeOnlineState,
} from '../positronTypes';

export {
    LanguageRuntimeDynState,
    LanguageRuntimeInfo,
    LanguageRuntimeMetadata,
    LanguageRuntimeSessionMode,
    LanguageRuntimeExit,
    RuntimeSessionMetadata,
    RuntimeClientState,
    RuntimeClientType,
    RuntimeCodeExecutionMode,
    RuntimeCodeFragmentStatus,
    RuntimeErrorBehavior,
    RuntimeExitReason,
    RuntimeOnlineState,
    RuntimeResourceUsage,
    RuntimeState,
    RuntimeStartMode,
    LanguageRuntimeSessionChannel,
    LanguageRuntimeSessionLocation,
    LanguageRuntimeStartupBehavior,
    RuntimeCodeExecutionMode as LanguageRuntimeCodeExecutionMode,
} from '../positronTypes';

// ============================================================
// Jupyter Kernel Spec
// ============================================================

/**
 * Represents a registered Jupyter Kernel spec.
 */
export interface JupyterKernelSpec {
    /** Command used to start the kernel and an array of command line arguments */
    argv: Array<string>;

    /** The kernel's display name */
    display_name: string;

    /** The language the kernel executes */
    language: string;

    /** Interrupt mode (signal or message) */
    interrupt_mode?: 'signal' | 'message';

    /** Environment variables to set when starting the kernel */
    env?: NodeJS.ProcessEnv;

    /** The Jupyter protocol version */
    kernel_protocol_version: string;

    /** Optional preflight command */
    startup_command?: string;
}

// ============================================================
// Language Runtime Types (from positron API)
// ============================================================

/**
 * Runtime resource usage information (Positron pattern).
 */
export interface EvaluateCodeResult {
    result: any;
    output: string;
}

/**
 * Kernel launch parameters used to start a runtime session.
 */
export interface RuntimeLaunchInfo {
    argv: string[];
    env: Record<string, string>;
    startupCommand?: string;
    interruptMode?: string;
    protocolVersion?: string;
}

/**
 * Backend message yielded by DAP comm receiver.
 */
export type DapCommBackendMessage =
    | {
        kind: 'request';
        method: string;
        params?: Record<string, unknown>;
        handle: (handler: () => any) => void;
    }
    | {
        kind: 'notification';
        method: string;
        params?: Record<string, unknown>;
    };

/**
 * Minimal DAP comm surface consumed by runtime/session.
 */
export interface DapCommLike {
    readonly targetName: string;
    readonly debugType: string;
    readonly debugName: string;
    readonly port: number;
    readonly comm: {
        readonly id?: string;
        receiver: AsyncIterable<DapCommBackendMessage>;
        dispose(): void;
    };
    handleMessage(msg: any): Promise<boolean>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    dispose(): void;
}

// ============================================================
// Jupyter Language Runtime Session
// ============================================================

export interface JupyterLanguageRuntimeSession {
    readonly runtimeMetadata: LanguageRuntimeMetadata;
    readonly metadata: RuntimeSessionMetadata;
    readonly dynState: LanguageRuntimeDynState;
    readonly runtimeInfo?: LanguageRuntimeInfo;

    // State
    readonly state: RuntimeState;
    onDidChangeRuntimeState: vscode.Event<RuntimeState>;
    onDidReceiveRuntimeMessage: vscode.Event<any>;
    onDidEndSession: vscode.Event<LanguageRuntimeExit>;
    onDidUpdateResourceUsage?: vscode.Event<RuntimeResourceUsage>;

    // Lifecycle
    start(): Promise<LanguageRuntimeInfo>;
    interrupt(): Promise<void>;
    restart(workingDirectory?: string): Promise<void>;
    getDynState?(): Promise<LanguageRuntimeDynState>;
    setWorkingDirectory?(workingDirectory: string): Promise<void>;
    shutdown(exitReason?: RuntimeExitReason): Promise<void>;
    forceQuit(): Promise<void>;

    // Execution
    execute(
        code: string,
        id: string,
        mode: RuntimeCodeExecutionMode,
        errorBehavior: RuntimeErrorBehavior
    ): void;
    isCodeFragmentComplete(code: string): Promise<RuntimeCodeFragmentStatus>;
    evaluate(code: string): Promise<EvaluateCodeResult>;
    callMethod(method: string, ...args: any[]): Promise<any>;
    callUiComm(method: string, params?: Record<string, unknown>): Promise<any>;
    getLaunchInfo(): Promise<RuntimeLaunchInfo | undefined>;
    createComm(targetName: string, params?: Record<string, unknown>): Promise<Comm>;
    createServerComm(targetName: string, ipAddress: string): Promise<[Comm, number]>;
    getKernelLogFile(): string;
    replyToPrompt(id: string, value: string): void;

    // Clients
    createClient(id: string, type: RuntimeClientType, params: any, metadata?: any): Promise<void>;
    listClients(type?: RuntimeClientType): Promise<Record<string, string>>;
    removeClient(id: string): void;
    sendClientMessage(clientId: string, messageId: string, message: any): void;

    // LSP Support (for positron-r style LSP integration)
    createPositronLspClientId(): string;
    startPositronLsp(clientId: string, ipAddress: string): Promise<number>;
    createDapComm(targetName: string, debugType: string, debugName: string): Promise<DapCommLike>;

    // Logging
    emitJupyterLog(message: string, logLevel?: vscode.LogLevel): void;
    showOutput(channel?: string): void;
    listOutputChannels?(): string[];
    updateSessionName?(sessionName: string): void;

    // Dispose
    dispose(): Promise<void>;
}

// ============================================================
// Positron Supervisor API
// ============================================================

export interface JupyterKernelExtra {
    attachOnStartup?: {
        init: (args: Array<string>) => void;
        attach: () => Promise<void>;
    };
    sleepOnStartup?: {
        init: (args: Array<string>, delay: number) => void;
    };
}

/**
 * The Positron Supervisor API as exposed by the positron-supervisor extension.
 */
export interface PositronSupervisorApi extends vscode.Disposable {
    /**
     * Create a session for a Jupyter-compatible kernel.
     */
    createSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionMetadata: RuntimeSessionMetadata,
        kernel: JupyterKernelSpec,
        dynState: LanguageRuntimeDynState,
        extra?: JupyterKernelExtra | undefined,
    ): Promise<JupyterLanguageRuntimeSession>;

    /**
     * Validate an existing session for a Jupyter-compatible kernel.
     */
    validateSession(sessionId: string): Promise<boolean>;

    /**
     * Restore a session for a Jupyter-compatible kernel.
     */
    restoreSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionMetadata: RuntimeSessionMetadata,
        dynState: LanguageRuntimeDynState,
    ): Promise<JupyterLanguageRuntimeSession>;
}
