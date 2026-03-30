import type { Page } from '@playwright/test';

type JsonRpcId = string | number | null;

interface JsonRpcError {
    code: number;
    message: string;
    data?: unknown;
}

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: JsonRpcId;
    method: string;
    params?: unknown;
}

interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: unknown;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: JsonRpcId;
    result?: unknown;
    error?: JsonRpcError;
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;
type RequestHandler = (request: JsonRpcRequest) => Promise<unknown> | unknown;
type NotificationHandler = (notification: JsonRpcNotification) => Promise<void> | void;

interface Waiter<TMessage extends JsonRpcRequest | JsonRpcNotification> {
    method: string;
    afterCount: number;
    resolve: (message: TMessage) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

function isJsonRpcMessage(message: unknown): message is JsonRpcMessage {
    return typeof message === 'object' && message !== null && (message as { jsonrpc?: unknown }).jsonrpc === '2.0';
}

function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
    return 'method' in message && 'id' in message;
}

function isNotification(message: JsonRpcMessage): message is JsonRpcNotification {
    return 'method' in message && !('id' in message);
}

export class MockWebviewBackend {
    private readonly _requestHandlers = new Map<string, RequestHandler>();
    private readonly _notificationHandlers = new Map<string, NotificationHandler>();
    private readonly _requestLog: JsonRpcRequest[] = [];
    private readonly _notificationLog: JsonRpcNotification[] = [];
    private readonly _requestWaiters = new Set<Waiter<JsonRpcRequest>>();
    private readonly _notificationWaiters = new Set<Waiter<JsonRpcNotification>>();
    private readonly _bindingName = `__arkSendToMockBackend_${Math.random().toString(16).slice(2)}`;

    private constructor(
        private readonly _page: Page,
    ) { }

    static async attach(page: Page, initialState: unknown = undefined): Promise<MockWebviewBackend> {
        const backend = new MockWebviewBackend(page);

        await page.exposeBinding(backend._bindingName, async (_source, message: unknown) => {
            await backend._handleOutgoingMessage(message);
        });

        await page.addInitScript(
            ({ bindingName, state }) => {
                let persistedState = state;
                const dispatch = (globalThis as Record<string, (message: unknown) => void>)[bindingName];

                const api = {
                    postMessage(message: unknown): void {
                        dispatch?.(message);
                    },
                    getState(): unknown {
                        return persistedState;
                    },
                    setState(nextState: unknown): void {
                        persistedState = nextState;
                    },
                };

                Object.defineProperty(globalThis, 'acquireVsCodeApi', {
                    configurable: true,
                    value: () => api,
                });

                (globalThis as typeof globalThis & {
                    __arkVsCodeApi?: typeof api;
                    __arkVsCodeTestHost?: {
                        getState: () => unknown;
                        setState: (nextState: unknown) => void;
                    };
                }).__arkVsCodeApi = api;

                (globalThis as typeof globalThis & {
                    __arkVsCodeTestHost?: {
                        getState: () => unknown;
                        setState: (nextState: unknown) => void;
                    };
                }).__arkVsCodeTestHost = {
                    getState: () => persistedState,
                    setState: (nextState: unknown) => {
                        persistedState = nextState;
                    },
                };
            },
            { bindingName: backend._bindingName, state: initialState },
        );

        return backend;
    }

    onRequest(method: string, handler: RequestHandler): void {
        this._requestHandlers.set(method, handler);
    }

    onNotification(method: string, handler: NotificationHandler): void {
        this._notificationHandlers.set(method, handler);
    }

    requestCount(method: string): number {
        return this._requestLog.filter((message) => message.method === method).length;
    }

    notificationCount(method: string): number {
        return this._notificationLog.filter((message) => message.method === method).length;
    }

    requests(method?: string): JsonRpcRequest[] {
        return method
            ? this._requestLog.filter((message) => message.method === method)
            : [...this._requestLog];
    }

    notifications(method?: string): JsonRpcNotification[] {
        return method
            ? this._notificationLog.filter((message) => message.method === method)
            : [...this._notificationLog];
    }

    async setState(state: unknown): Promise<void> {
        await this._page.evaluate((nextState) => {
            (globalThis as typeof globalThis & {
                __arkVsCodeTestHost?: {
                    setState: (value: unknown) => void;
                };
            }).__arkVsCodeTestHost?.setState(nextState);
        }, state);
    }

    async getState<T = unknown>(): Promise<T | undefined> {
        return this._page.evaluate(() => {
            return (globalThis as typeof globalThis & {
                __arkVsCodeTestHost?: {
                    getState: () => unknown;
                };
            }).__arkVsCodeTestHost?.getState() as T | undefined;
        });
    }

    async notify(method: string, params?: unknown): Promise<void> {
        await this._dispatchToPage({
            jsonrpc: '2.0',
            method,
            params,
        });
    }

    async respond(id: JsonRpcId, result?: unknown): Promise<void> {
        await this._dispatchToPage({
            jsonrpc: '2.0',
            id,
            result,
        });
    }

    async respondWithError(id: JsonRpcId, error: JsonRpcError): Promise<void> {
        await this._dispatchToPage({
            jsonrpc: '2.0',
            id,
            error,
        });
    }

    waitForNextRequest(method: string, timeoutMs = 5_000): Promise<JsonRpcRequest> {
        return this._waitForNext(this._requestWaiters, this.requestCount(method), method, timeoutMs);
    }

    waitForNextNotification(method: string, timeoutMs = 5_000): Promise<JsonRpcNotification> {
        return this._waitForNext(this._notificationWaiters, this.notificationCount(method), method, timeoutMs);
    }

    private _waitForNext<TMessage extends JsonRpcRequest | JsonRpcNotification>(
        waiters: Set<Waiter<TMessage>>,
        afterCount: number,
        method: string,
        timeoutMs: number,
    ): Promise<TMessage> {
        return new Promise<TMessage>((resolve, reject) => {
            const timeout = setTimeout(() => {
                waiters.delete(waiter);
                reject(new Error(`Timed out waiting for ${method}`));
            }, timeoutMs);

            const waiter: Waiter<TMessage> = {
                method,
                afterCount,
                resolve: (message) => {
                    clearTimeout(timeout);
                    waiters.delete(waiter);
                    resolve(message);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    waiters.delete(waiter);
                    reject(error);
                },
                timeout,
            };

            waiters.add(waiter);
        });
    }

    private async _dispatchToPage(message: JsonRpcMessage): Promise<void> {
        await this._page.evaluate((nextMessage) => {
            window.dispatchEvent(new MessageEvent('message', { data: nextMessage }));
        }, message);
    }

    private async _handleOutgoingMessage(message: unknown): Promise<void> {
        if (!isJsonRpcMessage(message)) {
            return;
        }

        if (isRequest(message)) {
            this._requestLog.push(message);
            this._resolveWaiters(this._requestWaiters, this._requestLog, message);

            const handler = this._requestHandlers.get(message.method);
            if (!handler) {
                await this.respond(message.id, undefined);
                return;
            }

            try {
                const result = await handler(message);
                await this.respond(message.id, result);
            } catch (error) {
                const messageText = error instanceof Error ? error.message : String(error);
                await this.respondWithError(message.id, {
                    code: -32000,
                    message: messageText,
                });
            }
            return;
        }

        if (isNotification(message)) {
            this._notificationLog.push(message);
            this._resolveWaiters(this._notificationWaiters, this._notificationLog, message);
            await this._notificationHandlers.get(message.method)?.(message);
        }
    }

    private _resolveWaiters<TMessage extends JsonRpcRequest | JsonRpcNotification>(
        waiters: Set<Waiter<TMessage>>,
        log: TMessage[],
        message: TMessage,
    ): void {
        const nextCount = log.filter((entry) => entry.method === message.method).length;
        for (const waiter of [...waiters]) {
            if (waiter.method === message.method && nextCount > waiter.afterCount) {
                waiter.resolve(message);
            }
        }
    }
}
