import { RuntimeState } from '../internal/runtimeTypes';
import type { ConsoleState } from '../shared/runtime';
import { PositronConsoleState } from '../services/console/interfaces/consoleService';

export function runtimeStateToConsoleState(state: RuntimeState): ConsoleState {
    switch (state) {
        case RuntimeState.Uninitialized:
            return 'uninitialized';
        case RuntimeState.Offline:
            return 'offline';
        case RuntimeState.Initializing:
        case RuntimeState.Starting:
            return 'starting';
        case RuntimeState.Ready:
        case RuntimeState.Idle:
            return 'ready';
        case RuntimeState.Busy:
            return 'busy';
        case RuntimeState.Interrupting:
            return 'interrupting';
        case RuntimeState.Restarting:
            return 'restarting';
        case RuntimeState.Exiting:
            return 'exiting';
        case RuntimeState.Exited:
            return 'exited';
        default:
            return 'uninitialized';
    }
}

export function runtimeStateToPositronConsoleState(
    state: RuntimeState,
): PositronConsoleState {
    switch (state) {
        case RuntimeState.Uninitialized:
            return PositronConsoleState.Uninitialized;
        case RuntimeState.Initializing:
        case RuntimeState.Starting:
            return PositronConsoleState.Starting;
        case RuntimeState.Restarting:
            return PositronConsoleState.Restarting;
        case RuntimeState.Busy:
            return PositronConsoleState.Busy;
        case RuntimeState.Interrupting:
            return PositronConsoleState.Interrupting;
        case RuntimeState.Ready:
        case RuntimeState.Idle:
            return PositronConsoleState.Ready;
        case RuntimeState.Offline:
            return PositronConsoleState.Offline;
        case RuntimeState.Exiting:
            return PositronConsoleState.Exiting;
        case RuntimeState.Exited:
            return PositronConsoleState.Exited;
        default:
            return PositronConsoleState.Disconnected;
    }
}

export function positronConsoleStateToConsoleState(
    state: PositronConsoleState,
): ConsoleState {
    switch (state) {
        case PositronConsoleState.Uninitialized:
            return 'uninitialized';
        case PositronConsoleState.Starting:
            return 'starting';
        case PositronConsoleState.Busy:
            return 'busy';
        case PositronConsoleState.Ready:
            return 'ready';
        case PositronConsoleState.Offline:
            return 'offline';
        case PositronConsoleState.Interrupting:
            return 'interrupting';
        case PositronConsoleState.Restarting:
            return 'restarting';
        case PositronConsoleState.Exiting:
            return 'exiting';
        case PositronConsoleState.Exited:
            return 'exited';
        case PositronConsoleState.Disconnected:
            return 'disconnected';
        default:
            return 'uninitialized';
    }
}
