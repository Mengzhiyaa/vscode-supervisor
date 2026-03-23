import * as vscode from 'vscode';
import { MessageConnection } from 'vscode-jsonrpc';
import { BaseWebviewProvider } from './baseProvider';
import * as HelpProtocol from '../rpc/webview/help';
import { ViewCommands } from '../coreCommandIds';
import { PositronHelpService, IHelpEntry } from '../services/help';

export class HelpViewProvider extends BaseWebviewProvider {
    private _currentEntryDisposable: vscode.Disposable | undefined;
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        extensionUri: vscode.Uri,
        outputChannel: vscode.LogOutputChannel,
        private readonly _helpService: PositronHelpService,
        getAdditionalLocalResourceRoots: () => readonly vscode.Uri[] = () => [],
    ) {
        super(extensionUri, outputChannel, getAdditionalLocalResourceRoots);
        this._helpService.setHelpViewProvider(this);
        this._bindEntry(this._helpService.currentHelpEntry);

        this._helpService.onDidChangeCurrentHelpEntry(entry => {
            this._bindEntry(entry);
            this._sendState();
        });
    }

    protected get _providerName(): string {
        return 'HelpViewProvider';
    }

    async reveal(preserveFocus: boolean): Promise<void> {
        const view = this.view;
        if (view) {
            view.show(preserveFocus);
            // Collapse Viewer when Help is revealed
            void vscode.commands.executeCommand(ViewCommands.viewerCollapse);
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
            // Show Help view - this will focus the Exploration sidebar
            await vscode.commands.executeCommand(ViewCommands.helpFocus);
            // Collapse Viewer when Help is revealed
            void vscode.commands.executeCommand(ViewCommands.viewerCollapse);
        } catch (err) {
            this.log(`Failed to reveal help view: ${err}`, vscode.LogLevel.Warning);
        } finally {
            await restoreFocus();
        }
    }

    getWelcomeUrl(): string | undefined {
        return 'help://welcome';
    }

    async find(): Promise<void> {
        await this.reveal(false);

        if (!this._connection) {
            this.log('Cannot show find widget: help webview connection is unavailable', vscode.LogLevel.Debug);
            return;
        }

        this._connection.sendNotification(HelpProtocol.HelpFindNotification.type, {});
    }

    protected _registerRpcHandlers(connection: MessageConnection): void {
        connection.onNotification(HelpProtocol.HelpNavigateNotification.type, params => {
            if (params.url.startsWith('command:')) {
                const command = params.url.substring('command:'.length);
                void vscode.commands.executeCommand(command);
                return;
            }
            const current = this._helpService.currentHelpEntry;
            if (current) {
                this._helpService.navigate(current.sourceUrl, params.url);
            }
        });

        connection.onNotification(HelpProtocol.HelpNavigateBackwardNotification.type, () => {
            this._helpService.navigateBackward();
        });

        connection.onNotification(HelpProtocol.HelpNavigateForwardNotification.type, () => {
            this._helpService.navigateForward();
        });

        connection.onNotification(HelpProtocol.HelpHistoryOpenNotification.type, params => {
            this._helpService.openHelpEntryIndex(params.index);
        });

        connection.onNotification(HelpProtocol.HelpShowWelcomeNotification.type, () => {
            this._helpService.showWelcomePage();
        });

        connection.onNotification(HelpProtocol.HelpScrollNotification.type, params => {
            this._helpService.updateCurrentEntryScroll(params.scrollX, params.scrollY);
        });

        connection.onNotification(HelpProtocol.HelpCompleteNotification.type, params => {
            this._helpService.updateCurrentEntryTitle(params.title);
        });

        connection.onNotification(HelpProtocol.HelpStylesNotification.type, params => {
            this._helpService.setProxyServerStyles(params.styles);
        });

        connection.onNotification(HelpProtocol.HelpExecuteCommandNotification.type, params => {
            void vscode.commands.executeCommand(params.command);
        });

        connection.onNotification(HelpProtocol.HelpCopySelectionNotification.type, params => {
            if (params.selection) {
                void vscode.env.clipboard.writeText(params.selection);
            }
        });

        // Send initial state once the connection is ready
        this._sendState();

        // Show welcome page if no entry yet
        if (!this._helpService.currentHelpEntry) {
            this._helpService.showWelcomePage();
        }

        // Listen for theme changes and notify webview to refresh styles
        this._disposables.push(
            vscode.window.onDidChangeActiveColorTheme(() => {
                this._connection?.sendNotification(HelpProtocol.HelpThemeChangedNotification.type, {});
            })
        );
    }

    protected _getHtmlContent(webview: vscode.Webview): string {
        const scriptUri = this._getWebviewUri(webview, 'webview', 'dist', 'help', 'index.js');
        const styleUri = this._getWebviewUri(webview, 'webview', 'dist', 'help', 'index.css');
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:; frame-src http: https: ${webview.cspSource};">
    <link href="${styleUri}" rel="stylesheet">
    <title>Help</title>
</head>
<body>
    <div id="app"></div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private _bindEntry(entry?: IHelpEntry): void {
        this._currentEntryDisposable?.dispose();
        this._currentEntryDisposable = undefined;

        if (entry) {
            this._currentEntryDisposable = entry.onDidChangeTitle(() => {
                this._sendState();
            });
        }
    }

    private _sendState(): void {
        if (!this._connection) {
            return;
        }

        const current = this._helpService.currentHelpEntry;
        const history = this._helpService.helpEntries.map(entry => ({
            sourceUrl: entry.sourceUrl,
            targetUrl: entry.targetUrl,
            title: entry.title
        }));

        this._connection.sendNotification(HelpProtocol.HelpStateNotification.type, {
            entry: current ? {
                sourceUrl: current.sourceUrl,
                targetUrl: current.targetUrl,
                title: current.title,
                scrollX: current.scrollX,
                scrollY: current.scrollY,
                isWelcome: current.sourceUrl === 'help://welcome'
            } : undefined,
            history,
            canNavigateBackward: this._helpService.canNavigateBackward,
            canNavigateForward: this._helpService.canNavigateForward
        });
    }
}
