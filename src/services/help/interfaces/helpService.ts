/*---------------------------------------------------------------------------------------------
 *  Service-Class Session Management - Help Interfaces
 *  1:1 replication of Positron's IPositronHelpService and IHelpEntry
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * IHelpEntry interface.
 */
export interface IHelpEntry {
    /** The proxied URL used for display in the help view. */
    readonly sourceUrl: string;

    /** The original target URL from the backend. */
    readonly targetUrl: string;

    /** The title of the help entry, if known. */
    readonly title?: string;

    /** The runtime session ID that produced this help entry. */
    readonly sessionId: string;

    /** The language ID for the help entry. */
    readonly languageId: string;

    /** The human-friendly language name. */
    readonly languageName: string;

    /** Saved scroll X position. */
    readonly scrollX: number;

    /** Saved scroll Y position. */
    readonly scrollY: number;

    /** Event fired when the title changes. */
    readonly onDidChangeTitle: vscode.Event<string>;
}

/**
 * IPositronHelpService interface.
 */
export interface IPositronHelpService extends vscode.Disposable {
    /** The help entries history. */
    readonly helpEntries: IHelpEntry[];

    /** The currently active help entry. */
    readonly currentHelpEntry?: IHelpEntry;

    /** Whether help can navigate backward in history. */
    readonly canNavigateBackward: boolean;

    /** Whether help can navigate forward in history. */
    readonly canNavigateForward: boolean;

    /** Event fired when the current help entry changes. */
    readonly onDidChangeCurrentHelpEntry: vscode.Event<IHelpEntry | undefined>;

    /** Initializes the help service. */
    initialize(): void;

    /** Opens the specified help entry index. */
    openHelpEntryIndex(helpEntryIndex: number): void;

    /** Requests help for a topic. */
    showHelpTopic(languageId: string, topic: string): Promise<boolean>;

    /** Navigates to a new URL from an existing help entry. */
    navigate(fromUrl: string, toUrl: string): void;

    /** Navigate backward in history. */
    navigateBackward(): void;

    /** Navigate forward in history. */
    navigateForward(): void;

    /** Show the find widget for the current help entry. */
    find(): Promise<void>;

    /** Show the welcome page. */
    showWelcomePage(): void;
}
