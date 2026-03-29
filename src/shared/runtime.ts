export enum RuntimeStartupPhase {
    Initializing = 'initializing',
    AwaitingTrust = 'awaitingTrust',
    Reconnecting = 'reconnecting',
    NewFolderTasks = 'newFolderTasks',
    Starting = 'starting',
    Discovering = 'discovering',
    Complete = 'complete',
}

export type RuntimeStartupPhaseValue = `${RuntimeStartupPhase}`;

export type ConsoleState =
    | 'uninitialized'
    | 'starting'
    | 'busy'
    | 'ready'
    | 'offline'
    | 'interrupting'
    | 'restarting'
    | 'exiting'
    | 'exited'
    | 'disconnected';

export enum RuntimeCodeExecutionMode {
    Interactive = 'interactive',
    NonInteractive = 'non-interactive',
    Silent = 'silent',
    Transient = 'transient',
}

export enum RuntimeErrorBehavior {
    Stop = 'stop',
    Continue = 'continue',
}

export interface RuntimeResourceUsage {
    cpu_percent: number;
    memory_bytes: number;
    thread_count?: number;
    sampling_period_ms?: number;
    timestamp?: number;
}
