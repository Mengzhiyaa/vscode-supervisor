/**
 * PlotsGalleryEditorProvider.ts
 * 
 * Provides a Plots Gallery view in a VS Code editor tab.
 * This reuses the existing plots webview component to display all plots in a gallery format.
 */

import * as vscode from 'vscode';
import { CoreCommandIds } from '../coreCommandIds';
import type { PlotsViewProvider } from '../webview/plotsProvider';
import { EditorWindowMover, findActivePanel } from './EditorWindowMover';

/**
 * Manages the Plots Gallery editor for viewing all plots in an editor tab.
 * Uses the same plots webview as the sidebar but in an editor context.
 */
export class PlotsGalleryEditorProvider implements vscode.Disposable {
    private _panel: vscode.WebviewPanel | undefined;
    private _secondaryPanels = new Set<vscode.WebviewPanel>();
    private _secondaryPanelGroups = new Map<vscode.WebviewPanel, vscode.TabGroup>();
    private _disposables: vscode.Disposable[] = [];
    private _panelRpcDisposables = new Map<vscode.WebviewPanel, vscode.Disposable>();

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _outputChannel: vscode.LogOutputChannel,
        private readonly _getPlotsProvider: () => PlotsViewProvider | undefined,
        private readonly _editorWindowMover: EditorWindowMover = new EditorWindowMover(),
    ) {
        this._disposables.push(vscode.window.tabGroups.onDidChangeTabGroups(event => {
            for (const [panel, group] of this._secondaryPanelGroups) {
                if (!event.closed.includes(group)) {
                    continue;
                }

                this._secondaryPanelGroups.delete(panel);
                setTimeout(() => {
                    if (this._secondaryPanels.has(panel)) {
                        panel.dispose();
                    }
                }, 0);
            }
        }));
    }

    /**
     * Opens the Plots Gallery in an editor tab.
     */
    async openGallery(options: { openInNewWindow?: boolean } = {}): Promise<void> {
        const { openInNewWindow = false } = options;

        if (!openInNewWindow) {
            // If panel already exists, reveal it
            if (this._panel) {
                this._panel.reveal(vscode.ViewColumn.Active, false);
                return;
            }
        }

        const targetPanel = this._createGalleryPanel(openInNewWindow);
        if (!targetPanel) {
            return;
        }

        if (openInNewWindow) {
            try {
                await this._movePanelToNewWindow(targetPanel);
            } catch (error) {
                targetPanel.dispose();
                throw error;
            }
        }
    }

    private _createGalleryPanel(useSecondaryStore: boolean): vscode.WebviewPanel | undefined {
        const panel = vscode.window.createWebviewPanel(
            'positronPlotsGallery',
            'Plots Gallery',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this._extensionUri, 'webview', 'dist'),
                    vscode.Uri.joinPath(this._extensionUri, 'resources')
                ]
            }
        );

        const plotsProvider = this._getPlotsProvider();
        if (!plotsProvider) {
            panel.dispose();
            vscode.window.showWarningMessage('Plots view is not ready yet. Please open Plots and try again.');
            return undefined;
        }

        const rpcDisposable = plotsProvider.createAuxWebviewConnection(
            panel.webview,
            () => panel.dispose(),
        );
        this._panelRpcDisposables.set(panel, rpcDisposable);

        // Set up the webview content (reuse the plots webview)
        panel.webview.html = this._getGalleryHtml(panel.webview);

        // Set icon
        panel.iconPath = {
            light: vscode.Uri.joinPath(this._extensionUri, 'resources', 'plot-light.svg'),
            dark: vscode.Uri.joinPath(this._extensionUri, 'resources', 'plot-dark.svg')
        };

        if (useSecondaryStore) {
            this._secondaryPanels.add(panel);
        } else {
            this._panel = panel;
        }

        // Handle panel disposal
        panel.onDidDispose(() => {
            const panelRpcDisposable = this._panelRpcDisposables.get(panel);
            panelRpcDisposable?.dispose();
            this._panelRpcDisposables.delete(panel);
            if (this._panel === panel) {
                this._panel = undefined;
            }
            this._secondaryPanels.delete(panel);
            this._secondaryPanelGroups.delete(panel);
            this._outputChannel.debug('Plots Gallery editor closed');
        }, null, this._disposables);

        this._outputChannel.debug('Plots Gallery editor opened');

        return panel;
    }

    /**
     * Gets the webview URI for a resource.
     */
    private _getWebviewUri(webview: vscode.Webview, ...pathSegments: string[]): vscode.Uri {
        return webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, ...pathSegments));
    }

    /**
     * Generates HTML content for the gallery editor.
     * This reuses the same plots webview components as the sidebar.
     */
    private _getGalleryHtml(webview: vscode.Webview): string {
        const scriptUri = this._getWebviewUri(webview, 'webview', 'dist', 'plots', 'index.js');
        const styleUri = this._getWebviewUri(webview, 'webview', 'dist', 'plots', 'index.css');
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:; frame-src http: https: ${webview.cspSource};">
    <link href="${styleUri}" rel="stylesheet">
    <title>Plots Gallery</title>
    <style>
        body {
            padding: 0;
            margin: 0;
            overflow: hidden;
        }
        #app {
            height: 100vh;
        }
        /* Gallery-specific styles */
        .positron-plots-container {
            background: var(--vscode-editor-background);
        }
    </style>
</head>
<body>
    <div id="app"></div>
    <script nonce="${nonce}">
        window.__ARK_PLOTS_GALLERY_EDITOR__ = true;
    </script>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Generates a nonce for CSP.
     */
    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Checks if the gallery is currently open.
     */
    get isOpen(): boolean {
        return this._panel !== undefined;
    }

    /**
     * Closes the currently active plots gallery panel, if any.
     * Returns true when a panel was closed.
     */
    closeActivePanel(): boolean {
        const activePanel = findActivePanel(this._secondaryPanels)
            ?? (this._panel?.active ? this._panel : undefined);
        if (activePanel) {
            activePanel.dispose();
            return true;
        }

        return false;
    }

    private async _movePanelToNewWindow(panel: vscode.WebviewPanel): Promise<void> {
        try {
            const destinationGroup = await this._editorWindowMover.move(panel);
            if (!this._secondaryPanels.has(panel)) {
                return;
            }
            this._secondaryPanelGroups.set(panel, destinationGroup);

            this._outputChannel.debug('Moved plots gallery to new window');
        } catch (error) {
            this._outputChannel.warn(`Failed to move plots gallery to new window: ${error}`);
            throw error;
        }
    }

    dispose(): void {
        this._panel?.dispose();
        this._panel = undefined;
        for (const panel of this._secondaryPanels) {
            panel.dispose();
        }
        this._secondaryPanels.clear();
        this._secondaryPanelGroups.clear();

        for (const disposable of this._panelRpcDisposables.values()) {
            disposable.dispose();
        }
        this._panelRpcDisposables.clear();

        for (const d of this._disposables) {
            d.dispose();
        }
    }
}

/**
 * Registers the Plots Gallery command.
 */
export function registerPlotsGalleryCommand(
    context: vscode.ExtensionContext,
    galleryProvider: PlotsGalleryEditorProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(CoreCommandIds.openPlotsGallery, (options?: { openInNewWindow?: boolean }) => {
            void galleryProvider.openGallery(options);
        })
    );
}
