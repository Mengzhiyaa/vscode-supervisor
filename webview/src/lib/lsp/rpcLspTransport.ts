import {
    AbstractMessageReader,
    AbstractMessageWriter,
    createMessageConnection,
    CancellationTokenSource,
    type CancellationToken,
    type DataCallback,
    type Disposable,
    type Message,
    type MessageConnection,
} from 'vscode-jsonrpc/browser';
import {
    isLspJsonRpcMessage,
    LSP_TUNNEL_MAX_MESSAGE_BYTES,
    LSP_TUNNEL_MAX_QUEUED_BYTES,
    type LspTunnelKey,
    type LspTunnelMessage,
} from '@shared/lspTunnel';

/** Cancellation must settle locally even when the remote peer ignores $/cancelRequest. */
export async function requestWithDeadline<T>(
    connection: MessageConnection,
    method: string,
    params: unknown,
    timeoutMs: number,
    token?: CancellationToken,
): Promise<T> {
    const source = new CancellationTokenSource();
    const external = token?.onCancellationRequested(() => source.cancel());
    let cancellation: Disposable | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
        cancellation = source.token.onCancellationRequested(() =>
            reject(new Error(`${method} cancelled or timed out`)),
        );
    });
    const timer = setTimeout(() => source.cancel(), timeoutMs);
    if (token?.isCancellationRequested) {
        source.cancel();
    }
    try {
        return await Promise.race([
            connection.sendRequest<T>(method, params, source.token),
            cancelled,
        ]);
    } finally {
        clearTimeout(timer);
        external?.dispose();
        cancellation?.dispose();
        source.dispose();
    }
}

class TunnelReader extends AbstractMessageReader {
    private callback: DataCallback | undefined;
    listen(callback: DataCallback): Disposable {
        this.callback = callback;
        return {
            dispose: () => {
                this.callback = undefined;
            },
        };
    }
    receive(message: Message): void {
        this.callback?.(message);
    }
    close(error?: Error): void {
        if (error) {
            this.fireError(error);
        }
        this.fireClose();
        this.callback = undefined;
    }
}

class TunnelWriter extends AbstractMessageWriter {
    constructor(private readonly send: (message: Message) => Promise<void>) {
        super();
    }
    async write(message: Message): Promise<void> {
        try {
            await this.send(message);
        } catch (error) {
            this.fireError(error, message);
            throw error;
        }
    }
    end(): void {
        this.fireClose();
    }
}

/** A complete inner JSON-RPC connection multiplexed over the outer Webview connection. */
export class RpcLspTransport {
    readonly connection: MessageConnection;
    private readonly reader = new TunnelReader();
    private readonly writer: TunnelWriter;
    private queue: Promise<void> = Promise.resolve();
    private queuedBytes = 0;
    private closed = false;

    constructor(
        private readonly outer: MessageConnection,
        readonly key: LspTunnelKey,
        private readonly onClosed: (error?: Error) => void,
    ) {
        this.writer = new TunnelWriter((message) => this.send(message));
        this.connection = createMessageConnection(this.reader, this.writer);
    }

    private send(message: Message): Promise<void> {
        if (this.closed || !isLspJsonRpcMessage(message)) {
            return Promise.reject(new Error('LSP transport is closed or message is invalid'));
        }
        const bytes = new TextEncoder().encode(JSON.stringify(message)).length;
        if (
            bytes > LSP_TUNNEL_MAX_MESSAGE_BYTES ||
            this.queuedBytes + bytes > LSP_TUNNEL_MAX_QUEUED_BYTES
        ) {
            this.close(new Error('LSP transport queue exceeded limit'));
            return Promise.reject(new Error('LSP transport queue exceeded limit'));
        }
        this.queuedBytes += bytes;
        const write = this.queue
            .then(async () => {
                if (this.closed) {
                    throw new Error('LSP transport is closed');
                }
                await requestWithDeadline(
                    this.outer,
                    'lspTunnel/send',
                    { ...this.key, message },
                    10_000,
                );
            })
            .finally(() => {
                this.queuedBytes -= bytes;
            });
        this.queue = write.catch((error) =>
            this.close(error instanceof Error ? error : new Error(String(error))),
        );
        return write;
    }

    receive(envelope: LspTunnelMessage): void {
        if (
            !this.closed &&
            envelope.tunnelId === this.key.tunnelId &&
            envelope.epoch === this.key.epoch &&
            isLspJsonRpcMessage(envelope.message)
        ) {
            this.reader.receive(envelope.message as Message);
        }
    }

    close(error?: Error): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.reader.close(error);
        this.connection.dispose();
        this.reader.dispose();
        this.writer.dispose();
        void requestWithDeadline(this.outer, 'lspTunnel/close', this.key, 5000).catch(() => {});
        this.onClosed(error);
    }
}
