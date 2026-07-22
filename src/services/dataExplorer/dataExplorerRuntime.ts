/*---------------------------------------------------------------------------------------------
 *  Data Explorer Runtime
 *  Session-specific Data Explorer instance that handles comm registration
 *  1:1 pattern from Positron's data explorer runtime
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RuntimeSession } from '../../runtime/session';
import { RuntimeClientInstance } from '../../runtime/RuntimeClientInstance';
import type { RuntimeClientManager } from '../../runtime/runtimeClientManager';
import { DataExplorerClientInstance } from './languageRuntimeDataExplorerClient';
import { DataExplorerBackendRequest, PositronDataExplorerComm } from '../../runtime/comms/positronDataExplorerComm';
import type {
    IPositronDataExplorerService,
} from './positronDataExplorerService';
import { RuntimeClientType, RuntimeState } from '../../internal/runtimeTypes';
import { shouldKeepDataExplorerInline } from './dataExplorerRouting';

function parseVariablePath(raw: unknown): string[] | undefined {
    if (!Array.isArray(raw) || raw.some((value) => typeof value !== 'string')) {
        return undefined;
    }
    return raw;
}

/**
 * Manages Data Explorer for a specific session.
 * Registers comm handler and creates instances when DataExplorer comms are opened.
 */
export class DataExplorerRuntime implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _runtimeDisposables: vscode.Disposable[] = [];
    private _clientHandlerRegistered = false;
    private _attached = false;
    private _clientManager: RuntimeClientManager | undefined;
    private _clientManagerRegistration: vscode.Disposable | undefined;
    private readonly _attachedClients = new Map<string, RuntimeClientInstance>();

    constructor(
        private readonly _session: RuntimeSession,
        private readonly _dataExplorerService: IPositronDataExplorerService,
        private readonly _logChannel: vscode.LogOutputChannel
    ) {
        this._disposables.push(
            this._session.onDidChangeRuntimeState(state => {
                if (state === RuntimeState.Exited) {
                    this._detachFromSession();
                } else if (!this._attached) {
                    this._attachToSession();
                }
            }),
        );
        this._logChannel.debug(`[DataExplorerRuntime] Created for session ${_session.sessionId}`);
        this._attachToSession();
    }

    get session(): RuntimeSession {
        return this._session;
    }

    reattach(): void {
        if (!this._attached) {
            this._attachToSession();
        } else if (this._session.clientManager) {
            this._attachToClientManager(this._session.clientManager, 'reattach');
        }
    }

    private _attachToSession(): void {
        if (this._attached) {
            return;
        }
        this._attached = true;
        this._logChannel.debug(
            `[DataExplorerRuntime] Attaching to session ${this._session.sessionId} ` +
            `(clientManager=${this._session.clientManager ? 'yes' : 'no'})`
        );

        // If client manager already exists, attach immediately
        if (this._session.clientManager) {
            this._attachToClientManager(this._session.clientManager, 'attach');
        }

        // Listen for client manager creation
        this._runtimeDisposables.push(
            this._session.onDidCreateClientManager(manager => {
                this._attachToClientManager(manager, 'clientManagerCreated');
            }),
        );
    }

    private _attachToClientManager(manager: RuntimeClientManager, reason: string): void {
        if (this._clientManager !== manager) {
            this._clientManagerRegistration?.dispose();
            this._clientManagerRegistration = undefined;
            this._clientManager = manager;
            this._clientHandlerRegistered = false;
            this._attachedClients.clear();
        }

        if (!this._clientHandlerRegistered) {
            this._logChannel.debug(
                `[DataExplorerRuntime] Registering DataExplorer client handler ` +
                `for session ${this._session.sessionId} (${reason})`
            );

            // Register handler for DataExplorer comm_open messages from the kernel
            this._clientManagerRegistration = manager.registerClientHandler({
                clientType: RuntimeClientType.DataExplorer,
                callback: (client, params) => {
                    this._handleDataExplorerClient(client, params as Record<string, unknown>);
                    return true; // Take ownership
                }
            });

            this._clientHandlerRegistered = true;
        }

        // Backfill existing Data Explorer clients (reload/reconnect scenario).
        // This ensures we handle comms that were restored before this handler
        // was registered.
        for (const client of manager.clientInstances) {
            if (client.message.target_name === RuntimeClientType.DataExplorer) {
                void this._handleDataExplorerClient(client, client.message.data as Record<string, unknown>);
            }
        }
    }

    private async _handleDataExplorerClient(
        client: RuntimeClientInstance,
        params: Record<string, unknown>
    ): Promise<void> {
        const clientId = client.getClientId();
        if (this._attachedClients.get(clientId) === client) {
            return;
        }
        this._attachedClients.set(clientId, client);

        this._logChannel.info(
            `[DataExplorerRuntime] DataExplorer comm opened: ${clientId}`
        );

        // Parse upstream metadata from comm_open params
        const requestedInlineOnly = params['inline_only'] === true;
        const inlineOnly = shouldKeepDataExplorerInline(
            this._session.sessionMetadata.sessionMode,
            requestedInlineOnly
        );
        const variablePath = parseVariablePath(params['variable_path']);

        if (requestedInlineOnly && !inlineOnly) {
            this._logChannel.debug(
                `[DataExplorerRuntime] Promoting inline-only explorer ${clientId} ` +
                `to a full editor for ${this._session.sessionMetadata.sessionMode} session ${this._session.sessionId}`
            );
        }

        // Create comm with GetDataValues timeout of 10s (upstream Positron alignment)
        const comm = new PositronDataExplorerComm(client, {
            [DataExplorerBackendRequest.GetDataValues]: { timeout: 10000 },
        });

        // Create the Data Explorer client instance
        const dataExplorerClient = new DataExplorerClientInstance(
            comm,
            this._logChannel
        );

        try {
            // Create instance in the service
            const instance = await this._dataExplorerService.createInstance(
                dataExplorerClient,
                this._session.runtimeMetadata.languageName,
                {
                    inlineOnly,
                    sessionId: this._session.sessionId,
                    variablePath,
                }
            );

            this._runtimeDisposables.push(
                dataExplorerClient.onDidClose(() => {
                    if (this._attachedClients.get(clientId) === client) {
                        this._attachedClients.delete(clientId);
                    }
                })
            );

            // Associate with variable if present in params
            const variableId = params['variable_id'] as string | undefined;
            if (variableId) {
                this._dataExplorerService.setInstanceForVar(instance.identifier, variableId);
            }

            this._logChannel.info(
                `[DataExplorerRuntime] Created DataExplorer instance: ${instance.identifier} ` +
                `for "${instance.displayName}"` +
                (inlineOnly ? ' (inline-only)' : '') +
                (variablePath ? ` (path: ${JSON.stringify(variablePath)})` : '')
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : JSON.stringify(error);
            this._logChannel.error(
                `[DataExplorerRuntime] Failed to create DataExplorer instance: ${message}`
            );
            if (this._attachedClients.get(clientId) === client) {
                this._attachedClients.delete(clientId);
            }
            dataExplorerClient.dispose();
        }
    }

    private _detachFromSession(): void {
        this._attached = false;
        this._clientManagerRegistration?.dispose();
        this._clientManagerRegistration = undefined;
        this._clientManager = undefined;
        this._runtimeDisposables.forEach(d => d.dispose());
        this._runtimeDisposables.length = 0;
        this._clientHandlerRegistered = false;
        this._attachedClients.clear();
    }

    dispose(): void {
        this._detachFromSession();
        this._disposables.forEach(d => d.dispose());
    }
}
