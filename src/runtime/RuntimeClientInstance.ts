/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    type LanguageRuntimeMessageCommData,
    type LanguageRuntimeMessageCommOpen,
    type LanguageRuntimeState,
    RuntimeClientState,
    RuntimeClientType,
    RuntimeOnlineState,
} from '../positronTypes';

/**
 * Output from a runtime client, containing data and optional buffers.
 * Matches Positron's RuntimeClientOutput interface.
 */
export interface RuntimeClientOutput<T = Record<string, unknown>> {
    data: T;
    buffers?: Uint8Array[];
}

interface PendingRpc {
    promise: DeferredPromise<RuntimeClientOutput<any>>;
    responseKeys: string[];
    completionGraceTimer?: ReturnType<typeof setTimeout>;
}

/**
 * A function that sends a message to the back end of a client instance.
 * Matches Positron's ExtHostClientMessageSender type.
 *
 * @param id The message ID. Can be used to correlate requests and responses.
 * @param data The message data.
 */
export type RuntimeClientMessageSender = (id: string, data: Record<string, unknown>) => void;

/**
 * A deferred promise that can be resolved or rejected externally.
 */
class DeferredPromise<T> {
    public readonly promise: Promise<T>;
    private _resolve!: (value: T) => void;
    private _reject!: (reason?: any) => void;
    private _isSettled = false;

    constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }

    get isSettled(): boolean {
        return this._isSettled;
    }

    complete(value: T): void {
        if (!this._isSettled) {
            this._isSettled = true;
            this._resolve(value);
        }
    }

    error(reason?: any): void {
        if (!this._isSettled) {
            this._isSettled = true;
            this._reject(reason);
        }
    }
}

/**
 * A client instance that communicates with the back end via a message channel.
 * 
 * This instance wraps a single comm (communication channel) and handles:
 * - State management (uninitialized, opening, connected, closing, closed)
 * - Message sending/receiving
 * - RPC request/response correlation
 * 
 * Matches Positron's ExtHostRuntimeClientInstance class.
 */
export class RuntimeClientInstance implements vscode.Disposable {
    // Emitter for client state changes
    private readonly _onDidChangeClientState = new vscode.EventEmitter<RuntimeClientState>();

    // Emitter for data sent from the back-end to the front end
    private readonly _onDidSendEvent = new vscode.EventEmitter<RuntimeClientOutput>();

    // The current client state
    private _state: RuntimeClientState;

    // The set of pending RPCs (messages awaiting a response from the back end)
    private _pendingRpcs = new Map<string, PendingRpc>();

    // A counter used to generate unique message IDs
    private _messageCounter = 0;

    /**
     * Event that fires when the client state changes.
     */
    readonly onDidChangeClientState = this._onDidChangeClientState.event;

    /**
     * Event that fires when the back end sends an event to the front end.
     * Note that RPC replies don't fire this event; they are returned as
     * promises from `performRpc`.
     */
    readonly onDidSendEvent = this._onDidSendEvent.event;

    /**
     * Creates a new client instance.
     *
     * @param message The `comm_open` message that opened the client instance.
     * @param sender A function that sends a message to the back end.
     * @param closer A function that closes the back end of the client instance.
     */
    constructor(
        readonly message: LanguageRuntimeMessageCommOpen,
        readonly sender: RuntimeClientMessageSender,
        readonly closer: () => void
    ) {
        // These instances are created when the runtime emits a `comm_open`
        // message, so they begin in the "connected" state -- the back end is
        // already open.
        this._state = RuntimeClientState.Connected;
        this.onDidChangeClientState((e) => {
            this._state = e;
        });
    }

    /**
     * Sends a message from the back end to the client instance.
     * Handles both RPC responses and regular events.
     *
     * @param message The message to emit to the client.
     */
    emitMessage(message: LanguageRuntimeMessageCommData): void {
        // Check to see if this is an RPC response.
        if (message.parent_id && this._pendingRpcs.has(message.parent_id)) {
            const pending = this._pendingRpcs.get(message.parent_id)!;
            const responseKeys = Object.keys((message.data ?? {}) as Record<string, unknown>);

            // If responseKeys were requested, only resolve when at least one matches.
            if (
                pending.responseKeys.length === 0 ||
                pending.responseKeys.some((key) => responseKeys.includes(key))
            ) {
                pending.promise.complete({
                    data: message.data as Record<string, unknown>,
                    buffers: message.buffers
                });
                this.deletePendingRpc(message.parent_id);
                return;
            }
        }

        // Not an RPC response, or didn't match response keys: treat as event.
        this._onDidSendEvent.fire({
            data: message.data as Record<string, unknown>,
            buffers: message.buffers
        });
    }

    /**
     * Sends a message to the back end.
     *
     * @param data The message data to send.
     */
    sendMessage(data: Record<string, unknown>): void {
        const id = `${this.getClientId()}-${this._messageCounter++}`;
        this.sender(id, data);
    }

    /**
     * Performs an RPC call to the back end with buffers in response.
     *
     * @param data The request data to send.
     * @param timeout Timeout in milliseconds (default: 10000)
     * @returns A promise that resolves with the response data and buffers.
     */
    performRpcWithBuffers<T>(
        data: Record<string, unknown>,
        timeout?: number,
        responseKeys: Array<string> = []
    ): Promise<RuntimeClientOutput<T>> {
        // Preserve caller-provided JSON-RPC ids (used by nested JSON-RPC request semantics).
        const requestId = (data as any)?.id;
        const id = (typeof requestId === 'string' || typeof requestId === 'number')
            ? `${requestId}`
            : `${this.getClientId()}-${this._messageCounter++}`;

        const rpc = new DeferredPromise<RuntimeClientOutput<T>>();
        this._pendingRpcs.set(id, {
            promise: rpc,
            responseKeys: [...responseKeys]
        });

        // If timeout is omitted, use the historical default (10s).
        // If timeout is explicitly undefined, disable timeout.
        const timeoutWasProvided = arguments.length >= 2;
        const effectiveTimeout = timeoutWasProvided ? timeout : 10000;
        if (typeof effectiveTimeout === 'number' && effectiveTimeout > 0) {
            setTimeout(() => {
                const pending = this._pendingRpcs.get(id);
                if (!pending || pending.promise.isSettled) {
                    return;
                }

                pending.promise.error(new Error('RPC timed out'));
                this.deletePendingRpc(id);
            }, effectiveTimeout);
        }

        // RuntimeClientInstance is transport-only; request payload is sent as-is.
        this.sender(id, data);
        return rpc.promise;
    }

    /**
     * Performs an RPC call to the back end.
     * 
     * This method is a convenience wrapper around `performRpcWithBuffers` that returns
     * only the data portion of the RPC response. Handles JSON-RPC 2.0 response format.
     *
     * @param data The request data to send.
     * @param timeout Timeout in milliseconds (default: 10000)
     * @returns A promise that resolves with the response data.
     */
    async performRpc<T>(
        data: Record<string, unknown>,
        timeout?: number,
        responseKeys: Array<string> = []
    ): Promise<T> {
        return (await this.performRpcWithBuffers<T>(data, timeout, responseKeys)).data;
    }

    updatePendingRpcState(message: LanguageRuntimeState): void {
        if (!message.parent_id || !this._pendingRpcs.has(message.parent_id)) {
            return;
        }

        const pending = this._pendingRpcs.get(message.parent_id)!;
        switch (message.state) {
            case RuntimeOnlineState.Busy:
                // Runtime resumed work; clear any completion grace timeout.
                if (pending.completionGraceTimer) {
                    clearTimeout(pending.completionGraceTimer);
                    pending.completionGraceTimer = undefined;
                }
                break;

            case RuntimeOnlineState.Idle:
                // If runtime reports idle for this RPC but response has not arrived,
                // wait briefly to tolerate late comm responses.
                if (pending.completionGraceTimer) {
                    return;
                }

                pending.completionGraceTimer = setTimeout(() => {
                    const maybePending = this._pendingRpcs.get(message.parent_id);
                    if (!maybePending || maybePending.promise.isSettled) {
                        return;
                    }

                    maybePending.promise.error(
                        new Error(`RPC request completed, but response not received after 5 seconds: ${JSON.stringify(message)}`)
                    );
                    this.deletePendingRpc(message.parent_id);
                }, 5000);
                break;

            case RuntimeOnlineState.Starting:
                break;
        }
    }

    /**
     * Gets the current state of the client instance.
     */
    getClientState(): RuntimeClientState {
        return this._state;
    }

    /**
     * Sets the state of the client instance.
     *
     * @param state The new state of the client.
     */
    setClientState(state: RuntimeClientState): void {
        this._onDidChangeClientState.fire(state);
    }

    /**
     * Gets the unique ID of this client instance (the comm_id).
     */
    getClientId(): string {
        return this.message.comm_id;
    }

    /**
     * Gets the type of this client instance (the target_name).
     */
    getClientType(): RuntimeClientType {
        return this.message.target_name as RuntimeClientType;
    }

    private deletePendingRpc(id: string): void {
        const pending = this._pendingRpcs.get(id);
        if (pending?.completionGraceTimer) {
            clearTimeout(pending.completionGraceTimer);
        }
        this._pendingRpcs.delete(id);
    }

    /**
     * Disposes the client instance, closing the connection if still open.
     */
    dispose(): void {
        // Cancel any pending RPCs
        for (const [id, pending] of this._pendingRpcs) {
            pending.promise.error(new Error(`Client '${this.getClientId()}' was disposed before RPC completed.`));
            this.deletePendingRpc(id);
        }

        // If the client is still connected, close it
        if (this._state === RuntimeClientState.Connected) {
            this._onDidChangeClientState.fire(RuntimeClientState.Closing);
            this._onDidChangeClientState.fire(RuntimeClientState.Closed);
            this.closer();
        }

        this._onDidChangeClientState.dispose();
        this._onDidSendEvent.dispose();
    }
}
