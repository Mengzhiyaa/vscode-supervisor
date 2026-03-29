/*---------------------------------------------------------------------------------------------
 *  Service-Class Session Management - Variables Interfaces
 *  1:1 replication of Positron's IPositronVariablesService and IPositronVariablesInstance
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RuntimeSession } from '../../../runtime/session';
import {
    RuntimeClientState,
    RuntimeClientStatus,
} from '../../../internal/runtimeTypes';
import type {
    InspectedVariable,
    Variable,
    VariableList,
} from '../../../runtime/comms/positronVariablesComm';
import type {
    IVariableGroup as SharedVariableGroup,
    IVariableItem as SharedVariableItem,
    IVariableOverflow as SharedVariableOverflow,
} from '../../../shared/variables';
export {
    RuntimeClientState,
    RuntimeClientStatus,
} from '../../../internal/runtimeTypes';
export type {
    InspectedVariable,
    Variable,
    VariableList,
} from '../../../runtime/comms/positronVariablesComm';

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
 * Variable tree group interface used by the service layer.
 */
export interface VariablesTreeGroup extends Omit<SharedVariableGroup, 'type'> {
    variableItems: VariablesTreeItem[];
}

/**
 * Variable tree item interface used by the service layer.
 */
export interface VariablesTreeItem extends Omit<
    SharedVariableItem,
    'type' | 'size' | 'kind' | 'hasViewer' | 'isExpanded' | 'isRecent'
> {
    size: number;
    kind: string;
    hasViewer: boolean;
    isExpanded: boolean;
    childItems?: VariablesTreeItem[];
    isRecent: boolean;
}

/**
 * Variable tree overflow marker interface used by the service layer.
 */
export interface VariablesTreeOverflow extends Omit<SharedVariableOverflow, 'type'> { }

/**
 * Service-layer variable tree entry.
 */
export type VariablesTreeEntry =
    | VariablesTreeGroup
    | VariablesTreeItem
    | VariablesTreeOverflow;

export function isVariablesTreeGroup(entry: VariablesTreeEntry): entry is VariablesTreeGroup {
    return 'title' in entry;
}

export function isVariablesTreeItem(entry: VariablesTreeEntry): entry is VariablesTreeItem {
    return 'path' in entry;
}

export function isVariablesTreeOverflow(entry: VariablesTreeEntry): entry is VariablesTreeOverflow {
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

    readonly onDidChangeEntries: vscode.Event<VariablesTreeEntry[]>;
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
