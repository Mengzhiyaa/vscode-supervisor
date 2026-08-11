import { RuntimeStartupPhase } from './runtimeStartupPhase';
export { RuntimeStartupPhase } from './runtimeStartupPhase';

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

export interface ConsoleSettings {
    scrollbackSize: number;
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    fontLigatures: string;
    fontVariations: string;
    fontWeight: string;
    letterSpacing: number;
    showResourceMonitor: boolean;
    promptWhenIncomplete: boolean;
    sashSize: number;
}

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
    process_id?: number;
    thread_count?: number;
    sampling_period_ms?: number;
    timestamp?: number;
}
