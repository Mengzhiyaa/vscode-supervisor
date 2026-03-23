/**
 * PlotEditorProvider.ts
 *
 * Provides functionality to open individual plots in VS Code editor tabs.
 * This creates a full-featured plot viewer with zoom controls and save/copy actions.
 */

import * as vscode from 'vscode';
import { createMessageConnection, type MessageConnection } from 'vscode-jsonrpc';
import { PlotClientInstance } from '../runtime/PlotClientInstance';
import { PlotRenderFormat } from '../runtime/comms/positronPlotComm';
import { PositronPlotsService } from '../runtime/positronPlotsService';
import * as RpcProtocol from '../rpc/webview/plotEditor';
import { WebviewMessageReader, WebviewMessageWriter } from '../rpc/webview/transport';
import { StaticPlotClient } from '../runtime/staticPlotClient';

/**
 * Manages plot editor panels for viewing individual plots in VS Code editor tabs.
 */
export class PlotEditorProvider implements vscode.Disposable {
    private readonly _panels = new Map<string, vscode.WebviewPanel>();
    private readonly _connections = new Map<string, MessageConnection>();
    private readonly _currentPlotData = new Map<string, string>();
    private readonly _newWindowPanels = new Set<string>();
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _outputChannel: vscode.LogOutputChannel,
        private readonly _plotsService?: PositronPlotsService,
    ) { }

    /**
     * Opens a plot in a new editor tab.
     * @param plotId The unique identifier for the plot
     * @param plotData Base64-encoded image data (data URI format)
     * @param title Optional title for the editor tab
     */
    openPlotInEditor(
        plotId: string,
        plotData: string,
        title?: string,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active,
    ): void {
        this._currentPlotData.set(plotId, plotData);

        const existingPanel = this._panels.get(plotId);
        if (existingPanel) {
            existingPanel.reveal(viewColumn);
            this._sendSetImage(plotId, plotData);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'positronPlotEditor',
            title || `Plot: ${plotId.substring(0, 8)}`,
            viewColumn,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this._extensionUri, 'webview', 'dist'),
                ]
            }
        );

        const connection = this._setupRpcConnection(panel.webview);
        this._connections.set(plotId, connection);
        this._registerRpcHandlers(plotId, panel, connection);
        connection.listen();

        panel.webview.html = this._getEditorHtml(panel.webview);
        this._sendSetImage(plotId, plotData);

        panel.onDidDispose(() => {
            connection.dispose();
            this._connections.delete(plotId);
            this._panels.delete(plotId);
            this._currentPlotData.delete(plotId);
            this._newWindowPanels.delete(plotId);
            this._outputChannel.debug(`Plot editor closed: ${plotId}`);
        });

        this._panels.set(plotId, panel);
        this._outputChannel.debug(`Plot editor opened: ${plotId}`);
    }

    /**
     * Closes the currently active plot editor panel, if any.
     * Returns true when a panel was closed.
     */
    closeActivePanel(): boolean {
        const newWindowPanels = [...this._newWindowPanels]
            .map(plotId => this._panels.get(plotId))
            .filter((panel): panel is vscode.WebviewPanel => panel !== undefined);

        for (const panel of newWindowPanels) {
            if (panel.active) {
                panel.dispose();
                return true;
            }
        }

        for (const panel of newWindowPanels) {
            if (panel.visible) {
                panel.dispose();
                return true;
            }
        }

        for (const panel of this._panels.values()) {
            if (panel.active) {
                panel.dispose();
                return true;
            }
        }

        for (const panel of this._panels.values()) {
            if (panel.visible) {
                panel.dispose();
                return true;
            }
        }

        const firstPanel = this._panels.values().next().value as vscode.WebviewPanel | undefined;
        if (firstPanel) {
            firstPanel.dispose();
            return true;
        }

        return false;
    }

    /**
     * Marks a panel as having been moved to a new window.
     * Sets up auto-dispose when the panel returns from the new window
     * (e.g. when the user closes the new window via the OS close button).
     */
    async markAsNewWindowPanel(plotId: string): Promise<void> {
        const panel = this._panels.get(plotId);
        if (!panel) {
            return;
        }

        this._newWindowPanels.add(plotId);

        // Ensure the target panel is active so moveEditorToNewWindow applies to it.
        panel.reveal(vscode.ViewColumn.Active, false);

        // Move the panel to a new window
        await new Promise<void>(resolve => {
            if (typeof queueMicrotask === 'function') {
                queueMicrotask(resolve);
            } else {
                setTimeout(resolve, 0);
            }
        });
        await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');

        // Record the initial viewColumn after moving to the new window
        const initialColumn = panel.viewColumn;

        // Listen for state changes: if the panel returns from the new window
        // (viewColumn changes), auto-dispose it to prevent ghost panels.
        panel.onDidChangeViewState((e) => {
            if (!this._newWindowPanels.has(plotId)) {
                return;
            }
            // When the new window is closed, VS Code moves the editor back
            // to the original window, which changes its viewColumn.
            if (e.webviewPanel.visible && e.webviewPanel.viewColumn !== initialColumn) {
                this._outputChannel.debug(
                    `Plot editor ${plotId} returned from new window, auto-disposing`
                );
                this._newWindowPanels.delete(plotId);
                setTimeout(() => {
                    e.webviewPanel.dispose();
                }, 0);
            }
        }, undefined, this._disposables);

        this._outputChannel.debug(`Plot editor ${plotId} moved to new window`);
    }

    private _setupRpcConnection(webview: vscode.Webview): MessageConnection {
        const reader = new WebviewMessageReader(webview);
        const writer = new WebviewMessageWriter(webview);
        return createMessageConnection(reader, writer);
    }

    private _registerRpcHandlers(
        plotId: string,
        panel: vscode.WebviewPanel,
        connection: MessageConnection,
    ): void {
        connection.onNotification(RpcProtocol.PlotEditorReadyNotification.type, () => {
            const data = this._currentPlotData.get(plotId);
            if (data) {
                this._sendSetImage(plotId, data);
            }
        });

        connection.onNotification(RpcProtocol.PlotEditorSaveNotification.type, () => {
            void this._saveCurrentPlot(plotId);
        });

        connection.onNotification(RpcProtocol.PlotEditorCopyNotification.type, () => {
            void this._copyCurrentPlot(plotId);
        });

        connection.onNotification(RpcProtocol.PlotEditorCloseNotification.type, () => {
            panel.dispose();
        });

        connection.onNotification(RpcProtocol.PlotEditorRenderNotification.type, (params) => {
            void this._handleRenderRequest(connection, plotId, params);
        });
    }

    private _sendSetImage(plotId: string, data: string): void {
        const connection = this._connections.get(plotId);
        if (!connection) {
            return;
        }
        connection.sendNotification(RpcProtocol.PlotEditorSetImageNotification.type, { data });
    }

    private async _handleRenderRequest(
        connection: MessageConnection,
        plotId: string,
        message: RpcProtocol.PlotEditorRenderNotification.Params,
    ): Promise<void> {
        const width = Math.floor(message.width ?? 0);
        const height = Math.floor(message.height ?? 0);
        if (width <= 0 || height <= 0) {
            return;
        }

        const pixelRatio = message.pixelRatio && message.pixelRatio > 0 ? message.pixelRatio : 1;
        const format = message.format === 'svg' ? PlotRenderFormat.Svg : PlotRenderFormat.Png;

        try {
            const rendered = await this._renderPlot(plotId, width, height, pixelRatio, format);
            if (!rendered?.data) {
                return;
            }

            this._currentPlotData.set(plotId, rendered.data);
            connection.sendNotification(RpcProtocol.PlotEditorRenderResultNotification.type, {
                data: rendered.data,
                mimeType: rendered.mimeType,
            });
        } catch (error) {
            this._outputChannel.warn(`Failed to re-render plot ${plotId} in editor: ${error}`);
        }
    }

    private async _renderPlot(
        plotId: string,
        width: number,
        height: number,
        pixelRatio: number,
        format: PlotRenderFormat,
    ): Promise<{ data: string; mimeType: string } | undefined> {
        if (!this._plotsService) {
            return undefined;
        }

        const editorClient = this._plotsService.getEditorInstance(plotId);
        const dynamicClient = editorClient instanceof PlotClientInstance
            ? editorClient
            : this._plotsService.getPlotClient(plotId);

        if (dynamicClient instanceof PlotClientInstance) {
            const rendered = await dynamicClient.renderWithSizingPolicy(
                { width, height },
                pixelRatio,
                format,
                true  // Suppress completeRenderEmitter — PlotEditor delivers via its own notification
            );

            return {
                data: rendered.uri,
                mimeType: format === PlotRenderFormat.Svg ? 'image/svg+xml' : 'image/png',
            };
        }

        if (editorClient instanceof StaticPlotClient) {
            return {
                data: editorClient.uri,
                mimeType: editorClient.mimeType,
            };
        }

        return undefined;
    }

    private async _saveCurrentPlot(plotId: string): Promise<void> {
        const data = this._currentPlotData.get(plotId);
        if (!data) {
            vscode.window.showWarningMessage('No plot data available to save.');
            return;
        }

        try {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(`plot-${plotId.substring(0, 8)}.png`),
                filters: {
                    'PNG Image': ['png'],
                    'All Files': ['*']
                }
            });

            if (uri) {
                const base64Data = data.replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                await vscode.workspace.fs.writeFile(uri, buffer);
                vscode.window.showInformationMessage(`Plot saved to ${uri.fsPath}`);
            }
        } catch (e) {
            this._outputChannel.error(`Failed to save plot: ${e}`);
            vscode.window.showErrorMessage(`Failed to save plot: ${e}`);
        }
    }

    private async _copyCurrentPlot(plotId: string): Promise<void> {
        const data = this._currentPlotData.get(plotId);
        if (!data) {
            vscode.window.showWarningMessage('No plot data available to copy.');
            return;
        }

        try {
            await vscode.env.clipboard.writeText(data);
            vscode.window.showInformationMessage('Plot copied to clipboard');
        } catch (e) {
            this._outputChannel.error(`Failed to copy plot: ${e}`);
            vscode.window.showErrorMessage(`Failed to copy plot: ${e}`);
        }
    }

    /**
     * Generates the HTML content for the plot editor.
     * Loads the Svelte-built plotEditor bundle.
     */
    private _getEditorHtml(webview: vscode.Webview): string {
        const scriptUri = this._getWebviewUri(webview, 'webview', 'dist', 'plotEditor', 'index.js');
        const styleUri = this._getWebviewUri(webview, 'webview', 'dist', 'plotEditor', 'index.css');
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:;">
    <link href="${styleUri}" rel="stylesheet">
    <title>Plot Editor</title>
</head>
<body>
    <div id="app"></div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private _getWebviewUri(webview: vscode.Webview, ...pathSegments: string[]): vscode.Uri {
        return webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, ...pathSegments));
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    dispose(): void {
        for (const panel of this._panels.values()) {
            panel.dispose();
        }
        this._panels.clear();

        for (const connection of this._connections.values()) {
            connection.dispose();
        }
        this._connections.clear();

        this._currentPlotData.clear();
        this._newWindowPanels.clear();

        for (const d of this._disposables) {
            d.dispose();
        }
    }
}
