/**
 * PlotEditorProvider.ts
 *
 * Provides functionality to open individual plots in VS Code editor tabs.
 * This creates a full-featured plot viewer with zoom controls and save/copy actions.
 */

import * as vscode from 'vscode';
import { createMessageConnection, type MessageConnection } from 'vscode-jsonrpc/node';
import { PlotClientInstance } from '../runtime/PlotClientInstance';
import { PlotRenderFormat } from '../runtime/comms/positronPlotComm';
import { PositronPlotsService } from '../runtime/positronPlotsService';
import * as RpcProtocol from '../rpc/webview/plotEditor';
import { WebviewMessageReader, WebviewMessageWriter } from '../rpc/webview/transport';
import { StaticPlotClient } from '../runtime/staticPlotClient';
import {
    decodeImageDataUrl,
    extensionForMimeType,
} from '../runtime/imageDataUrl';
import {
    SurfaceKind,
    SurfaceLifecycleService,
    SurfaceModelKind,
} from '../services/surfaces/surfaceLifecycleService';

export type PlotEditorContent =
    | {
        kind: 'image';
        data: string;
        mimeType?: string;
    }
    | {
        kind: 'html';
        uri: string;
        title?: string;
    };

const MaxHtmlExportBytes = 50 * 1024 * 1024;

export function decodeImageDataUri(data: string): { mimeType: string; bytes: Uint8Array } {
    try {
        const decoded = decodeImageDataUrl(data);
        if (!decoded.mimeType.startsWith('image/')) {
            throw new Error('Invalid image data URI');
        }
        return decoded;
    } catch (error) {
        if (error instanceof Error && error.message === 'Invalid image data URI') {
            throw error;
        }
        throw new Error('Invalid image data URI');
    }
}

export function imageExtension(mimeType: string): string {
    return extensionForMimeType(mimeType);
}

export function addHtmlBaseUri(content: string, sourceUri: string): string {
    if (/<base(?:\s|>)/i.test(content)) {
        return content;
    }
    const base = `<base href="${sourceUri.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;
    const head = /<head(?:\s[^>]*)?>/i.exec(content);
    if (head?.index !== undefined) {
        const index = head.index + head[0].length;
        return `${content.slice(0, index)}${base}${content.slice(index)}`;
    }
    return `${base}${content}`;
}

/**
 * Manages plot editor panels for viewing individual plots in VS Code editor tabs.
 */
export class PlotEditorProvider implements vscode.Disposable {
    private readonly _panels = new Map<string, vscode.WebviewPanel>();
    private readonly _connections = new Map<string, MessageConnection>();
    private readonly _currentPlotContent = new Map<string, PlotEditorContent>();
    private readonly _newWindowPanels = new Set<string>();
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _outputChannel: vscode.LogOutputChannel,
        private readonly _plotsService?: PositronPlotsService,
        private readonly _surfaceLifecycle?: SurfaceLifecycleService,
    ) { }

    /**
     * Opens a plot in a new editor tab.
     * @param plotId The unique identifier for the plot
     * @param plotContent Image data or an HTML/renderer URI
     * @param title Optional title for the editor tab
     */
    openPlotInEditor(
        plotId: string,
        plotContent: string | PlotEditorContent,
        title?: string,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active,
    ): void {
        const content = typeof plotContent === 'string'
            ? { kind: 'image' as const, data: plotContent }
            : plotContent;
        this._currentPlotContent.set(plotId, content);

        const existingPanel = this._panels.get(plotId);
        if (existingPanel) {
            existingPanel.reveal(viewColumn);
            this._sendContent(plotId, content);
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
        const surfaceAttachment = this._surfaceLifecycle
            ?.findModelByResource(SurfaceModelKind.Plot, plotId);
        const attachmentLease = surfaceAttachment
            ? this._surfaceLifecycle!.attach(surfaceAttachment.id, {
                surfaceId: `plot-editor:${plotId}`,
                kind: SurfaceKind.PlotEditor,
                ownerId: 'plot-editor-provider',
                metadata: { plotId },
            })
            : undefined;
        this._connections.set(plotId, connection);
        this._registerRpcHandlers(plotId, panel, connection);
        connection.listen();

        panel.webview.html = this._getEditorHtml(panel.webview);
        this._sendContent(plotId, content);

        panel.onDidDispose(() => {
            attachmentLease?.dispose();
            connection.dispose();
            this._connections.delete(plotId);
            this._panels.delete(plotId);
            this._currentPlotContent.delete(plotId);
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
            const content = this._currentPlotContent.get(plotId);
            if (content) {
                this._sendContent(plotId, content);
            }
        });

        connection.onNotification(RpcProtocol.PlotEditorSaveNotification.type, () => {
            void this._saveCurrentPlot(plotId);
        });

        connection.onNotification(RpcProtocol.PlotEditorCopyNotification.type, () => {
            void this._copyCurrentPlot(plotId);
        });

        connection.onNotification(RpcProtocol.PlotEditorOpenInBrowserNotification.type, () => {
            const content = this._currentPlotContent.get(plotId);
            if (content?.kind === 'html') {
                void vscode.env.openExternal(vscode.Uri.parse(content.uri));
            }
        });

        connection.onNotification(RpcProtocol.PlotEditorCloseNotification.type, () => {
            panel.dispose();
        });

        connection.onNotification(RpcProtocol.PlotEditorRenderNotification.type, (params) => {
            void this._handleRenderRequest(connection, plotId, params);
        });
    }

    private _sendContent(plotId: string, content: PlotEditorContent): void {
        const connection = this._connections.get(plotId);
        if (!connection) {
            return;
        }
        connection.sendNotification(RpcProtocol.PlotEditorSetContentNotification.type, content);
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

            this._currentPlotContent.set(plotId, {
                kind: 'image',
                data: rendered.data,
                mimeType: rendered.mimeType,
            });
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
        const content = this._currentPlotContent.get(plotId);
        if (!content) {
            vscode.window.showWarningMessage('No plot data available to save.');
            return;
        }

        try {
            const image = content.kind === 'image'
                ? decodeImageDataUri(content.data)
                : undefined;
            const extension = image ? imageExtension(image.mimeType) : 'html';
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(`plot-${plotId.substring(0, 8)}.${extension}`),
                filters: image ? {
                    [`${extension.toUpperCase()} Image`]: [extension],
                    'All Files': ['*']
                } : {
                    'HTML Document': ['html', 'htm'],
                    'All Files': ['*'],
                },
            });

            if (uri) {
                const bytes = image?.bytes ?? Buffer.from(
                    addHtmlBaseUri(
                        await this._readHtml(content.kind === 'html' ? content.uri : ''),
                        content.kind === 'html' ? content.uri : '',
                    ),
                    'utf8',
                );
                await vscode.workspace.fs.writeFile(uri, bytes);
                const message = vscode.l10n.t('Plot exported to {0}', uri.fsPath);
                this._sendStatus(plotId, message);
                void vscode.window.showInformationMessage(message);
            }
        } catch (e) {
            this._outputChannel.error(`Failed to save plot: ${e}`);
            this._sendStatus(plotId, vscode.l10n.t('Failed to export plot: {0}', String(e)), true);
            vscode.window.showErrorMessage(`Failed to save plot: ${e}`);
        }
    }

    private async _copyCurrentPlot(plotId: string): Promise<void> {
        const content = this._currentPlotContent.get(plotId);
        if (!content) {
            vscode.window.showWarningMessage('No plot data available to copy.');
            return;
        }

        try {
            const value = content.kind === 'image'
                ? content.data
                : addHtmlBaseUri(await this._readHtml(content.uri), content.uri);
            await vscode.env.clipboard.writeText(value);
            const message = content.kind === 'html'
                ? vscode.l10n.t('Plot HTML copied to clipboard')
                : vscode.l10n.t('Plot data URI copied to clipboard');
            this._sendStatus(plotId, message);
            void vscode.window.showInformationMessage(message);
        } catch (e) {
            this._outputChannel.error(`Failed to copy plot: ${e}`);
            this._sendStatus(plotId, vscode.l10n.t('Failed to copy plot: {0}', String(e)), true);
            vscode.window.showErrorMessage(`Failed to copy plot: ${e}`);
        }
    }

    private async _readHtml(uriText: string): Promise<string> {
        const uri = vscode.Uri.parse(uriText);
        if (uri.scheme === 'file') {
            const bytes = await vscode.workspace.fs.readFile(uri);
            if (bytes.byteLength > MaxHtmlExportBytes) {
                throw new Error('HTML plot is too large to export');
            }
            return Buffer.from(bytes).toString('utf8');
        }
        if (uri.scheme !== 'http' && uri.scheme !== 'https') {
            throw new Error(`Unsupported HTML plot URI scheme: ${uri.scheme}`);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
            const response = await fetch(uri.toString(true), { signal: controller.signal });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }
            const contentLength = Number(response.headers.get('content-length') ?? 0);
            if (contentLength > MaxHtmlExportBytes) {
                throw new Error('HTML plot is too large to export');
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.byteLength > MaxHtmlExportBytes) {
                throw new Error('HTML plot is too large to export');
            }
            return Buffer.from(bytes).toString('utf8');
        } finally {
            clearTimeout(timeout);
        }
    }

    private _sendStatus(plotId: string, message: string, error = false): void {
        this._connections.get(plotId)?.sendNotification(
            RpcProtocol.PlotEditorStatusNotification.type,
            { message, error },
        );
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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:; frame-src http: https: ${webview.cspSource};">
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

        this._currentPlotContent.clear();
        this._newWindowPanels.clear();

        for (const d of this._disposables) {
            d.dispose();
        }
    }
}
