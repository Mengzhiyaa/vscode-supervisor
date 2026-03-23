/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *  Ported to vscode-ark by the vscode-ark team.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from './runtimeItem';
import { ActivityItem } from './activityItem';
import { ActivityItemStream } from './activityItemStream';
import { ActivityItemInput, ActivityItemInputState } from './activityItemInput';
import { ActivityItemErrorMessage } from './activityItemErrorMessage';
import { ActivityItemOutputHtml } from './activityItemOutputHtml';
import { ActivityItemOutputPlot } from './activityItemOutputPlot';
import { ActivityItemOutputMessage } from './activityItemOutputMessage';
import { writable, type Readable } from 'svelte/store';

// Re-export for convenience
export { ActivityItem };
export { ActivityItemInput, ActivityItemInputState };
export { ActivityItemStream, ActivityItemStreamType } from './activityItemStream';
export { ActivityItemErrorMessage };
export { ActivityItemOutputHtml };
export { ActivityItemOutputPlot };
export { ActivityItemOutputMessage };
export { ActivityItemPrompt, ActivityItemPromptState } from './activityItemPrompt';

/** The ActivityItemOutput type alias (Positron pattern). */
export type ActivityItemOutput =
    ActivityItemOutputHtml |
    ActivityItemOutputMessage |
    ActivityItemOutputPlot;

const isOutputActivityItem = (
    activityItem: ActivityItem | ActivityItemOutput
): activityItem is ActivityItemOutput =>
    activityItem instanceof ActivityItemOutputHtml ||
    activityItem instanceof ActivityItemOutputMessage ||
    activityItem instanceof ActivityItemOutputPlot;

/**
 * Checks whether two ActivityItemStream objects are of the same type and have the same parent ID.
 */
const isSameActivityItemStream = (
    activityItemStream1: ActivityItemStream,
    activityItemStream2: ActivityItemStream
): boolean =>
    activityItemStream1.type === activityItemStream2.type &&
    activityItemStream1.parentId === activityItemStream2.parentId;

/**
 * RuntimeItemActivity class - Represents a single execution activity with input and outputs.
 * Mirrors: positron/src/vs/workbench/services/positronConsole/browser/classes/runtimeItemActivity.ts
 */
export class RuntimeItemActivity extends RuntimeItem {
    //#region Private Properties

    /**
     * Gets or sets the activity items.
     */
    private _activityItems: (
        ActivityItem |
        ActivityItemStream |
        ActivityItemErrorMessage |
        ActivityItemInput |
        ActivityItemOutput
    )[] = [];
    private readonly _activityItemsStore = writable<(
        ActivityItem |
        ActivityItemStream |
        ActivityItemErrorMessage |
        ActivityItemInput |
        ActivityItemOutput
    )[]>([]);

    //#endregion Private Properties

    //#region Public Properties

    /**
     * Gets the activity items.
     */
    public get activityItems(): (
        ActivityItem |
        ActivityItemStream |
        ActivityItemErrorMessage |
        ActivityItemInput |
        ActivityItemOutput
    )[] {
        return this._activityItems;
    }

    /**
     * Gets the activity items as a store for reactive updates.
     */
    public get activityItemsStore(): Readable<(
        ActivityItem |
        ActivityItemStream |
        ActivityItemErrorMessage |
        ActivityItemInput |
        ActivityItemOutput
    )[]> {
        return this._activityItemsStore;
    }

    //#endregion Public Properties

    //#region Constructor

    /**
     * Constructor.
     * @param id The identifier.
     * @param activityItem The initial activity item.
     */
    constructor(id: string, activityItem: ActivityItem | ActivityItemOutput) {
        // Call the base class's constructor.
        super(id);

        // Add the initial activity item.
        this.addActivityItem(activityItem);
    }

    //#endregion Constructor

    //#region Public Methods

    /**
     * Adds an activity item.
     * @param activityItem The activity item to add.
     */
    public addActivityItem(activityItem: ActivityItem | ActivityItemOutput): void {
        // Perform activity item processing if this is not the first activity item.
        if (this._activityItems.length) {
            // If the activity item being added is an ActivityItemStream, see if we can append it to
            // the last ActivityItemStream of the same type with the same parent identifier.
            if (activityItem instanceof ActivityItemStream) {
                // Get the last activity item.
                const lastActivityItem = this._activityItems[this._activityItems.length - 1];
                if (lastActivityItem instanceof ActivityItemStream) {
                    // If the ActivityItemStream being added and the last ActivityItemStream are of
                    // the same type with the same parent identifier, add the ActivityItemStream
                    // being added to the last ActivityItemStream.
                    if (isSameActivityItemStream(lastActivityItem, activityItem)) {
                        // Add the ActivityItemStream being added to the last ActivityItemStream.
                        const activityItemStream = lastActivityItem.addActivityItemStream(activityItem);
                        if (!activityItemStream) {
                            this._setActivityItems([...this._activityItems]);
                            return;
                        }

                        // Set the activity item to add.
                        activityItem = activityItemStream;
                    }
                }
            } else if (activityItem instanceof ActivityItemInput && activityItem.state !== ActivityItemInputState.Provisional) {
                // When a non-provisional ActivityItemInput is being added, see if there's a
                // provisional ActivityItemInput for it in the activity items.
                for (let i = this._activityItems.length - 1; i >= 0; --i) {
                    const activityItemToCheck = this._activityItems[i];
                    if (activityItemToCheck instanceof ActivityItemInput) {
                        if (activityItemToCheck.state === ActivityItemInputState.Provisional &&
                            activityItemToCheck.parentId === activityItem.parentId) {
                            const nextActivityItems = [...this._activityItems];
                            nextActivityItems[i] = activityItem;
                            this._setActivityItems(nextActivityItems);
                            return;
                        }
                        break;
                    }
                }
            }
        }

        // Push the activity item.
        this._setActivityItems([...this._activityItems, activityItem]);
    }

    /**
     * Replaces an existing output item by output ID.
     * Returns true when a matching item is updated.
     */
    public replaceOutputItemByOutputId(
        outputId: string,
        activityItem: ActivityItemOutput
    ): boolean {
        for (let i = this._activityItems.length - 1; i >= 0; --i) {
            const existing = this._activityItems[i];
            if (isOutputActivityItem(existing) && existing.outputId === outputId) {
                const nextActivityItems = [...this._activityItems];
                nextActivityItems[i] = activityItem;
                this._setActivityItems(nextActivityItems);
                return true;
            }
        }

        return false;
    }

    /**
     * Gets the clipboard representation of the runtime item.
     * @param commentPrefix The comment prefix to use.
     * @returns The clipboard representation of the runtime item.
     */
    public override getClipboardRepresentation(commentPrefix: string): string[] {
        return this._activityItems.flatMap(activityItem =>
            activityItem.getClipboardRepresentation(commentPrefix)
        );
    }

    /**
     * Marks the input item as busy or completed.
     * @param busy Whether the input is busy.
     */
    public markInputBusyState(busy: boolean): void {
        for (const item of this._activityItems) {
            if (item instanceof ActivityItemInput) {
                if (item.state !== ActivityItemInputState.Provisional) {
                    item.state = busy
                        ? ActivityItemInputState.Executing
                        : ActivityItemInputState.Completed;
                }
                this._setActivityItems([...this._activityItems]);
                break;
            }
        }
    }

    /**
     * Clears output items while preserving the input echo for this activity.
     * Mirrors Jupyter clear_output semantics.
     */
    public clearOutputItems(): void {
        this._setActivityItems(
            this._activityItems.filter((item) => item instanceof ActivityItemInput),
        );
    }

    /**
     * Optimizes scrollback.
     * @param scrollbackSize The scrollback size.
     * @param clearData If true, permanently deletes data beyond scrollback limit.
     * @returns The remaining scrollback size.
     */
    public override optimizeScrollback(scrollbackSize: number, clearData: boolean = true): number {
        // If scrollback size is zero, hide the item and return zero.
        if (scrollbackSize === 0) {
            this._isHidden = true;
            return 0;
        }

        // Unhide the item.
        this._isHidden = false;

        // Optimize scrollback for each activity item in reverse order.
        for (let i = this._activityItems.length - 1; i >= 0; i--) {
            scrollbackSize = this._activityItems[i].optimizeScrollback(scrollbackSize, clearData);
        }

        // Refresh store so hidden state updates render immediately.
        this._activityItemsStore.set(this._activityItems);

        // Return the remaining scrollback size.
        return scrollbackSize;
    }

    //#endregion Public Methods

    //#region Private Methods

    private _setActivityItems(activityItems: (
        ActivityItem |
        ActivityItemStream |
        ActivityItemErrorMessage |
        ActivityItemInput |
        ActivityItemOutput
    )[]): void {
        this._activityItems = activityItems;
        this._activityItemsStore.set(activityItems);
    }

    //#endregion Private Methods
}
