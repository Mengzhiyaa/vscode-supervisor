export type VariablesGrouping = 'none' | 'kind' | 'size';
export type VariablesSorting = 'name' | 'size' | 'recent';
export type VariablesInstanceState =
    | 'uninitialized'
    | 'opening'
    | 'connected'
    | 'closing'
    | 'closed';
export type VariablesInstanceStatus = 'idle' | 'busy' | 'disconnected';

export interface VariablesInstanceInfo {
    sessionId: string;
    state: VariablesInstanceState;
    status: VariablesInstanceStatus;
    grouping: VariablesGrouping;
    sorting: VariablesSorting;
    filterText: string;
    highlightRecent: boolean;
}

export interface IVariableGroup {
    type: 'group';
    id: string;
    title: string;
    isExpanded: boolean;
}

export interface IVariableItem {
    type: 'item';
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
    type: 'overflow';
    id: string;
    overflowValues: number;
    indentLevel: number;
}

export type VariableEntry = IVariableGroup | IVariableItem | IVariableOverflow;

export function isVariableGroup(entry: VariableEntry): entry is IVariableGroup {
    return entry.type === 'group';
}

export function isVariableItem(entry: VariableEntry): entry is IVariableItem {
    return entry.type === 'item';
}

export function isVariableOverflow(entry: VariableEntry): entry is IVariableOverflow {
    return entry.type === 'overflow';
}

export function encodeInstanceState(value: string): VariablesInstanceState {
    switch (value) {
        case 'opening':
            return 'opening';
        case 'connected':
            return 'connected';
        case 'closing':
            return 'closing';
        case 'closed':
            return 'closed';
        case 'uninitialized':
        default:
            return 'uninitialized';
    }
}

export function encodeInstanceStatus(value: string): VariablesInstanceStatus {
    switch (value) {
        case 'busy':
            return 'busy';
        case 'disconnected':
            return 'disconnected';
        case 'idle':
        default:
            return 'idle';
    }
}

export function decodeGrouping(wire: VariablesGrouping): number {
    switch (wire) {
        case 'kind':
            return 1;
        case 'size':
            return 2;
        case 'none':
        default:
            return 0;
    }
}

export function encodeGrouping(value: number): VariablesGrouping {
    switch (value) {
        case 1:
            return 'kind';
        case 2:
            return 'size';
        case 0:
        default:
            return 'none';
    }
}

export function decodeSorting(wire: VariablesSorting): number {
    switch (wire) {
        case 'size':
            return 1;
        case 'recent':
            return 2;
        case 'name':
        default:
            return 0;
    }
}

export function encodeSorting(value: number): VariablesSorting {
    switch (value) {
        case 1:
            return 'size';
        case 2:
            return 'recent';
        case 0:
        default:
            return 'name';
    }
}
