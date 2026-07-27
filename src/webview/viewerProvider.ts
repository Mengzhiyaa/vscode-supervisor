import * as vscode from 'vscode';
import { MessageConnection } from 'vscode-jsonrpc';
import { ViewIds, WorkbenchViewContainerCommands } from '../coreCommandIds';
import { BaseWebviewProvider } from './baseProvider';
import * as ViewerProtocol from '../rpc/webview/viewer';
import { PositronPreviewService, PreviewItem, type PreviewOpenTarget } from '../services/preview';
import { IPositronConsoleService } from '../services/console';

/**
 * Navigation history entry for the viewer.
 */
interface ViewerHistoryEntry {
    preview: PreviewItem;
}

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
    /** Flag to suppress pushing to history when navigating back/forward */
    private _navigating = false;

    constructor(
        extensionUri: vscode.Uri,
        outputChannel: vscode.LogOutputChannel,
        private readonly _previewService: PositronPreviewService,
        private readonly _consoleService?: IPositronConsoleService,
        getAdditionalLocalResourceRoots: () => readonly vscode.Uri[] = () => [],
    ) {
        super(extensionUri, outputChannel, getAdditionalLocalResourceRoots);
        this._subscribeToPreviewService();
        void this._previewService.restoreLastPreview?.().then(preview => {
            if (preview && !this._lastPreview) {
                this._acceptPreview(preview);
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
        await this.reveal(false);
        this._connection?.sendNotification(
            ViewerProtocol.ViewerFocusNotification.type,
            {},
        );
    }

    async find(): Promise<void> {
        await this.reveal(false);
        this._connection?.sendNotification(
            ViewerProtocol.ViewerFindNotification.type,
            {},
        );
    }

    private _subscribeToPreviewService(): void {
        this._disposables.push(
            this._previewService.onDidShowPreview(preview => this._acceptPreview(preview)),
            this._previewService.onDidChangePreviewInterruptState?.(() => {
                void this._sendInterruptState();
            }),
        );
    }

    private _acceptPreview(preview: PreviewItem): void {
        const replacesCurrentOutput = !!preview.outputId &&
            preview.outputId === this._lastPreview?.outputId &&
            preview.sessionId === this._lastPreview.sessionId;
        this._lastPreview = preview;

        if (replacesCurrentOutput && this._historyIndex >= 0) {
            this._history[this._historyIndex] = { preview };
        } else if (!this._navigating) {
            if (this._historyIndex < this._history.length - 1) {
                this._history.splice(this._historyIndex + 1);
            }
            this._history.push({ preview });
            this._historyIndex = this._history.length - 1;
        }

        this._attachPreviewSurface(preview);
        this._sendPreview(preview);
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
        _connection.onRequest('viewer/getDefaultOpenTarget', () => ({
            target: this._previewService.getDefaultOpenTarget(),
        }));
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
            params => this._navigate(params.url, params.title),
        );

        _connection.onNotification('viewer/navigateBack', () => {
            if (this._historyIndex > 0) {
                this._historyIndex--;
                this._navigating = true;
                const entry = this._history[this._historyIndex];
                this._lastPreview = entry.preview;
                this._attachPreviewSurface(entry.preview);
                this._sendPreview(entry.preview);
                this._sendNavState();
                this._navigating = false;
            }
        });

        _connection.onNotification('viewer/navigateForward', () => {
            if (this._historyIndex < this._history.length - 1) {
                this._historyIndex++;
                this._navigating = true;
                const entry = this._history[this._historyIndex];
                this._lastPreview = entry.preview;
                this._attachPreviewSurface(entry.preview);
                this._sendPreview(entry.preview);
                this._sendNavState();
                this._navigating = false;
            }
        });

        // --- Actions ---
        _connection.onNotification('viewer/reload', () => {
            if (this._lastPreview) {
                this._sendPreview(this._lastPreview);
            }
        });

        _connection.onNotification('viewer/clear', () => {
            this._surfaceAttachment?.dispose();
            this._surfaceAttachment = undefined;
            this._lastPreview = undefined;
            this._history = [];
            this._historyIndex = -1;
            this._sendInterruptStateNotification(false, false);
        });

        _connection.onNotification('viewer/openInBrowser', () => {
            if (this._lastPreview) {
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

        // Send current preview if one exists
        if (this._lastPreview) {
            this._attachPreviewSurface(this._lastPreview);
            this._sendPreview(this._lastPreview);
            this._sendNavState();
            void this._sendInterruptState();
        }
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

        try {
            const resolved = new URL(rawUrl, current.uri.toString(true));
            if (!['http:', 'https:'].includes(resolved.protocol)) {
                return;
            }
            const currentUrl = new URL(current.uri.toString(true));
            if (resolved.toString() === currentUrl.toString()) {
                return;
            }

            // Links inside a proxied page already point at the proxy origin.
            // Keep that URI and let the provider own the history rather than
            // accidentally wrapping the proxy in another proxy.
            if (resolved.origin === currentUrl.origin) {
                this._acceptPreview({
                    ...current,
                    uri: vscode.Uri.parse(resolved.toString()),
                    title: title || current.title,
                });
                return;
            }
        } catch (error) {
            this.log(`Ignored invalid Viewer navigation ${rawUrl}: ${error}`, vscode.LogLevel.Debug);
            return;
        }

        void this._previewService.handleShowUrl(current.sessionId, { url: rawUrl });
    }

    /** Sends the current navigation state (back/forward availability) to the webview. */
    private _sendNavState(): void {
        if (!this._connection) {
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
            if (!view.visible) {
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
        const openedInSimpleBrowser = await this._openPreviewInSimpleBrowser(preview);
        if (openedInSimpleBrowser) {
            return true;
        }

        try {
            await vscode.commands.executeCommand('vscode.open', preview.uri, {
                preview: false,
                preserveFocus: false,
                viewColumn: vscode.ViewColumn.Active,
            });
            return true;
        } catch (error) {
            this.log(`Failed to open preview in editor: ${error}`, vscode.LogLevel.Warning);
            return false;
        }
    }

    private async _openPreview(preview: PreviewItem, target: PreviewOpenTarget): Promise<boolean> {
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
        const openedInSimpleBrowser = await this._openPreviewInSimpleBrowser(preview);
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

    private async _openPreviewInSimpleBrowser(preview: PreviewItem): Promise<boolean> {
        try {
            await vscode.commands.executeCommand('simpleBrowser.api.open', preview.uri, {
                preserveFocus: false,
                viewColumn: vscode.ViewColumn.Active,
            });
            return true;
        } catch (error) {
            this.log(`simpleBrowser.api.open failed for ${preview.uri}: ${error}`, vscode.LogLevel.Debug);
        }

        try {
            await vscode.commands.executeCommand('simpleBrowser.show', preview.uri.toString(true));
            return true;
        } catch (error) {
            this.log(`simpleBrowser.show failed for ${preview.uri}: ${error}`, vscode.LogLevel.Debug);
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

    private _sendPreview(preview: PreviewItem): void {
        if (!this._connection) {
            return;
        }

        void this._revealViewerIfHidden(true);
        this._connection.sendNotification(ViewerProtocol.ViewerShowNotification.type, {
            url: preview.uri.toString(),
            title: preview.title,
            height: preview.height,
            sessionId: preview.sessionId,
            kind: preview.type
        });
    }

    protected override _onDidDisposeWebviewView(): void {
        this._surfaceAttachment?.dispose();
        this._surfaceAttachment = undefined;
    }

    dispose(): void {
        this._surfaceAttachment?.dispose();
        this._surfaceAttachment = undefined;
        this._disposables.forEach(disposable => disposable.dispose());
        this._connection?.dispose();
    }
}
