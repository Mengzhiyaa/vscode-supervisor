/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RuntimeClientInstance, RuntimeClientOutput } from '../RuntimeClientInstance';
import { RuntimeClientState } from '../../positronTypes';
import { createUniqueId } from '../../supervisor/util';

/**
 * An enum representing the set of JSON-RPC error codes.
 */
export enum JsonRpcErrorCode {
    ParseError = -32700,
    InvalidRequest = -32600,
    MethodNotFound = -32601,
    InvalidParams = -32602,
    InternalError = -32603,
    ServerErrorStart = -32000,
    ServerErrorEnd = -32099
}

/**
 * An error returned by a runtime method call.
 */
export interface PositronCommError {
    /** An error code */
    code: JsonRpcErrorCode;

    /** A human-readable error message */
    message: string;

    /**
     * A name for the error, for compatibility with the Error object.
     * Usually `RPC Error ${code}`.
     */
    name: string;

    /** Additional error information (optional) */
    data: any | undefined;
}

/**
 * RPC options for a specific method.
 */
export interface PositronCommRpcOptions {
    /**
     * Timeout in milliseconds after which to error if the server does not respond.
     * Defaults to 5 seconds. Undefined means no timeout.
     */
    timeout: number | undefined;
}

/**
 * Options for a PositronBaseComm.
 */
export type PositronCommOptions<T extends string> = {
    /** RPC options keyed by RPC name. */
    [key in T]?: PositronCommRpcOptions;
};

/**
 * An event emitter that can be used to fire events from the backend to the frontend.
 */
class PositronCommEmitter<T> extends vscode.EventEmitter<T> {
    /**
     * Create a new event emitter.
     *
     * @param name The name of the event, as a JSON-RPC method name.
     * @param properties The names of the properties in the event payload; used
     *   to convert positional parameters to named parameters.
     */
    constructor(
        readonly name: string,
        readonly properties: string[]
    ) {
        super();
    }
}

/**
 * A base class for Positron comm instances. This class handles communication
 * with the backend, and provides methods for creating event emitters and
 * performing RPCs.
 *
 * Matches Positron's PositronBaseComm pattern.
 */
export class PositronBaseComm implements vscode.Disposable {
    /**
     * A map of event names to emitters. This is used to create event emitters
     * from the backend to the frontend.
     */
    private _emitters = new Map<string, PositronCommEmitter<any>>();

    /**
     * An emitter for the close event.
     */
    private _closeEmitter = new vscode.EventEmitter<void>();

    /**
     * Disposables for cleanup.
     */
    private _disposables: vscode.Disposable[] = [];

    /**
     * Fires when the client is closed.
     */
    public readonly onDidClose: vscode.Event<void>;

    /**
     * The underlying client instance.
     */
    protected readonly clientInstance: RuntimeClientInstance;

    /**
     * Create a new Positron comm.
     *
     * @param clientInstance The client instance to use for communication with the backend.
     * @param options Optional RPC options.
     */
    constructor(
        clientInstance: RuntimeClientInstance,
        private readonly options?: PositronCommOptions<any>
    ) {
        this.clientInstance = clientInstance;
        this.onDidClose = this._closeEmitter.event;

        // Listen for data events from the client instance
        this._disposables.push(
            clientInstance.onDidSendEvent((event: RuntimeClientOutput) => {
                this._handleEvent(event.data);
            })
        );

        // Listen for client state changes
        this._disposables.push(
            clientInstance.onDidChangeClientState((state) => {
                if (state === RuntimeClientState.Closed) {
                    this._closeEmitter.fire();
                }
            })
        );
    }

    /**
     * Gets the ID of the client instance.
     */
    get clientId(): string {
        return this.clientInstance.getClientId();
    }

    /**
     * Handles incoming events from the client instance.
     * Routes them to the appropriate event emitter based on the 'method' field.
     */
    private _handleEvent(data: Record<string, unknown>): void {
        const method = data.method as string | undefined;
        if (!method) {
            return;
        }

        const emitter = this._emitters.get(method);
        if (emitter) {
            const payload = data.params;

            // JSON-RPC parameters can be specified either as an array or as
            // key/value pairs. If the payload is an array, convert it to
            // the object form.
            if (Array.isArray(payload)) {
                // Create the object from the array, converting positional
                // parameters to named parameters.
                const obj: any = {};
                for (let i = 0; i < payload.length; i++) {
                    obj[emitter.properties[i]] = payload[i];
                }
                emitter.fire(obj);
            } else if (typeof payload === 'object' && payload !== null) {
                // If the payload is already an object, just fire the event
                emitter.fire(payload);
            } else if (typeof payload === 'undefined') {
                // If the payload is undefined, fire the event with an empty object
                emitter.fire({});
            } else {
                // If the payload is some other kind of object, log a warning
                console.warn(
                    `Invalid payload type ${typeof payload} ` +
                    `for event '${method}' ` +
                    `on comm ${this.clientInstance.getClientId()}: ` +
                    `${JSON.stringify(payload)} ` +
                    `(Expected an object or an array)`
                );
            }
        } else if (method) {
            // If there are no emitters but an event type was defined,
            // this event will get dropped. This is normal for RPC responses.
            // Only log if it's not a response pattern (no result/error)
            if (!('result' in data) && !('error' in data)) {
                console.warn(
                    `Dropping event '${method}' ` +
                    `on comm ${this.clientInstance.getClientId()}: ` +
                    `${JSON.stringify(data.params)} ` +
                    `(No listeners for event '${method}')`
                );
            }
        }
    }

    /**
     * Create a new event emitter.
     *
     * @param name The name of the event, as a JSON-RPC method name.
     * @param properties The names of the properties in the event payload; used
     *   to convert positional parameters to named parameters.
     * @returns The event for consumers to subscribe to
     */
    protected createEventEmitter<T>(name: string, properties: string[]): vscode.Event<T> {
        const emitter = new PositronCommEmitter<T>(name, properties);
        this._emitters.set(name, emitter);
        this._disposables.push(emitter);
        return emitter.event;
    }

    /**
     * Perform an RPC and wait for the result.
     *
     * @param rpcName The name of the RPC to perform.
     * @param paramNames The parameter names
     * @param paramValues The parameter values
     * @returns A promise that resolves to the result of the RPC, or rejects
     *   with a PositronCommError.
     */
    protected async performRpc<T>(
        rpcName: string,
        paramNames: string[],
        paramValues: any[]
    ): Promise<T> {
        // Create the RPC arguments from the parameter names and values
        const rpcArgs: any = {};
        for (let i = 0; i < paramNames.length; i++) {
            rpcArgs[paramNames[i]] = paramValues[i];
        }

        // Generate a JSON-RPC request id.
        const id = createUniqueId();

        // Form the JSON-RPC request object.
        const request: any = {
            jsonrpc: '2.0',
            method: rpcName,
            id
        };

        // Amend params if we have any
        if (paramNames.length > 0) {
            request.params = rpcArgs;
        }

        // Check for explicitly set timeout in options, otherwise use the default
        const defaultTimeout = 5000; // 5 seconds
        const timeout = (this.options?.[rpcName] && 'timeout' in this.options[rpcName])
            ? this.options[rpcName].timeout
            : defaultTimeout;

        let response: any = {};
        try {
            // Wait for a response that includes either a result or an error.
            response = await this.clientInstance.performRpc<any>(request, timeout, ['result', 'error']);
        } catch (err: any) {
            // Convert the error to a comm error
            const error: PositronCommError = {
                code: JsonRpcErrorCode.InternalError,
                message: err.message || 'Unknown error',
                name: err.name || 'Error',
                data: err
            };
            throw error;
        }

        // JSON-RPC error response.
        if (Object.prototype.hasOwnProperty.call(response, 'error')) {
            const error = response.error as PositronCommError;
            error.name = `RPC Error ${error.code}`;
            throw error;
        }

        // JSON-RPC requires either result or error.
        if (!Object.prototype.hasOwnProperty.call(response, 'result')) {
            const error: PositronCommError = {
                code: JsonRpcErrorCode.InternalError,
                message: `Invalid response from ${this.clientInstance.getClientId()}: ` +
                    `no 'result' field. (response = ${JSON.stringify(response)})`,
                name: 'InvalidResponseError',
                data: {},
            };
            throw error;
        }

        return response.result as T;
    }

    /**
     * Disposes the comm and all associated resources.
     */
    dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._emitters.clear();
        this._closeEmitter.dispose();
    }
}
