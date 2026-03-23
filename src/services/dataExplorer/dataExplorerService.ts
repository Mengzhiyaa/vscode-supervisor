/*---------------------------------------------------------------------------------------------
 *  Data Explorer Service
 *  1:1 port from Positron's positronDataExplorerService.ts
 *  Manages Data Explorer instances and their lifecycle
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DataExplorerClientInstance } from './dataExplorerClientInstance';
import { BackendState, TableSchema, DatasetImportOptions, SetDatasetImportOptionsResult } from '../../runtime/comms/positronDataExplorerComm';
import { SessionManager } from '../../runtime/sessionManager';
import { RuntimeSession } from '../../runtime/session';
import { DataExplorerSessionInstance } from './dataExplorerInstance';
import { DuckDBInstance } from '../duckdb/duckdbInstance';
import { DuckDBTableView } from '../duckdb/duckdbTableView';
import { DuckDBDataExplorerComm } from '../duckdb/duckdbDataExplorerComm';

/**
 * Interface for a data explorer instance (matching Positron's IPositronDataExplorerInstance)
 */
export interface IDataExplorerInstance extends vscode.Disposable {
    /**
     * Gets the unique identifier for this instance
     */
    readonly identifier: string;

    /**
     * Gets the display name
     */
    readonly displayName: string;

    /**
     * Gets the runtime language name used for editor affordances like
     * Convert to Code preview highlighting.
     */
    readonly languageName: string;

    /**
     * Gets the data explorer client instance
     */
    readonly clientInstance: DataExplorerClientInstance;

    /**
     * Gets the cached backend state
     */
    readonly backendState: BackendState | undefined;

    /**
     * Gets the number of columns
     */
    readonly numColumns: number;

    /**
     * Gets the number of rows
     */
    readonly numRows: number;

    /**
     * Whether this instance supports file import options.
     */
    readonly supportsFileOptions: boolean;

    /**
     * Gets current "has header row" option state.
     */
    readonly fileHasHeaderRow: boolean;

    /**
     * Whether this instance is for inline-only display and should not auto-open an editor.
     */
    readonly inlineOnly: boolean;

    /**
     * Events
     */
    readonly onDidClose: vscode.Event<void>;
    readonly onDidUpdateBackendState: vscode.Event<BackendState>;

    /**
     * Request focus on this instance
     */
    requestFocus(): void;

    /**
     * Get column schema for specified indices
     */
    getSchema(columnIndices: number[]): Promise<TableSchema>;

    /**
     * Set file import options for file-backed datasets.
     */
    setDatasetImportOptions(options: DatasetImportOptions): Promise<SetDatasetImportOptionsResult>;
}

/**
 * Manages all data explorer instances
 */
export interface IDataExplorerService extends vscode.Disposable {
    /**
     * Gets all active instances
     */
    readonly instances: Map<string, IDataExplorerInstance>;

    /**
     * Gets the active instance
     */
    readonly activeInstance: IDataExplorerInstance | undefined;

    /**
     * Events
     */
    readonly onDidCreateInstance: vscode.Event<IDataExplorerInstance>;
    readonly onDidCloseInstance: vscode.Event<string>;
    readonly onDidChangeActiveInstance: vscode.Event<IDataExplorerInstance | undefined>;

    /**
     * Event that fires when an instance is registered (after creation and state fetch).
     * Used by DataExplorerEditor to wait for instance availability.
     */
    readonly onDidRegisterInstance: vscode.Event<IDataExplorerInstance>;

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
        options?: DataExplorerCreateOptions
    ): Promise<IDataExplorerInstance>;

    /**
     * Gets an instance by its identifier
     */
    getInstance(identifier: string): IDataExplorerInstance | undefined;

    /**
     * Gets an instance by its identifier, waiting for registration if not yet available.
     * Resolves the editor-first vs instance-first race condition.
     */
    getInstanceAsync(identifier: string, timeoutMs?: number): Promise<IDataExplorerInstance | undefined>;

    /**
     * Gets an instance by variable ID
     */
    getInstanceForVar(variableId: string): IDataExplorerInstance | undefined;

    /**
     * Gets an instance by variable path (for notebook inline reuse)
     */
    getInstanceForVariablePath(sessionId: string, variablePath: string[]): IDataExplorerInstance | undefined;

    /**
     * Associates a variable with an instance
     */
    setInstanceForVar(instanceId: string, variableId: string): void;

    /**
     * Associates a variable path with an instance
     */
    setInstanceForVariablePath(instanceId: string, sessionId: string, variablePath: string[]): void;

    /**
     * Sets the active instance
     */
    setActiveInstance(instance: IDataExplorerInstance | undefined): void;

    /**
     * Opens a file (CSV/TSV/Parquet) in the Data Explorer using DuckDB-WASM.
     */
    openWithDuckDB(uri: vscode.Uri): Promise<IDataExplorerInstance>;
}

export interface DataExplorerCreateOptions {
    inlineOnly?: boolean;
    sessionId?: string;
    variablePath?: string[];
}

/**
 * Data Explorer Instance Implementation
 */
class DataExplorerInstance implements IDataExplorerInstance {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _onDidClose = new vscode.EventEmitter<void>();
    private readonly _onDidUpdateBackendState = new vscode.EventEmitter<BackendState>();
    private readonly _onDidRequestFocus = new vscode.EventEmitter<void>();
    private readonly _schemaCache = new Map<number, TableSchema['columns'][number]>();
    private _fileHasHeaderRow = true;

    constructor(
        private readonly _clientInstance: DataExplorerClientInstance,
        private readonly _languageName: string,
        private readonly _inlineOnly: boolean = false
    ) {
        this._disposables.push(this._onDidClose);
        this._disposables.push(this._onDidUpdateBackendState);
        this._disposables.push(this._onDidRequestFocus);

        // Forward events from client instance
        this._disposables.push(
            this._clientInstance.onDidClose(() => {
                this._schemaCache.clear();
                this._onDidClose.fire();
            })
        );

        this._disposables.push(
            this._clientInstance.onDidUpdateBackendState((state) => {
                this._onDidUpdateBackendState.fire(state);
            })
        );

        this._disposables.push(
            this._clientInstance.onDidSchemaUpdate(() => {
                this._schemaCache.clear();
            })
        );
    }

    get identifier(): string {
        return this._clientInstance.clientId;
    }

    get displayName(): string {
        return this._clientInstance.cachedBackendState?.display_name ?? 'Data';
    }

    get clientInstance(): DataExplorerClientInstance {
        return this._clientInstance;
    }

    get backendState(): BackendState | undefined {
        return this._clientInstance.cachedBackendState;
    }

    get numColumns(): number {
        return this._clientInstance.cachedBackendState?.table_shape.num_columns ?? 0;
    }

    get numRows(): number {
        return this._clientInstance.cachedBackendState?.table_shape.num_rows ?? 0;
    }

    get supportsFileOptions(): boolean {
        return this._clientInstance.clientId.startsWith('duckdb:');
    }

    get fileHasHeaderRow(): boolean {
        return this._fileHasHeaderRow;
    }

    get inlineOnly(): boolean {
        return this._inlineOnly;
    }

    get languageName(): string {
        return this._languageName;
    }

    readonly onDidClose = this._onDidClose.event;
    readonly onDidUpdateBackendState = this._onDidUpdateBackendState.event;
    readonly onDidRequestFocus = this._onDidRequestFocus.event;

    requestFocus(): void {
        this._onDidRequestFocus.fire();
    }

    async getSchema(columnIndices: number[]): Promise<TableSchema> {
        if (columnIndices.length === 0) {
            return { columns: [] };
        }

        const uniqueColumnIndices = Array.from(new Set(columnIndices));
        const missingColumnIndices = uniqueColumnIndices.filter(
            (columnIndex) => !this._schemaCache.has(columnIndex),
        );

        if (missingColumnIndices.length > 0) {
            const schema = await this._clientInstance.getSchema(missingColumnIndices);
            for (const column of schema.columns) {
                this._schemaCache.set(column.column_index, column);
            }
        }

        return {
            columns: columnIndices
                .map((columnIndex) => this._schemaCache.get(columnIndex))
                .filter((column): column is TableSchema['columns'][number] => Boolean(column)),
        };
    }

    async setDatasetImportOptions(options: DatasetImportOptions): Promise<SetDatasetImportOptionsResult> {
        this._schemaCache.clear();
        const result = await this._clientInstance.setDatasetImportOptions(options);
        if (Object.prototype.hasOwnProperty.call(options, 'has_header_row') && options.has_header_row !== undefined) {
            this._fileHasHeaderRow = options.has_header_row;
        }
        return result;
    }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._clientInstance.dispose();
    }
}

/**
 * Data Explorer Service Implementation
 */
export class DataExplorerService implements IDataExplorerService {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _instances = new Map<string, IDataExplorerInstance>();
    private readonly _variableToInstanceMap = new Map<string, string>();
    private readonly _variablePathToInstanceMap = new Map<string, string>();
    private readonly _sessionInstances = new Map<string, DataExplorerSessionInstance>();
    private _activeInstance: IDataExplorerInstance | undefined;

    private readonly _onDidCreateInstance = new vscode.EventEmitter<IDataExplorerInstance>();
    private readonly _onDidCloseInstance = new vscode.EventEmitter<string>();
    private readonly _onDidChangeActiveInstance = new vscode.EventEmitter<IDataExplorerInstance | undefined>();
    private readonly _onDidRegisterInstance = new vscode.EventEmitter<IDataExplorerInstance>();

    constructor(
        private readonly _sessionManager: SessionManager,
        private readonly _logChannel: vscode.LogOutputChannel
    ) {
        this._disposables.push(this._onDidCreateInstance);
        this._disposables.push(this._onDidCloseInstance);
        this._disposables.push(this._onDidChangeActiveInstance);
        this._disposables.push(this._onDidRegisterInstance);
    }

    get instances(): Map<string, IDataExplorerInstance> {
        return this._instances;
    }

    get activeInstance(): IDataExplorerInstance | undefined {
        return this._activeInstance;
    }

    readonly onDidCreateInstance = this._onDidCreateInstance.event;
    readonly onDidCloseInstance = this._onDidCloseInstance.event;
    readonly onDidChangeActiveInstance = this._onDidChangeActiveInstance.event;
    readonly onDidRegisterInstance = this._onDidRegisterInstance.event;

    private _variablePathKey(sessionId: string, variablePath: string[]): string {
        return JSON.stringify([sessionId, variablePath]);
    }

    initialize(): void {
        this._logChannel.debug('[DataExplorerService] Initializing...');

        // Listen for session starts
        this._disposables.push(
            this._sessionManager.onWillStartSession((e) => {
                this._logChannel.debug(`[DataExplorerService] Session will start: ${e.session.sessionId}`);
                this._createSessionInstance(e.session);
            })
        );

        // Listen for session deletions
        this._disposables.push(
            this._sessionManager.onDidDeleteRuntimeSession((sessionId: string) => {
                this._logChannel.debug(`[DataExplorerService] Session deleted: ${sessionId}`);
                this._cleanupSession(sessionId);
            })
        );

        // Create instances for existing sessions
        for (const session of this._sessionManager.sessions) {
            this._createSessionInstance(session);
        }

        this._logChannel.debug('[DataExplorerService] Initialized');
    }

    private _createSessionInstance(session: RuntimeSession): void {
        if (this._sessionInstances.has(session.sessionId)) {
            return;
        }

        const sessionInstance = new DataExplorerSessionInstance(
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
        options?: DataExplorerCreateOptions
    ): Promise<IDataExplorerInstance> {
        this._logChannel.info(`DataExplorerService: Creating instance for ${clientInstance.clientId}`);

        // Create instance
        const instance = new DataExplorerInstance(clientInstance, languageName, options?.inlineOnly === true);

        // Store instance
        this._instances.set(instance.identifier, instance);

        // Handle instance close
        instance.onDidClose(() => {
            this._instances.delete(instance.identifier);
            this._onDidCloseInstance.fire(instance.identifier);

            if (this._activeInstance === instance) {
                this.setActiveInstance(undefined);
            }

            // Clean up variable mappings
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

        if (!instance.inlineOnly) {
            this.setActiveInstance(instance);
        }

        return instance;
    }

    getInstance(identifier: string): IDataExplorerInstance | undefined {
        return this._instances.get(identifier);
    }

    /**
     * Gets an instance by identifier, waiting for registration if not yet available.
     * Resolves the editor-first vs instance-first race (upstream Positron pattern).
     */
    async getInstanceAsync(identifier: string, timeoutMs: number = 5000): Promise<IDataExplorerInstance | undefined> {
        const existing = this._instances.get(identifier);
        if (existing) {
            return existing;
        }

        return new Promise<IDataExplorerInstance | undefined>((resolve) => {
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

    getInstanceForVar(variableId: string): IDataExplorerInstance | undefined {
        const instanceId = this._variableToInstanceMap.get(variableId);
        if (instanceId) {
            return this._instances.get(instanceId);
        }
        return undefined;
    }

    getInstanceForVariablePath(sessionId: string, variablePath: string[]): IDataExplorerInstance | undefined {
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

    setActiveInstance(instance: IDataExplorerInstance | undefined): void {
        if (this._activeInstance !== instance) {
            this._activeInstance = instance;
            this._onDidChangeActiveInstance.fire(instance);
        }
    }

    /**
     * Opens a file in the Data Explorer using DuckDB-WASM backend.
     * If a Data Explorer for this URI is already open, focuses it instead.
     */
    async openWithDuckDB(uri: vscode.Uri): Promise<IDataExplorerInstance> {
        const identifier = `duckdb:${uri.toString()}`;

        // Check for existing instance
        const existing = this._instances.get(identifier);
        if (existing) {
            existing.requestFocus();
            return existing;
        }

        this._logChannel.info(`[DataExplorerService] Opening file with DuckDB: ${uri.toString()}`);

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
            this._logChannel.error(`[DataExplorerService] Failed to open file with DuckDB: ${errorMsg}`);

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

    dispose(): void {
        // Dispose DuckDB instance if it was initialized
        DuckDBInstance.getInstance().dispose().catch(() => { });

        // Dispose all instances
        for (const instance of this._instances.values()) {
            instance.dispose();
        }
        this._instances.clear();
        this._variableToInstanceMap.clear();
        this._variablePathToInstanceMap.clear();
        this._disposables.forEach(d => d.dispose());
    }
}
