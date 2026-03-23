/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronBaseComm, PositronCommOptions } from './positronBaseComm';
import { RuntimeClientInstance } from '../RuntimeClientInstance';

/**
 * A view containing a list of variables in the session.
 */
export interface VariableList {
    /** A list of variables in the session. */
    variables: Variable[];
    /** The total number of variables in the session. */
    length: number;
    /** The version of the view (incremented with each update) */
    version?: number;
}

/**
 * An inspected variable.
 */
export interface InspectedVariable {
    /** The children of the inspected variable. */
    children: Variable[];
    /** The total number of children. */
    length: number;
}

/**
 * An object formatted for copying to the clipboard.
 */
export interface FormattedVariable {
    /** The formatted content of the variable. */
    content: string;
}

/**
 * A single variable in the runtime.
 */
export interface Variable {
    /** A key that uniquely identifies the variable within the runtime */
    access_key: string;
    /** The name of the variable, formatted for display */
    display_name: string;
    /** A string representation of the variable's value */
    display_value: string;
    /** The variable's type, formatted for display */
    display_type: string;
    /** Extended information about the variable's type */
    type_info: string;
    /** The size of the variable's value in bytes */
    size: number;
    /** The kind of value the variable represents */
    kind: VariableKind;
    /** The number of elements in the variable, if it is a collection */
    length: number;
    /** Whether the variable has child variables */
    has_children: boolean;
    /** True if there is a viewer available for this variable */
    has_viewer: boolean;
    /** True if the 'value' field is a truncated representation */
    is_truncated: boolean;
    /** The time the variable was created or updated */
    updated_time: number;
}

/**
 * Possible values for Format in ClipboardFormat
 */
export enum ClipboardFormatFormat {
    TextHtml = 'text/html',
    TextPlain = 'text/plain'
}

/**
 * Possible values for Kind in Variable
 */
export enum VariableKind {
    Boolean = 'boolean',
    Bytes = 'bytes',
    Class = 'class',
    Collection = 'collection',
    Empty = 'empty',
    Function = 'function',
    Map = 'map',
    Number = 'number',
    Other = 'other',
    String = 'string',
    Table = 'table',
    Lazy = 'lazy',
    Connection = 'connection'
}

/**
 * Event: Update variables
 */
export interface UpdateEvent {
    /** An array of variables that have been newly assigned. */
    assigned: Variable[];
    /** An array of variables that were not evaluated for value updates. */
    unevaluated: Variable[];
    /** An array of variable names that have been removed. */
    removed: string[];
    /** The version of the view */
    version: number;
}

/**
 * Event: Refresh variables
 */
export interface RefreshEvent {
    /** An array listing all the variables in the current session. */
    variables: Variable[];
    /** The number of variables in the current session. */
    length: number;
    /** The version of the view */
    version: number;
}

/**
 * Backend request types for the variables comm.
 */
export enum VariablesBackendRequest {
    List = 'list',
    Clear = 'clear',
    Delete = 'delete',
    Inspect = 'inspect',
    ClipboardFormat = 'clipboard_format',
    View = 'view'
}

/**
 * A comm wrapper for the variables client.
 * Provides typed methods and events for variable operations.
 * 
 * Matches Positron's PositronVariablesComm pattern.
 */
export class PositronVariablesComm extends PositronBaseComm {
    /**
     * Event that fires when variables are updated.
     */
    readonly onDidUpdate: vscode.Event<UpdateEvent>;

    /**
     * Event that fires when all variables should be refreshed.
     */
    readonly onDidRefresh: vscode.Event<RefreshEvent>;

    constructor(
        client: RuntimeClientInstance,
        options?: PositronCommOptions<VariablesBackendRequest>
    ) {
        super(client, options);

        // Create event emitters for the 'update' and 'refresh' events
        this.onDidUpdate = this.createEventEmitter<UpdateEvent>(
            'update',
            ['assigned', 'unevaluated', 'removed', 'version']
        );

        this.onDidRefresh = this.createEventEmitter<RefreshEvent>(
            'refresh',
            ['variables', 'length', 'version']
        );
    }

    /**
     * List all variables.
     * Returns a list of all the variables in the current session.
     *
     * @returns A view containing a list of variables in the session.
     */
    list(): Promise<VariableList> {
        return this.performRpc<VariableList>('list', [], []);
    }

    /**
     * Clear all variables.
     * Clears (deletes) all variables in the current session.
     *
     * @param includeHiddenObjects Whether to clear hidden objects in addition to normal variables
     */
    clear(includeHiddenObjects: boolean): Promise<void> {
        return this.performRpc<void>('clear', ['include_hidden_objects'], [includeHiddenObjects]);
    }

    /**
     * Deletes a set of named variables.
     *
     * @param names The names of the variables to delete.
     * @returns The names of the variables that were successfully deleted.
     */
    delete(names: string[]): Promise<string[]> {
        return this.performRpc<string[]>('delete', ['names'], [names]);
    }

    /**
     * Inspect a variable.
     * Returns the children of a variable, as an array of variables.
     *
     * @param path The path to the variable to inspect, as an array of access keys.
     * @returns An inspected variable.
     */
    inspect(path: string[]): Promise<InspectedVariable> {
        return this.performRpc<InspectedVariable>('inspect', ['path'], [path]);
    }

    /**
     * Format for clipboard.
     * Requests a formatted representation of a variable for copying to the clipboard.
     *
     * @param path The path to the variable to format
     * @param format The requested format for the variable, as a MIME type
     * @returns An object formatted for copying to the clipboard.
     */
    clipboardFormat(path: string[], format: ClipboardFormatFormat): Promise<FormattedVariable> {
        return this.performRpc<FormattedVariable>('clipboard_format', ['path', 'format'], [path, format]);
    }

    /**
     * Request a viewer for a variable.
     *
     * @param path The path to the variable to view
     * @returns The ID of the viewer that was opened.
     */
    view(path: string[]): Promise<string | undefined> {
        return this.performRpc<string | undefined>('view', ['path'], [path]);
    }
}
