/*---------------------------------------------------------------------------------------------
 *  PositronVariablesInstance Implementation
 *  1:1 replication of Positron's variables instance class
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    IPositronVariablesInstance,
    PositronVariablesGrouping,
    PositronVariablesSorting,
    RuntimeClientState,
    RuntimeClientStatus,
    VariablesTreeEntry,
    VariablesTreeItem,
    VariablesTreeGroup,
    VariablesTreeOverflow,
    Variable,
    type VariablesClientInstance
} from './interfaces/variablesService';
import { RuntimeSession } from '../../runtime/session';
import { RuntimeClientInstance } from '../../runtime/RuntimeClientInstance';
import type { RuntimeClientManager } from '../../runtime/runtimeClientManager';
import {
    VariablesClientInstance as RuntimeVariablesClientInstance,
    PositronVariablesList,
    PositronVariablesUpdate,
    createVariablesClient
} from '../../runtime/VariablesClientInstance';
import {
    RuntimeClientType,
    RuntimeState,
} from '../../internal/runtimeTypes';

/**
 * VariableItem class for internal state management.
 */
class VariableItem implements VariablesTreeItem {
    readonly id: string;
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
    childItems?: VariableItem[];
    isRecent: boolean;
    totalChildren: number;
    overflowEntry?: VariableOverflow;

    constructor(variable: Variable, parentPath: string[] = [], isRecent: boolean = false) {
        this.path = [...parentPath, variable.access_key];
        this.id = JSON.stringify(this.path);
        this.indentLevel = parentPath.length;
        this.displayName = variable.display_name;
        this.displayValue = variable.display_value;
        this.displayType = variable.display_type;
        this.size = variable.size;
        this.kind = variable.kind;
        this.hasChildren = variable.has_children;
        this.hasViewer = variable.has_viewer;
        this.isExpanded = false;
        this.isRecent = isRecent;
        this.totalChildren = variable.length;
    }

    get accessKey(): string {
        return this.path[this.path.length - 1];
    }

    locateVariableItem(path: string[]): VariableItem | undefined {
        if (!path.length) {
            return this;
        }

        const childItem = this.childItems?.find(item => item.accessKey === path[0]);
        return childItem?.locateVariableItem(path.slice(1));
    }

    flatten(isExpanded: (path: string[]) => boolean): Array<VariableItem | VariableOverflow> {
        const entries: Array<VariableItem | VariableOverflow> = [this];

        if (!this.hasChildren) {
            this.isExpanded = false;
            return entries;
        }

        this.isExpanded = isExpanded(this.path);
        if (!this.isExpanded) {
            return entries;
        }

        for (const childItem of this.childItems ?? []) {
            entries.push(...childItem.flatten(isExpanded));
        }

        if (this.overflowEntry) {
            entries.push(this.overflowEntry);
        }

        return entries;
    }
}

class VariableOverflow implements VariablesTreeOverflow {
    constructor(
        public readonly id: string,
        public readonly indentLevel: number,
        public readonly overflowValues: number
    ) { }
}

/**
 * VariableGroup class for grouping variables.
 */
class VariableGroup implements VariablesTreeGroup {
    constructor(
        public readonly id: string,
        public readonly title: string,
        public isExpanded: boolean,
        public variableItems: VariablesTreeItem[]
    ) { }
}

/**
 * PositronVariablesInstance class (1:1 Positron).
 */
export class PositronVariablesInstance implements IPositronVariablesInstance {
    //#region Private Properties
    private _state: RuntimeClientState = RuntimeClientState.Uninitialized;
    private _status: RuntimeClientStatus = RuntimeClientStatus.Disconnected;
    private _variableItems = new Map<string, VariableItem>();
    private _grouping: PositronVariablesGrouping = PositronVariablesGrouping.Kind;
    private _sorting: PositronVariablesSorting = PositronVariablesSorting.Name;
    private _filterText = '';
    private _highlightRecent = true;
    private readonly _collapsedGroupIds = new Set<string>();
    private readonly _expandedPaths = new Set<string>();
    private _entries: VariablesTreeEntry[] = [];
    private _variablesClient: RuntimeVariablesClientInstance | undefined;
    private _variablesClientId: string | undefined;
    private _pendingClientRequests = 0;
    private _clientHandlerRegistered = false;
    private _warnedMissingClient = false;
    private readonly _disposables: vscode.Disposable[] = [];
    private _runtimeDisposables: vscode.Disposable[] = [];
    private _clientDisposables: vscode.Disposable[] = [];

    private readonly _onDidChangeEntriesEmitter = new vscode.EventEmitter<VariablesTreeEntry[]>();
    private readonly _onDidChangeStateEmitter = new vscode.EventEmitter<RuntimeClientState>();
    private readonly _onDidChangeStatusEmitter = new vscode.EventEmitter<RuntimeClientStatus>();
    private readonly _onFocusElementEmitter = new vscode.EventEmitter<void>();
    //#endregion

    constructor(
        private readonly _session: RuntimeSession,
        private readonly _outputChannel: vscode.LogOutputChannel
    ) {
        this._outputChannel.debug(`[VariablesInstance] Created for session ${_session.sessionId}`);
        this.attachToSession();
    }

    //#region IPositronVariablesInstance Implementation
    get session(): RuntimeSession { return this._session; }
    get state(): RuntimeClientState { return this._state; }
    get status(): RuntimeClientStatus { return this._status; }

    get grouping(): PositronVariablesGrouping { return this._grouping; }
    set grouping(value: PositronVariablesGrouping) {
        if (this._grouping !== value) {
            this._grouping = value;
            this.updateEntries();
        }
    }

    get sorting(): PositronVariablesSorting { return this._sorting; }
    set sorting(value: PositronVariablesSorting) {
        if (this._sorting !== value) {
            this._sorting = value;
            this.updateEntries();
        }
    }

    get highlightRecent(): boolean { return this._highlightRecent; }
    set highlightRecent(value: boolean) {
        if (this._highlightRecent !== value) {
            this._highlightRecent = value;
            this.updateEntries();
        }
    }

    readonly onDidChangeEntries = this._onDidChangeEntriesEmitter.event;
    readonly onDidChangeState = this._onDidChangeStateEmitter.event;
    readonly onDidChangeStatus = this._onDidChangeStatusEmitter.event;
    readonly onFocusElement = this._onFocusElementEmitter.event;

    requestRefresh(): void {
        this._outputChannel.debug('[VariablesInstance] Requesting refresh');
        if (!this._variablesClient) {
            this._warnMissingClient('refresh');
            return;
        }

        this._expandedPaths.clear();
        void this._runWithClientRequest(async () => {
            const list = await this._variablesClient!.requestRefresh();
            await this.processList(list);
        })
            .catch(error => {
                this._outputChannel.warn(`[VariablesInstance] Refresh failed: ${error}`);
            });
    }

    requestClear(includeHiddenVariables: boolean): void {
        this._outputChannel.debug('[VariablesInstance] Requesting clear');
        if (!this._variablesClient) {
            this._warnMissingClient('clear');
            return;
        }

        void this._runWithClientRequest(() =>
            this._variablesClient!.requestClear(includeHiddenVariables)
        )
            .then(() => {
                this.requestRefresh();
            })
            .catch(error => {
                this._outputChannel.warn(`[VariablesInstance] Clear failed: ${error}`);
            });
    }

    requestDelete(names: string[]): void {
        this._outputChannel.debug(`[VariablesInstance] Requesting delete: ${names.join(', ')}`);
        if (!this._variablesClient) {
            this._warnMissingClient('delete');
            return;
        }

        void this._runWithClientRequest(async () => {
            const update = await this._variablesClient!.requestDelete(names);
            await this.processUpdate(update);
        })
            .catch(error => {
                this._outputChannel.warn(`[VariablesInstance] Delete failed: ${error}`);
            });
    }

    expandVariableGroup(id: string): void {
        if (this._collapsedGroupIds.has(id)) {
            this._collapsedGroupIds.delete(id);
            this.fireEntriesChanged();
        }
    }

    collapseVariableGroup(id: string): void {
        if (!this._collapsedGroupIds.has(id)) {
            this._collapsedGroupIds.add(id);
            this.fireEntriesChanged();
        }
    }

    async expandVariableItem(path: string[]): Promise<void> {
        const pathString = JSON.stringify(path);
        if (!this._expandedPaths.has(pathString)) {
            this._expandedPaths.add(pathString);
            const variableItem = this.locateVariableItem(path);
            if (variableItem) {
                await this.loadChildItems(variableItem);
            }
            this.fireEntriesChanged();
        }
    }

    collapseVariableItem(path: string[]): void {
        const pathString = JSON.stringify(path);
        if (this._expandedPaths.has(pathString)) {
            this._expandedPaths.delete(pathString);
            this.fireEntriesChanged();
        }
    }

    setFilterText(filterText: string): void {
        if (this._filterText !== filterText) {
            this._filterText = filterText;
            this.updateEntries();
        }
    }

    hasFilterText(): boolean { return this._filterText !== ''; }
    getFilterText(): string { return this._filterText; }
    focusElement(): void { this._onFocusElementEmitter.fire(); }

    async list(): Promise<Variable[]> {
        if (!this._variablesClient) {
            this._warnMissingClient('list');
            return [];
        }

        const list = await this._runWithClientRequest(() => this._variablesClient!.list());
        return Array.isArray(list) ? list : (list.variables ?? []);
    }

    async inspect(path: string[]): Promise<{ children: Variable[]; length: number }> {
        if (!this._variablesClient) {
            this._warnMissingClient('inspect');
            return { children: [], length: 0 };
        }

        const result = await this._runWithClientRequest(() => this._variablesClient!.inspect(path));
        return {
            children: result.children ?? [],
            length: result.length ?? 0,
        };
    }

    async clipboardFormat(path: string[], format: string): Promise<string> {
        if (!this._variablesClient) {
            this._warnMissingClient('clipboardFormat');
            return '';
        }

        return this._runWithClientRequest(() =>
            this._variablesClient!.clipboardFormat(path, format)
        );
    }

    async view(path: string[]): Promise<void> {
        if (!this._variablesClient) {
            this._warnMissingClient('view');
            return;
        }

        await this._runWithClientRequest(() => this._variablesClient!.view(path));
    }

    getClientInstance(): VariablesClientInstance | undefined { return this._variablesClient; }

    dispose(): void {
        this.detachFromSession();
        this._disposeRuntimeDisposables();
        this._disposables.forEach(d => d.dispose());
        this._onDidChangeEntriesEmitter.dispose();
        this._onDidChangeStateEmitter.dispose();
        this._onDidChangeStatusEmitter.dispose();
        this._onFocusElementEmitter.dispose();
    }
    //#endregion

    //#region Public Methods for Service Integration
    updateVariables(variables: Variable[]): void {
        this._variableItems.forEach(item => { item.isRecent = false; });

        for (const variable of variables) {
            this._variableItems.set(
                variable.access_key,
                this.createVariableItem(variable, [], this._highlightRecent)
            );
        }

        const newKeys = new Set(variables.map(v => v.access_key));
        for (const key of this._variableItems.keys()) {
            if (!newKeys.has(key)) {
                this._variableItems.delete(key);
            }
        }

        this.updateEntries();
    }

    setState(state: RuntimeClientState): void {
        if (this._state !== state) {
            this._state = state;
            this._onDidChangeStateEmitter.fire(state);
        }
    }

    setStatus(status: RuntimeClientStatus): void {
        if (this._status !== status) {
            this._status = status;
            this._onDidChangeStatusEmitter.fire(status);
        }
    }
    //#endregion

    //#region Private Methods
    private attachToSession(): void {
        this._outputChannel.debug(
            `[VariablesInstance] Attaching to session ${this._session.sessionId} (state=${this._session.state}, clientManager=${this._session.clientManager ? 'yes' : 'no'})`
        );
        this._state = RuntimeClientState.Opening;
        this._status = RuntimeClientStatus.Disconnected;
        this._onDidChangeStateEmitter.fire(this._state);
        this._onDidChangeStatusEmitter.fire(this._status);

        this._disposeRuntimeDisposables();

        if (this._session.clientManager) {
            this._attachToClientManager(this._session.clientManager, 'attach');
        } else {
            this._outputChannel.debug(
                `[VariablesInstance] Waiting for client manager for session ${this._session.sessionId}`
            );
        }

        this._runtimeDisposables.push(
            this._session.onDidCreateClientManager(manager => {
                this._attachToClientManager(manager, 'clientManagerCreated');
            }),
            this._session.onDidChangeRuntimeState(state => {
                if (state === RuntimeState.Exited) {
                    this.detachFromSession();
                }
            })
        );
    }

    private detachFromSession(): void {
        this._disposeClientDisposables();
        this._pendingClientRequests = 0;

        if (this._variablesClient) {
            this._variablesClient.dispose();
            this._variablesClient = undefined;
        }

        this._variablesClientId = undefined;
        this._warnedMissingClient = false;
        this._expandedPaths.clear();
        this._variableItems.clear();
        this.updateEntries();

        this.setState(RuntimeClientState.Closed);
        this.setStatus(RuntimeClientStatus.Disconnected);
    }

    private _handleVariablesClient(client: RuntimeClientInstance): void {
        const clientId = client.getClientId();
        if (this._variablesClientId === clientId) {
            return;
        }
        this._outputChannel.debug(`[VariablesInstance] Attaching variables client ${clientId}`);

        this._disposeClientDisposables();
        if (this._variablesClient) {
            this._variablesClient.dispose();
        }

        this._variablesClient = createVariablesClient(client);
        this._variablesClientId = clientId;
        this._warnedMissingClient = false;
        this._pendingClientRequests = 0;
        this.setState(RuntimeClientState.Connected);
        this._updateClientRequestStatus();

        this._clientDisposables.push(
            this._variablesClient.onDidReceiveList(list => {
                void this.processList(list);
            }),
            this._variablesClient.onDidReceiveUpdate(update => {
                void this.processUpdate(update);
            }),
            client.onDidChangeClientState(state => {
                this._syncClientState(state);
            })
        );

        // Kick off an initial refresh to populate data
        this.requestRefresh();
    }

    private _syncClientState(state: RuntimeClientState): void {
        switch (state) {
            case RuntimeClientState.Uninitialized:
                this._pendingClientRequests = 0;
                this.setState(RuntimeClientState.Uninitialized);
                this.setStatus(RuntimeClientStatus.Disconnected);
                break;
            case RuntimeClientState.Opening:
                this.setState(RuntimeClientState.Opening);
                this.setStatus(RuntimeClientStatus.Disconnected);
                break;
            case RuntimeClientState.Connected:
                this.setState(RuntimeClientState.Connected);
                this._updateClientRequestStatus();
                break;
            case RuntimeClientState.Closing:
                this._pendingClientRequests = 0;
                this.setState(RuntimeClientState.Closing);
                this.setStatus(RuntimeClientStatus.Disconnected);
                break;
            case RuntimeClientState.Closed:
                this._pendingClientRequests = 0;
                this.setState(RuntimeClientState.Closed);
                this.setStatus(RuntimeClientStatus.Disconnected);
                this._expandedPaths.clear();
                this._variablesClient = undefined;
                this._variablesClientId = undefined;
                this._warnedMissingClient = false;
                break;
        }
    }

    private _disposeRuntimeDisposables(): void {
        this._runtimeDisposables.forEach(d => d.dispose());
        this._runtimeDisposables = [];
        this._clientHandlerRegistered = false;
    }

    private _disposeClientDisposables(): void {
        this._clientDisposables.forEach(d => d.dispose());
        this._clientDisposables = [];
    }

    private _attachToClientManager(manager: RuntimeClientManager, reason: string): void {
        if (!this._clientHandlerRegistered) {
            this._outputChannel.debug(
                `[VariablesInstance] Registering variables client handler for session ${this._session.sessionId} (${reason})`
            );
            this._runtimeDisposables.push(
                manager.registerClientHandler({
                    clientType: RuntimeClientType.Variables,
                    callback: (client, _params) => {
                        this._handleVariablesClient(client);
                        return true;
                    }
                })
            );
            this._clientHandlerRegistered = true;
        }

        const existingClientId = manager.variablesClientId;
        if (existingClientId) {
            const existingClient = manager.getClient(existingClientId);
            if (existingClient) {
                this._outputChannel.debug(
                    `[VariablesInstance] Found existing variables client ${existingClientId} for session ${this._session.sessionId} (${reason})`
                );
                this._handleVariablesClient(existingClient);
            }
        }
    }

    private _warnMissingClient(action: string): void {
        if (this._warnedMissingClient) {
            this._outputChannel.debug(
                `[VariablesInstance] Ignoring ${action}; variables client not available`
            );
            return;
        }
        this._warnedMissingClient = true;
        this._outputChannel.warn(
            `[VariablesInstance] Ignoring ${action}; variables client not available`
        );
    }

    private _updateClientRequestStatus(): void {
        if (this._state !== RuntimeClientState.Connected || !this._variablesClient) {
            this.setStatus(RuntimeClientStatus.Disconnected);
            return;
        }

        this.setStatus(
            this._pendingClientRequests > 0
                ? RuntimeClientStatus.Busy
                : RuntimeClientStatus.Idle
        );
    }

    private async _runWithClientRequest<T>(action: () => Promise<T>): Promise<T> {
        this._pendingClientRequests += 1;
        this._updateClientRequestStatus();

        try {
            return await action();
        } finally {
            this._pendingClientRequests = Math.max(0, this._pendingClientRequests - 1);
            this._updateClientRequestStatus();
        }
    }

    private async processList(list: PositronVariablesList): Promise<void> {
        const variableItems = new Map<string, VariableItem>();
        const promises: Promise<void>[] = [];
        for (const variable of list.data) {
            const item = this.createVariableItem(variable);
            variableItems.set(item.accessKey, item);
            if (item.hasChildren && this.isPathExpanded(item.path)) {
                promises.push(this.loadChildItems(item));
            }
        }
        this._variableItems = variableItems;
        await Promise.all(promises);
        this.updateEntries();
    }

    private async processUpdate(update: PositronVariablesUpdate): Promise<void> {
        this._variableItems.forEach(item => { item.isRecent = false; });

        const promises: Promise<void>[] = [];
        for (const assigned of update.assigned) {
            const variable = assigned.data;
            const isRecent = assigned.evaluated && this._highlightRecent;
            const item = this.createVariableItem(variable, [], isRecent);
            this._variableItems.set(variable.access_key, item);
            if (item.hasChildren && this.isPathExpanded(item.path)) {
                promises.push(this.loadChildItems(item));
            }
        }

        for (const removed of update.removed) {
            this._variableItems.delete(removed);
        }

        await Promise.all(promises);
        this.updateEntries();
    }

    private updateEntries(): void {
        this._entries = [];
        const items = this.getFilteredItems();

        switch (this._grouping) {
            case PositronVariablesGrouping.None:
                this._entries = this.sortItems(items);
                break;
            case PositronVariablesGrouping.Kind:
                this._entries = this.groupByKind(items);
                break;
            case PositronVariablesGrouping.Size:
                this._entries = this.groupBySize(items);
                break;
        }

        this.fireEntriesChanged();
    }

    private getFilteredItems(): VariableItem[] {
        const items = Array.from(this._variableItems.values());
        if (!this._filterText) return items;
        const lowerFilter = this._filterText.toLowerCase();
        return items.filter(item =>
            item.displayName.toLowerCase().includes(lowerFilter) ||
            item.displayValue.toLowerCase().includes(lowerFilter)
        );
    }

    private sortItems(items: VariableItem[]): VariableItem[] {
        const sorted = [...items];
        switch (this._sorting) {
            case PositronVariablesSorting.Name:
                sorted.sort((a, b) => a.displayName.localeCompare(b.displayName));
                break;
            case PositronVariablesSorting.Size:
                sorted.sort((a, b) => b.size - a.size);
                break;
            case PositronVariablesSorting.Recent:
                sorted.sort((a, b) => {
                    if (a.isRecent && !b.isRecent) return -1;
                    if (!a.isRecent && b.isRecent) return 1;
                    return a.displayName.localeCompare(b.displayName);
                });
                break;
        }
        return sorted;
    }

    private createVariableItem(
        variable: Variable,
        parentPath: string[] = [],
        isRecent: boolean = false
    ): VariableItem {
        return new VariableItem(variable, parentPath, isRecent);
    }

    private isPathExpanded(path: string[]): boolean {
        return this._expandedPaths.has(JSON.stringify(path));
    }

    private locateVariableItem(path: string[]): VariableItem | undefined {
        const rootItem = this._variableItems.get(path[0]);
        if (!rootItem) {
            return undefined;
        }

        return rootItem.locateVariableItem(path.slice(1));
    }

    private async loadChildItems(variableItem: VariableItem): Promise<void> {
        if (!this._variablesClient || !variableItem.hasChildren) {
            variableItem.childItems = [];
            variableItem.overflowEntry = undefined;
            variableItem.totalChildren = 0;
            return;
        }

        try {
            const inspected = await this._runWithClientRequest(() =>
                this._variablesClient!.inspect(variableItem.path)
            );
            const childItems: VariableItem[] = [];
            const promises: Promise<void>[] = [];

            for (const child of inspected.children) {
                const childItem = this.createVariableItem(child, variableItem.path);
                childItems.push(childItem);

                if (childItem.hasChildren && this.isPathExpanded(childItem.path)) {
                    promises.push(this.loadChildItems(childItem));
                }
            }

            await Promise.all(promises);

            variableItem.childItems = childItems;
            variableItem.totalChildren = inspected.length ?? childItems.length;
            const overflowValues = Math.max(
                variableItem.totalChildren - childItems.length,
                0
            );
            variableItem.overflowEntry = overflowValues > 0
                ? new VariableOverflow(
                    `${variableItem.id}::overflow`,
                    variableItem.indentLevel + 1,
                    overflowValues
                )
                : undefined;
        } catch (error) {
            this._outputChannel.warn(
                `[VariablesInstance] Failed to load children for ${JSON.stringify(variableItem.path)}: ${error}`
            );
            variableItem.childItems = [];
            variableItem.overflowEntry = undefined;
        }
    }

    private groupByKind(items: VariableItem[]): VariablesTreeEntry[] {
        const groups: Record<string, VariableItem[]> = { data: [], values: [], functions: [], classes: [] };
        for (const item of items) {
            if (item.kind === 'table') groups.data.push(item);
            else if (item.kind === 'function') groups.functions.push(item);
            else if (item.kind === 'class') groups.classes.push(item);
            else groups.values.push(item);
        }

        const entries: VariablesTreeEntry[] = [];
        if (groups.data.length > 0) entries.push(new VariableGroup('group/data', 'Data', !this._collapsedGroupIds.has('group/data'), this.sortItems(groups.data)));
        if (groups.values.length > 0) entries.push(new VariableGroup('group/values', 'Values', !this._collapsedGroupIds.has('group/values'), this.sortItems(groups.values)));
        if (groups.functions.length > 0) entries.push(new VariableGroup('group/functions', 'Functions', !this._collapsedGroupIds.has('group/functions'), this.sortItems(groups.functions)));
        if (groups.classes.length > 0) entries.push(new VariableGroup('group/classes', 'Classes', !this._collapsedGroupIds.has('group/classes'), this.sortItems(groups.classes)));
        return entries;
    }

    private groupBySize(items: VariableItem[]): VariablesTreeEntry[] {
        const groups: Record<string, VariableItem[]> = { small: [], medium: [], large: [], veryLarge: [] };
        for (const item of items) {
            if (item.size < 1024) groups.small.push(item);
            else if (item.size < 1024 * 1024) groups.medium.push(item);
            else if (item.size < 1024 * 1024 * 100) groups.large.push(item);
            else groups.veryLarge.push(item);
        }

        const entries: VariablesTreeEntry[] = [];
        if (groups.veryLarge.length > 0) entries.push(new VariableGroup('group/very-large', 'Very Large (>100MB)', !this._collapsedGroupIds.has('group/very-large'), this.sortItems(groups.veryLarge)));
        if (groups.large.length > 0) entries.push(new VariableGroup('group/large', 'Large (1MB-100MB)', !this._collapsedGroupIds.has('group/large'), this.sortItems(groups.large)));
        if (groups.medium.length > 0) entries.push(new VariableGroup('group/medium', 'Medium (1KB-1MB)', !this._collapsedGroupIds.has('group/medium'), this.sortItems(groups.medium)));
        if (groups.small.length > 0) entries.push(new VariableGroup('group/small', 'Small (<1KB)', !this._collapsedGroupIds.has('group/small'), this.sortItems(groups.small)));
        return entries;
    }

    private fireEntriesChanged(): void {
        const flattened = this._entries.flatMap(entry => {
            if (entry instanceof VariableGroup) {
                entry.isExpanded = !this._collapsedGroupIds.has(entry.id);
                if (!entry.isExpanded) {
                    return [entry];
                }
                return [entry, ...(entry.variableItems as VariableItem[]).flatMap(item =>
                    item.flatten((path: string[]) => this.isPathExpanded(path))
                )];
            }

            if (entry instanceof VariableItem) {
                return entry.flatten((path: string[]) => this.isPathExpanded(path));
            }

            return [];
        });

        this._onDidChangeEntriesEmitter.fire(flattened);
    }
    //#endregion
}
