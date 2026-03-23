/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronBaseComm, PositronCommOptions } from './positronBaseComm';
import { RuntimeClientInstance } from '../RuntimeClientInstance';
import { PlotRenderSettings } from './positronPlotComm';

/**
 * A line and character position.
 */
export interface Position {
    character: number;
    line: number;
}

/**
 * A selection range.
 */
export interface Range {
    start: Position;
    end: Position;
}

/**
 * Possible values for Kind in OpenEditor.
 */
export enum OpenEditorKind {
    Path = 'path',
    Uri = 'uri'
}

/**
 * Possible values for Destination in ShowHtmlFile.
 */
export enum ShowHtmlFileDestination {
    Plot = 'plot',
    Viewer = 'viewer',
    Editor = 'editor'
}

/**
 * Source information for preview content.
 */
export interface PreviewSource {
    /** The type of source that opened the preview */
    type: string;
    /** The ID of the source (session_id or terminal process ID) */
    id: string;
}

/**
 * Event: Change in backend's busy/idle status.
 */
export interface BusyEvent {
    busy: boolean;
}

/**
 * Event: Clear the console.
 */
export interface ClearConsoleEvent {
}

/**
 * Event: Open an editor.
 */
export interface OpenEditorEvent {
    file: string;
    line: number;
    column: number;
    kind?: OpenEditorKind;
    pinned?: boolean;
}

/**
 * Event: Show a message.
 */
export interface ShowMessageEvent {
    message: string;
}

/**
 * Event: Prompt state update.
 */
export interface PromptStateEvent {
    input_prompt: string;
    continuation_prompt: string;
}

/**
 * Event: Working directory update.
 */
export interface WorkingDirectoryEvent {
    directory: string;
}

/**
 * Event: Open a workspace.
 */
export interface OpenWorkspaceEvent {
    path: string;
    new_window: boolean;
}

/**
 * Event: Set editor selections.
 */
export interface SetEditorSelectionsEvent {
    selections: Array<Range>;
}

/**
 * Event: Show a URL in the Viewer pane.
 */
export interface ShowUrlEvent {
    /** The URL to display */
    url: string;
    /** Optional source information for the URL */
    source?: PreviewSource;
}

/**
 * Event: Show an HTML file.
 */
export interface ShowHtmlFileEvent {
    /** The fully qualified filesystem path to the HTML file to display */
    path: string;
    /** A title to be displayed in the viewer */
    title: string;
    /** Where the file should be shown */
    destination: ShowHtmlFileDestination;
    /** Desired height of the HTML viewer, in pixels */
    height: number;
}

/**
 * Event: Open a file or folder with the system default application.
 */
export interface OpenWithSystemEvent {
    path: string;
}

/**
 * Event: Webview preloads should be flushed.
 */
export interface ClearWebviewPreloadsEvent {
}

/**
 * UI frontend event names.
 */
export enum UiFrontendEvent {
    Busy = 'busy',
    ClearConsole = 'clear_console',
    OpenEditor = 'open_editor',
    ShowMessage = 'show_message',
    PromptState = 'prompt_state',
    WorkingDirectory = 'working_directory',
    OpenWorkspace = 'open_workspace',
    SetEditorSelections = 'set_editor_selections',
    ShowUrl = 'show_url',
    ShowHtmlFile = 'show_html_file',
    OpenWithSystem = 'open_with_system',
    ClearWebviewPreloads = 'clear_webview_preloads'
}

/**
 * Runtime UI client event envelope.
 */
export interface IRuntimeClientEvent {
    name: UiFrontendEvent;
    data: unknown;
}

export type UiParam =
    | null
    | boolean
    | number
    | string
    | Array<UiParam>
    | { [key: string]: UiParam };

/**
 * Result returned by silent code evaluation.
 */
export interface EvaluateCodeResult {
    result: any;
    output: string;
}

/**
 * Backend request types for the UI comm.
 */
export enum UiBackendRequest {
    CallMethod = 'call_method',
    DidChangePlotsRenderSettings = 'did_change_plots_render_settings',
    EditorContextChanged = 'editor_context_changed',
    EvaluateCode = 'evaluate_code'
}

/**
 * A comm wrapper for the UI client.
 * Provides typed events for UI-related notifications.
 *
 * Matches Positron's PositronUiComm pattern.
 */
export class PositronUiComm extends PositronBaseComm {
    readonly onDidBusy: vscode.Event<BusyEvent>;
    readonly onDidClearConsole: vscode.Event<ClearConsoleEvent>;
    readonly onDidOpenEditor: vscode.Event<OpenEditorEvent>;
    readonly onDidShowMessage: vscode.Event<ShowMessageEvent>;
    readonly onDidPromptState: vscode.Event<PromptStateEvent>;
    readonly onDidWorkingDirectory: vscode.Event<WorkingDirectoryEvent>;
    readonly onDidOpenWorkspace: vscode.Event<OpenWorkspaceEvent>;
    readonly onDidSetEditorSelections: vscode.Event<SetEditorSelectionsEvent>;
    readonly onDidShowUrl: vscode.Event<ShowUrlEvent>;
    readonly onDidShowHtmlFile: vscode.Event<ShowHtmlFileEvent>;
    readonly onDidOpenWithSystem: vscode.Event<OpenWithSystemEvent>;
    readonly onDidClearWebviewPreloads: vscode.Event<ClearWebviewPreloadsEvent>;

    constructor(
        client: RuntimeClientInstance,
        options?: PositronCommOptions<UiBackendRequest>
    ) {
        super(client, options);

        this.onDidBusy = this.createEventEmitter<BusyEvent>(
            'busy',
            ['busy']
        );
        this.onDidClearConsole = this.createEventEmitter<ClearConsoleEvent>(
            'clear_console',
            []
        );
        this.onDidOpenEditor = this.createEventEmitter<OpenEditorEvent>(
            'open_editor',
            ['file', 'line', 'column', 'kind', 'pinned']
        );
        this.onDidShowMessage = this.createEventEmitter<ShowMessageEvent>(
            'show_message',
            ['message']
        );
        this.onDidPromptState = this.createEventEmitter<PromptStateEvent>(
            'prompt_state',
            ['input_prompt', 'continuation_prompt']
        );
        this.onDidWorkingDirectory = this.createEventEmitter<WorkingDirectoryEvent>(
            'working_directory',
            ['directory']
        );
        this.onDidOpenWorkspace = this.createEventEmitter<OpenWorkspaceEvent>(
            'open_workspace',
            ['path', 'new_window']
        );
        this.onDidSetEditorSelections = this.createEventEmitter<SetEditorSelectionsEvent>(
            'set_editor_selections',
            ['selections']
        );
        this.onDidShowUrl = this.createEventEmitter<ShowUrlEvent>(
            'show_url',
            ['url', 'source']
        );
        this.onDidShowHtmlFile = this.createEventEmitter<ShowHtmlFileEvent>(
            'show_html_file',
            ['path', 'title', 'destination', 'height']
        );
        this.onDidOpenWithSystem = this.createEventEmitter<OpenWithSystemEvent>(
            'open_with_system',
            ['path']
        );
        this.onDidClearWebviewPreloads = this.createEventEmitter<ClearWebviewPreloadsEvent>(
            'clear_webview_preloads',
            []
        );
    }

    /**
     * Notification that plot render settings have changed.
     */
    didChangePlotsRenderSettings(settings: PlotRenderSettings): Promise<null> {
        return this.performRpc('did_change_plots_render_settings', ['settings'], [settings]);
    }

    /**
     * Call a backend UI method and return its result.
     */
    callMethod(method: string, params: Array<UiParam>): Promise<any> {
        return this.performRpc('call_method', ['method', 'params'], [method, params]);
    }

    /**
     * Evaluate a code expression silently and return the result as JSON.
     *
     * @param code The code expression to evaluate
     * @returns The evaluation result
     */
    evaluateCode(code: string): Promise<EvaluateCodeResult> {
        return this.performRpc('evaluate_code', ['code'], [code]);
    }
}
