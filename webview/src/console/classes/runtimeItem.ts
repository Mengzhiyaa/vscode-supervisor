/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *  Ported to vscode-ark by the vscode-ark team.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, type ANSIOutputLine } from '$lib/ansi/ansiOutput';

/**
 * RuntimeItem class - Base class for all console runtime items.
 * Mirrors: positron/src/vs/workbench/services/positronConsole/browser/classes/runtimeItem.ts
 */
export class RuntimeItem {
    //#region Protected Properties

    /**
     * Gets or sets a value which indicates whether the item is hidden.
     */
    protected _isHidden = false;

    //#endregion Protected Properties

    //#region Constructor

    /**
     * Constructor.
     * @param id The identifier.
     */
    constructor(readonly id: string) { }

    //#endregion Constructor

    //#region Public Properties

    /**
     * Gets a value which indicates whether the item is hidden.
     */
    public get isHidden(): boolean {
        return this._isHidden;
    }

    //#endregion Public Properties

    //#region Public Methods

    /**
     * Gets the clipboard representation of the runtime item.
     * @param commentPrefix The comment prefix to use.
     * @note Override in derived classes to provide a clipboard representation.
     * @returns The clipboard representation of the runtime item.
     */
    public getClipboardRepresentation(_commentPrefix: string): string[] {
        return [];
    }

    /**
     * Optimizes scrollback.
     * @param scrollbackSize The scrollback size.
     * @param _clearData If true, permanently deletes data beyond scrollback limit.
     * @note The default implementation treats a runtime item as a single item, so it is either
     * entirely visible or entirely hidden. Override in derived classes to provide a different
     * behavior.
     * @returns The remaining scrollback size.
     */
    public optimizeScrollback(scrollbackSize: number, _clearData: boolean = true): number {
        // If scrollback size is zero, hide the item and return zero.
        if (!scrollbackSize) {
            this._isHidden = true;
            return 0;
        }

        // Unhide the item and return the scrollback size minus one.
        this._isHidden = false;
        return scrollbackSize - 1;
    }

    //#endregion Public Methods
}

/**
 * RuntimeItemStandard class - For simple runtime messages with ANSI output.
 * Mirrors: positron/src/vs/workbench/services/positronConsole/browser/classes/runtimeItem.ts
 */
export class RuntimeItemStandard extends RuntimeItem {
    //#region Public Properties

    /**
     * Gets the output lines.
     */
    readonly outputLines: readonly ANSIOutputLine[];

    //#endregion Public Properties

    //#region Constructor

    /**
     * Constructor.
     * @param id The identifier.
     * @param message The message.
     */
    constructor(id: string, message: string) {
        // Call the base class's constructor.
        super(id);

        // Process the message directly into ANSI output lines suitable for rendering.
        this.outputLines = ANSIOutput.processOutput(message);
    }

    //#endregion Constructor

    //#region Public Methods

    /**
     * Gets the clipboard representation of the activity item.
     * @param commentPrefix The comment prefix to use.
     * @returns The clipboard representation of the activity item.
     */
    public override getClipboardRepresentation(commentPrefix: string): string[] {
        return this.outputLines.map(line =>
            commentPrefix + line.outputRuns.map(run => run.text).join('')
        );
    }

    /**
     * Optimizes scrollback by counting actual output lines.
     * @param scrollbackSize The remaining scrollback budget.
     * @param _clearData If true, permanently deletes data beyond scrollback limit.
     * @returns The remaining scrollback size after this item.
     */
    public override optimizeScrollback(scrollbackSize: number, _clearData: boolean = true): number {
        const lineCount = this.outputLines.length || 1;

        // If no budget remaining, hide the entire item
        if (scrollbackSize === 0) {
            this._isHidden = true;
            return 0;
        }

        // If we fit within the budget, show and consume our lines
        if (lineCount <= scrollbackSize) {
            this._isHidden = false;
            return scrollbackSize - lineCount;
        }

        // We exceed the budget - hide the entire item (can't partially show)
        // and preserve the remaining budget for earlier items
        this._isHidden = true;
        return scrollbackSize;
    }

    //#endregion Public Methods
}

/**
 * RuntimeItemExited class (1:1 Positron).
 * Represents runtime exited state.
 */
export class RuntimeItemExited extends RuntimeItemStandard {
    constructor(
        id: string,
        public readonly sessionName: string,
        public readonly exitCode: number,
        public readonly reason: string
    ) {
        super(id, `${sessionName} exited (code: ${exitCode})${reason ? `\n${reason}` : ""}`);
    }
}

/**
 * RuntimeItemOffline class (1:1 Positron).
 * Represents runtime offline/disconnected state.
 */
export class RuntimeItemOffline extends RuntimeItemStandard {
    constructor(
        id: string,
        public readonly sessionName: string,
        public readonly reason: string
    ) {
        super(id, `${sessionName} is offline.${reason ? `\n${reason}` : ""}`);
    }
}

/**
 * RuntimeItemPendingInput class (1:1 Positron).
 * Represents queued input waiting to execute.
 */
export class RuntimeItemPendingInput extends RuntimeItemStandard {
    constructor(
        id: string,
        public readonly inputPrompt: string,
        public readonly code: string
    ) {
        super(id, code);
    }
}

export type RuntimeItemStartingAttachMode =
    | 'starting'
    | 'restarting'
    | 'switching'
    | 'reconnecting'
    | 'connected';

/**
 * RuntimeItemStarting class (1:1 Positron).
 * Represents runtime starting state.
 */
export class RuntimeItemStarting extends RuntimeItemStandard {
    constructor(
        id: string,
        public readonly message: string,
        public readonly attachMode: RuntimeItemStartingAttachMode = 'starting',
    ) {
        super(id, message);
    }
}

/**
 * RuntimeItemRestartButton class (1:1 Positron).
 * Represents a restart action button in console.
 */
export class RuntimeItemRestartButton extends RuntimeItem {
    constructor(
        id: string,
        public readonly sessionId: string,
        public readonly onRestart: () => void
    ) {
        super(id);
    }
}

/**
 * RuntimeItemTrace class (1:1 Positron).
 * Represents trace/debug output in the console.
 */
export class RuntimeItemTrace extends RuntimeItemStandard {
    constructor(
        id: string,
        public readonly message: string,
        public readonly timestamp: Date = new Date()
    ) {
        super(
            id,
            message
                .replaceAll('\x1b', 'ESC')
                .replaceAll('\x9B', 'CSI'),
        );
    }
}

/**
 * RuntimeItemRestarting class (1:1 Positron).
 * Represents runtime restarting state with animated indicator.
 */
export class RuntimeItemRestarting extends RuntimeItem {
    constructor(
        id: string,
        public readonly sessionName: string
    ) {
        super(id);
    }
}
