/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RuntimeClientInstance } from './RuntimeClientInstance';
import { PositronHelpComm, ShowHelpEvent } from './comms/positronHelpComm';

/**
 * A help client instance.
 */
export class HelpClientInstance implements vscode.Disposable {
    /** The underlying comm. */
    private readonly _comm: PositronHelpComm;

    /**
     * Creates a new help client instance.
     *
     * @param client The client instance.
     * @param languageId The language ID for this client.
     */
    constructor(
        client: RuntimeClientInstance,
        readonly languageId: string
    ) {
        this._comm = new PositronHelpComm(client);
        this.onDidShowHelp = this._comm.onDidShowHelp;
        this.onDidClose = this._comm.onDidClose;
    }

    /**
     * Requests that the given help topic be shown.
     *
     * @param topic The topic to show.
     * @returns A promise that resolves to true if the topic was found.
     */
    async showHelpTopic(topic: string): Promise<boolean> {
        return this._comm.showHelpTopic(topic);
    }

    /**
     * Event that fires when help content should be shown.
     */
    readonly onDidShowHelp: vscode.Event<ShowHelpEvent>;

    /**
     * Event that fires when the comm is closed.
     */
    readonly onDidClose: vscode.Event<void>;

    dispose(): void {
        this._comm.dispose();
    }
}
