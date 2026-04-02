/*---------------------------------------------------------------------------------------------
 *  Positron Data Explorer Custom Editor Provider
 *  Implements VS Code's CustomReadonlyEditorProvider so Data Explorer appears
 *  in the "Reopen With Editor" menu for CSV, TSV, and Parquet files.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { IPositronDataExplorerService } from './positronDataExplorerService';
import { PositronDataExplorerEditorProvider } from './positronDataExplorerEditorProvider';

/**
 * A lightweight CustomReadonlyEditorProvider that delegates to the existing
 * PositronDataExplorerEditorProvider for all panel lifecycle management.
 *
 * When the user selects "Reopen With → Data Explorer", VS Code calls:
 *   1. openCustomDocument() — we return a minimal CustomDocument
 *   2. resolveCustomEditor() — we open the file via DuckDB and attach to the panel
 */
export class PositronDataExplorerCustomEditorProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'positron.dataExplorerEditor';

    constructor(
        private readonly _dataExplorerService: IPositronDataExplorerService,
        private readonly _editorProvider: PositronDataExplorerEditorProvider,
        private readonly _logChannel: vscode.LogOutputChannel
    ) {}

    /**
     * Called by VS Code when a file is opened with this custom editor.
     * Returns a minimal document — the real work happens in resolveCustomEditor.
     */
    openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
        return { uri, dispose: () => {} };
    }

    /**
     * Called by VS Code to render the custom editor's webview.
     * Opens the file via DuckDB, creates a Data Explorer instance,
     * and attaches it to the VS Code-provided webview panel.
     */
    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        const identifier = `duckdb:${document.uri.toString()}`;

        try {
            this._logChannel.info(
                `[DataExplorerCustomEditor] Opening file: ${document.uri.toString()}`
            );

            // Mark this identifier so the PositronDataExplorerEditorProvider's onDidCreateInstance
            // listener does NOT auto-create a duplicate panel.
            this._editorProvider.markExternalPanel(identifier);

            // Open the file via DuckDB — creates the Data Explorer instance
            const instance = await this._dataExplorerService.openWithDuckDB(document.uri);

            // Remove the mark now that openWithDuckDB has returned
            this._editorProvider.unmarkExternalPanel(identifier);

            // Attach the instance to the VS Code-provided webview panel
            this._editorProvider.attachToPanel(instance, webviewPanel);
        } catch (error) {
            this._editorProvider.unmarkExternalPanel(identifier);
            this._logChannel.error(
                `[DataExplorerCustomEditor] Failed to open file: ${error}`
            );
            webviewPanel.webview.html = `
                <html><body>
                    <h2>Failed to open in Data Explorer</h2>
                    <p>${String(error)}</p>
                </body></html>
            `;
        }
    }
}
