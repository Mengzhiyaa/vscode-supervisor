/*---------------------------------------------------------------------------------------------
 *  Positron Data Explorer Custom Editor Provider
 *  Implements VS Code's CustomReadonlyEditorProvider so Data Explorer appears
 *  in the "Reopen With Editor" menu for CSV, TSV, and Parquet files.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { IPositronDataExplorerService } from './positronDataExplorerService';
import { PositronDataExplorerEditorProvider } from './positronDataExplorerEditorProvider';
import { getDataExplorerIdentifier } from './dataExplorerUri';

/**
 * Keep the Data Explorer app mounted while its editor tab is hidden.
 *
 * Positron keeps the editor's React tree alive across editor visibility
 * changes and only pauses expensive data operations. A custom editor webview
 * needs retainContextWhenHidden to provide the same lifecycle.
 */
export const POSITRON_DATA_EXPLORER_CUSTOM_EDITOR_OPTIONS = {
    supportsMultipleEditorsPerDocument: false,
    webviewOptions: {
        retainContextWhenHidden: true,
    },
} satisfies NonNullable<
    Parameters<typeof vscode.window.registerCustomEditorProvider>[2]
>;

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
        const modelIdentifier = getDataExplorerIdentifier(document.uri);
        const identifier = modelIdentifier ?? `duckdb:${document.uri.toString()}`;
        const displayName = document.uri.path.split('/').pop() || 'data';

        // Resolve can spend time initializing the extension-host DuckDB worker.
        // Install a script-free, CSP-restricted shell immediately so failures or
        // slow initialization can never leave VS Code displaying a blank editor.
        this._editorProvider.showLoading(webviewPanel, displayName);

        try {
            this._logChannel.info(
                `[DataExplorerCustomEditor] Opening file: ${document.uri.toString()}`
            );

            // Mark this identifier so the PositronDataExplorerEditorProvider's onDidCreateInstance
            // listener does NOT auto-create a duplicate panel.
            this._editorProvider.markExternalPanel(identifier);

            // Internal model URIs reattach an existing runtime-backed instance;
            // actual files continue through the DuckDB backend.
            const instance = modelIdentifier
                ? this._dataExplorerService.getInstance(modelIdentifier)
                : await this._dataExplorerService.openWithDuckDB(document.uri);
            if (!instance) {
                throw new Error(`Data Explorer model is no longer available: ${identifier}`);
            }

            // Remove the mark now that openWithDuckDB has returned
            this._editorProvider.unmarkExternalPanel(identifier);

            // Attach the instance to the VS Code-provided webview panel
            this._editorProvider.attachToPanel(instance, webviewPanel);
        } catch (error) {
            this._editorProvider.unmarkExternalPanel(identifier);
            this._logChannel.error(
                `[DataExplorerCustomEditor] Failed to open file: ${error}`
            );
            this._editorProvider.showError(webviewPanel, error);
        }
    }
}
