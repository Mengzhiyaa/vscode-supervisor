import * as vscode from 'vscode';
import { MessageConnection } from 'vscode-jsonrpc/node';
import { ViewIds, WorkbenchViewContainerCommands } from '../coreCommandIds';
import { BaseWebviewProvider } from './baseProvider';
import * as ViewerProtocol from '../rpc/webview/viewer';
import { PositronPreviewService, PreviewItem, type PreviewOpenTarget } from '../services/preview';
import { IPositronConsoleService } from '../services/console';
import { openPreviewInEditor } from '../services/preview/previewEditor';

/**
 * Navigation history entry for the viewer.
 */
interface ViewerHistoryEntry {
    preview: PreviewItem;
    proxyLease?: vscode.Disposable;
    documentId?: string;
    navigationKey?: string;
}

const MaxViewerHistoryEntries = 50;

/**
 * Webview provider for the Viewer sidebar view.
 * Displays HTML/URL previews from the UI comm.
 */
export class ViewerViewProvider extends BaseWebviewProvider {
    private readonly _disposables: vscode.Disposable[] = [];
    private _lastPreview: PreviewItem | undefined;
    private _surfaceAttachment: vscode.Disposable | undefined;

    /** Navigation history stack */
    private _history: ViewerHistoryEntry[] = [];
    private _historyIndex = -1;
    private _activeDocumentId: string | undefined;
    private _restoreGeneration = 0;
    private _previewSendGeneration = 0;
    private _disposed = false;
    private _webviewReady = false;
    private _previewPublished = false;
    private readonly _pendingActions = new Set<'find' | 'focus'>();

    constructor(
        extensionUri: vscode.Uri,
        outputChannel: vscode.LogOutputChannel,
        private readonly _previewService: PositronPreviewService,
        private readonly _consoleService?: IPositronConsoleService,
        getAdditionalLocalResourceRoots: () => readonly vscode.Uri[] = () => [],
    ) {
        super(extensionUri, outputChannel, getAdditionalLocalResourceRoots);
        this._subscribeToPreviewService();
        const restoreGeneration = this._restoreGeneration;
        void this._previewService.restoreLastPreview?.().then(preview => {
            if (preview && !this._lastPreview && restoreGeneration === this._restoreGeneration && !this._disposed) {
                this._acceptPreview(preview, false);
            }
        }).catch(error => {
            this.log(`Failed to restore Viewer model: ${error}`, vscode.LogLevel.Warning);
        });
    }

    protected get _providerName(): string {
        return 'ViewerViewProvider';
    }

    async reveal(preserveFocus: boolean = false): Promise<void> {
        await this._revealViewerIfHidden(preserveFocus);
    }

    async focus(): Promise<void> {
        this._pendingActions.add('focus');
        await this.reveal(false);
        this._flushPendingActions();
    }

    async find(): Promise<void> {
        this._pendingActions.add('find');
        await this.reveal(false);
        this._flushPendingActions();
    }

    private _subscribeToPreviewService(): void {
        this._disposables.push(
            this._previewService.onDidShowPreview(preview => this._acceptPreview(preview)),
            this._previewService.onDidChangePreviewInterruptState?.(() => {
                void this._sendInterruptState();
            }),
        );
    }

    private _acceptPreview(
        preview: PreviewItem,
        reveal = true,
        navigation?: ViewerProtocol.ViewerDidNavigateNotification.Params,
        mode: 'load' | 'sync' = 'load',
    ): void {
        if (this._disposed) {
            return;
        }
        this._restoreGeneration++;
        const replacesCurrentOutput = !navigation && !!preview.outputId &&
            preview.outputId === this._lastPreview?.outputId &&
            preview.sessionId === this._lastPreview.sessionId;
        this._lastPreview = preview;
        this._previewPublished = false;

        // Opening the view must not depend on a connection to that view existing.
        if (reveal) {
            void this._revealViewerIfHidden(true);
        }

        const replacesHistory = replacesCurrentOutput || (navigation && navigation.navigationType !== 'push');
        const historyEntry: ViewerHistoryEntry = {
            preview,
            documentId: navigation?.documentId,
            navigationKey: navigation?.navigationKey,
            proxyLease: this._previewService.retainProxyUri?.(preview.uri),
        };
        if (replacesHistory && this._historyIndex >= 0) {
            this._history[this._historyIndex].proxyLease?.dispose();
            this._history[this._historyIndex] = historyEntry;
        } else {
            if (this._historyIndex < this._history.length - 1) {
                this._history.splice(this._historyIndex + 1).forEach(entry => entry.proxyLease?.dispose());
            }
            this._history.push(historyEntry);
            while (this._history.length > MaxViewerHistoryEntries) {
                this._history.shift()?.proxyLease?.dispose();
            }
            this._historyIndex = this._history.length - 1;
        }

        const entry = this._history[this._historyIndex];
        if (entry && entry.preview === preview) {
            entry.proxyLease ??= this._previewService.retainProxyUri?.(preview.uri);
        }

        this._attachPreviewSurface(preview);
        this._sendPreview(preview, mode);
        this._sendNavState();
        void this._sendInterruptState();
    }

    private _attachPreviewSurface(preview: PreviewItem): void {
        this._surfaceAttachment?.dispose();
        this._surfaceAttachment = this._previewService.attachPreview?.(
            preview,
            'viewer:main',
            undefined,
            'viewer-view-provider',
        );
    }

    protected _registerRpcHandlers(_connection: MessageConnection): void {
        this._webviewReady = false;
        this._previewPublished = false;
        this._previewSendGeneration++;
        _connection.onRequest('viewer/getDefaultOpenTarget', () => {
            // Sent after the frontend has installed its notification handlers.
            this._webviewReady = true;
            if (this._lastPreview) {
                this._attachPreviewSurface(this._lastPreview);
                this._sendPreview(this._lastPreview);
            } else {
                this._pendingActions.clear();
            }
            this._sendNavState();
            void this._sendInterruptState();
            return { target: this._previewService.getDefaultOpenTarget() };
        });
        _connection.onRequest('viewer/open', async (params: { target: PreviewOpenTarget }) => {
            if (!this._lastPreview) {
                return { success: false, error: vscode.l10n.t('No preview to open.') };
            }
            const success = await this._openPreview(this._lastPreview, params.target);
            if (success) {
                await this._previewService.setDefaultOpenTarget(params.target);
            }
            return success ? { success: true } : {
                success: false,
                error: vscode.l10n.t('The preview could not be opened in the selected location.'),
            };
        });
        // --- Navigation ---
        _connection.onNotification('viewer/navigate', (params: { url: string }) => {
            this.log(`[ViewerViewProvider] Navigate to: ${params.url}`);
            this._navigate(params.url);
        });

        _connection.onNotification(
            ViewerProtocol.ViewerDidNavigateNotification.type,
            params => this._didNavigate(params),
        );

        _connection.onNotification('viewer/navigateBack', () => {
            this._goToHistory(this._historyIndex - 1);
        });

        _connection.onNotification('viewer/navigateForward', () => {
            this._goToHistory(this._historyIndex + 1);
        });

        // --- Actions ---
        _connection.onNotification('viewer/reload', () => {
            if (this._lastPreview) {
                this._sendPreview(this._lastPreview);
            }
        });

        _connection.onNotification('viewer/clear', () => {
            this._restoreGeneration++;
            this._activeDocumentId = undefined;
            this._previewService.clearViewer();
            this._previewSendGeneration++;
            this._previewPublished = false;
            this._pendingActions.clear();
            this._surfaceAttachment?.dispose();
            this._surfaceAttachment = undefined;
            this._lastPreview = undefined;
            this._history.forEach(entry => entry.proxyLease?.dispose());
            this._history = [];
            this._historyIndex = -1;
            this._sendInterruptStateNotification(false, false);
            this._sendNavState();
        });

        _connection.onNotification('viewer/openInBrowser', () => {
            if (this._lastPreview) {
                this._previewService.keepProxyForExternalWindow?.(this._lastPreview.uri);
                void vscode.env.openExternal(this._lastPreview.uri);
            }
        });

        _connection.onNotification('viewer/openInEditor', () => {
            if (this._lastPreview) {
                void this._openPreviewInEditor(this._lastPreview);
            }
        });

        _connection.onNotification('viewer/openInNewWindow', () => {
            if (this._lastPreview) {
                void this._openPreviewInNewWindow(this._lastPreview);
            }
        });

        _connection.onNotification('viewer/interrupt', async () => {
            const preview = this._lastPreview;
            const sessionId = preview?.sessionId;
            if (!preview) {
                this.log('[ViewerViewProvider] Interrupt: no current preview');
                return;
            }

            this._sendInterruptStateNotification(true, true);
            if (typeof this._previewService.interruptPreview !== 'function') {
                const instance = sessionId
                    ? this._consoleService?.getConsoleInstance(sessionId)
                    : undefined;
                instance?.interrupt();
                void this._sendInterruptState();
                return;
            }
            try {
                try {
                    if (await this._previewService.interruptPreview(preview)) {
                        this.log(
                            `[ViewerViewProvider] Interrupted source for Viewer model ${preview.modelId ?? '<legacy>'}`,
                        );
                        return;
                    }
                    this.log(
                        `[ViewerViewProvider] Interrupt is unsupported for Viewer source ${preview.modelId ?? '<legacy>'}`,
                        vscode.LogLevel.Warning,
                    );
                    return;
                } catch (err) {
                    this.log(`[ViewerViewProvider] Source interrupt failed: ${err}`, vscode.LogLevel.Warning);
                    return;
                }
            } finally {
                void this._sendInterruptState();
            }
        });

    }

    private async _sendInterruptState(): Promise<void> {
        const preview = this._lastPreview;
        if (!preview) {
            this._sendInterruptStateNotification(false, false);
            return;
        }
        try {
            const state = typeof this._previewService.getPreviewInterruptState === 'function'
                ? await this._previewService.getPreviewInterruptState(preview)
                : {
                    interruptible: typeof this._previewService.isPreviewInterruptible === 'function'
                        ? await this._previewService.isPreviewInterruptible(preview)
                        : Boolean(preview.sessionId && this._consoleService?.getConsoleInstance(preview.sessionId)),
                    interrupting: false,
                };
            if (preview === this._lastPreview) {
                this._sendInterruptStateNotification(state.interruptible, state.interrupting);
            }
        } catch (error) {
            this.log(`[ViewerViewProvider] Failed to resolve interrupt state: ${error}`, vscode.LogLevel.Warning);
            if (preview === this._lastPreview) {
                this._sendInterruptStateNotification(false, false);
            }
        }
    }

    private _sendInterruptStateNotification(interruptible: boolean, interrupting: boolean): void {
        if (!this._webviewReady) {
            return;
        }
        this._connection?.sendNotification(
            ViewerProtocol.ViewerUpdateInterruptStateNotification.type,
            { interruptible, interrupting },
        );
    }

    private _navigate(rawUrl: string, title?: string): void {
        const current = this._lastPreview;
        if (!current) {
            return;
        }

        let targetUrl: string;
        try {
            const resolved = new URL(rawUrl, current.uri.toString(true));
            targetUrl = resolved.toString();
            if (!['http:', 'https:'].includes(resolved.protocol)) {
                return;
            }
            const currentUrl = new URL(current.uri.toString(true));
            if (resolved.toString() === currentUrl.toString()) {
                this._sendPreview(current);
                return;
            }

            // Links inside a proxied page already point at the proxy origin.
            // Keep that URI and let the provider own the history rather than
            // accidentally wrapping the proxy in another proxy.
            if (resolved.origin === currentUrl.origin) {
                this._acceptPreview({
                    ...current,
                    uri: vscode.Uri.parse(resolved.toString()),
                    restoreUri: this._previewService.getProxySourceUri?.(vscode.Uri.parse(resolved.toString()))
                        ?? current.restoreUri,
                    title: title || current.title,
                }, true, { url: resolved.toString(), navigationType: 'push' });
                return;
            }
        } catch (error) {
            this.log(`Ignored invalid Viewer navigation ${rawUrl}: ${error}`, vscode.LogLevel.Debug);
            return;
        }

        void this._previewService.handleShowUrl(current.sessionId, {
            url: targetUrl,
            source: current.sourceIdentity,
        }).catch(error => this.log(`Failed to navigate Viewer: ${error}`, vscode.LogLevel.Warning));
    }

    private _didNavigate(params: ViewerProtocol.ViewerDidNavigateNotification.Params): void {
        const current = this._lastPreview;
        if (!current) return;
        const navigationType = params.navigationType ?? 'load';
        if (navigationType !== 'load' && params.documentId !== this._activeDocumentId) return;
        try {
            const url = new URL(params.url);
            if (!['http:', 'https:'].includes(url.protocol)) return;
            if (url.origin !== new URL(current.uri.toString(true)).origin) return;
            this._activeDocumentId = params.documentId;
            if (navigationType === 'traverse') {
                const index = this._history.findIndex(entry =>
                    entry.documentId === params.documentId &&
                    (params.navigationKey ? entry.navigationKey === params.navigationKey :
                        entry.preview.uri.toString(true) === url.toString()),
                );
                if (index >= 0) this._historyIndex = index;
            }
            const uri = vscode.Uri.parse(url.toString());
            this._acceptPreview({
                ...current,
                uri,
                restoreUri: this._previewService.getProxySourceUri?.(uri) ?? current.restoreUri,
                title: params.title || current.title,
            }, false, { ...params, navigationType }, 'sync');
        } catch (error) {
            this.log(`Ignored invalid Viewer location: ${error}`, vscode.LogLevel.Debug);
        }
    }

    private _goToHistory(index: number): void {
        if (index < 0 || index >= this._history.length) return;
        this._historyIndex = index;
        const entry = this._history[index];
        this._lastPreview = entry.preview;
        this._attachPreviewSurface(entry.preview);
        const canTraverse = entry.documentId && entry.documentId === this._activeDocumentId && entry.navigationKey;
        this._sendPreview(entry.preview, canTraverse ? 'traverse' : 'load');
        this._sendNavState();
        void this._sendInterruptState();
    }

    /** Sends the current navigation state (back/forward availability) to the webview. */
    private _sendNavState(): void {
        if (!this._connection || !this._webviewReady) {
            return;
        }
        this._connection.sendNotification('viewer/updateNavState', {
            canNavigateBack: this._historyIndex > 0,
            canNavigateForward: this._historyIndex < this._history.length - 1,
        });
    }

    protected _getHtmlContent(webview: vscode.Webview): string {
        const scriptUri = this._getWebviewUri(webview, 'webview', 'dist', 'viewer', 'index.js');
        const styleUri = this._getWebviewUri(webview, 'webview', 'dist', 'viewer', 'index.css');
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:; frame-src http: https: ${webview.cspSource};">
    <link href="${styleUri}" rel="stylesheet">
    <title>Viewer</title>
</head>
<body>
    <div id="app"></div>
    ${this._getLocalizationInlineScript(nonce)}
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private async _revealViewerIfHidden(preserveFocus: boolean): Promise<void> {
        const view = this.view;
        if (view) {
            if (!view.visible || !preserveFocus) {
                view.show(preserveFocus);
            }
            return;
        }

        const editorToRestore = preserveFocus ? vscode.window.activeTextEditor : undefined;
        const restoreFocus = async (): Promise<void> => {
            if (!editorToRestore) {
                return;
            }
            await vscode.window.showTextDocument(editorToRestore.document, {
                viewColumn: editorToRestore.viewColumn,
                preserveFocus: false
            });
        };

        try {
            await vscode.commands.executeCommand('workbench.views.action.showView', ViewIds.viewer);
        } catch (err) {
            this.log(`Failed to reveal viewer view: ${err}`, vscode.LogLevel.Warning);
            try {
                await vscode.commands.executeCommand(WorkbenchViewContainerCommands.viewer);
            } catch (fallbackErr) {
                this.log(`Failed to reveal viewer container: ${fallbackErr}`, vscode.LogLevel.Warning);
            }
        } finally {
            await restoreFocus();
        }
    }

    private async _openPreviewInEditor(preview: PreviewItem): Promise<boolean> {
        this._previewService.keepProxyForExternalWindow?.(preview.uri);
        return openPreviewInEditor(preview.uri, this._outputChannel);
    }

    private async _openPreview(preview: PreviewItem, target: PreviewOpenTarget): Promise<boolean> {
        this._previewService.keepProxyForExternalWindow?.(preview.uri);
        try {
            if (target === 'browser') {
                return await vscode.env.openExternal(preview.uri);
            }
            if (target === 'newWindow') {
                return await this._openPreviewInNewWindow(preview);
            } else {
                return await this._openPreviewInEditor(preview);
            }
        } catch (error) {
            this.log(`Failed to open preview in ${target}: ${error}`, vscode.LogLevel.Warning);
            return false;
        }
    }

    private async _openPreviewInNewWindow(preview: PreviewItem): Promise<boolean> {
        const openedInSimpleBrowser = await this._openPreviewInEditor(preview);
        if (!openedInSimpleBrowser) {
            void vscode.window.showWarningMessage(
                'Viewer preview could not be opened in a new window because no editor-backed browser is available.'
            );
            return false;
        }

        try {
            await this._waitForNextWorkbenchTurn();
            await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
            return true;
        } catch (error) {
            this.log(`Failed to move preview to a new window: ${error}`, vscode.LogLevel.Warning);
            return false;
        }
    }

    private async _waitForNextWorkbenchTurn(): Promise<void> {
        await new Promise<void>(resolve => {
            if (typeof queueMicrotask === 'function') {
                queueMicrotask(resolve);
            } else {
                setTimeout(resolve, 0);
            }
        });
    }

    private _sendPreview(preview: PreviewItem, mode: 'load' | 'sync' | 'traverse' = 'load'): void {
        if (!this._connection || !this._webviewReady) {
            return;
        }

        const generation = ++this._previewSendGeneration;
        this._previewPublished = false;
        const entry = this._history.find(candidate => candidate.preview === preview);
        if (mode === 'load' && entry && !entry.proxyLease && this._previewService.refreshPreviewUri) {
            void this._previewService.refreshPreviewUri(preview).then(uri => {
                if (!this._connection || generation !== this._previewSendGeneration) {
                    return;
                }
                preview.uri = uri;
                entry.proxyLease = this._previewService.retainProxyUri(uri);
                this._publishPreviewToWebview(preview, generation, mode);
            }).catch(error => this.log(`Failed to restore preview: ${error}`, vscode.LogLevel.Warning));
            return;
        }
        this._publishPreviewToWebview(preview, generation, mode);
    }

    private _publishPreviewToWebview(preview: PreviewItem, generation: number, mode: 'load' | 'sync' | 'traverse'): void {
        const connection = this._connection;
        if (!connection || !this._webviewReady) {
            return;
        }
        const entry = this._history[this._historyIndex];
        if (mode === 'load') this._activeDocumentId = undefined;
        void connection.sendNotification(ViewerProtocol.ViewerShowNotification.type, {
            mode,
            documentId: entry?.documentId,
            navigationKey: entry?.navigationKey,
            url: preview.uri.toString(),
            title: preview.title,
            height: preview.height,
            sessionId: preview.sessionId,
            kind: preview.type
        }).then(() => {
            if (generation !== this._previewSendGeneration || connection !== this._connection) {
                return;
            }
            this._previewPublished = true;
            this._flushPendingActions();
            void this._sendInterruptState();
        }).catch(error => this.log(`Failed to publish preview: ${error}`, vscode.LogLevel.Warning));
    }

    private _flushPendingActions(): void {
        if (!this._connection || !this._webviewReady || !this._previewPublished) {
            return;
        }
        for (const action of this._pendingActions) {
            void this._connection.sendNotification(
                action === 'find' ? ViewerProtocol.ViewerFindNotification.type : ViewerProtocol.ViewerFocusNotification.type,
                {},
            );
        }
        this._pendingActions.clear();
    }

    protected override _onDidDisposeWebviewView(): void {
        this._activeDocumentId = undefined;
        this._webviewReady = false;
        this._previewPublished = false;
        this._pendingActions.clear();
        this._previewSendGeneration++;
        this._history.forEach(entry => {
            entry.proxyLease?.dispose();
            entry.proxyLease = undefined;
        });
        this._surfaceAttachment?.dispose();
        this._surfaceAttachment = undefined;
    }

    dispose(): void {
        this._disposed = true;
        this._webviewReady = false;
        this._pendingActions.clear();
        this._previewSendGeneration++;
        this._history.forEach(entry => entry.proxyLease?.dispose());
        this._history = [];
        this._surfaceAttachment?.dispose();
        this._surfaceAttachment = undefined;
        this._disposables.forEach(disposable => disposable.dispose());
        this._connection?.dispose();
    }
}
