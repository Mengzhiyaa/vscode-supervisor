import * as vscode from 'vscode';
import {
    OpenEditorKind,
    type OpenEditorEvent,
    type OpenWithSystemEvent,
    type OpenWorkspaceEvent,
    type SetEditorSelectionsEvent,
    type ShowMessageEvent,
    UiFrontendEvent,
} from './comms/positronUiComm';
import type { ILanguageRuntimeGlobalEvent } from './runtimeEvents';
import type { IRuntimeSessionService } from './runtimeSessionService';

/**
 * Handles VS Code UI side effects requested by runtime frontend events.
 *
 * The runtime session service owns lifecycle and event forwarding; this service
 * owns workbench commands so session switching does not accidentally behave like
 * editor/workspace navigation.
 */
export class RuntimeFrontendEventService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _initialized = false;

    constructor(
        private readonly _sessionManager: Pick<IRuntimeSessionService, 'onDidReceiveRuntimeEvent'>,
        private readonly _outputChannel: vscode.LogOutputChannel,
    ) {
    }

    initialize(): void {
        if (this._initialized) {
            return;
        }

        this._initialized = true;
        this._disposables.push(
            this._sessionManager.onDidReceiveRuntimeEvent((runtimeEvent) => {
                void this.handleRuntimeEvent(runtimeEvent).catch((error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    this._outputChannel.warn(`[RuntimeFrontendEvent] Failed to handle ${runtimeEvent.event.name}: ${message}`);
                });
            }),
        );
    }

    async handleRuntimeEvent(runtimeEvent: ILanguageRuntimeGlobalEvent): Promise<void> {
        const data = runtimeEvent.event.data;

        switch (runtimeEvent.event.name) {
            case UiFrontendEvent.ShowMessage:
                await this._showMessage(data as Partial<ShowMessageEvent>);
                break;

            case UiFrontendEvent.OpenWorkspace:
                await this._openWorkspace(data as Partial<OpenWorkspaceEvent>);
                break;

            case UiFrontendEvent.OpenEditor:
                await this._openRuntimeEditor(data as Partial<OpenEditorEvent>);
                break;

            case UiFrontendEvent.SetEditorSelections:
                this._setActiveEditorSelections(data as Partial<SetEditorSelectionsEvent>);
                break;

            case UiFrontendEvent.OpenWithSystem:
                await this._openWithSystem(data as Partial<OpenWithSystemEvent>);
                break;
        }
    }

    dispose(): void {
        for (const disposable of this._disposables.splice(0)) {
            disposable.dispose();
        }
    }

    private async _showMessage(event: Partial<ShowMessageEvent>): Promise<void> {
        if (typeof event.message === 'string' && event.message.length > 0) {
            await vscode.window.showInformationMessage(event.message);
        }
    }

    private async _openWorkspace(event: Partial<OpenWorkspaceEvent>): Promise<void> {
        if (typeof event.path !== 'string' || event.path.length === 0) {
            return;
        }

        const requestedNewWindow = !!event.new_window;
        const forceNewWindow = requestedNewWindow || this._hasDirtyTextDocuments();
        if (!requestedNewWindow && forceNewWindow) {
            this._outputChannel.info(
                `[RuntimeFrontendEvent] Opening runtime-requested workspace in a new window because the current window has unsaved editor changes: ${event.path}`,
            );
        }

        await vscode.commands.executeCommand(
            'vscode.openFolder',
            vscode.Uri.file(event.path),
            forceNewWindow,
        );
    }

    private async _openRuntimeEditor(event: Partial<OpenEditorEvent>): Promise<void> {
        if (typeof event.file !== 'string' || event.file.length === 0) {
            return;
        }

        const targetUri = event.kind === OpenEditorKind.Uri
            ? vscode.Uri.parse(event.file)
            : vscode.Uri.file(event.file);

        const targetLine = typeof event.line === 'number' && Number.isFinite(event.line)
            ? Math.max(Math.trunc(event.line) - 1, 0)
            : 0;
        const targetColumn = typeof event.column === 'number' && Number.isFinite(event.column)
            ? Math.max(Math.trunc(event.column) - 1, 0)
            : 0;

        const targetPosition = new vscode.Position(targetLine, targetColumn);
        const targetSelection = new vscode.Selection(targetPosition, targetPosition);

        await vscode.window.showTextDocument(targetUri, {
            selection: targetSelection,
            preview: event.pinned === false,
            preserveFocus: false,
        });
    }

    private _setActiveEditorSelections(event: Partial<SetEditorSelectionsEvent>): void {
        if (!Array.isArray(event.selections) || event.selections.length === 0) {
            return;
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return;
        }

        const selections: vscode.Selection[] = [];
        for (const selection of event.selections) {
            if (!selection || !selection.start || !selection.end) {
                continue;
            }

            selections.push(
                new vscode.Selection(
                    new vscode.Position(
                        Math.max(Math.trunc(selection.start.line), 0),
                        Math.max(Math.trunc(selection.start.character), 0),
                    ),
                    new vscode.Position(
                        Math.max(Math.trunc(selection.end.line), 0),
                        Math.max(Math.trunc(selection.end.character), 0),
                    ),
                ),
            );
        }

        if (selections.length > 0) {
            activeEditor.selections = selections;
            activeEditor.revealRange(selections[0]);
        }
    }

    private async _openWithSystem(event: Partial<OpenWithSystemEvent>): Promise<void> {
        if (typeof event.path === 'string' && event.path.length > 0) {
            await vscode.env.openExternal(vscode.Uri.file(event.path));
        }
    }

    private _hasDirtyTextDocuments(): boolean {
        return vscode.workspace.textDocuments.some(document => document.isDirty);
    }
}
