/**
 * Variables types for the vscode-ark webview.
 * These types match Positron's variables service interfaces.
 *
 * Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 * Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 */

export type {
    VariablesGrouping,
    VariablesSorting,
} from '@shared/variables';

export type VariablesInstanceState =
    | "uninitialized"
    | "opening"
    | "connected"
    | "closing"
    | "closed";

export type VariablesInstanceStatus = "idle" | "busy" | "disconnected";

export interface VariablesInstanceInfo {
    sessionId: string;
    state: VariablesInstanceState;
    status: VariablesInstanceStatus;
    grouping: VariablesGrouping;
    sorting: VariablesSorting;
    filterText: string;
    highlightRecent: boolean;
}

/**
 * Variables instance information for session selection.
 */
export interface VariablesInstance {
    id: string;
    sessionName: string;
    runtimeName: string;
    state?: VariablesInstanceState;
    status?: VariablesInstanceStatus;
}

export interface IVariableGroup {
    type: "group";
    id: string;
    title: string;
    isExpanded: boolean;
}

export interface IVariableItem {
    type: "item";
    id: string;
    path: string[];
    indentLevel: number;
    displayName: string;
    displayValue: string;
    displayType: string;
    size?: number;
    kind?: string;
    hasChildren: boolean;
    hasViewer?: boolean;
    isExpanded?: boolean;
    isRecent?: boolean;
}

export interface IVariableOverflow {
    type: "overflow";
    id: string;
    overflowValues: number;
    indentLevel: number;
}

export type VariableEntry = IVariableGroup | IVariableItem | IVariableOverflow;

export function isVariableGroup(entry: VariableEntry): entry is IVariableGroup {
    return entry.type === "group";
}

export function isVariableItem(entry: VariableEntry): entry is IVariableItem {
    return entry.type === "item";
}

export function isVariableOverflow(entry: VariableEntry): entry is IVariableOverflow {
    return entry.type === "overflow";
}
