import * as vscode from 'vscode';
import { MessageConnection } from 'vscode-jsonrpc';
import { ViewIds, WorkbenchViewContainerCommands } from '../coreCommandIds';
import { BaseWebviewProvider } from './baseProvider';
import * as ViewerProtocol from '../rpc/webview/viewer';
import { PositronPreviewService, PreviewItem } from '../services/preview';
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
    private _lastPreview: PreviewItem | undefined;

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
    }

    protected get _providerName(): string {
        return 'ViewerViewProvider';
    }

    private _subscribeToPreviewService(): void {
        this._previewService.onDidShowPreview(preview => {
            this._lastPreview = preview;

            // Push to history unless we're doing a back/forward navigate
            if (!this._navigating) {
                // Truncate forward history
                if (this._historyIndex < this._history.length - 1) {
                    this._history.splice(this._historyIndex + 1);
                }
                this._history.push({ preview });
                this._historyIndex = this._history.length - 1;
            }

            this._sendPreview(preview);
            this._sendNavState();
        });
    }

    protected _registerRpcHandlers(_connection: MessageConnection): void {
        // --- Navigation ---
        _connection.onNotification('viewer/navigate', (params: { url: string }) => {
            this.log(`[ViewerViewProvider] Navigate to: ${params.url}`);
            this._previewService.handleShowUrl(
                this._lastPreview?.sessionId ?? '',
                { url: params.url }
            );
        });

        _connection.onNotification('viewer/navigateBack', () => {
            if (this._historyIndex > 0) {
                this._historyIndex--;
                this._navigating = true;
                const entry = this._history[this._historyIndex];
                this._lastPreview = entry.preview;
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
            this._lastPreview = undefined;
            this._history = [];
            this._historyIndex = -1;
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
            const sessionId = this._lastPreview?.sessionId;
            if (!sessionId) {
                this.log('[ViewerViewProvider] Interrupt: no session ID in current preview');
                return;
            }
            const instance = this._consoleService?.getConsoleInstance(sessionId);
            if (instance) {
                try {
                    instance.interrupt();
                    this.log(`[ViewerViewProvider] Interrupted session ${sessionId} via console instance`);
                } catch (err) {
                    this.log(`[ViewerViewProvider] Interrupt via console instance failed: ${err}`, vscode.LogLevel.Warning);
                }
            } else {
                this.log(`[ViewerViewProvider] Interrupt: no console instance for session ${sessionId}`, vscode.LogLevel.Warning);
            }
        });

        // Send current preview if one exists
        if (this._lastPreview) {
            this._sendPreview(this._lastPreview);
            this._sendNavState();
        }
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
                await vscode.commands.executeCommand(WorkbenchViewContainerCommands.explorationSidebar);
            } catch (fallbackErr) {
                this.log(`Failed to reveal viewer container: ${fallbackErr}`, vscode.LogLevel.Warning);
            }
        } finally {
            await restoreFocus();
        }
    }

    private async _openPreviewInEditor(preview: PreviewItem): Promise<void> {
        const openedInSimpleBrowser = await this._openPreviewInSimpleBrowser(preview);
        if (openedInSimpleBrowser) {
            return;
        }

        try {
            await vscode.commands.executeCommand('vscode.open', preview.uri, {
                preview: false,
                preserveFocus: false,
                viewColumn: vscode.ViewColumn.Active,
            });
        } catch (error) {
            this.log(`Failed to open preview in editor: ${error}`, vscode.LogLevel.Warning);
        }
    }

    private async _openPreviewInNewWindow(preview: PreviewItem): Promise<void> {
        const openedInSimpleBrowser = await this._openPreviewInSimpleBrowser(preview);
        if (!openedInSimpleBrowser) {
            void vscode.window.showWarningMessage(
                'Viewer preview could not be opened in a new window because no editor-backed browser is available.'
            );
            return;
        }

        try {
            await this._waitForNextWorkbenchTurn();
            await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
        } catch (error) {
            this.log(`Failed to move preview to a new window: ${error}`, vscode.LogLevel.Warning);
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
}
