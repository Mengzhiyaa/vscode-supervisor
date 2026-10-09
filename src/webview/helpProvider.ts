import * as vscode from 'vscode';
import { MessageConnection } from 'vscode-jsonrpc/node';
import { BaseWebviewProvider } from './baseProvider';
import * as HelpProtocol from '../rpc/webview/help';
import { ViewCommands, WorkbenchViewContainerCommands } from '../coreCommandIds';
import { PositronHelpService, IHelpEntry } from '../services/help';

export class HelpViewProvider extends BaseWebviewProvider {
    private _currentEntryDisposable: vscode.Disposable | undefined;
    private readonly _disposables: vscode.Disposable[] = [];
    private _webviewReady = false;
    private _stateGeneration = 0;
    private readonly _pendingActions = new Set<'find' | 'focus'>();
    private readonly _entryIds = new WeakMap<IHelpEntry, string>();
    private _nextEntryId = 0;

    constructor(
        extensionUri: vscode.Uri,
        outputChannel: vscode.LogOutputChannel,
        private readonly _helpService: PositronHelpService,
        getAdditionalLocalResourceRoots: () => readonly vscode.Uri[] = () => [],
    ) {
        super(extensionUri, outputChannel, getAdditionalLocalResourceRoots);
        this._helpService.setHelpViewProvider(this);
        this._bindEntry(this._helpService.currentHelpEntry);

        this._disposables.push(
            this._helpService.onDidChangeCurrentHelpEntry(entry => {
                this._bindEntry(entry);
                void this._sendState();
            }),
            vscode.window.onDidChangeActiveColorTheme(() => {
                if (this._webviewReady) {
                    void this._connection?.sendNotification(HelpProtocol.HelpThemeChangedNotification.type, {});
                }
            }),
        );
    }

    protected get _providerName(): string {
        return 'HelpViewProvider';
    }

    async reveal(preserveFocus: boolean): Promise<void> {
        const view = this.view;
        if (view) {
            view.show(preserveFocus);
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
            await vscode.commands.executeCommand(ViewCommands.helpFocus);
        } catch (err) {
            this.log(`Failed to reveal help view: ${err}`, vscode.LogLevel.Warning);
            await vscode.commands.executeCommand(WorkbenchViewContainerCommands.help);
        } finally {
            await restoreFocus();
        }
    }

    getWelcomeUrl(): string | undefined {
        return 'help://welcome';
    }

    async find(): Promise<void> {
        this._pendingActions.add('find');
        await this.reveal(false);
        await this._sendState();
    }

    async focus(): Promise<void> {
        this._pendingActions.add('focus');
        await this.reveal(false);
        await this._sendState();
    }

    protected _registerRpcHandlers(connection: MessageConnection): void {
        this._webviewReady = false;
        this._stateGeneration++;
        connection.onNotification(HelpProtocol.HelpNavigateNotification.type, params => {
            if (!this._isCurrentEntry(params.entryId)) {
                return;
            }
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
            if (this._isCurrentEntry(params.entryId)) {
                this._helpService.updateCurrentEntryScroll(params.scrollX, params.scrollY);
            }
        });

        connection.onNotification(HelpProtocol.HelpCompleteNotification.type, params => {
            if (this._isCurrentEntry(params.entryId)) {
                this._helpService.updateCurrentEntryTitle(params.title);
            }
        });

        connection.onNotification(HelpProtocol.HelpStylesNotification.type, params => {
            this._helpService.setProxyServerStyles(params.styles);
            // The frontend sends styles only after installing all its listeners.
            // Use that handshake to replay state, including after a webview reload.
            this._webviewReady = true;
            if (!this._helpService.currentHelpEntry) {
                this._helpService.showWelcomePage();
            } else {
                void this._sendState();
            }
        });

        connection.onNotification(HelpProtocol.HelpExecuteCommandNotification.type, params => {
            void vscode.commands.executeCommand(params.command);
        });

        connection.onNotification(HelpProtocol.HelpCopySelectionNotification.type, params => {
            if (params.selection) {
                void vscode.env.clipboard.writeText(params.selection);
            }
        });

    }

    protected _getHtmlContent(webview: vscode.Webview): string {
        const scriptUri = this._getWebviewUri(webview, 'webview', 'dist', 'help', 'index.js');
        const commonStyleUri = this._getWebviewUri(webview, 'webview', 'dist', 'common', 'index.css');
        const styleUri = this._getWebviewUri(webview, 'webview', 'dist', 'help', 'index.css');
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:; frame-src http: https: ${webview.cspSource};">
    <link href="${commonStyleUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>Help</title>
</head>
<body>
    <div id="app"></div>
    ${this._getLocalizationInlineScript(nonce)}
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private _bindEntry(entry?: IHelpEntry): void {
        this._currentEntryDisposable?.dispose();
        this._currentEntryDisposable = undefined;

        if (entry) {
            this._currentEntryDisposable = entry.onDidChangeTitle(() => {
                void this._sendState();
            });
        }
    }

    private _getEntryId(entry: IHelpEntry): string {
        let id = this._entryIds.get(entry);
        if (!id) {
            id = `help-${++this._nextEntryId}`;
            this._entryIds.set(entry, id);
        }
        return id;
    }

    private _isCurrentEntry(entryId: string | undefined): boolean {
        const current = this._helpService.currentHelpEntry;
        return !!current && entryId === this._getEntryId(current);
    }

    private async _sendState(): Promise<void> {
        const generation = ++this._stateGeneration;
        const connection = this._connection;
        if (!connection || !this._webviewReady) {
            return;
        }

        const current = this._helpService.currentHelpEntry;
        try {
            if (current) {
                await this._helpService.resolveHelpEntrySource(current);
            }
            if (generation !== this._stateGeneration || connection !== this._connection) {
                return;
            }
            await this._publishState(connection);
            if (generation !== this._stateGeneration || connection !== this._connection) {
                return;
            }
            for (const action of this._pendingActions) {
                void connection.sendNotification(
                    action === 'find' ? HelpProtocol.HelpFindNotification.type : HelpProtocol.HelpFocusNotification.type,
                    {},
                );
            }
            this._pendingActions.clear();
        } catch (error) {
            this.log(`Failed to synchronize help view: ${error}`, vscode.LogLevel.Warning);
        }
    }

    private _publishState(connection: MessageConnection): Promise<void> {
        const current = this._helpService.currentHelpEntry;
        const history = this._helpService.helpEntries.map(entry => ({
            sourceUrl: entry.sourceUrl,
            targetUrl: entry.targetUrl,
            title: entry.title
        }));

        return connection.sendNotification(HelpProtocol.HelpStateNotification.type, {
            entry: current ? {
                entryId: this._getEntryId(current),
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

    protected override _onDidDisposeWebviewView(): void {
        this._webviewReady = false;
        this._stateGeneration++;
        this._pendingActions.clear();
    }

    dispose(): void {
        this._onDidDisposeWebviewView();
        this._currentEntryDisposable?.dispose();
        this._disposables.forEach(disposable => disposable.dispose());
        this._connection?.dispose();
        this._helpService.setHelpViewProvider(undefined);
    }
}
