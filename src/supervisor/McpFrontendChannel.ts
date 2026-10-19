/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *  Adapted from Positron's MCP frontend for the standalone extension.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import WebSocket from 'ws';
import { McpClient } from './kcclient/api';
import { createWebSocket } from './NamedPipeHttpAgent';
import * as positron from './positron';

/** Carries window ownership and focus over Kallichore's authenticated channel. */
export class McpFrontendChannel implements vscode.Disposable {
    private _socket?: WebSocket;
    private _timer?: ReturnType<typeof setTimeout>;
    private _delay = 1000;
    private _disposed = false;
    private _ready = false;
    private readonly _disposables: vscode.Disposable[];

    constructor(
        private readonly _uri: string,
        private readonly _headers: Record<string, string>,
        private readonly _sessionIds: () => string[],
        private readonly _clientsChanged: (clients: McpClient[]) => void,
        private readonly _log: (message: string) => void,
    ) {
        this._disposables = [
            positron.runtime.onDidChangeForegroundSession(() => {
                void this.sendForeground();
            }),
            vscode.window.onDidChangeWindowState((state) => {
                if (state.focused) {
                    this.send({ kind: 'focused' });
                }
            }),
        ];
        this.connect();
    }

    public sessionsChanged(): void {
        this.send({ kind: 'sessions_changed', session_ids: this._sessionIds() });
        void this.sendForeground();
    }

    private async sendForeground(): Promise<void> {
        const socket = this._socket;
        const id = await this.foregroundId();
        if (this._socket === socket) {
            this.send({
                kind: 'foreground_changed',
                session_id: id && this._sessionIds().includes(id) ? id : null,
            });
        }
    }

    private async foregroundId(): Promise<string | undefined> {
        try {
            return (await positron.runtime.getForegroundSession())?.metadata.sessionId;
        } catch {
            return undefined;
        }
    }

    private connect(): void {
        if (this._disposed) {
            return;
        }
        try {
            const socket = createWebSocket(this._uri, undefined, { headers: this._headers });
            this._socket = socket;
            socket.on('open', () => {
                void this.sayHello(socket);
            });
            socket.on('message', (data) => {
                if (this._socket !== socket) {
                    return;
                }
                try {
                    const message = JSON.parse(data.toString());
                    if (message?.kind === 'clients_changed' && Array.isArray(message.clients)) {
                        this._clientsChanged(message.clients);
                    } else if (
                        message?.kind === 'command_request' &&
                        typeof message.id === 'string'
                    ) {
                        // Session tools are handled by Kallichore. Positron's private
                        // AI command catalog has no equivalent in this extension.
                        this.send({
                            kind: 'command_reply',
                            id: message.id,
                            ok: false,
                            reason: 'not-found',
                            message: 'This frontend does not publish editor commands.',
                        });
                    }
                } catch {
                    this._log('Ignored an invalid MCP frontend frame.');
                }
            });
            socket.on('error', () => {
                this._log('MCP frontend channel connection failed.');
            });
            socket.on('close', () => {
                if (this._socket !== socket) {
                    return;
                }
                this._socket = undefined;
                this._ready = false;
                this._clientsChanged([]);
                this.scheduleReconnect();
            });
        } catch {
            this._log('Could not open the MCP frontend channel.');
            this.scheduleReconnect();
        }
    }

    private async sayHello(socket: WebSocket): Promise<void> {
        const id = await this.foregroundId();
        if (this._disposed || this._socket !== socket || socket.readyState !== WebSocket.OPEN) {
            return;
        }
        this._delay = 1000;
        this._ready = true;
        const sessionIds = this._sessionIds();
        this.send({
            kind: 'hello',
            commands: [],
            guide: {},
            session_ids: sessionIds,
            foreground_session_id: id && sessionIds.includes(id) ? id : undefined,
            focused: vscode.window.state.focused,
        });
    }

    private send(message: unknown): void {
        if (!this._disposed && this._ready && this._socket?.readyState === WebSocket.OPEN) {
            this._socket.send(JSON.stringify(message), (error) => {
                if (error) {
                    this._log('Could not send an MCP frontend frame.');
                }
            });
        }
    }

    private scheduleReconnect(): void {
        if (this._disposed || this._timer) {
            return;
        }
        this._timer = setTimeout(() => {
            this._timer = undefined;
            this.connect();
        }, this._delay);
        this._delay = Math.min(this._delay * 2, 30000);
    }

    public dispose(): void {
        this._disposed = true;
        if (this._timer) {
            clearTimeout(this._timer);
        }
        const socket = this._socket;
        this._socket = undefined;
        if (socket) {
            if (socket.readyState === WebSocket.CONNECTING) {
                socket.terminate();
            } else {
                socket.close();
            }
        }
        this._disposables.forEach((disposable) => disposable.dispose());
        this._clientsChanged([]);
    }
}
