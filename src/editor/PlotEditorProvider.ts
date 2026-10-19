/**
 * PlotEditorProvider.ts
 *
 * Provides functionality to open individual plots in VS Code editor tabs.
 * This creates a full-featured plot viewer with zoom controls and save/copy actions.
 */

import { getErrorMessage } from '../shared/errors';
import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { createMessageConnection, type MessageConnection } from 'vscode-jsonrpc/node';
import { PlotClientInstance, ZoomLevel, type PlotMetadata } from '../runtime/PlotClientInstance';
import { savePlotImage } from '../runtime/plotImageExport';
import { PlotRenderFormat } from '../runtime/comms/positronPlotComm';
import { PositronPlotsService } from '../runtime/positronPlotsService';
import * as RpcProtocol from '../rpc/webview/plotEditor';
import { WebviewMessageReader, WebviewMessageWriter } from '../rpc/webview/transport';
import { StaticPlotClient } from '../runtime/staticPlotClient';
import { HtmlPlotClient } from '../runtime/htmlPlotClient';
import { isZoomablePlotClient, type IPositronPlotClient } from '../runtime/positronPlots';
import {
    decodeImageDataUrl,
    mimeTypeFromDataUrl,
    extensionForMimeType,
} from '../runtime/imageDataUrl';
import {
    SurfaceKind,
    SurfaceLifecycleService,
    SurfaceModelKind,
} from '../services/surfaces/surfaceLifecycleService';
import { EditorWindowMover, findActivePanel } from './EditorWindowMover';
import { serializeWebviewLocalizationMessages } from '../webview/webviewLocalization';

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
    private readonly _newWindowPanelGroups = new Map<string, vscode.TabGroup>();
    private readonly _proxyLeases = new Map<string, vscode.Disposable>();
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _modelSubscriptions = new Map<string, vscode.Disposable[]>();
    private readonly _renderVersions = new Map<string, number>();
    private readonly _renderSerials = new Map<string, number>();
    private readonly _restoreWaiters = new Set<() => void>();
    private _shuttingDown = false;
    private readonly _snapshotWrites = new Map<string, Promise<void>>();

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _outputChannel: vscode.LogOutputChannel,
        private readonly _plotsService?: PositronPlotsService,
        private readonly _surfaceLifecycle?: SurfaceLifecycleService,
        private readonly _editorWindowMover: EditorWindowMover = new EditorWindowMover(),
        private readonly _retainProxyUri?: (uri: vscode.Uri) => vscode.Disposable,
        private readonly _keepProxyForExternalWindow?: (uri: vscode.Uri) => void,
        private readonly _storageUri?: vscode.Uri,
    ) {
        this._disposables.push(vscode.window.tabGroups.onDidChangeTabGroups(event => {
            for (const [plotId, group] of this._newWindowPanelGroups) {
                if (!event.closed.includes(group)) {
                    continue;
                }

                this._newWindowPanels.delete(plotId);
                this._newWindowPanelGroups.delete(plotId);
                const panel = this._panels.get(plotId);
                setTimeout(() => {
                    if (panel && this._panels.get(plotId) === panel) {
                        panel.dispose();
                    }
                }, 0);
            }
        }));
    }

    registerSerializer(): void {
        this._disposables.push(vscode.window.registerWebviewPanelSerializer('positronPlotEditor', {
            deserializeWebviewPanel: async (panel, state: unknown) => {
                const saved = state as { version?: number; plotId?: string; sessionId?: string; staticSnapshot?: boolean } | undefined;
                if (saved?.version !== 1 || typeof saved.plotId !== 'string' || typeof saved.sessionId !== 'string') {
                    panel.dispose();
                    return;
                }
                let closed = false;
                const closeListener = panel.onDidDispose(() => { closed = true; });
                try {
                    const plot = saved.staticSnapshot
                        ? await this._restoreStaticSnapshot(saved.plotId, saved.sessionId)
                        : await this._waitForEditorInstance(saved.plotId, saved.sessionId, panel);
                    if (closed || this._shuttingDown) { throw new vscode.CancellationError(); }
                    const content: PlotEditorContent = plot instanceof HtmlPlotClient
                        ? { kind: 'html', uri: plot.uri.toString(true), title: plot.metadata.name }
                        : { kind: 'image', data: plot instanceof StaticPlotClient ? plot.uri : plot instanceof PlotClientInstance ? plot.lastRender?.uri ?? '' : '' };
                    this.openPlotInEditor(saved.plotId, content, panel.title, panel.viewColumn, false, panel);
                } catch (error) {
                    if (!this._shuttingDown && !(error instanceof vscode.CancellationError)) {
                        void vscode.window.showWarningMessage(vscode.l10n.t('The plot session could not be restored.'));
                    }
                    panel.dispose();
                } finally {
                    closeListener.dispose();
                }
            },
        }));
    }

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
        revealExisting = true,
        restoredPanel?: vscode.WebviewPanel,
    ): void {
        const content = typeof plotContent === 'string'
            ? { kind: 'image' as const, data: plotContent }
            : plotContent;
        this._currentPlotContent.set(plotId, content);

        const existingPanel = this._panels.get(plotId);
        if (existingPanel) {
            if (revealExisting) {
                existingPanel.reveal(viewColumn);
            }
            this._sendContent(plotId, content);
            return;
        }

        const panel = restoredPanel ?? vscode.window.createWebviewPanel(
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

        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'webview', 'dist')],
        };
        this._panels.set(plotId, panel);
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
        this._bindPlotClient(plotId, panel);
        connection.listen();

        panel.webview.html = this._getEditorHtml(panel.webview);
        this._sendContent(plotId, content);

        panel.onDidDispose(() => {
            if (this._panels.get(plotId) !== panel) { return; }
            this._modelSubscriptions.get(plotId)?.forEach(subscription => subscription.dispose());
            this._modelSubscriptions.delete(plotId);
            if (!this._shuttingDown) {
                const sessionId = this._plotsService?.getEditorInstance(plotId)?.metadata.session_id;
                this._plotsService?.removeEditorPlot(plotId);
                const file = sessionId ? this._snapshotUri(plotId, sessionId) : undefined;
                if (file) {
                    void (this._snapshotWrites.get(plotId) ?? Promise.resolve()).then(async () => {
                        if (!this._panels.has(plotId)) { await vscode.workspace.fs.delete(file); }
                    }).catch(() => undefined);
                }
            }
            this._renderVersions.delete(plotId);
            this._renderSerials.delete(plotId);
            this._proxyLeases.get(plotId)?.dispose();
            this._proxyLeases.delete(plotId);
            attachmentLease?.dispose();
            connection.dispose();
            this._connections.delete(plotId);
            this._panels.delete(plotId);
            this._currentPlotContent.delete(plotId);
            this._newWindowPanels.delete(plotId);
            this._newWindowPanelGroups.delete(plotId);
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
        const activePanel = findActivePanel(this._panels.values());
        if (activePanel) {
            activePanel.dispose();
            return true;
        }

        return false;
    }

    /**
     * Marks a panel as having been moved to a new window.
     * Tracks the exact destination tab group so closing the auxiliary group
     * disposes this panel without relying on non-unique viewColumn values.
     */
    async markAsNewWindowPanel(plotId: string): Promise<void> {
        const panel = this._panels.get(plotId);
        if (!panel) {
            return;
        }

        if (this._newWindowPanels.has(plotId)) {
            panel.reveal(undefined, false);
            return;
        }

        const destinationGroup = await this._editorWindowMover.move(panel);
        if (this._panels.get(plotId) !== panel) {
            return;
        }

        this._newWindowPanels.add(plotId);
        this._newWindowPanelGroups.set(plotId, destinationGroup);

        this._outputChannel.debug(`Plot editor ${plotId} moved to new window`);
    }

    private _snapshotUri(plotId: string, sessionId: string): vscode.Uri | undefined {
        return this._storageUri && vscode.Uri.joinPath(this._storageUri, 'plot-editors',
            `${createHash('sha256').update(JSON.stringify([sessionId, plotId])).digest('hex')}.json`);
    }

    private _persistStaticSnapshot(plotId: string): void {
        const plot = this._plotsService?.getEditorInstance(plotId);
        if (!(plot instanceof StaticPlotClient)) { return; }
        const file = this._snapshotUri(plotId, plot.metadata.session_id);
        if (!file) { return; }
        const bytes = Buffer.from(JSON.stringify({ metadata: plot.metadata, mimeType: plot.mimeType, data: plot.data }));
        if (bytes.byteLength > MaxHtmlExportBytes) { return; }
        const previous = this._snapshotWrites.get(plotId) ?? Promise.resolve();
        const write = previous.catch(() => undefined).then(async () => {
            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this._storageUri!, 'plot-editors'));
            await vscode.workspace.fs.writeFile(file, bytes);
        }).catch(error => this._outputChannel.warn(`Failed to preserve plot editor: ${getErrorMessage(error)}`));
        this._snapshotWrites.set(plotId, write);
    }

    private async _restoreStaticSnapshot(plotId: string, sessionId: string): Promise<StaticPlotClient> {
        const file = this._snapshotUri(plotId, sessionId);
        if (!file || !this._plotsService || (await vscode.workspace.fs.stat(file)).size > MaxHtmlExportBytes) {
            throw new Error('Static plot snapshot is unavailable');
        }
        const snapshot = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf8')) as {
            metadata?: PlotMetadata; mimeType?: string; data?: string;
        };
        if (snapshot.metadata?.id !== plotId || snapshot.metadata.session_id !== sessionId ||
            typeof snapshot.mimeType !== 'string' || !snapshot.mimeType.startsWith('image/') || typeof snapshot.data !== 'string') {
            throw new Error('Invalid static plot snapshot');
        }
        return this._plotsService.restoreStaticEditorInstance(snapshot.metadata, snapshot.mimeType, snapshot.data);
    }

    async flushPersistedState(): Promise<void> {
        await Promise.all(this._snapshotWrites.values());
    }

    private _waitForEditorInstance(plotId: string, sessionId: string, panel: vscode.WebviewPanel): Promise<IPositronPlotClient> {
        const getPlot = () => {
            const plot = this._plotsService?.getEditorInstance(plotId) ?? this._plotsService?.getOrCreateEditorInstance(plotId);
            return plot?.metadata.session_id === sessionId ? plot : undefined;
        };
        const existing = getPlot();
        if (existing) { return Promise.resolve(existing); }
        return new Promise((resolve, reject) => {
            const subscriptions: vscode.Disposable[] = [];
            let settled = false;
            const cancel = () => finish(undefined, new vscode.CancellationError());
            const finish = (plot?: IPositronPlotClient, error?: Error) => {
                if (settled) { return; }
                settled = true;
                clearTimeout(timer);
                subscriptions.forEach(subscription => subscription.dispose());
                this._restoreWaiters.delete(cancel);
                if (plot) { resolve(plot); } else { reject(error); }
            };
            const timer = setTimeout(() => finish(undefined, new Error('Plot session did not reconnect')), 30_000);
            this._restoreWaiters.add(cancel);
            subscriptions.push(panel.onDidDispose(cancel));
            if (this._plotsService) {
                subscriptions.push(this._plotsService.onDidCreateEditorPlot(plot => {
                    if (plot.id === plotId && plot.metadata.session_id === sessionId) { finish(plot); }
                }));
                subscriptions.push(this._plotsService.onDidEmitPlot(() => {
                    const plot = getPlot();
                    if (plot) { finish(plot); }
                }));
            }
        });
    }

    private _bindPlotClient(plotId: string, panel: vscode.WebviewPanel): void {
        this._modelSubscriptions.get(plotId)?.forEach(subscription => subscription.dispose());
        const plot = this._plotsService?.getEditorInstance(plotId);
        const subscriptions: vscode.Disposable[] = [];
        this._modelSubscriptions.set(plotId, subscriptions);
        if (!plot) { return; }
        this._persistStaticSnapshot(plotId);
        const sendState = () => {
            this._persistStaticSnapshot(plotId);
            this._connections.get(plotId)?.sendNotification(RpcProtocol.PlotEditorStateNotification.type, {
                ...this._getSizingState(plotId),
                zoomLevel: isZoomablePlotClient(plot) ? plot.zoomLevel : undefined,
                state: plot instanceof PlotClientInstance ? plot.state : undefined,
                renderEstimateMs: plot instanceof PlotClientInstance ? plot.renderEstimateMs : undefined,
            });
        };
        if (isZoomablePlotClient(plot)) { subscriptions.push(plot.onDidChangeZoomLevel(sendState)); }
        if (plot instanceof PlotClientInstance) {
            subscriptions.push(
                plot.onDidCompleteRender(rendered => {
                    this._renderSerials.set(plotId, (this._renderSerials.get(plotId) ?? 0) + 1);
                    this._deliverImage(plotId, rendered.uri, mimeTypeFromDataUrl(rendered.uri));
                }),
                plot.onDidChangeSizingPolicy(sendState),
                plot.onDidSetIntrinsicSize(sendState),
                plot.onDidChangeState(sendState),
                plot.onDidClose(() => { if (!this._shuttingDown) { panel.dispose(); } }),
            );
            void plot.getIntrinsicSize().catch(error => this._outputChannel.debug(getErrorMessage(error)));
        }
    }

    private _deliverImage(plotId: string, data: string, mimeType: string): void {
        const previous = this._currentPlotContent.get(plotId);
        const version = (this._renderVersions.get(plotId) ?? 0) + (previous?.kind === 'image' && previous.data === data ? 0 : 1);
        this._renderVersions.set(plotId, version);
        this._currentPlotContent.set(plotId, { kind: 'image', data, mimeType });
        this._connections.get(plotId)?.sendNotification(RpcProtocol.PlotEditorRenderResultNotification.type, {
            data, mimeType, renderVersion: version,
        });
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
                const plot = this._plotsService?.getEditorInstance(plotId);
                if (plot instanceof PlotClientInstance) {
                    connection.sendNotification(RpcProtocol.PlotEditorStateNotification.type, {
                        state: plot.state,
                        renderEstimateMs: plot.renderEstimateMs,
                    });
                }
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
                this._keepProxyForExternalWindow?.(vscode.Uri.parse(content.uri));
                void vscode.env.openExternal(vscode.Uri.parse(content.uri));
            }
        });

        connection.onNotification(RpcProtocol.PlotEditorCloseNotification.type, () => {
            panel.dispose();
        });

        connection.onNotification(RpcProtocol.PlotEditorSelectZoomNotification.type, ({ zoomLevel }) => {
            const plot = this._plotsService?.getEditorInstance(plotId);
            if (isZoomablePlotClient(plot) && [0, 0.5, 0.75, 1, 2].includes(zoomLevel)) {
                plot.zoomLevel = zoomLevel as ZoomLevel;
            }
        });

        connection.onNotification(RpcProtocol.PlotEditorRenderNotification.type, (params) => {
            void this._handleRenderRequest(connection, plotId, params);
        });

        connection.onRequest(RpcProtocol.PlotEditorSelectSizingPolicyRequest.type, (params) => {
            const plot = this._plotsService?.getEditorInstance(plotId);
            if (!(plot instanceof PlotClientInstance) ||
                !this._getSizingState(plotId).sizingPolicies?.some(policy => policy.id === params.policyId)) {
                throw new Error('Sizing policy is not available for this plot.');
            }
            if (plot.sizingPolicy.id !== params.policyId) {
                this._plotsService!.setEditorSizingPolicy(plotId, params.policyId);
            }
            return { policyId: plot.sizingPolicy.id };
        });
    }

    private _getSizingState(plotId: string): Pick<RpcProtocol.PlotEditorSetContentNotification.Params,
        'sizingPolicies' | 'selectedSizingPolicyId'> {
        const plot = this._plotsService?.getEditorInstance(plotId);
        if (!(plot instanceof PlotClientInstance)) {
            return {};
        }
        const policies = this._plotsService!.sizingPolicies.filter(policy =>
            (policy.id !== 'intrinsic' || !!plot.intrinsicSize) && policy.id !== 'custom');
        // A frozen/custom policy can belong only to this editor instance.
        if (!policies.some(policy => policy.id === plot.sizingPolicy.id)) {
            policies.push(plot.sizingPolicy);
        }
        return {
            sizingPolicies: policies.map(policy => ({ id: policy.id, name: policy.getName(plot) })),
            selectedSizingPolicyId: plot.sizingPolicy.id,
        };
    }

    private _sendContent(plotId: string, content: PlotEditorContent): void {
        const lease = content.kind === 'html'
            ? this._retainProxyUri?.(vscode.Uri.parse(content.uri))
            : undefined;
        this._proxyLeases.get(plotId)?.dispose();
        this._proxyLeases.delete(plotId);
        if (lease) { this._proxyLeases.set(plotId, lease); }
        const connection = this._connections.get(plotId);
        if (!connection) {
            return;
        }
        connection.sendNotification(RpcProtocol.PlotEditorSetContentNotification.type, {
            ...content,
            plotId,
            sessionId: this._plotsService?.getEditorInstance(plotId)?.metadata.session_id,
            zoomLevel: (() => { const plot = this._plotsService?.getEditorInstance(plotId); return isZoomablePlotClient(plot) ? plot.zoomLevel : undefined; })(),
            renderVersion: this._renderVersions.get(plotId) ?? 0,
            staticSnapshot: this._plotsService?.getEditorInstance(plotId) instanceof StaticPlotClient && !!this._storageUri,
            ...(content.kind === 'image' ? this._getSizingState(plotId) : {}),
        });
    }

    private async _handleRenderRequest(
        connection: MessageConnection,
        plotId: string,
        message: RpcProtocol.PlotEditorRenderNotification.Params,
    ): Promise<void> {
        const width = Math.floor(message.width ?? 0);
        const height = Math.floor(message.height ?? 0);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            return;
        }

        const pixelRatio = Number.isFinite(message.pixelRatio) && message.pixelRatio > 0 ? message.pixelRatio : 1;
        const format = message.format === 'svg' ? PlotRenderFormat.Svg : PlotRenderFormat.Png;

        const serial = (this._renderSerials.get(plotId) ?? 0) + 1;
        this._renderSerials.set(plotId, serial);
        try {
            const rendered = await this._renderPlot(plotId, width, height, pixelRatio, format);
            if (!rendered?.data || this._connections.get(plotId) !== connection || this._renderSerials.get(plotId) !== serial) {
                return;
            }

            this._deliverImage(plotId, rendered.data, rendered.mimeType);
        } catch (error) {
            this._outputChannel.warn(`Failed to re-render plot ${plotId} in editor: ${getErrorMessage(error)}`);
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
            const plot = this._plotsService?.getEditorInstance(plotId) ??
                this._plotsService?.positronPlotInstances.find(candidate => candidate.id === plotId);
            const uri = plot instanceof PlotClientInstance
                ? await this._plotsService!.exportPlot(plotId, true)
                : content.kind === 'image'
                ? await savePlotImage(content.data, `plot-${plotId}`, plot?.metadata.suggested_file_name)
                : await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(`plot-${plotId.substring(0, 8)}.html`),
                    filters: {
                        'HTML Document': ['html', 'htm'],
                        'All Files': ['*'],
                    },
                });

            if (uri) {
                const bytes = content.kind === 'html' ? Buffer.from(
                    addHtmlBaseUri(
                        await this._readHtml(content.uri),
                        content.uri,
                    ),
                    'utf8',
                ) : undefined;
                if (bytes) {
                    await vscode.workspace.fs.writeFile(uri, bytes);
                }
                const message = vscode.l10n.t('Plot exported to {0}', uri.fsPath);
                this._sendStatus(plotId, message);
                void vscode.window.showInformationMessage(message);
            }
        } catch (e) {
            this._outputChannel.error(`Failed to save plot: ${getErrorMessage(e)}`);
            this._sendStatus(plotId, vscode.l10n.t('Failed to export plot: {0}', getErrorMessage(e)), true);
            vscode.window.showErrorMessage(`Failed to save plot: ${getErrorMessage(e)}`);
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
            this._outputChannel.error(`Failed to copy plot: ${getErrorMessage(e)}`);
            this._sendStatus(plotId, vscode.l10n.t('Failed to copy plot: {0}', getErrorMessage(e)), true);
            vscode.window.showErrorMessage(`Failed to copy plot: ${getErrorMessage(e)}`);
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
        const commonStyleUri = this._getWebviewUri(webview, 'webview', 'dist', 'common', 'index.css');
        const styleUri = this._getWebviewUri(webview, 'webview', 'dist', 'plotEditor', 'index.css');
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:; frame-src http: https: ${webview.cspSource};">
    <link href="${commonStyleUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>Plot Editor</title>
</head>
<body>
    <div id="app"></div>
    <script nonce="${nonce}">globalThis.__arkLocalization=${serializeWebviewLocalizationMessages()};</script>
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

    prepareForShutdown(): void {
        this._shuttingDown = true;
        for (const cancel of this._restoreWaiters) { cancel(); }
    }

    dispose(): void {
        for (const lease of this._proxyLeases.values()) { lease.dispose(); }
        this._proxyLeases.clear();
        for (const subscriptions of this._modelSubscriptions.values()) {
            subscriptions.forEach(subscription => subscription.dispose());
        }
        this._modelSubscriptions.clear();
        for (const cancel of this._restoreWaiters) { cancel(); }
        for (const panel of this._panels.values()) {
            if (!this._shuttingDown) { panel.dispose(); }
        }
        this._panels.clear();

        for (const connection of this._connections.values()) {
            connection.dispose();
        }
        this._connections.clear();

        this._currentPlotContent.clear();
        this._newWindowPanels.clear();
        this._newWindowPanelGroups.clear();

        for (const d of this._disposables) {
            d.dispose();
        }
    }
}
