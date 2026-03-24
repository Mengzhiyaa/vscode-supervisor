/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { JupyterLanguageRuntimeSession } from '../supervisor/positron-supervisor';
import {
    type LanguageRuntimeMessageCommData,
    type LanguageRuntimeMessageCommOpen,
    type LanguageRuntimeState,
    LanguageRuntimeMessageType,
    type RuntimeClientHandler,
    RuntimeClientType,
    RuntimeClientState,
    RuntimeState,
} from '../internal/runtimeTypes';
import { createUniqueId } from '../supervisor/util';
import { RuntimeClientInstance } from './RuntimeClientInstance';
import {
    isRuntimeClientInstanceRegistered,
    registerRuntimeClientInstance,
} from './runtimeClientRegistry';

/**
 * Manages the lifecycle of Positron clients (comms) for a runtime session.
 * 
 * This class handles:
 * - Opening standard Positron comms (Variables, UI, Help) when session becomes ready
 * - Managing kernel-initiated client instances (comm_open from kernel)
 * - Routing comm messages to appropriate client instances
 * - Managing client lifecycle and cleanup
 * - Registering client handlers for specific client types
 * 
 * Based on Positron's RuntimeClientInstance pattern.
 */
export class RuntimeClientManager implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _initializingPromise: Promise<void> | undefined;

    // Track client IDs for extension-created clients (cleanup purposes)
    private _variablesClientId: string | undefined;
    private _uiClientId: string | undefined;
    private _helpClientId: string | undefined;

    // Map of comm_id to RuntimeClientInstance for kernel-initiated clients
    // Matches Positron's _clients Map in ExtHostLanguageRuntimeSessionAdapter
    private readonly _clients: Map<string, RuntimeClientInstance> = new Map();

    // Array of registered client handlers (matching Positron's _clientHandlers)
    private readonly _clientHandlers: RuntimeClientHandler[] = [];

    // Event emitter for when a new client instance is created.
    private readonly _onDidCreateClientInstance = new vscode.EventEmitter<{
        client: RuntimeClientInstance;
        message: LanguageRuntimeMessageCommOpen;
    }>();

    /**
     * Event that fires when a new client instance is created.
     */
    readonly onDidCreateClientInstance = this._onDidCreateClientInstance.event;

    constructor(
        private readonly _session: JupyterLanguageRuntimeSession,
        private readonly _logChannel: vscode.LogOutputChannel
    ) {
        this._disposables.push(this._onDidCreateClientInstance);

        this._disposables.push(
            this._session.onDidChangeRuntimeState((state) => {
                if (
                    state === RuntimeState.Exited ||
                    state === RuntimeState.Uninitialized
                ) {
                    this._handleRuntimeExited(state);
                }
            })
        );
    }

    private _setKnownClientId(clientType: RuntimeClientType, clientId: string): void {
        switch (clientType) {
            case RuntimeClientType.Variables:
                this._variablesClientId = clientId;
                break;
            case RuntimeClientType.Ui:
                this._uiClientId = clientId;
                break;
            case RuntimeClientType.Help:
                this._helpClientId = clientId;
                break;
        }
    }

    private _clearKnownClientId(commId: string): void {
        if (this._variablesClientId === commId) {
            this._variablesClientId = undefined;
        }
        if (this._uiClientId === commId) {
            this._uiClientId = undefined;
        }
        if (this._helpClientId === commId) {
            this._helpClientId = undefined;
        }
    }

    private _clearKnownClientIds(): void {
        this._variablesClientId = undefined;
        this._uiClientId = undefined;
        this._helpClientId = undefined;
    }

    private _buildSyntheticOpenMessage(
        clientId: string,
        clientType: RuntimeClientType,
        params: Record<string, unknown> = {}
    ): LanguageRuntimeMessageCommOpen {
        return {
            id: clientId,
            parent_id: '',
            when: new Date().toISOString(),
            type: LanguageRuntimeMessageType.CommOpen,
            comm_id: clientId,
            target_name: clientType,
            data: params,
            metadata: {}
        };
    }

    private _createRuntimeClientInstance(message: LanguageRuntimeMessageCommOpen): RuntimeClientInstance {
        return new RuntimeClientInstance(
            message,
            (id, data) => {
                this._session.sendClientMessage(message.comm_id, id, data);
            },
            () => {
                this._session.removeClient(message.comm_id);
            }
        );
    }

    private _notifyClientHandlers(
        clientType: RuntimeClientType,
        client: RuntimeClientInstance,
        params: Record<string, unknown>
    ): boolean {
        for (const handler of this._clientHandlers) {
            if (handler.clientType === clientType) {
                if (handler.callback(client, params)) {
                    this._logChannel.debug(
                        `RuntimeClientManager: Handler took ownership of '${client.getClientId()}' ` +
                        `for '${clientType}'`
                    );
                    return true;
                }
            }
        }

        return false;
    }

    private _registerSyntheticClient(
        clientId: string,
        clientType: RuntimeClientType,
        params: Record<string, unknown> = {}
    ): RuntimeClientInstance {
        const syntheticMessage = this._buildSyntheticOpenMessage(clientId, clientType, params);
        const client = this._createRuntimeClientInstance(syntheticMessage);

        this._clients.set(clientId, client);
        this._notifyClientHandlers(clientType, client, params);
        this._onDidCreateClientInstance.fire({ client, message: syntheticMessage });

        return client;
    }

    /**
     * Initializes the standard Positron clients after the session is ready.
     * This should be called once the kernel is in Ready/Idle state.
     * 
     * Follows Positron's startup sequence:
     * 1. Create Variables comm
     * 2. Create UI comm  
     * 3. Query for Help comm availability
     * 4. Create Help comm if available
     */
    async initializeClients(): Promise<void> {
        if (this._initializingPromise) {
            await this._initializingPromise;
            return;
        }

        this._initializingPromise = (async () => {
            this._logChannel.info('RuntimeClientManager: Ensuring Positron clients...');

            try {
                // Restore any existing clients from the kernel (reconnect/restart scenario)
                await this.restoreExistingClients();

                // 1. Create Variables client
                await this._createVariablesClient();

                // 2. Create UI client
                await this._createUiClient();

                // 3. Create Help client (after checking availability)
                await this._createHelpClient();

                this._logChannel.info('RuntimeClientManager: Positron clients are ready');
            } catch (error) {
                this._logChannel.error(`RuntimeClientManager: Failed to initialize clients: ${error}`);
                throw error;
            }
        })();

        try {
            await this._initializingPromise;
        } finally {
            this._initializingPromise = undefined;
        }
    }

    /**
     * Creates the Variables client (positron.variables).
     * This comm is used for syncing the Variables pane with the kernel.
     */
    private async _createVariablesClient(): Promise<void> {
        const existingClientId = this._findExistingClientId(RuntimeClientType.Variables);
        if (existingClientId) {
            this._setKnownClientId(RuntimeClientType.Variables, existingClientId);
            this._logChannel.debug(`RuntimeClientManager: Using existing Variables client ${existingClientId}`);
            return;
        }

        const clientId = `positron-variables-${this._session.runtimeMetadata.languageId}-${createUniqueId()}`;

        this._logChannel.debug(`RuntimeClientManager: Creating Variables client ${clientId}`);

        try {
            await this._session.createClient(
                clientId,
                RuntimeClientType.Variables,
                {}
            );
            this._setKnownClientId(RuntimeClientType.Variables, clientId);
            this._registerSyntheticClient(clientId, RuntimeClientType.Variables);
            this._logChannel.info(`RuntimeClientManager: Variables client created and registered: ${clientId}`);
        } catch (error) {
            this._logChannel.error(`RuntimeClientManager: Failed to create Variables client: ${error}`);
            throw error;
        }
    }

    /**
     * Creates the UI client (positron.ui).
     * This comm is used for:
     * - Setting console width
     * - Receiving prompt_state updates
     * - Receiving working_directory updates
     * - Plot render settings
     */
    private async _createUiClient(): Promise<void> {
        const existingClientId = this._findExistingClientId(RuntimeClientType.Ui);
        if (existingClientId) {
            this._setKnownClientId(RuntimeClientType.Ui, existingClientId);
            this._logChannel.debug(`RuntimeClientManager: Using existing UI client ${existingClientId}`);
            return;
        }

        const clientId = `positron-ui-${this._session.runtimeMetadata.languageId}-${createUniqueId()}`;

        this._logChannel.debug(`RuntimeClientManager: Creating UI client ${clientId}`);

        try {
            await this._session.createClient(
                clientId,
                RuntimeClientType.Ui,
                {}
            );
            this._setKnownClientId(RuntimeClientType.Ui, clientId);
            this._registerSyntheticClient(clientId, RuntimeClientType.Ui);
            this._logChannel.info(`RuntimeClientManager: UI client created and registered: ${clientId}`);
        } catch (error) {
            this._logChannel.error(`RuntimeClientManager: Failed to create UI client: ${error}`);
            throw error;
        }
    }

    /**
     * Creates the Help client (positron.help) if supported.
     * First queries the kernel to check if help comm is available.
     */
    private async _createHelpClient(): Promise<void> {
        const existingClientId = this._findExistingClientId(RuntimeClientType.Help);
        if (existingClientId) {
            this._setKnownClientId(RuntimeClientType.Help, existingClientId);
            this._logChannel.debug(`RuntimeClientManager: Using existing Help client ${existingClientId}`);
            return;
        }

        const clientId = `positron-help-${this._session.runtimeMetadata.languageId}-${createUniqueId()}`;

        this._logChannel.debug(`RuntimeClientManager: Checking Help client availability...`);

        try {
            // Query if help comm is available
            const clients = await this._session.listClients(RuntimeClientType.Help);

            // If there are existing help comms, one was opened by the kernel
            if (Object.keys(clients).length > 0) {
                const existingId = Object.keys(clients)[0];
                this._setKnownClientId(RuntimeClientType.Help, existingId);
                if (!this._clients.has(existingId)) {
                    this._registerSyntheticClient(existingId, RuntimeClientType.Help);
                }
                this._logChannel.debug(`RuntimeClientManager: Help comm already exists from kernel: ${existingId}`);
                return;
            }

            // Create help client
            await this._session.createClient(
                clientId,
                RuntimeClientType.Help,
                {}
            );
            this._setKnownClientId(RuntimeClientType.Help, clientId);
            this._registerSyntheticClient(clientId, RuntimeClientType.Help);
            this._logChannel.info(`RuntimeClientManager: Help client created and registered: ${clientId}`);
        } catch (error) {
            // Help comm is optional - log but don't throw
            this._logChannel.warn(`RuntimeClientManager: Failed to create Help client (optional): ${error}`);
        }
    }

    /**
     * Gets the Variables client ID if created.
     */
    get variablesClientId(): string | undefined {
        return this._variablesClientId;
    }

    /**
     * Gets the UI client ID if created.
     */
    get uiClientId(): string | undefined {
        return this._uiClientId;
    }

    /**
     * Gets the Help client ID if created.
     */
    get helpClientId(): string | undefined {
        return this._helpClientId;
    }

    /**
     * Restores any existing clients from the kernel (reconnect scenario).
     */
    async restoreExistingClients(): Promise<void> {
        try {
            const clients = await this._session.listClients();
            const entries = Object.entries(clients);
            if (entries.length === 0) {
                return;
            }

            for (const [commId, targetName] of entries) {
                if (!Object.values(RuntimeClientType).includes(targetName as RuntimeClientType)) {
                    continue;
                }

                if (this._clients.has(commId)) {
                    continue;
                }

                // Track standard client IDs if present
                switch (targetName) {
                    case RuntimeClientType.Variables:
                        if (!this._variablesClientId) {
                            this._setKnownClientId(RuntimeClientType.Variables, commId);
                        }
                        break;
                    case RuntimeClientType.Ui:
                        if (!this._uiClientId) {
                            this._setKnownClientId(RuntimeClientType.Ui, commId);
                        }
                        break;
                    case RuntimeClientType.Help:
                        if (!this._helpClientId) {
                            this._setKnownClientId(RuntimeClientType.Help, commId);
                        }
                        break;
                }

                this.openClientInstance(
                    this._buildSyntheticOpenMessage(commId, targetName as RuntimeClientType)
                );
            }
        } catch (error) {
            this._logChannel.warn(`RuntimeClientManager: Failed to restore existing clients: ${error}`);
        }
    }

    private _handleRuntimeExited(state: RuntimeState): void {
        this._logChannel.debug(
            `RuntimeClientManager: Runtime entered '${state}', clearing tracked clients`
        );

        for (const [, client] of this._clients) {
            client.setClientState(RuntimeClientState.Closed);
            client.dispose();
        }

        this._clients.clear();
        this._clearKnownClientIds();
    }

    private _findExistingClientId(clientType: RuntimeClientType): string | undefined {
        for (const [commId, client] of this._clients) {
            if (client.message.target_name === clientType) {
                return commId;
            }
        }
        return undefined;
    }

    // =========================================================================
    // Kernel-initiated comm handling (matching Positron's pattern)
    // =========================================================================

    /**
     * Opens a client instance (comm) on the frontend.
     * Called when a new comm is created by the kernel (comm_open message).
     * 
     * Matches Positron's handleCommOpen() in extHostLanguageRuntime.ts
     *
     * @param message The comm_open message from the kernel
     */
    openClientInstance(message: LanguageRuntimeMessageCommOpen): boolean {
        // If the target name is not a valid client type, remove the backend
        // client and return (Positron parity).
        if (!Object.values(RuntimeClientType).includes(message.target_name as RuntimeClientType)) {
            this._logChannel.warn(
                `RuntimeClientManager: Unknown client type '${message.target_name}', ` +
                `removing backend client '${message.comm_id}'`
            );
            this._session.removeClient(message.comm_id);
            return true;
        }

        const clientType = message.target_name as RuntimeClientType;

        this._setKnownClientId(clientType, message.comm_id);

        // Create a new client instance wrapper
        const client = this._createRuntimeClientInstance(message);

        // See if one of the registered client handlers wants to handle this
        // (matching Positron's handleCommOpen pattern)
        const handled = this._notifyClientHandlers(
            clientType,
            client,
            (message.data ?? {}) as Record<string, unknown>
        );

        // Save the client instance
        this._clients.set(message.comm_id, client);
        this._logChannel.info(
            `RuntimeClientManager: Created client instance '${message.comm_id}' ` +
            `for '${clientType}' (handled: ${handled})`
        );

        // Fire an event to notify listeners
        this._onDidCreateClientInstance.fire({ client, message });
        return true;
    }

    /**
     * Registers a client handler that will be called when a client of the
     * specified type is created.
     * 
     * Matches Positron's registerClientHandler() in extHostLanguageRuntime.ts
     *
     * @param handler The handler to register
     * @returns A disposable that unregisters the handler when disposed
     */
    registerClientHandler(handler: RuntimeClientHandler): vscode.Disposable {
        this._clientHandlers.push(handler);
        this._logChannel.debug(
            `RuntimeClientManager: Registered handler for '${handler.clientType}'`
        );
        return new vscode.Disposable(() => {
            const index = this._clientHandlers.indexOf(handler);
            if (index >= 0) {
                this._clientHandlers.splice(index, 1);
            }
        });
    }

    /**
     * Registers a watcher for a specific client type and invokes it for both
     * existing and future client instances.
     */
    watchClient(
        clientType: RuntimeClientType,
        handler: (client: RuntimeClientInstance, message: LanguageRuntimeMessageCommOpen) => void
    ): vscode.Disposable {
        // Watch existing instances first (reconnect-safe semantics).
        for (const client of this._clients.values()) {
            if (client.message.target_name === clientType) {
                handler(client, client.message);
            }
        }

        // Then watch future instances.
        return this.onDidCreateClientInstance(({ client, message }) => {
            if (message.target_name === clientType) {
                handler(client, message);
            }
        });
    }

    /**
     * Registers a client instance ID so it is recognized for message routing.
     * 
     * Matches Positron's registerClientInstance() in extHostLanguageRuntime.ts
     *
     * @param clientInstanceId The client instance ID to register
     * @returns A disposable that unregisters the ID when disposed
     */
    registerClientInstance(clientInstanceId: string): vscode.Disposable {
        return registerRuntimeClientInstance(clientInstanceId);
    }

    /**
     * Routes a comm_data message from the kernel to the appropriate client instance.
     * 
     * Matches Positron's emitDidReceiveClientMessage() in mainThreadLanguageRuntime.ts
     *
     * @param message The comm_data message from the kernel
     */
    emitDidReceiveClientMessage(message: LanguageRuntimeMessageCommData): boolean {
        const client = this._clients.get(message.comm_id);
        if (client) {
            client.emitMessage(message);
            return true;
        }

        if (isRuntimeClientInstanceRegistered(message.comm_id)) {
            return true;
        }

        this._logChannel.debug(
            `RuntimeClientManager: Client instance '${message.comm_id}' not found; ` +
            `comm_data message is unhandled`
        );
        return false;
    }

    /**
     * Updates the state of a client instance.
     * Typically called when receiving comm_closed from the kernel.
     * 
     * Matches Positron's emitClientState() in mainThreadLanguageRuntime.ts
     *
     * @param commId The comm ID
     * @param state The new state
     */
    emitClientState(commId: string, state: RuntimeClientState): boolean {
        const client = this._clients.get(commId);
        if (client) {
            client.setClientState(state);

            // If the client is closed, clean up
            if (state === RuntimeClientState.Closed) {
                client.dispose();
                this._clients.delete(commId);
                this._clearKnownClientId(commId);
                this._logChannel.debug(
                    `RuntimeClientManager: Client '${commId}' closed and removed`
                );
            }
            return true;
        }

        if (isRuntimeClientInstanceRegistered(commId)) {
            return true;
        }

        this._logChannel.debug(
            `RuntimeClientManager: Client instance '${commId}' not found; ` +
            `ignoring state change: ${state}`
        );
        return false;
    }

    /**
     * Updates pending RPC status for all managed clients using a runtime state
     * message.
     */
    updatePendingRpcState(message: LanguageRuntimeState): void {
        for (const client of this._clients.values()) {
            client.updatePendingRpcState(message);
        }
    }

    /**
     * Gets a client instance by comm ID.
     *
     * @param commId The comm ID to look up
     * @returns The client instance, or undefined if not found
     */
    getClient(commId: string): RuntimeClientInstance | undefined {
        return this._clients.get(commId);
    }

    /**
     * Gets all active client instances.
     */
    get clientInstances(): RuntimeClientInstance[] {
        return Array.from(this._clients.values());
    }

    /**
     * Clean up clients on dispose.
     */
    dispose(): void {
        this._initializingPromise = undefined;

        const variablesClientId = this._variablesClientId;
        const uiClientId = this._uiClientId;
        const helpClientId = this._helpClientId;

        // Dispose kernel-initiated client instances
        for (const [, client] of this._clients) {
            client.setClientState(RuntimeClientState.Closed);
            client.dispose();
        }
        this._clients.clear();

        // Remove extension-created clients from the kernel
        if (variablesClientId) {
            try {
                this._session.removeClient(variablesClientId);
            } catch { /* ignore cleanup errors */ }
        }
        if (uiClientId) {
            try {
                this._session.removeClient(uiClientId);
            } catch { /* ignore cleanup errors */ }
        }
        if (helpClientId) {
            try {
                this._session.removeClient(helpClientId);
            } catch { /* ignore cleanup errors */ }
        }

        this._clearKnownClientIds();

        this._disposables.forEach(d => d.dispose());
    }
}
