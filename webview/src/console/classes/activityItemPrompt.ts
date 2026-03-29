/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *  Ported to vscode-ark by the vscode-ark team.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem';
import { ANSIOutput, type ANSIOutputLine } from '$lib/ansi/ansiOutput';
import { formatOutputLinesForClipboard } from '../utils/clipboardUtils';
import { ActivityItemPromptState } from '@shared/console';
export { ActivityItemPromptState } from '@shared/console';

/**
 * ActivityItemPrompt class.
 * Represents an input prompt from the kernel (e.g., readline() in R).
 * Mirrors: positron/.../classes/activityItemPrompt.ts
 */
export class ActivityItemPrompt extends ActivityItem {
    //#region Public Properties

    /**
     * Gets the output lines (prompt text with ANSI formatting).
     */
    readonly outputLines: readonly ANSIOutputLine[];

    /**
     * Gets or sets the state.
     */
    state = ActivityItemPromptState.Unanswered;

    /**
     * Gets or sets the answer.
     */
    answer?: string = undefined;

    //#endregion Public Properties

    //#region Constructor

    /**
     * Constructor.
     * @param id The identifier.
     * @param parentId The parent identifier.
     * @param when The date.
     * @param prompt The input prompt text.
     * @param password Whether this is a password prompt.
     * @param sessionId The session identifier (needed for RPC calls).
     */
    constructor(
        id: string,
        parentId: string,
        when: Date,
        readonly prompt: string,
        readonly password: boolean,
        readonly sessionId?: string
    ) {
        // Call the base class's constructor.
        super(id, parentId, when);

        // Process the prompt directly into ANSI output lines suitable for rendering.
        this.outputLines = ANSIOutput.processOutput(prompt);
    }

    //#endregion Constructor

    //#region Public Methods

    /**
     * Gets the clipboard representation of the activity item.
     * @param commentPrefix The comment prefix to use.
     * @returns The clipboard representation of the activity item.
     */
    public override getClipboardRepresentation(commentPrefix: string): string[] {
        return formatOutputLinesForClipboard(this.outputLines, commentPrefix);
    }

    //#endregion Public Methods
}
