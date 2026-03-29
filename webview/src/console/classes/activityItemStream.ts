/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *  Ported to vscode-ark by the vscode-ark team.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem';
import { ANSIOutput, type ANSIOutputLine } from '$lib/ansi/ansiOutput';
import { writable, type Readable } from 'svelte/store';
import { ActivityItemStreamType } from '@shared/console';
export { ActivityItemStreamType } from '@shared/console';

/**
 * ActivityItemStream class - Represents stdout/stderr stream output.
 * Mirrors: positron/src/vs/workbench/services/positronConsole/browser/classes/activityItemStream.ts
 */
export class ActivityItemStream extends ActivityItem {
	//#region Private Properties

	/**
	 * Gets or sets a value which indicates whether this ActivityItemStream is terminated.
	 */
	private _terminated = false;

	/**
	 * Gets the ActivityItemStream array.
	 */
	private _activityItemStreams: ActivityItemStream[] = [];

	/**
	 * Gets the ANSIOutput.
	 */
	private _ansiOutput = new ANSIOutput();

	/**
	 * Gets the output lines store.
	 */
	private _outputLinesStore = writable<readonly ANSIOutputLine[]>([]);

	/**
	 * Gets or sets the scrollback size. This is used to truncate the output lines for display.
	 */
	private _scrollbackSize?: number;

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	get outputLines(): readonly ANSIOutputLine[] {
		// Process the activity items streams.
		this.processActivityItemStreams();

		// If scrollback size is undefined, return all of the output lines.
		if (this._scrollbackSize === undefined) {
			return this._ansiOutput.outputLines;
		}

		// Return the truncated output lines.
		return this._ansiOutput.truncatedOutputLines(this._scrollbackSize);
	}

	/**
	 * Gets the output lines store.
	 */
	get outputLinesStore(): Readable<readonly ANSIOutputLine[]> {
		return this._outputLinesStore;
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param type The type.
	 * @param text The text.
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		readonly type: ActivityItemStreamType,
		readonly text: string
	) {
		// Call the base class's constructor.
		super(id, parentId, when);

		// Initialize.
		this._activityItemStreams.push(this);
		this.processActivityItemStreams();
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Adds an ActivityItemStream to this ActivityItemStream.
	 * @param activityItemStream The ActivityItemStream to add.
	 * @returns The remainder ActivityItemStream, or undefined.
	 */
	public addActivityItemStream(activityItemStream: ActivityItemStream): ActivityItemStream | undefined {
		// If this ActivityItemStream is terminated, copy its styles to the ActivityItemStream being
		// added and return it as the remainder ActivityItemStream to be processed.
		if (this._terminated) {
			activityItemStream._ansiOutput.copyStylesFrom(this._ansiOutput);
			return activityItemStream;
		}

		// Get the index of the last newline in the ActivityItemStream that's being added.
		const newlineIndex = activityItemStream.text.lastIndexOf('\n');
		if (newlineIndex === -1) {
			this._activityItemStreams.push(activityItemStream);
			this.processActivityItemStreams();
			this._terminated = !this._ansiOutput.isBuffering;
			return undefined;
		}

		// Split the text at the last newline.
		const textWithNewline = activityItemStream.text.substring(0, newlineIndex + 1);
		const remainderText = activityItemStream.text.substring(newlineIndex + 1);

		// Add an ActivityItemStream with the text containing the newline.
		this._activityItemStreams.push(activityItemStream.clone(textWithNewline));

		// Process the activity item streams.
		this.processActivityItemStreams();

		// Update the terminated flag.
		this._terminated = !this._ansiOutput.isBuffering;

		// If there is no remainder text, return undefined.
		if (!remainderText.length) {
			return undefined;
		}

		// Create the remainder ActivityItemStream.
		const remainder = activityItemStream.clone(remainderText);

		// If this ActivityItemStream isn't terminated, push the remainder.
		if (!this._terminated) {
			this._activityItemStreams.push(remainder);
			return undefined;
		}

		// Return the remainder ActivityItemStream to be processed.
		remainder._ansiOutput.copyStylesFrom(this._ansiOutput);
		return remainder;
	}

	/**
	 * Gets the clipboard representation of the activity item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the activity item.
	 */
	public override getClipboardRepresentation(commentPrefix: string): string[] {
		this.processActivityItemStreams();
		return this._ansiOutput.outputLines.map(line =>
			commentPrefix + line.outputRuns.map(run => run.text).join('')
		);
	}

	/**
	 * Optimizes scrollback.
	 * @param scrollbackSize The scrollback size.
	 * @param clearData If true, permanently deletes data beyond scrollback limit to free memory.
	 * @returns The remaining scrollback size.
	 */
	public override optimizeScrollback(scrollbackSize: number, clearData: boolean = true): number {
		// Process the activity items streams.
		this.processActivityItemStreams();

		// If there are fewer output lines than the scrollback size, clear the scrollback size
		// as all of them will be displayed, and return the remaining scrollback size.
		if (this._ansiOutput.outputLines.length <= scrollbackSize) {
			this._scrollbackSize = undefined;
			this.syncOutputLinesStore();
			return scrollbackSize - this._ansiOutput.outputLines.length;
		}

		// Set the scrollback size.
		this._scrollbackSize = scrollbackSize;

		// If clearData is enabled, permanently truncate the internal data to free memory.
		if (clearData) {
			this._ansiOutput.truncate(scrollbackSize);
		}

		this.syncOutputLinesStore();
		return 0;
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Clones this ActivityItemStream with new text.
	 * @param text The new text.
	 * @returns A clone of this ActivityItemStream with new text.
	 */
	private clone(text: string): ActivityItemStream {
		return new ActivityItemStream(
			this.id,
			this.parentId,
			this.when,
			this.type,
			text
		);
	}

	/**
	 * Processes the activity item streams.
	 */
	private processActivityItemStreams(): void {
		// If there are no activity item streams, return.
		if (!this._activityItemStreams.length) {
			return;
		}

		// Process the activity item streams.
		for (const activityItemStream of this._activityItemStreams) {
			this._ansiOutput.processOutput(activityItemStream.text);
		}

		// Clear the activity item streams.
		this._activityItemStreams = [];

		// Sync the output lines store after processing.
		this.syncOutputLinesStore();
	}

	/**
	 * Syncs the output lines store with current output lines.
	 */
	private syncOutputLinesStore(): void {
		const outputLines = this._scrollbackSize === undefined
			? this._ansiOutput.outputLines
			: this._ansiOutput.truncatedOutputLines(this._scrollbackSize);
		this._outputLinesStore.set(outputLines);
	}

	//#endregion Private Methods
}
