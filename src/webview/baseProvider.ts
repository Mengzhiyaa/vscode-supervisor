import * as vscode from 'vscode';
import { createMessageConnection, MessageConnection } from 'vscode-jsonrpc';
import { WebviewMessageReader, WebviewMessageWriter } from '../rpc/webview/transport';

/**
 * Base class for webview providers with JSON-RPC support.
 * Provides common functionality for webview creation and RPC communication.
 */
export abstract class BaseWebviewProvider implements vscode.WebviewViewProvider {
    protected _view: vscode.WebviewView | undefined;
    protected _connection: MessageConnection | undefined;

    constructor(
        protected readonly _extensionUri: vscode.Uri,
        protected readonly _outputChannel: vscode.LogOutputChannel,
        private readonly _getAdditionalLocalResourceRoots: () => readonly vscode.Uri[] = () => []
    ) { }

    /**
     * Called when the webview view is resolved
     */
    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        // Configure webview options
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'webview', 'dist'),
                vscode.Uri.joinPath(this._extensionUri, 'resources'),
                ...this._getAdditionalLocalResourceRoots(),
            ]
        };

        // Set up JSON-RPC connection
        this._setupRpcConnection(webviewView.webview);

        // Set HTML content
        webviewView.webview.html = this._getHtmlContent(webviewView.webview);

        // Handle view disposal
        webviewView.onDidDispose(() => {
            this._connection?.dispose();
            this._connection = undefined;
            this._view = undefined;
        });

        this._outputChannel.debug(`[${this._providerName}] Webview resolved`);
    }

    /**
     * Sets up JSON-RPC connection over webview messaging
     */
    private _setupRpcConnection(webview: vscode.Webview): void {
        const reader = new WebviewMessageReader(webview);
        const writer = new WebviewMessageWriter(webview);

        this._connection = createMessageConnection(reader, writer);

        // Register RPC handlers
        this._registerRpcHandlers(this._connection);

        // Start listening
        this._connection.listen();

        this._outputChannel.debug(`[${this._providerName}] RPC connection established`);
    }

    /**
     * Registers RPC request and notification handlers.
     * Override in subclasses to add specific handlers.
     */
    protected abstract _registerRpcHandlers(connection: MessageConnection): void;

    /**
     * Returns the HTML content for the webview.
     * Override in subclasses to provide specific content.
     */
    protected abstract _getHtmlContent(webview: vscode.Webview): string;

    /**
     * Gets the name of this provider for logging
     */
    protected abstract get _providerName(): string;

    /**
     * Logs a message to the output channel.
     * Follows Positron's KallichoreSession.log() pattern:
     * - Truncates messages over 2048 characters
     * - Dispatches to appropriate log level method
     * 
     * @param msg The message to log
     * @param logLevel The log level (default: Info)
     */
    protected log(msg: string, logLevel?: vscode.LogLevel): void {
        // Ensure message isn't over the maximum length
        if (msg.length > 2048) {
            msg = msg.substring(0, 2048) + '... (truncated)';
        }

        const formattedMsg = `[${this._providerName}] ${msg}`;

        switch (logLevel) {
            case vscode.LogLevel.Error:
                this._outputChannel.error(formattedMsg);
                break;
            case vscode.LogLevel.Warning:
                this._outputChannel.warn(formattedMsg);
                break;
            case vscode.LogLevel.Info:
                this._outputChannel.info(formattedMsg);
                break;
            case vscode.LogLevel.Debug:
                this._outputChannel.debug(formattedMsg);
                break;
            case vscode.LogLevel.Trace:
                this._outputChannel.trace(formattedMsg);
                break;
            default:
                this._outputChannel.info(formattedMsg);
        }
    }

    /**
     * Logs an info message (convenience method)
     */
    protected _log(message: string): void {
        this.log(message, vscode.LogLevel.Info);
    }

    /**
     * Logs an error message (convenience method)
     */
    protected _logError(message: string): void {
        this.log(message, vscode.LogLevel.Error);
    }

    /**
     * Gets the webview view if available
     */
    get view(): vscode.WebviewView | undefined {
        return this._view;
    }

    /**
     * Gets the RPC connection if available
     */
    get connection(): MessageConnection | undefined {
        return this._connection;
    }

    /**
     * Generates a nonce for CSP
     */
    protected _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Gets the URI for a webview resource
     */
    protected _getWebviewUri(webview: vscode.Webview, ...pathSegments: string[]): vscode.Uri {
        return webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, ...pathSegments)
        );
    }

    protected _serializeInlineScriptData(value: unknown): string {
        return JSON.stringify(value).replace(/</g, '\\u003c');
    }
}
