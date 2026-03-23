/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RuntimeClientInstance, RuntimeClientOutput } from './RuntimeClientInstance';
import {
    PositronVariablesComm,
    Variable,
    VariableList,
    InspectedVariable,
    UpdateEvent,
    RefreshEvent,
    ClipboardFormatFormat
} from './comms/positronVariablesComm';

/**
 * Represents a variable in a language runtime; wraps the raw data format with
 * additional metadata and methods.
 * 
 * Matches Positron's PositronVariable pattern.
 */
export class PositronVariable {
    /**
     * Creates a new PositronVariable instance.
     *
     * @param data The raw data from the language runtime.
     * @param parentKeys A list of the access keys of the parent variables.
     * @param evaluated A flag indicating whether the variable was evaluated.
     * @param _comm The comm client that owns this variable.
     */
    constructor(
        public readonly data: Variable,
        public readonly parentKeys: string[] = [],
        public readonly evaluated: boolean,
        private readonly _comm: PositronVariablesComm
    ) { }

    /**
     * Gets the path of this variable.
     */
    get path(): string[] {
        return [...this.parentKeys, this.data.access_key];
    }

    /**
     * Gets the ID of the comm client that owns the variable.
     */
    get clientId(): string {
        return this._comm.clientId;
    }

    /**
     * Gets the children of this variable, if any.
     *
     * @returns A promise that resolves to the list of children.
     */
    async getChildren(): Promise<PositronVariablesList> {
        if (this.data.has_children) {
            const path = this.parentKeys.concat(this.data.access_key);
            const result = await this._comm.inspect(path);
            return new PositronVariablesList(result.children, path, this._comm);
        } else {
            throw new Error(
                `Attempt to retrieve children of ` +
                `${this.data.display_name} (${JSON.stringify(this.parentKeys)}) ` +
                `which has no children.`
            );
        }
    }

    /**
     * Formats the value of this variable for the clipboard.
     *
     * @param mime The desired MIME type of the format.
     * @returns A promise that resolves to the formatted value.
     */
    async formatForClipboard(mime: ClipboardFormatFormat): Promise<string> {
        const path = this.parentKeys.concat(this.data.access_key);
        const result = await this._comm.clipboardFormat(path, mime);
        return result.content;
    }

    /**
     * Requests that the language runtime open a viewer for this variable.
     *
     * @returns The ID of the viewer that was opened, if any.
     */
    async view(): Promise<string | undefined> {
        const path = this.parentKeys.concat(this.data.access_key);
        return await this._comm.view(path);
    }
}

/**
 * A list of variables and their values; wraps the raw data format.
 */
export class PositronVariablesList {
    public readonly variables: PositronVariable[];

    constructor(
        public readonly data: Variable[],
        parentKeys: string[] = [],
        comm: PositronVariablesComm
    ) {
        this.variables = data.map(v => new PositronVariable(v, parentKeys, true, comm));
    }
}

/**
 * Wraps the raw data format for an update message.
 */
export class PositronVariablesUpdate {
    /** The variables that have been added or changed */
    public readonly assigned: PositronVariable[];

    /** The names of the variables that have been removed */
    public readonly removed: string[];

    constructor(
        public readonly data: UpdateEvent,
        comm: PositronVariablesComm
    ) {
        // Add all the assigned variables to the list of assignments
        this.assigned = data.assigned.map(v => new PositronVariable(v, [], true, comm));

        // Add all the unevaluated variables, but mark them as unevaluated
        this.assigned = this.assigned.concat(
            data.unevaluated.map(v => new PositronVariable(v, [], false, comm))
        );

        this.removed = data.removed;
    }
}

/**
 * The client-side interface to a variables (a set of named variables) inside
 * a language runtime.
 * 
 * Matches Positron's VariablesClientInstance pattern.
 */
export class VariablesClientInstance implements vscode.Disposable {
    /** The comm wrapper for communicating with the backend */
    private _comm: PositronVariablesComm;

    private _onDidReceiveListEmitter = new vscode.EventEmitter<PositronVariablesList>();
    private _onDidReceiveUpdateEmitter = new vscode.EventEmitter<PositronVariablesUpdate>();

    /** Event that fires when the variable list is received (from refresh event or list RPC) */
    readonly onDidReceiveList = this._onDidReceiveListEmitter.event;

    /** Event that fires when variables are updated incrementally */
    readonly onDidReceiveUpdate = this._onDidReceiveUpdateEmitter.event;

    private _disposables: vscode.Disposable[] = [];

    /**
     * Create a new variable client instance.
     *
     * @param client The client instance to use to communicate with the back end.
     */
    constructor(client: RuntimeClientInstance) {
        // Clipboard formatting should have a small timeout
        this._comm = new PositronVariablesComm(client, {
            clipboard_format: { timeout: 3000 },
            // Explicitly never timeout the other requests
            list: { timeout: undefined },
            clear: { timeout: undefined },
            delete: { timeout: undefined },
            inspect: { timeout: undefined },
            view: { timeout: undefined },
        });

        // Connect to refresh events
        this._disposables.push(
            this._comm.onDidRefresh((e: RefreshEvent) => {
                this._onDidReceiveListEmitter.fire(
                    new PositronVariablesList(e.variables, [], this._comm)
                );
            })
        );

        // Connect to update events
        this._disposables.push(
            this._comm.onDidUpdate((e: UpdateEvent) => {
                this._onDidReceiveUpdateEmitter.fire(
                    new PositronVariablesUpdate(e, this._comm)
                );
            })
        );
    }

    /**
     * Requests that the variables client send a new list of variables.
     */
    async requestRefresh(): Promise<PositronVariablesList> {
        const list = await this._comm.list();
        return new PositronVariablesList(list.variables, [], this._comm);
    }

    /**
     * Requests that the variables client clear all variables.
     */
    async requestClear(includeHiddenObjects: boolean): Promise<void> {
        return this._comm.clear(includeHiddenObjects);
    }

    /**
     * Requests that the variables client inspect the specified variable.
     *
     * @param path The path to the variable to inspect
     * @returns The variable's children
     */
    async requestInspect(path: string[]): Promise<PositronVariablesList> {
        const list = await this._comm.inspect(path);
        return new PositronVariablesList(list.children, path, this._comm);
    }

    /**
     * Requests that the variables client delete the specified variables.
     *
     * @param names The names of the variables to delete
     * @returns A promise that resolves to an update message with the deleted variables
     */
    async requestDelete(names: string[]): Promise<PositronVariablesUpdate> {
        const removed = await this._comm.delete(names);
        return new PositronVariablesUpdate({
            assigned: [],
            unevaluated: [],
            removed,
            version: 0
        }, this._comm);
    }

    /**
     * Requests that the variables client format the specified variable.
     *
     * @param format The format to request, as a MIME type
     * @param path The path to the variable to format
     * @returns A promise that resolves to the formatted content
     */
    async requestClipboardFormat(format: ClipboardFormatFormat, path: string[]): Promise<string> {
        const formatted = await this._comm.clipboardFormat(path, format);
        return formatted.content;
    }

    /**
     * Gets the underlying comm client.
     */
    get comm(): PositronVariablesComm {
        return this._comm;
    }

    /**
     * Gets the client ID.
     */
    getClientId(): string {
        return this._comm.clientId;
    }

    // =========================================================================
    // Backward-compatible method aliases
    // These delegate to the requestXxx methods for compatibility with existing code
    // =========================================================================

    /**
     * List all variables.
     * Alias for requestRefresh().
     */
    async list(): Promise<VariableList> {
        return this._comm.list();
    }

    /**
     * Clear all variables.
     * Alias for requestClear().
     */
    async clear(includeHidden: boolean = false): Promise<void> {
        return this._comm.clear(includeHidden);
    }

    /**
     * Delete specific variables.
     * Alias for requestDelete().
     */
    async delete(names: string[]): Promise<string[]> {
        return this._comm.delete(names);
    }

    /**
     * Inspect a variable.
     * Alias for requestInspect().
     */
    async inspect(path: string[]): Promise<InspectedVariable> {
        return this._comm.inspect(path);
    }

    /**
     * Format a variable for the clipboard.
     * Alias for requestClipboardFormat().
     */
    async clipboardFormat(path: string[], format: string): Promise<string> {
        return this.requestClipboardFormat(format as ClipboardFormatFormat, path);
    }

    /**
     * Request a viewer for a variable.
     * Alias for comm.view().
     */
    async view(path: string[]): Promise<void> {
        await this._comm.view(path);
    }

    /**
     * Disposes the client instance.
     */
    dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._onDidReceiveListEmitter.dispose();
        this._onDidReceiveUpdateEmitter.dispose();
        this._comm.dispose();
    }
}

/**
 * Creates a VariablesClientInstance from a RuntimeClientInstance.
 *
 * @param client The underlying client instance
 * @returns A new VariablesClientInstance
 */
export function createVariablesClient(client: RuntimeClientInstance): VariablesClientInstance {
    return new VariablesClientInstance(client);
}

// Re-export types for convenience
export type { Variable, VariableList, InspectedVariable, UpdateEvent, RefreshEvent };
export { ClipboardFormatFormat, VariableKind } from './comms/positronVariablesComm';
