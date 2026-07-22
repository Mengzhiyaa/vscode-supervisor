/*---------------------------------------------------------------------------------------------
 *  Positron Data Explorer Service
 *  1:1 port from Positron's positronDataExplorerService.ts
 *  Manages Data Explorer instances and their lifecycle
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DataExplorerClientInstance } from './languageRuntimeDataExplorerClient';
import { RuntimeSessionService } from '../../runtime/runtimeSession';
import { RuntimeSession } from '../../runtime/session';
import { DataExplorerRuntime } from './dataExplorerRuntime';
import { DuckDBInstance } from '../duckdb/duckdbInstance';
import { DuckDBTableView } from '../duckdb/duckdbTableView';
import { DuckDBDataExplorerComm } from '../duckdb/duckdbDataExplorerComm';
import {
    DataExplorerBackendProvider,
    DataExplorerBackendRegistry,
} from './positronDataExplorerExtensionBackend';
import {
    PositronDataExplorerInstance,
    type IPositronDataExplorerInstance,
} from './positronDataExplorerInstance';

export type { IPositronDataExplorerInstance } from './interfaces/positronDataExplorerInstance';

/**
 * Manages all data explorer instances
 */
export interface IPositronDataExplorerService extends vscode.Disposable {
    /**
     * Gets all registered instances
     */
    readonly instances: Map<string, IPositronDataExplorerInstance>;

    /**
     * Events
     */
    readonly onDidCreateInstance: vscode.Event<IPositronDataExplorerInstance>;
    readonly onDidCloseInstance: vscode.Event<string>;

    /**
     * Event that fires when an instance is registered (after creation and state fetch).
     * Used by DataExplorerEditor to wait for instance availability.
     */
    readonly onDidRegisterInstance: vscode.Event<IPositronDataExplorerInstance>;

    /**
     * Initializes the service to listen for sessions
     */
    initialize(): void;

    /**
     * Creates a new data explorer instance from a client instance
     */
    createInstance(
        clientInstance: DataExplorerClientInstance,
        languageName: string,
        options?: PositronDataExplorerCreateOptions
    ): Promise<IPositronDataExplorerInstance>;

    /**
     * Gets an instance by its identifier
     */
    getInstance(identifier: string): IPositronDataExplorerInstance | undefined;

    /**
     * Gets an instance by its identifier, waiting for registration if not yet available.
     * Resolves the editor-first vs instance-first race condition.
     */
    getInstanceAsync(identifier: string, timeoutMs?: number): Promise<IPositronDataExplorerInstance | undefined>;

    /**
     * Gets an instance by variable ID
     */
    getInstanceForVar(variableId: string): IPositronDataExplorerInstance | undefined;

    /**
     * Gets an instance by variable path (for notebook inline reuse)
     */
    getInstanceForVariablePath(sessionId: string, variablePath: string[]): IPositronDataExplorerInstance | undefined;

    /**
     * Associates a variable with an instance
     */
    setInstanceForVar(instanceId: string, variableId: string): void;

    /**
     * Associates a variable path with an instance
     */
    setInstanceForVariablePath(instanceId: string, sessionId: string, variablePath: string[]): void;

    /**
     * Opens a file (CSV/TSV/Parquet) in the Data Explorer using DuckDB-WASM.
     */
    openWithDuckDB(uri: vscode.Uri): Promise<IPositronDataExplorerInstance>;

    registerBackendProvider(provider: DataExplorerBackendProvider): vscode.Disposable;

    openWithBackend(uri: vscode.Uri, providerId?: string): Promise<IPositronDataExplorerInstance>;
}

export interface PositronDataExplorerCreateOptions {
    inlineOnly?: boolean;
    sessionId?: string;
    variablePath?: string[];
}

/**
 * Data Explorer Service Implementation
 */
export class PositronDataExplorerService implements IPositronDataExplorerService {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _backendRegistry = new DataExplorerBackendRegistry();
    private readonly _instances = new Map<string, IPositronDataExplorerInstance>();
    private readonly _variableToInstanceMap = new Map<string, string>();
    private readonly _variablePathToInstanceMap = new Map<string, string>();
    private readonly _sessionInstances = new Map<string, DataExplorerRuntime>();
    private readonly _onDidCreateInstance = new vscode.EventEmitter<IPositronDataExplorerInstance>();
    private readonly _onDidCloseInstance = new vscode.EventEmitter<string>();
    private readonly _onDidRegisterInstance = new vscode.EventEmitter<IPositronDataExplorerInstance>();

    constructor(
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _logChannel: vscode.LogOutputChannel
    ) {
        this._disposables.push(this._onDidCreateInstance);
        this._disposables.push(this._onDidCloseInstance);
        this._disposables.push(this._onDidRegisterInstance);
    }

    get instances(): Map<string, IPositronDataExplorerInstance> {
        return this._instances;
    }

    readonly onDidCreateInstance = this._onDidCreateInstance.event;
    readonly onDidCloseInstance = this._onDidCloseInstance.event;
    readonly onDidRegisterInstance = this._onDidRegisterInstance.event;

    private _variablePathKey(sessionId: string, variablePath: string[]): string {
        return JSON.stringify([sessionId, variablePath]);
    }

    initialize(): void {
        this._logChannel.debug('[PositronDataExplorerService] Initializing...');

        // Listen for session starts
        this._disposables.push(
            this._sessionManager.onWillStartSession((e) => {
                this._logChannel.debug(`[PositronDataExplorerService] Session will start: ${e.session.sessionId}`);
                this._createSessionInstance(e.session);
            })
        );

        // Listen for session deletions
        this._disposables.push(
            this._sessionManager.onDidDeleteRuntimeSession((sessionId: string) => {
                this._logChannel.debug(`[PositronDataExplorerService] Session deleted: ${sessionId}`);
                this._cleanupSession(sessionId);
            })
        );

        // Create instances for existing sessions
        for (const session of this._sessionManager.sessions) {
            this._createSessionInstance(session);
        }

        this._logChannel.debug('[PositronDataExplorerService] Initialized');
    }

    private _createSessionInstance(session: RuntimeSession): void {
        const existingInstance = this._sessionInstances.get(session.sessionId);
        if (existingInstance?.session === session) {
            existingInstance.reattach();
            return;
        }

        existingInstance?.dispose();

        const sessionInstance = new DataExplorerRuntime(
            session,
            this,
            this._logChannel
        );

        this._sessionInstances.set(session.sessionId, sessionInstance);
    }

    private _cleanupSession(sessionId: string): void {
        const sessionInstance = this._sessionInstances.get(sessionId);
        if (sessionInstance) {
            sessionInstance.dispose();
            this._sessionInstances.delete(sessionId);
        }
    }

    async createInstance(
        clientInstance: DataExplorerClientInstance,
        languageName: string,
        options?: PositronDataExplorerCreateOptions
    ): Promise<IPositronDataExplorerInstance> {
        this._logChannel.info(`PositronDataExplorerService: Creating instance for ${clientInstance.clientId}`);

        const existingInstance = this._instances.get(clientInstance.clientId);
        if (existingInstance) {
            existingInstance.rebindClientInstance(clientInstance);
            if (options?.sessionId && options.variablePath && options.variablePath.length > 0) {
                this.setInstanceForVariablePath(
                    existingInstance.identifier,
                    options.sessionId,
                    options.variablePath,
                );
            }
            this._onDidRegisterInstance.fire(existingInstance);
            return existingInstance;
        }

        const instance = new PositronDataExplorerInstance(
            clientInstance,
            languageName,
            options?.inlineOnly === true,
            options?.sessionId,
        );

        this._instances.set(instance.identifier, instance);

        // A backend close disconnects the client, but does not destroy model UI
        // state or surface attachments. A later client with the same identity
        // rebinds to this model.
        instance.onDidClose(() => {
            if (this._instances.get(instance.identifier) !== instance) {
                return;
            }
        });

        instance.onDidDispose(() => {
            if (this._instances.get(instance.identifier) !== instance) {
                return;
            }
            this._instances.delete(instance.identifier);
            this._onDidCloseInstance.fire(instance.identifier);
            for (const [varId, instId] of this._variableToInstanceMap) {
                if (instId === instance.identifier) {
                    this._variableToInstanceMap.delete(varId);
                }
            }

            for (const [key, instId] of this._variablePathToInstanceMap) {
                if (instId === instance.identifier) {
                    this._variablePathToInstanceMap.delete(key);
                }
            }
        });

        if (options?.sessionId && options.variablePath && options.variablePath.length > 0) {
            this.setInstanceForVariablePath(instance.identifier, options.sessionId, options.variablePath);
        }

        // Fire creation event
        this._onDidCreateInstance.fire(instance);

        // Fire registration event (resolves getInstanceAsync waiters)
        this._onDidRegisterInstance.fire(instance);

        return instance;
    }

    getInstance(identifier: string): IPositronDataExplorerInstance | undefined {
        return this._instances.get(identifier);
    }

    /**
     * Gets an instance by identifier, waiting for registration if not yet available.
     * Resolves the editor-first vs instance-first race (upstream Positron pattern).
     */
    async getInstanceAsync(identifier: string, timeoutMs: number = 5000): Promise<IPositronDataExplorerInstance | undefined> {
        const existing = this._instances.get(identifier);
        if (existing) {
            return existing;
        }

        return new Promise<IPositronDataExplorerInstance | undefined>((resolve) => {
            const timeout = setTimeout(() => {
                disposable.dispose();
                resolve(undefined);
            }, timeoutMs);

            const disposable = this._onDidRegisterInstance.event((instance) => {
                if (instance.identifier === identifier) {
                    clearTimeout(timeout);
                    disposable.dispose();
                    resolve(instance);
                }
            });
        });
    }

    getInstanceForVar(variableId: string): IPositronDataExplorerInstance | undefined {
        const instanceId = this._variableToInstanceMap.get(variableId);
        if (instanceId) {
            return this._instances.get(instanceId);
        }
        return undefined;
    }

    getInstanceForVariablePath(sessionId: string, variablePath: string[]): IPositronDataExplorerInstance | undefined {
        const instanceId = this._variablePathToInstanceMap.get(
            this._variablePathKey(sessionId, variablePath)
        );
        if (instanceId) {
            return this._instances.get(instanceId);
        }
        return undefined;
    }

    setInstanceForVar(instanceId: string, variableId: string): void {
        this._variableToInstanceMap.set(variableId, instanceId);
    }

    setInstanceForVariablePath(instanceId: string, sessionId: string, variablePath: string[]): void {
        this._variablePathToInstanceMap.set(
            this._variablePathKey(sessionId, variablePath),
            instanceId
        );
    }

    /**
     * Opens a file in the Data Explorer using DuckDB-WASM backend.
     * If a Data Explorer for this URI is already open, focuses it instead.
     */
    async openWithDuckDB(uri: vscode.Uri): Promise<IPositronDataExplorerInstance> {
        const identifier = `duckdb:${uri.toString()}`;

        // Check for existing instance
        const existing = this._instances.get(identifier);
        if (existing) {
            existing.requestFocus();
            return existing;
        }

        this._logChannel.info(`[PositronDataExplorerService] Opening file with DuckDB: ${uri.toString()}`);

        try {
            // Create table view and import file
            const tableView = new DuckDBTableView(uri);
            await tableView.importFile();

            // Create the comm adapter
            const comm = new DuckDBDataExplorerComm(tableView, this._logChannel);

            // Wrap in DataExplorerClientInstance
            const clientInstance = new DataExplorerClientInstance(comm, this._logChannel);

            // Create the Data Explorer instance
            const instance = await this.createInstance(clientInstance, 'sql');

            return instance;
        } catch (error) {
            const errorMsg = String(error);
            this._logChannel.error(`[PositronDataExplorerService] Failed to open file with DuckDB: ${errorMsg}`);

            // FR-013: Distinguish WASM initialization failures from file I/O errors
            const isWasmError = /wasm|instantiate|worker|webassembly|compile/i.test(errorMsg);
            if (isWasmError) {
                throw new Error(
                    `DuckDB-WASM engine failed to initialize. ` +
                    `Your environment may not support WebAssembly. ` +
                    `Original error: ${errorMsg}`
                );
            }

            throw error;
        }
    }

    registerBackendProvider(provider: DataExplorerBackendProvider): vscode.Disposable {
        return this._backendRegistry.registerProvider(provider);
    }

    async openWithBackend(uri: vscode.Uri, providerId?: string): Promise<IPositronDataExplorerInstance> {
        const backend = await this._backendRegistry.open(uri, providerId);
        const existing = this._instances.get(backend.clientId);
        if (existing) {
            backend.dispose();
            existing.requestFocus();
            return existing;
        }
        const clientInstance = new DataExplorerClientInstance(backend, this._logChannel);
        return this.createInstance(clientInstance, 'extension');
    }

    dispose(): void {
        // Dispose DuckDB instance if it was initialized
        DuckDBInstance.getInstance().dispose().catch(() => { });

        // Dispose all instances
        for (const instance of this._instances.values()) {
            instance.dispose();
        }
        this._instances.clear();
        for (const sessionInstance of this._sessionInstances.values()) {
            sessionInstance.dispose();
        }
        this._sessionInstances.clear();
        this._variableToInstanceMap.clear();
        this._variablePathToInstanceMap.clear();
        this._disposables.forEach(d => d.dispose());
        this._backendRegistry.dispose();
    }
}
