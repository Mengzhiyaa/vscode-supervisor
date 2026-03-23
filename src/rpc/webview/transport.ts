import * as vscode from 'vscode';
import {
    AbstractMessageReader,
    AbstractMessageWriter,
    DataCallback,
    Disposable,
    Message,
    MessageReader,
    MessageWriter
} from 'vscode-jsonrpc';

/**
 * MessageReader implementation that reads JSON-RPC messages from a VS Code Webview.
 * Used on the extension side to receive messages from the webview.
 */
export class WebviewMessageReader extends AbstractMessageReader implements MessageReader {
    private _callback: DataCallback | null = null;
    private _disposable: vscode.Disposable | undefined;

    constructor(private readonly _webview: vscode.Webview) {
        super();

        // Listen for messages from the webview
        this._disposable = this._webview.onDidReceiveMessage((message: unknown) => {
            // Only process JSON-RPC messages
            if (this._isJsonRpcMessage(message) && this._callback) {
                this._callback(message as Message);
            }
        });
    }

    /**
     * Checks if a message is a valid JSON-RPC message
     */
    private _isJsonRpcMessage(message: unknown): boolean {
        if (typeof message !== 'object' || message === null) {
            return false;
        }
        const msg = message as Record<string, unknown>;
        return msg.jsonrpc === '2.0';
    }

    /**
     * Start listening for messages
     */
    listen(callback: DataCallback): Disposable {
        this._callback = callback;
        return {
            dispose: () => {
                this._callback = null;
            }
        };
    }

    /**
     * Dispose of the reader
     */
    dispose(): void {
        super.dispose();
        this._disposable?.dispose();
        this._callback = null;
    }
}

/**
 * MessageWriter implementation that sends JSON-RPC messages to a VS Code Webview.
 * Used on the extension side to send messages to the webview.
 */
export class WebviewMessageWriter extends AbstractMessageWriter implements MessageWriter {
    constructor(private readonly _webview: vscode.Webview) {
        super();
    }

    /**
     * Write a message to the webview
     */
    async write(msg: Message): Promise<void> {
        try {
            const success = await this._webview.postMessage(msg);
            if (!success) {
                this.fireError(new Error('Failed to post message to webview'), msg, undefined);
            }
        } catch (error) {
            this.fireError(error as Error, msg, undefined);
        }
    }

    /**
     * End the writer (no-op for webview)
     */
    end(): void {
        // No-op
    }
}
