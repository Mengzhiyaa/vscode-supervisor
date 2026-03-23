/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *  Ported to vscode-ark by the vscode-ark team.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem';

/**
 * Localized strings.
 */
const positronHTMLOutput = '[HTML output]';

/**
 * ActivityItemOutputHtml class.
 * Represents formatted HTML output by a language runtime.
 * Mirrors: positron/src/vs/workbench/services/positronConsole/browser/classes/activityItemOutputHtml.ts
 */
export class ActivityItemOutputHtml extends ActivityItem {
    //#region Constructor

    /**
     * Constructor.
     *
     * @param id The identifier.
     * @param parentId The parent identifier.
     * @param when The date.
     * @param html The HTML content returned from the runtime.
     * @param text The text content returned from the runtime.
     * @param outputId The optional identifier of the output associated with this activity item.
     */
    constructor(
        id: string,
        parentId: string,
        when: Date,
        readonly html: string,
        readonly text: string | undefined,
        readonly outputId?: string
    ) {
        // Call the base class's constructor.
        super(id, parentId, when);
    }

    //#endregion Constructor

    //#region Public Methods

    /**
     * Gets the clipboard representation of the activity item.
     * @param commentPrefix The comment prefix to use.
     * @returns The clipboard representation of the activity item.
     */
    public override getClipboardRepresentation(commentPrefix: string): string[] {
        return [commentPrefix + (this.text ?? positronHTMLOutput)];
    }

    //#endregion Public Methods
}
