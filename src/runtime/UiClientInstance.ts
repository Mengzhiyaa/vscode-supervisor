/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RuntimeClientInstance } from './RuntimeClientInstance';
import { PlotRenderSettings } from './comms/positronPlotComm';
import {
    PositronUiComm,
    ShowHtmlFileEvent,
    ShowUrlEvent,
    BusyEvent,
    ClearConsoleEvent,
    OpenEditorEvent,
    ShowMessageEvent,
    PromptStateEvent,
    WorkingDirectoryEvent,
    OpenWorkspaceEvent,
    SetEditorSelectionsEvent,
    OpenWithSystemEvent,
    ClearWebviewPreloadsEvent
} from './comms/positronUiComm';

/**
 * Client-side interface to the UI comm.
 * Wraps the raw PositronUiComm with typed events.
 */
export class UiClientInstance implements vscode.Disposable {
    private readonly _comm: PositronUiComm;

    readonly onDidBusy: vscode.Event<BusyEvent>;
    readonly onDidClearConsole: vscode.Event<ClearConsoleEvent>;
    readonly onDidOpenEditor: vscode.Event<OpenEditorEvent>;
    readonly onDidShowMessage: vscode.Event<ShowMessageEvent>;
    readonly onDidPromptState: vscode.Event<PromptStateEvent>;
    readonly onDidWorkingDirectory: vscode.Event<WorkingDirectoryEvent>;
    readonly onDidOpenWorkspace: vscode.Event<OpenWorkspaceEvent>;
    readonly onDidSetEditorSelections: vscode.Event<SetEditorSelectionsEvent>;
    readonly onDidShowHtmlFile: vscode.Event<ShowHtmlFileEvent>;
    readonly onDidShowUrl: vscode.Event<ShowUrlEvent>;
    readonly onDidOpenWithSystem: vscode.Event<OpenWithSystemEvent>;
    readonly onDidClearWebviewPreloads: vscode.Event<ClearWebviewPreloadsEvent>;

    constructor(client: RuntimeClientInstance) {
        this._comm = new PositronUiComm(client);

        this.onDidBusy = this._comm.onDidBusy;
        this.onDidClearConsole = this._comm.onDidClearConsole;
        this.onDidOpenEditor = this._comm.onDidOpenEditor;
        this.onDidShowMessage = this._comm.onDidShowMessage;
        this.onDidPromptState = this._comm.onDidPromptState;
        this.onDidWorkingDirectory = this._comm.onDidWorkingDirectory;
        this.onDidOpenWorkspace = this._comm.onDidOpenWorkspace;
        this.onDidSetEditorSelections = this._comm.onDidSetEditorSelections;
        this.onDidShowHtmlFile = this._comm.onDidShowHtmlFile;
        this.onDidShowUrl = this._comm.onDidShowUrl;
        this.onDidOpenWithSystem = this._comm.onDidOpenWithSystem;
        this.onDidClearWebviewPreloads = this._comm.onDidClearWebviewPreloads;
    }

    async didChangePlotsRenderSettings(settings: PlotRenderSettings): Promise<void> {
        await this._comm.didChangePlotsRenderSettings(settings);
    }

    async callMethod(method: string, params: Array<any>): Promise<any> {
        return this._comm.callMethod(method, params);
    }

    dispose(): void {
        this._comm.dispose();
    }
}
