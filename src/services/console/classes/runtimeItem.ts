/*---------------------------------------------------------------------------------------------
 *  RuntimeItem Classes - Console Output Items
 *  1:1 replication of Positron's RuntimeItem hierarchy
 *--------------------------------------------------------------------------------------------*/

import { SessionAttachMode } from '../interfaces/consoleService';

const htmlOutputPlaceholder = '[HTML output]';
const ansiOscPattern = /\x1B\][^\x07]*(?:\x07|\x1B\\)|\x9D[^\x07\x9C]*(?:\x07|\x9C)/g;
const ansiCsiPattern = /\x1B\[[0-?]*[ -/]*[@-~]|\x9B[0-?]*[ -/]*[@-~]/g;
const ansiSinglePattern = /\x1B[@-Z\\-_]/g;

function normalizeConsoleText(text: string): string {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(ansiOscPattern, '')
        .replace(ansiCsiPattern, '')
        .replace(ansiSinglePattern, '');
}

function splitConsoleTextLines(text: string): string[] {
    const normalized = normalizeConsoleText(text);
    if (!normalized.length) {
        return [];
    }

    const lines = normalized.split('\n');
    if (normalized.endsWith('\n')) {
        lines.pop();
    }

    return lines;
}

function formatConsoleTextForClipboard(text: string, commentPrefix: string = ''): string[] {
    return splitConsoleTextLines(text).map((line) => `${commentPrefix}${line}`);
}

function countConsoleTextLines(text: string, fallbackMinimum: number = 0): number {
    const lineCount = splitConsoleTextLines(text).length;
    return lineCount === 0 ? fallbackMinimum : lineCount;
}

/**
 * Base RuntimeItem class (1:1 Positron).
 * Represents a single item in the console output history.
 */
export abstract class RuntimeItem {
    protected _isHidden = false;

    constructor(
        public readonly id: string,
        public readonly when: Date
    ) { }

    get isHidden(): boolean { return this._isHidden; }

    getClipboardRepresentation(_commentPrefix: string): string[] {
        return [];
    }

    /**
     * Optimizes scrollback (1:1 Positron).
     * Default: treats item as single unit — visible or hidden.
     * @returns Remaining scrollback budget.
     */
    optimizeScrollback(scrollbackSize: number): number {
        if (!scrollbackSize) {
            this._isHidden = true;
            return 0;
        }
        this._isHidden = false;
        return scrollbackSize - 1;
    }
}

abstract class RuntimeItemStandard extends RuntimeItem {
    constructor(
        id: string,
        when: Date,
        protected readonly text: string
    ) {
        super(id, when);
    }

    override getClipboardRepresentation(commentPrefix: string): string[] {
        return formatConsoleTextForClipboard(this.text, commentPrefix);
    }

    override optimizeScrollback(scrollbackSize: number): number {
        const lineCount = countConsoleTextLines(this.text, this.text.length > 0 ? 1 : 0);

        if (scrollbackSize === 0) {
            this._isHidden = true;
            return 0;
        }

        if (lineCount <= scrollbackSize) {
            this._isHidden = false;
            return scrollbackSize - lineCount;
        }

        this._isHidden = true;
        return scrollbackSize;
    }
}

/**
 * RuntimeItemActivity class (1:1 Positron).
 * Groups related activity items (e.g., input + output for a single execution).
 */
export class RuntimeItemActivity extends RuntimeItem {
    private _activityItems: ActivityItem[] = [];

    constructor(
        public readonly parentId: string,
        initialItem: ActivityItem
    ) {
        super(initialItem.id, initialItem.when);
        this._activityItems.push(initialItem);
    }

    get activityItems(): ActivityItem[] {
        return this._activityItems;
    }

    override getClipboardRepresentation(commentPrefix: string): string[] {
        return this._activityItems.flatMap((item) => item.getClipboardRepresentation(commentPrefix));
    }

    addActivityItem(item: ActivityItem): void {
        if (
            item instanceof ActivityItemInput &&
            item.state !== ActivityItemInputState.Provisional
        ) {
            for (let i = this._activityItems.length - 1; i >= 0; i--) {
                const existingItem = this._activityItems[i];
                if (existingItem instanceof ActivityItemInput) {
                    if (
                        existingItem.state === ActivityItemInputState.Provisional &&
                        existingItem.parentId === item.parentId
                    ) {
                        this._activityItems[i] = item;
                        return;
                    }
                    break;
                }
            }
        }

        this._activityItems.push(item);
    }

    get lastActivityItem(): ActivityItem | undefined {
        return this._activityItems[this._activityItems.length - 1];
    }

    /**
     * Clears all output activity items, keeping only input items.
     * This implements Jupyter clear_output semantics: clear the output
     * area of the current cell without removing the input echo.
     */
    clearOutputItems(): void {
        this._activityItems = this._activityItems.filter(
            item => item instanceof ActivityItemInput
        );
    }

    replaceOutputItemByOutputId(
        outputId: string,
        replacement:
            | ActivityItemOutputMessage
            | ActivityItemOutputHtml
            | ActivityItemOutputPlot
    ): boolean {
        for (let i = this._activityItems.length - 1; i >= 0; i--) {
            const existing = this._activityItems[i];
            if (
                (existing instanceof ActivityItemOutputMessage ||
                    existing instanceof ActivityItemOutputHtml ||
                    existing instanceof ActivityItemOutputPlot) &&
                existing.outputId === outputId
            ) {
                this._activityItems[i] = replacement;
                return true;
            }
        }
        return false;
    }

    /**
     * Optimizes scrollback for this activity and its items (1:1 Positron).
     */
    override optimizeScrollback(scrollbackSize: number): number {
        if (!scrollbackSize) {
            this._isHidden = true;
            return 0;
        }
        this._isHidden = false;
        // Delegate to activity items in reverse order
        for (let i = this._activityItems.length - 1; i >= 0; i--) {
            scrollbackSize = this._activityItems[i].optimizeScrollback(scrollbackSize);
        }
        return scrollbackSize;
    }
}

/**
 * RuntimeItemStartup class (1:1 Positron).
 * Represents console startup/banner message.
 */
export class RuntimeItemStartup extends RuntimeItemStandard {
    constructor(
        id: string,
        when: Date,
        public readonly banner: string,
        public readonly version: string
    ) {
        super(id, when, banner);
    }
}

/**
 * RuntimeItemStartupFailure class.
 * Represents a runtime startup failure with diagnostic details.
 */
export class RuntimeItemStartupFailure extends RuntimeItemStandard {
    constructor(
        id: string,
        when: Date,
        public readonly message: string,
        details: string,
    ) {
        super(id, when, details);
    }
}

/**
 * RuntimeItemStarted class (1:1 Positron).
 * Represents console started notification.
 */
export class RuntimeItemStarted extends RuntimeItemStandard {
    constructor(
        id: string,
        when: Date,
        public readonly sessionName: string
    ) {
        super(id, when, `${sessionName} started.`);
    }
}

/**
 * RuntimeItemRestarted class (1:1 Positron).
 * Represents console restarted notification.
 */
export class RuntimeItemRestarted extends RuntimeItemStandard {
    constructor(
        id: string,
        when: Date,
        public readonly sessionName: string
    ) {
        super(id, when, `${sessionName} restarted.`);
    }
}

/**
 * RuntimeItemReconnected class (1:1 Positron).
 * Represents console reconnected notification.
 */
export class RuntimeItemReconnected extends RuntimeItemStandard {
    constructor(
        id: string,
        when: Date,
        public readonly sessionName: string
    ) {
        super(id, when, `${sessionName} reconnected.`);
    }
}

/**
 * RuntimeItemExited class (1:1 Positron).
 * Represents console exit notification.
 */
export class RuntimeItemExited extends RuntimeItemStandard {
    constructor(
        id: string,
        when: Date,
        public readonly sessionName: string,
        public readonly exitCode: number,
        public readonly reason: string
    ) {
        super(id, when, `${sessionName} exited (code: ${exitCode})${reason ? `\n${reason}` : ''}`);
    }
}

/**
 * RuntimeItemTrace class (1:1 Positron).
 * Represents trace/debug output.
 */
export class RuntimeItemTrace extends RuntimeItemStandard {
    constructor(
        id: string,
        when: Date,
        public readonly trace: string
    ) {
        super(
            id,
            when,
            trace
                .replaceAll('\x1b', 'ESC')
                .replaceAll('\x9B', 'CSI')
        );
    }
}

/**
 * RuntimeItemOffline class (1:1 Positron).
 * Represents runtime offline/disconnected state.
 */
export class RuntimeItemOffline extends RuntimeItemStandard {
    constructor(
        id: string,
        when: Date,
        public readonly sessionName: string,
        public readonly reason: string
    ) {
        super(id, when, `${sessionName} is offline.${reason ? `\n${reason}` : ''}`);
    }
}

export interface RuntimeItemPendingInputAttribution {
    source: string;
    fileUri?: unknown;
    lineNumber?: number;
    metadata?: Record<string, unknown>;
}

/**
 * RuntimeItemPendingInput class (1:1 Positron).
 * Represents queued input waiting for execution.
 */
export class RuntimeItemPendingInput extends RuntimeItemStandard {
    constructor(
        id: string,
        when: Date,
        public readonly inputPrompt: string,
        public readonly attribution: RuntimeItemPendingInputAttribution,
        public readonly executionId: string | undefined,
        public readonly code: string,
        public readonly mode: 'interactive' | 'non-interactive' | 'silent' | 'transient' = 'interactive'
    ) {
        super(id, when, code);
    }
}

/**
 * RuntimeItemStarting class (1:1 Positron).
 * Represents runtime starting state with attach mode for visual transitions.
 */
export class RuntimeItemStarting extends RuntimeItemStandard {
    constructor(
        id: string,
        when: Date,
        public readonly message: string,
        public readonly attachMode: SessionAttachMode
    ) {
        super(id, when, message);
    }
}

/**
 * RuntimeItemRestartButton class (1:1 Positron).
 * Represents a restart action button in console.
 */
export class RuntimeItemRestartButton extends RuntimeItem {
    constructor(
        id: string,
        when: Date,
        public readonly sessionId: string,
        public readonly onRestart: () => void
    ) {
        super(id, when);
    }
}

/**
 * ActivityItem base class (1:1 Positron).
 * Represents individual activity within an execution.
 */
export abstract class ActivityItem {
    protected _isHidden = false;

    constructor(
        public readonly id: string,
        public readonly parentId: string,
        public readonly when: Date
    ) { }

    get isHidden(): boolean { return this._isHidden; }

    getClipboardRepresentation(_commentPrefix: string): string[] {
        return [];
    }

    /**
     * Optimizes scrollback (1:1 Positron).
     * Default: treats activity item as single unit.
     */
    optimizeScrollback(scrollbackSize: number): number {
        if (!scrollbackSize) {
            this._isHidden = true;
            return 0;
        }
        this._isHidden = false;
        return scrollbackSize - 1;
    }
}

/**
 * ActivityItemInputState enum (1:1 Positron).
 */
export const enum ActivityItemInputState {
    Provisional = 'provisional',
    Executing = 'executing',
    Completed = 'completed',
    Cancelled = 'cancelled'
}

/**
 * ActivityItemInput class (1:1 Positron).
 * Represents code input.
 */
export class ActivityItemInput extends ActivityItem {
    constructor(
        id: string,
        parentId: string,
        when: Date,
        public state: ActivityItemInputState,
        public readonly inputPrompt: string,
        public readonly continuationPrompt: string,
        public readonly code: string
    ) {
        super(id, parentId, when);
    }

    override getClipboardRepresentation(_commentPrefix: string): string[] {
        return formatConsoleTextForClipboard(this.code);
    }
}

/**
 * ActivityItemStreamType enum (1:1 Positron).
 */
export const enum ActivityItemStreamType {
    OUTPUT = 'output',
    ERROR = 'error'
}

/**
 * ActivityItemStream class (1:1 Positron).
 * Represents stdout/stderr output.
 */
export class ActivityItemStream extends ActivityItem {
    text: string;

    constructor(
        id: string,
        parentId: string,
        when: Date,
        public readonly streamType: ActivityItemStreamType,
        text: string
    ) {
        super(id, parentId, when);
        this.text = text;
    }

    override getClipboardRepresentation(commentPrefix: string): string[] {
        return formatConsoleTextForClipboard(this.text, commentPrefix);
    }

    override optimizeScrollback(scrollbackSize: number): number {
        const lineCount = countConsoleTextLines(this.text, this.text.length > 0 ? 1 : 0);

        if (lineCount <= scrollbackSize) {
            this._isHidden = false;
            return scrollbackSize - lineCount;
        }

        this._isHidden = lineCount > 0;
        return 0;
    }
}

/**
 * ActivityItemErrorMessage class (1:1 Positron).
 * Represents error output.
 */
export class ActivityItemErrorMessage extends ActivityItem {
    constructor(
        id: string,
        parentId: string,
        when: Date,
        public readonly name: string,
        public readonly message: string,
        public readonly traceback: string[]
    ) {
        super(id, parentId, when);
    }

    override getClipboardRepresentation(commentPrefix: string): string[] {
        const lines = [
            ...formatConsoleTextForClipboard(!this.name ? this.message : `${this.name}: ${this.message}`, commentPrefix),
            ...this.traceback.flatMap((line) => formatConsoleTextForClipboard(line, commentPrefix)),
        ];
        return lines;
    }

    override optimizeScrollback(scrollbackSize: number): number {
        const outputLines =
            countConsoleTextLines(!this.name ? this.message : `${this.name}: ${this.message}`) +
            this.traceback.reduce((count, line) => count + countConsoleTextLines(line, line.length > 0 ? 1 : 0), 0);

        if (outputLines <= scrollbackSize) {
            this._isHidden = false;
            return scrollbackSize - outputLines;
        }

        this._isHidden = outputLines > 0;
        return 0;
    }
}

/**
 * Output data type for display_data messages.
 */
export interface ILanguageRuntimeMessageOutputData {
    [mimeType: string]: string;
}

/**
 * ActivityItemOutputMessage class (1:1 Positron).
 * Represents rich text output.
 */
export class ActivityItemOutputMessage extends ActivityItem {
    constructor(
        id: string,
        parentId: string,
        when: Date,
        public readonly data: ILanguageRuntimeMessageOutputData,
        public readonly outputId?: string
    ) {
        super(id, parentId, when);
    }

    override getClipboardRepresentation(commentPrefix: string): string[] {
        return formatConsoleTextForClipboard(this.data['text/plain'] ?? '', commentPrefix);
    }

    override optimizeScrollback(scrollbackSize: number): number {
        const output = this.data['text/plain'] ?? '';
        const lineCount = countConsoleTextLines(output, output.length > 0 ? 1 : 0);

        if (lineCount <= scrollbackSize) {
            this._isHidden = false;
            return scrollbackSize - lineCount;
        }

        this._isHidden = lineCount > 0;
        return 0;
    }
}

/**
 * ActivityItemOutputHtml class (1:1 Positron).
 * Represents HTML output.
 */
export class ActivityItemOutputHtml extends ActivityItem {
    constructor(
        id: string,
        parentId: string,
        when: Date,
        public readonly html: string,
        public readonly resource?: string,
        public readonly outputId?: string
    ) {
        super(id, parentId, when);
    }

    override getClipboardRepresentation(commentPrefix: string): string[] {
        return formatConsoleTextForClipboard(this.resource ?? htmlOutputPlaceholder, commentPrefix);
    }
}

/**
 * ActivityItemOutputPlot class (1:1 Positron).
 * Represents plot output.
 */
export class ActivityItemOutputPlot extends ActivityItem {
    constructor(
        id: string,
        parentId: string,
        when: Date,
        public readonly data: ILanguageRuntimeMessageOutputData,
        public readonly onSelected: () => void,
        public readonly outputId?: string
    ) {
        super(id, parentId, when);
    }

    override getClipboardRepresentation(commentPrefix: string): string[] {
        return formatConsoleTextForClipboard(this.data['text/plain'] ?? '', commentPrefix);
    }

    override optimizeScrollback(scrollbackSize: number): number {
        const output = this.data['text/plain'] ?? '';
        const lineCount = countConsoleTextLines(output, output.length > 0 ? 1 : 0);

        if (lineCount <= scrollbackSize) {
            this._isHidden = false;
            return scrollbackSize - lineCount;
        }

        this._isHidden = lineCount > 0;
        return 0;
    }
}

/**
 * ActivityItemPromptState enum (1:1 Positron).
 */
export const enum ActivityItemPromptState {
    Unanswered = 'unanswered',
    Answered = 'answered',
    Interrupted = 'interrupted'
}

/**
 * ActivityItemPrompt class (1:1 Positron).
 * Represents input prompt request with state tracking.
 */
export class ActivityItemPrompt extends ActivityItem {
    state: ActivityItemPromptState = ActivityItemPromptState.Unanswered;
    answer: string = '';

    constructor(
        id: string,
        parentId: string,
        when: Date,
        public readonly prompt: string,
        public readonly password: boolean
    ) {
        super(id, parentId, when);
    }

    override getClipboardRepresentation(commentPrefix: string): string[] {
        return formatConsoleTextForClipboard(this.prompt, commentPrefix);
    }
}

/**
 * Type alias for all activity item types.
 */
export type ActivityItemOutput =
    | ActivityItemStream
    | ActivityItemErrorMessage
    | ActivityItemOutputMessage
    | ActivityItemOutputHtml
    | ActivityItemOutputPlot;
