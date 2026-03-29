/**
 * Console types for the vscode-ark webview.
 * These types match Positron's console service interfaces.
 *
 * Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 * Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 */

import type {
    ConsoleState,
    RuntimeStartupPhaseValue,
} from "@shared/runtime";
export type { ConsoleState } from "@shared/runtime";

/**
 * Runtime status type for displaying runtime state icons.
 */
export type RuntimeStatusType = 'Active' | 'Disconnected' | 'Idle';

export type RuntimeStartupPhase = RuntimeStartupPhaseValue;

/**
 * Session mode for runtime icon display.
 */
export type SessionMode = 'console' | 'notebook' | 'background';

export interface ConsoleSettings {
    scrollbackSize: number;
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
}

/**
 * Mapping from ConsoleState to RuntimeStatusType.
 */
export const consoleStateToRuntimeStatus: Record<ConsoleState, RuntimeStatusType> = {
    'uninitialized': 'Disconnected',
    'disconnected': 'Disconnected',
    'starting': 'Active',
    'busy': 'Active',
    'interrupting': 'Active',
    'restarting': 'Active',
    'ready': 'Idle',
    'offline': 'Disconnected',
    'exiting': 'Active',
    'exited': 'Disconnected'
};

/**
 * Mapping from RuntimeStatusType to codicon class.
 */
export const runtimeStatusToIcon: Record<RuntimeStatusType, string> = {
    'Active': 'codicon-positron-status-active',
    'Disconnected': 'codicon-positron-status-disconnected',
    'Idle': 'codicon-positron-status-idle'
};

/**
 * Mapping from RuntimeStatusType to CSS color variable.
 */
export const runtimeStatusToColor: Record<RuntimeStatusType, string> = {
    'Active': 'var(--vscode-positronConsole-stateIconActive, #3a79b2)',
    'Disconnected': 'var(--vscode-positronConsole-stateIconDisconnected, #d93939)',
    'Idle': 'var(--vscode-positronConsole-stateIconIdle, #2eb77c)'
};
