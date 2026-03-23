/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *  Ported to vscode-ark by the vscode-ark team.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem';
import { ANSIOutput, type ANSIOutputLine } from '$lib/ansi/ansiOutput';

/**
 * ActivityItemInputState enumeration.
 */
export const enum ActivityItemInputState {
    Provisional = 'provisional',
    Executing = 'executing',
    Completed = 'completed',
    Cancelled = 'cancelled'
}

/**
 * ActivityItemInput class - Represents user input code in a console activity.
 * Mirrors: positron/src/vs/workbench/services/positronConsole/browser/classes/activityItemInput.ts
 */
export class ActivityItemInput extends ActivityItem {
    //#region Private Properties

    /**
     * Gets or sets the state.
     */
    private _state: ActivityItemInputState;

    /**
     * Gets the code output lines.
     */
    private readonly _codeOutputLines: readonly ANSIOutputLine[];

    /**
     * onStateChanged listeners.
     */
    private readonly _onStateChangedListeners = new Set<() => void>();

    //#endregion Private Properties

    //#region Public Properties

    /**
     * Gets the state.
     */
    get state(): ActivityItemInputState {
        return this._state;
    }

    /**
     * Sets the state.
     * @param state The state to set.
     */
    set state(state: ActivityItemInputState) {
        if (state !== this._state) {
            this._state = state;
            this._onStateChangedListeners.forEach((listener) => {
                listener();
            });
        }
    }

    /**
     * Gets the code output lines.
     */
    get codeOutputLines(): readonly ANSIOutputLine[] {
        return this._codeOutputLines;
    }

    /**
     * Register a listener for state changes.
     * @param listener The listener to add.
     * @returns A function to remove the listener.
     */
    public onStateChanged(listener: () => void): () => void {
        this._onStateChangedListeners.add(listener);
        return () => {
            this._onStateChangedListeners.delete(listener);
        };
    }

    //#endregion Public Properties

    //#region Constructor

    /**
     * Constructor.
     * @param id The identifier.
     * @param parentId The parent identifier.
     * @param when The date.
     * @param state The initial state.
     * @param inputPrompt The input prompt.
     * @param continuationPrompt The continuation prompt.
     * @param code The code.
     */
    constructor(
        id: string,
        parentId: string,
        when: Date,
        state: ActivityItemInputState,
        readonly inputPrompt: string,
        readonly continuationPrompt: string,
        readonly code: string
    ) {
        // Call the base class's constructor.
        super(id, parentId, when);

        // Initialize.
        this._state = state;
        this._codeOutputLines = ANSIOutput.processOutput(code);
    }

    //#endregion Constructor

    //#region Public Methods

    /**
     * Gets the clipboard representation of the activity item.
     * @param commentPrefix The comment prefix to use.
     * @returns The clipboard representation of the activity item.
     */
    public override getClipboardRepresentation(_commentPrefix: string): string[] {
        // Activity item inputs are not commented out, so ignore the comment prefix.
        return this._codeOutputLines.map(line =>
            line.outputRuns.map(run => run.text).join('')
        );
    }

    //#endregion Public Methods
}
