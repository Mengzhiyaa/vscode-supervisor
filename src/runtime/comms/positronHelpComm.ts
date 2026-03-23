/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronBaseComm, PositronCommOptions } from './positronBaseComm';
import { RuntimeClientInstance } from '../RuntimeClientInstance';

/**
 * Parameters for the ShowHelpTopic method.
 */
export interface ShowHelpTopicParams {
    /**
     * The help topic to show.
     */
    topic: string;
}

/**
 * Possible values for Kind in ShowHelp.
 */
export enum ShowHelpKind {
    Html = 'html',
    Markdown = 'markdown',
    Url = 'url'
}

/**
 * Parameters for the ShowHelp method.
 */
export interface ShowHelpParams {
    /**
     * The help content to show.
     */
    content: string;

    /**
     * The type of content to show.
     */
    kind: ShowHelpKind;

    /**
     * Whether to focus the Help pane when the content is displayed.
     */
    focus: boolean;
}

/**
 * Event: Request to show help in the frontend.
 */
export interface ShowHelpEvent {
    /**
     * The help content to show.
     */
    content: string;

    /**
     * The type of content to show.
     */
    kind: ShowHelpKind;

    /**
     * Whether to focus the Help pane when the content is displayed.
     */
    focus: boolean;
}

export enum HelpFrontendEvent {
    ShowHelp = 'show_help'
}

export enum HelpBackendRequest {
    ShowHelpTopic = 'show_help_topic'
}

/**
 * A comm wrapper for the help client.
 * Provides typed methods and events for help operations.
 */
export class PositronHelpComm extends PositronBaseComm {
    /**
     * Event that fires when help content should be shown.
     */
    readonly onDidShowHelp: vscode.Event<ShowHelpEvent>;

    constructor(
        client: RuntimeClientInstance,
        options?: PositronCommOptions<HelpBackendRequest>
    ) {
        super(client, options);

        this.onDidShowHelp = this.createEventEmitter<ShowHelpEvent>(
            'show_help',
            ['content', 'kind', 'focus']
        );
    }

    /**
     * Look for and, if found, show a help topic.
     *
     * Requests that the help backend look for a help topic and, if found,
     * show it. If the topic is found, it will be shown via a Show Help
     * notification. If the topic is not found, no notification will be
     * delivered.
     *
     * @param topic The help topic to show.
     * @returns Whether the topic was found and shown.
     */
    showHelpTopic(topic: string): Promise<boolean> {
        return this.performRpc<boolean>('show_help_topic', ['topic'], [topic]);
    }
}
