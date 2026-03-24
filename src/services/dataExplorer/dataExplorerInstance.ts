/*---------------------------------------------------------------------------------------------
 *  Data Explorer Instance
 *  Session-specific Data Explorer instance that handles comm registration
 *  1:1 pattern from Positron's data explorer runtime
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RuntimeSession } from '../../runtime/session';
import { RuntimeClientInstance } from '../../runtime/RuntimeClientInstance';
import type { RuntimeClientManager } from '../../runtime/runtimeClientManager';
import { DataExplorerClientInstance } from './dataExplorerClientInstance';
import { DataExplorerBackendRequest, PositronDataExplorerComm } from '../../runtime/comms/positronDataExplorerComm';
import type { IDataExplorerService, IDataExplorerInstance } from './dataExplorerService';
import { RuntimeClientType, RuntimeState } from '../../internal/runtimeTypes';

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
export class DataExplorerSessionInstance implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _runtimeDisposables: vscode.Disposable[] = [];
    private _clientHandlerRegistered = false;
    private readonly _attachedClientIds = new Set<string>();

    // Event emitter for when a data explorer is opened
    private readonly _onDidOpenDataExplorer = new vscode.EventEmitter<IDataExplorerInstance>();
    readonly onDidOpenDataExplorer = this._onDidOpenDataExplorer.event;

    constructor(
        private readonly _session: RuntimeSession,
        private readonly _dataExplorerService: IDataExplorerService,
        private readonly _logChannel: vscode.LogOutputChannel
    ) {
        this._disposables.push(this._onDidOpenDataExplorer);
        this._logChannel.debug(`[DataExplorerInstance] Created for session ${_session.sessionId}`);
        this._attachToSession();
    }

    private _attachToSession(): void {
        this._logChannel.debug(
            `[DataExplorerInstance] Attaching to session ${this._session.sessionId} ` +
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
            this._session.onDidChangeRuntimeState(state => {
                if (state === RuntimeState.Exited) {
                    this._detachFromSession();
                }
            })
        );
    }

    private _attachToClientManager(manager: RuntimeClientManager, reason: string): void {
        if (!this._clientHandlerRegistered) {
            this._logChannel.debug(
                `[DataExplorerInstance] Registering DataExplorer client handler ` +
                `for session ${this._session.sessionId} (${reason})`
            );

            // Register handler for DataExplorer comm_open messages from the kernel
            this._runtimeDisposables.push(
                manager.registerClientHandler({
                    clientType: RuntimeClientType.DataExplorer,
                    callback: (client, params) => {
                        this._handleDataExplorerClient(client, params as Record<string, unknown>);
                        return true; // Take ownership
                    }
                })
            );

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
        if (this._attachedClientIds.has(clientId)) {
            return;
        }
        this._attachedClientIds.add(clientId);

        this._logChannel.info(
            `[DataExplorerInstance] DataExplorer comm opened: ${clientId}`
        );

        // Parse upstream metadata from comm_open params
        const inlineOnly = params['inline_only'] === true;
        const variablePath = parseVariablePath(params['variable_path']);

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
                    this._attachedClientIds.delete(clientId);
                })
            );

            // Associate with variable if present in params
            const variableId = params['variable_id'] as string | undefined;
            if (variableId) {
                this._dataExplorerService.setInstanceForVar(instance.identifier, variableId);
            }

            // Fire event - DataExplorerEditorProvider will open the panel
            // Unless this is an inline-only instance (notebook inline display)
            if (!inlineOnly) {
                this._onDidOpenDataExplorer.fire(instance);
            }

            this._logChannel.info(
                `[DataExplorerInstance] Created DataExplorer instance: ${instance.identifier} ` +
                `for "${instance.displayName}"` +
                (inlineOnly ? ' (inline-only)' : '') +
                (variablePath ? ` (path: ${JSON.stringify(variablePath)})` : '')
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : JSON.stringify(error);
            this._logChannel.error(
                `[DataExplorerInstance] Failed to create DataExplorer instance: ${message}`
            );
            this._attachedClientIds.delete(clientId);
            dataExplorerClient.dispose();
        }
    }

    private _detachFromSession(): void {
        this._runtimeDisposables.forEach(d => d.dispose());
        this._runtimeDisposables.length = 0;
        this._clientHandlerRegistered = false;
        this._attachedClientIds.clear();
    }

    dispose(): void {
        this._detachFromSession();
        this._disposables.forEach(d => d.dispose());
    }
}
