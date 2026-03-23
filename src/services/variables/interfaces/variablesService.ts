/*---------------------------------------------------------------------------------------------
 *  Service-Class Session Management - Variables Interfaces
 *  1:1 replication of Positron's IPositronVariablesService and IPositronVariablesInstance
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RuntimeSession } from '../../../runtime/session';

/**
 * RuntimeClientState enumeration (1:1 Positron).
 */
export const enum RuntimeClientState {
    Uninitialized = 'uninitialized',
    Opening = 'opening',
    Connected = 'connected',
    Closing = 'closing',
    Closed = 'closed'
}

/**
 * RuntimeClientStatus enumeration (1:1 Positron).
 */
export const enum RuntimeClientStatus {
    Idle = 'idle',
    Busy = 'busy',
    Disconnected = 'disconnected'
}

/**
 * PositronVariablesGrouping enumeration (1:1 Positron).
 */
export const enum PositronVariablesGrouping {
    None = 0,
    Kind = 1,
    Size = 2
}

/**
 * PositronVariablesSorting enumeration (1:1 Positron).
 */
export const enum PositronVariablesSorting {
    Name = 0,
    Size = 1,
    Recent = 2
}

/**
 * Variable data structure.
 */
export interface Variable {
    access_key: string;
    display_name: string;
    display_value: string;
    display_type: string;
    type_info: string;
    size: number;
    kind: string;
    length: number;
    has_children: boolean;
    has_viewer: boolean;
    is_truncated: boolean;
    updated_time: number;
}

/**
 * A view containing a list of variables in the session.
 */
export interface VariableList {
    variables: Variable[];
    length: number;
    version?: number;
}

/**
 * An inspected variable response.
 */
export interface InspectedVariable {
    children: Variable[];
    length: number;
}

/**
 * Variable group interface.
 */
export interface IVariableGroup {
    id: string;
    title: string;
    isExpanded: boolean;
    variableItems: IVariableItem[];
}

/**
 * Variable item interface.
 */
export interface IVariableItem {
    id: string;
    path: string[];
    indentLevel: number;
    displayName: string;
    displayValue: string;
    displayType: string;
    size: number;
    kind: string;
    hasChildren: boolean;
    hasViewer: boolean;
    isExpanded: boolean;
    childItems?: IVariableItem[];
    isRecent: boolean;
}

/**
 * Variable overflow marker interface.
 */
export interface IVariableOverflow {
    id: string;
    indentLevel: number;
    overflowValues: number;
}

/**
 * VariableEntry type alias (1:1 Positron).
 */
export type VariableEntry = IVariableGroup | IVariableItem | IVariableOverflow;

export function isVariableGroup(entry: VariableEntry): entry is IVariableGroup {
    return 'title' in entry;
}

export function isVariableItem(entry: VariableEntry): entry is IVariableItem {
    return 'path' in entry;
}

export function isVariableOverflow(entry: VariableEntry): entry is IVariableOverflow {
    return 'overflowValues' in entry;
}

/**
 * Variables client instance interface.
 */
export interface VariablesClientInstance {
    getClientId(): string;
    list(): Promise<VariableList>;
    clear(includeHidden?: boolean): Promise<void>;
    delete(names: string[]): Promise<string[]>;
    inspect(path: string[]): Promise<InspectedVariable>;
    clipboardFormat(path: string[], format: string): Promise<string>;
    view(path: string[]): Promise<void>;
}

/**
 * IPositronVariablesInstance interface (1:1 Positron).
 */
export interface IPositronVariablesInstance extends vscode.Disposable {
    readonly session: RuntimeSession;
    readonly state: RuntimeClientState;
    readonly status: RuntimeClientStatus;
    grouping: PositronVariablesGrouping;
    sorting: PositronVariablesSorting;
    highlightRecent: boolean;

    readonly onDidChangeEntries: vscode.Event<VariableEntry[]>;
    readonly onDidChangeState: vscode.Event<RuntimeClientState>;
    readonly onDidChangeStatus: vscode.Event<RuntimeClientStatus>;
    readonly onFocusElement: vscode.Event<void>;

    requestRefresh(): void;
    requestClear(includeHiddenVariables: boolean): void;
    requestDelete(names: string[]): void;
    expandVariableGroup(id: string): void;
    collapseVariableGroup(id: string): void;
    expandVariableItem(path: string[]): Promise<void>;
    collapseVariableItem(path: string[]): void;
    setFilterText(filterText: string): void;
    hasFilterText(): boolean;
    getFilterText(): string;
    focusElement(): void;
    list(): Promise<Variable[]>;
    inspect(path: string[]): Promise<InspectedVariable>;
    clipboardFormat(path: string[], format: string): Promise<string>;
    view(path: string[]): Promise<void>;
    getClientInstance(): VariablesClientInstance | undefined;
}

/**
 * IPositronVariablesService interface (1:1 Positron).
 */
export interface IPositronVariablesService extends vscode.Disposable {
    readonly positronVariablesInstances: IPositronVariablesInstance[];
    readonly activePositronVariablesInstance: IPositronVariablesInstance | undefined;

    readonly onDidStartPositronVariablesInstance: vscode.Event<IPositronVariablesInstance>;
    readonly onDidStopPositronVariablesInstance: vscode.Event<IPositronVariablesInstance>;
    readonly onDidChangeActivePositronVariablesInstance: vscode.Event<IPositronVariablesInstance | undefined>;

    initialize(): void;
    setActivePositronVariablesSession(sessionId: string): void;
    setViewVisible(visible: boolean): void;
    getVariablesInstance(sessionId: string): IPositronVariablesInstance | undefined;
}
