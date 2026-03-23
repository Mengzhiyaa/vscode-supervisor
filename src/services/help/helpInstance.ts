/*---------------------------------------------------------------------------------------------
 *  PositronHelpInstance
 *  Per-session Help comm handler.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RuntimeSession } from '../../runtime/session';
import { RuntimeClientManager } from '../../runtime/runtimeClientManager';
import { RuntimeClientInstance } from '../../runtime/RuntimeClientInstance';
import { HelpClientInstance } from '../../runtime/HelpClientInstance';
import { PositronHelpService } from './helpService';
import {
    RuntimeClientState as SupervisorClientState,
    RuntimeClientType,
    RuntimeState,
} from '../../positronTypes';

export class PositronHelpInstance implements vscode.Disposable {
    private readonly _runtimeDisposables: vscode.Disposable[] = [];
    private _clientDisposables: vscode.Disposable[] = [];
    private _clientHandlerRegistered = false;
    private _helpClient: HelpClientInstance | undefined;

    constructor(
        private readonly _session: RuntimeSession,
        private readonly _helpService: PositronHelpService,
        private readonly _outputChannel: vscode.LogOutputChannel
    ) {
        this._attachToSession();
    }

    get session(): RuntimeSession {
        return this._session;
    }

    dispose(): void {
        this._disposeClientDisposables();
        this._runtimeDisposables.forEach(d => d.dispose());
        this._runtimeDisposables.length = 0;
        this._helpClient = undefined;
    }

    private _attachToSession(): void {
        const tryAttach = (manager?: RuntimeClientManager, reason?: string) => {
            if (!manager) {
                return;
            }
            this._attachToClientManager(manager, reason ?? 'unknown');
        };

        tryAttach(this._session.clientManager, 'initial');

        this._runtimeDisposables.push(
            this._session.onDidCreateClientManager((manager) => {
                tryAttach(manager, 'clientManagerCreated');
            }),
            this._session.onDidChangeRuntimeState(state => {
                if (state === RuntimeState.Exited) {
                    this._helpService.deleteHelpEntriesForSession(this._session.sessionId);
                }
            })
        );
    }

    private _attachToClientManager(manager: RuntimeClientManager, reason: string): void {
        if (!this._clientHandlerRegistered) {
            this._outputChannel.debug(
                `[HelpInstance] Registering Help client handler for session ${this._session.sessionId} (${reason})`
            );
            this._runtimeDisposables.push(
                manager.registerClientHandler({
                    clientType: RuntimeClientType.Help,
                    callback: (client, _params) => {
                        this._handleHelpClient(client);
                        return true;
                    }
                })
            );
            this._clientHandlerRegistered = true;
        }

        const existingClientId = manager.helpClientId;
        if (existingClientId) {
            const existingClient = manager.getClient(existingClientId);
            if (existingClient) {
                this._outputChannel.debug(
                    `[HelpInstance] Found existing Help client ${existingClientId} for session ${this._session.sessionId} (${reason})`
                );
                this._handleHelpClient(existingClient);
            }
        }
    }

    private _handleHelpClient(client: RuntimeClientInstance): void {
        this._disposeClientDisposables();
        if (this._helpClient) {
            this._helpClient.dispose();
        }

        this._helpClient = new HelpClientInstance(client, this._session.runtimeMetadata.languageId);
        this._helpService.registerHelpClient(this._session, this._helpClient);

        this._clientDisposables.push(
            this._helpClient.onDidShowHelp(event => {
                this._helpService.handleShowHelpEvent(this._session, event);
            }),
            this._helpClient.onDidClose(() => {
                this._helpService.unregisterHelpClient(this._session.sessionId);
                this._helpService.deleteHelpEntriesForSession(this._session.sessionId);
            }),
            client.onDidChangeClientState(state => {
                if (state === SupervisorClientState.Closed) {
                    this._helpService.unregisterHelpClient(this._session.sessionId);
                }
            })
        );
    }

    private _disposeClientDisposables(): void {
        this._clientDisposables.forEach(d => d.dispose());
        this._clientDisposables = [];
    }
}
