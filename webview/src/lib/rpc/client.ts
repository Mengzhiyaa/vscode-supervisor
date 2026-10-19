import {
    createMessageConnection,
    type MessageConnection,
    type DataCallback,
    type Disposable,
    type Message,
    type MessageReader,
    type MessageWriter,
    type Event,
} from 'vscode-jsonrpc/browser';

// Acquire VS Code API
declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

type VsCodeApi = ReturnType<typeof acquireVsCodeApi>;

function getVsCodeApi(): VsCodeApi {
    if (globalThis.__arkVsCodeApi) {
        return globalThis.__arkVsCodeApi;
    }

    const api = acquireVsCodeApi();
    globalThis.__arkVsCodeApi = api;
    return api;
}

const vscode = getVsCodeApi();

// Helper to create a no-op event
function createNoopEvent<T>(): Event<T> {
    return (_listener: (e: T) => any, _thisArgs?: any, _disposables?: Disposable[]): Disposable => {
        return { dispose: () => {} };
    };
}

/**
 * MessageReader that reads JSON-RPC messages from the VS Code extension.
 * Used on the webview side.
 */
class VscodeMessageReader implements MessageReader {
    private _callback: DataCallback | null = null;
    private readonly _messageHandler: (event: MessageEvent) => void;

    // Event emitters (no-op since we don't close in webview)
    readonly onError: Event<Error> = createNoopEvent();
    readonly onClose: Event<void> = createNoopEvent();
    readonly onPartialMessage: Event<any> = createNoopEvent();

    constructor() {
        this._messageHandler = (event: MessageEvent) => {
            if (!this._isHostMessageSource(event)) {
                return;
            }
            const message = event.data;
            // Only process JSON-RPC messages
            if (this._isJsonRpcMessage(message) && this._callback) {
                this._callback(message as Message);
            }
        };
        window.addEventListener('message', this._messageHandler);
    }

    private _isHostMessageSource(event: MessageEvent): boolean {
        // The standalone harness dispatches source-less MessageEvents.
        if (event.source === null) {
            return true;
        }
        if (event.origin !== window.origin) {
            return false;
        }
        if (event.source === window || event.source === window.parent) {
            return true;
        }

        // VS Code masks window.parent as window, while its preload still sends
        // messages from the real parent. Identify that sender by frame ownership
        // rather than accepting all same-origin windows (including previews).
        try {
            const senderFrames = (event.source as Window).frames;
            for (let index = 0; index < senderFrames.length; index++) {
                if (senderFrames[index] === window) {
                    return true;
                }
            }
        } catch {
            // Non-window sources and inaccessible frames are not host senders.
        }
        return false;
    }

    private _isJsonRpcMessage(message: unknown): boolean {
        if (typeof message !== 'object' || message === null) {
            return false;
        }
        const msg = message as Record<string, unknown>;
        return msg.jsonrpc === '2.0';
    }

    listen(callback: DataCallback): Disposable {
        this._callback = callback;
        return {
            dispose: () => {
                this._callback = null;
            },
        };
    }

    dispose(): void {
        window.removeEventListener('message', this._messageHandler);
        this._callback = null;
    }
}

/**
 * MessageWriter that sends JSON-RPC messages to the VS Code extension.
 * Used on the webview side.
 */
class VscodeMessageWriter implements MessageWriter {
    // Event emitters (no-op since we don't close in webview)
    readonly onError: Event<[Error, Message | undefined, number | undefined]> = createNoopEvent();
    readonly onClose: Event<void> = createNoopEvent();

    async write(msg: Message): Promise<void> {
        // Deep clone the message to remove Svelte 5 reactive proxies
        // that cannot be cloned by postMessage's structured clone algorithm
        const clonedMsg = JSON.parse(JSON.stringify(msg));
        vscode.postMessage(clonedMsg);
    }

    end(): void {
        // No-op
    }

    dispose(): void {
        // No-op
    }
}

/**
 * Creates and returns a JSON-RPC connection to the VS Code extension.
 */
export function createRpcConnection(): MessageConnection {
    const reader = new VscodeMessageReader();
    const writer = new VscodeMessageWriter();
    const connection = createMessageConnection(reader, writer);
    connection.listen();
    return connection;
}

// Singleton connection instance
let _connection: MessageConnection | null = null;

/**
 * Gets the shared RPC connection instance.
 */
export function getRpcConnection(): MessageConnection {
    if (!_connection) {
        _connection = createRpcConnection();
    }
    return _connection;
}

/**
 * Gets the persisted webview state.
 * State survives webview being hidden/shown and even disposed/recreated.
 */
export function getVsCodeState<T = unknown>(): T | undefined {
    return vscode.getState() as T | undefined;
}

/**
 * Sets the persisted webview state.
 * State survives webview being hidden/shown and even disposed/recreated.
 */
export function setVsCodeState<T = unknown>(state: T): void {
    vscode.setState(state);
}
