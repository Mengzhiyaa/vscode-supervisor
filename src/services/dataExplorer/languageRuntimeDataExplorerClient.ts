/*---------------------------------------------------------------------------------------------
 *  Language Runtime Data Explorer Client
 *  1:1 port from Positron's languageRuntimeDataExplorerClient.ts
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    BackendState,
    TableSchema,
    TableData,
    TableRowLabels,
    FormatOptions,
    ColumnSelection,
    ColumnFilter,
    RowFilter,
    ColumnSortKey,
    ColumnProfileRequest,
    ColumnProfileResult,
    FilterResult,
    ExportedData,
    ExportFormat,
    TableSelection,
    ArraySelection,
    SchemaUpdateEvent,
    DataUpdateEvent,
    ReturnColumnProfilesEvent,
    SupportedFeatures,
    SupportStatus,
    SearchSchemaResult,
    SearchSchemaSortOrder,
    ConvertedCode,
    CodeSyntaxName,
    DatasetImportOptions,
    SetDatasetImportOptionsResult,
    IDataExplorerComm,
} from '../../runtime/comms/positronDataExplorerComm';

/**
 * Data explorer client status
 */
export enum DataExplorerClientStatus {
    Idle = 'idle',
    Computing = 'computing',
    Disconnected = 'disconnected',
    Error = 'error'
}

/**
 * Default disconnected state
 */
export const DATA_EXPLORER_DISCONNECTED_STATE: BackendState = {
    display_name: 'disconnected',
    table_shape: { num_rows: 0, num_columns: 0 },
    table_unfiltered_shape: { num_rows: 0, num_columns: 0 },
    has_row_labels: false,
    column_filters: [],
    row_filters: [],
    sort_keys: [],
    supported_features: {
        search_schema: {
            support_status: SupportStatus.Unsupported,
            supported_types: []
        },
        set_column_filters: {
            support_status: SupportStatus.Unsupported,
            supported_types: []
        },
        set_row_filters: {
            support_status: SupportStatus.Unsupported,
            supports_conditions: SupportStatus.Unsupported,
            supported_types: []
        },
        get_column_profiles: {
            support_status: SupportStatus.Unsupported,
            supported_types: []
        },
        set_sort_columns: { support_status: SupportStatus.Unsupported },
        export_data_selection: {
            support_status: SupportStatus.Unsupported,
            supported_formats: []
        },
        convert_to_code: {
            support_status: SupportStatus.Unsupported,
            code_syntaxes: []
        }
    }
};

/**
 * Default format options for data values
 */
const DEFAULT_DATA_FORMAT_OPTIONS: FormatOptions = {
    large_num_digits: 2,
    small_num_digits: 4,
    max_integral_digits: 7,
    max_value_length: 1000,
    thousands_sep: '',
};

/**
 * Default format options for profile values
 */
const DEFAULT_PROFILE_FORMAT_OPTIONS: FormatOptions = {
    large_num_digits: 2,
    small_num_digits: 4,
    max_integral_digits: 7,
    max_value_length: 1000,
    thousands_sep: ',',
};

/**
 * A data explorer client instance that wraps an IDataExplorerComm
 * and provides a high-level API for data explorer operations.
 */
export class DataExplorerClientInstance implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _status: DataExplorerClientStatus = DataExplorerClientStatus.Idle;
    private _cachedBackendState: BackendState | undefined;
    private _backendPromise: Promise<BackendState> | undefined;
    private _numPendingTasks = 0;

    // Format options
    private readonly _dataFormatOptions = DEFAULT_DATA_FORMAT_OPTIONS;
    private readonly _profileFormatOptions = DEFAULT_PROFILE_FORMAT_OPTIONS;

    // Async task tracking for column profiles
    private readonly _asyncTasks = new Map<string, {
        resolve: (value: ColumnProfileResult[]) => void;
        reject: (reason: Error) => void;
        timeoutHandle: ReturnType<typeof setTimeout>;
    }>();

    // Event emitters
    private readonly _onDidClose = new vscode.EventEmitter<void>();
    private readonly _onDidSchemaUpdate = new vscode.EventEmitter<SchemaUpdateEvent>();
    private readonly _onDidDataUpdate = new vscode.EventEmitter<DataUpdateEvent>();
    private readonly _onDidStatusUpdate = new vscode.EventEmitter<DataExplorerClientStatus>();
    private readonly _onDidUpdateBackendState = new vscode.EventEmitter<BackendState>();
    private readonly _onDidReturnColumnProfiles = new vscode.EventEmitter<ReturnColumnProfilesEvent>();

    constructor(
        private readonly _comm: IDataExplorerComm,
        private readonly _logChannel: vscode.LogOutputChannel
    ) {
        this._disposables.push(this._onDidClose);
        this._disposables.push(this._onDidSchemaUpdate);
        this._disposables.push(this._onDidDataUpdate);
        this._disposables.push(this._onDidStatusUpdate);
        this._disposables.push(this._onDidUpdateBackendState);
        this._disposables.push(this._onDidReturnColumnProfiles);

        // Typed backend events.
        this._disposables.push(
            this._comm.onDidSchemaUpdate(() => {
                this._logChannel.debug('DataExplorerClientInstance: Schema update received');
                this.updateBackendState().then(() => {
                    this._onDidSchemaUpdate.fire({});
                });
            })
        );
        this._disposables.push(
            this._comm.onDidDataUpdate(() => {
                this._logChannel.debug('DataExplorerClientInstance: Data update received');
                this.updateBackendState().then(() => {
                    this._onDidDataUpdate.fire({});
                });
            })
        );
        this._disposables.push(
            this._comm.onDidReturnColumnProfiles((event) => {
                this._logChannel.debug('DataExplorerClientInstance: Column profiles returned');
                this._onDidReturnColumnProfiles.fire(event);

                const pending = this._asyncTasks.get(event.callback_id);
                if (pending) {
                    clearTimeout(pending.timeoutHandle);
                    if (event.error_message) {
                        pending.reject(new Error(event.error_message));
                    } else {
                        pending.resolve(event.profiles || []);
                    }
                    this._asyncTasks.delete(event.callback_id);
                }
            })
        );
        this._disposables.push(
            this._comm.onDidClose(() => {
                this._setStatus(DataExplorerClientStatus.Disconnected);
                this._onDidClose.fire();
            })
        );
    }

    /**
     * Gets the client ID (comm_id)
     */
    get clientId(): string {
        return this._comm.clientId;
    }

    /**
     * Gets the identifier (alias for clientId)
     */
    get identifier(): string {
        return this.clientId;
    }

    /**
     * Gets the current cached backend state
     */
    get cachedBackendState(): BackendState | undefined {
        return this._cachedBackendState;
    }

    /**
     * Gets the current status
     */
    get status(): DataExplorerClientStatus {
        return this._status;
    }

    /**
     * Gets the profile format options
     */
    get profileFormatOptions(): FormatOptions {
        return this._profileFormatOptions;
    }

    // =========================================================================
    // Events
    // =========================================================================

    readonly onDidClose = this._onDidClose.event;
    readonly onDidSchemaUpdate = this._onDidSchemaUpdate.event;
    readonly onDidDataUpdate = this._onDidDataUpdate.event;
    readonly onDidStatusUpdate = this._onDidStatusUpdate.event;
    readonly onDidUpdateBackendState = this._onDidUpdateBackendState.event;
    readonly onDidReturnColumnProfiles = this._onDidReturnColumnProfiles.event;

    // =========================================================================
    // Public Methods
    // =========================================================================

    /**
     * Get the current backend state
     */
    async getBackendState(waitForCompletedTasks?: boolean): Promise<BackendState> {
        if (this._backendPromise) {
            return this._backendPromise;
        }
        if (this._cachedBackendState === undefined) {
            return this.updateBackendState(waitForCompletedTasks);
        }
        if (this._numPendingTasks > 0 && waitForCompletedTasks) {
            return this.updateBackendState(waitForCompletedTasks);
        }
        return this._cachedBackendState;
    }

    /**
     * Force refresh of backend state
     */
    async updateBackendState(waitForCompletedTasks?: boolean): Promise<BackendState> {
        if (this._backendPromise) {
            return this._backendPromise;
        }

        if (this._numPendingTasks > 0 && waitForCompletedTasks) {
            await this._waitForPendingTasks();
        }

        this._backendPromise = this._runBackendTask(
            () => this._comm.getState(),
            () => DATA_EXPLORER_DISCONNECTED_STATE
        );

        this._cachedBackendState = await this._backendPromise;
        this._backendPromise = undefined;

        if (this._cachedBackendState.connected === false) {
            this._status = DataExplorerClientStatus.Disconnected;
        }

        this._onDidUpdateBackendState.fire(this._cachedBackendState);
        return this._cachedBackendState;
    }

    /**
     * Get schema for specified columns
     */
    async getSchema(columnIndices: number[]): Promise<TableSchema> {
        if (columnIndices.length === 0) {
            return { columns: [] };
        }
        return this._runBackendTask(
            () => this._comm.getSchema(columnIndices),
            () => ({ columns: [] })
        );
    }

    /**
     * Get data values for specified columns
     */
    async getDataValues(columns: ColumnSelection[]): Promise<TableData> {
        if (columns.length === 0) {
            return { columns: [] };
        }
        return this._runBackendTask(
            () => this._comm.getDataValues(columns, this._dataFormatOptions),
            () => ({ columns: [[]] })
        );
    }

    /**
     * Get row labels
     */
    async getRowLabels(selection: ArraySelection): Promise<TableRowLabels> {
        return this._runBackendTask(
            () => this._comm.getRowLabels(selection, this._dataFormatOptions),
            () => ({ row_labels: [[]] })
        );
    }

    /**
     * Set row filters
     */
    async setRowFilters(filters: RowFilter[]): Promise<FilterResult> {
        return this._runBackendTask(
            () => this._comm.setRowFilters(filters),
            () => ({ selected_num_rows: 0 })
        );
    }

    /**
     * Set sort columns
     */
    async setSortColumns(sortKeys: ColumnSortKey[]): Promise<void> {
        return this._runBackendTask(
            () => this._comm.setSortColumns(sortKeys),
            () => { }
        );
    }

    /**
     * Set column filters
     */
    async setColumnFilters(filters: ColumnFilter[]): Promise<void> {
        return this._runBackendTask(
            () => this._comm.setColumnFilters(filters),
            () => { }
        );
    }

    /**
     * Search schema
     */
    async searchSchema(filters: ColumnFilter[], sortOrder: SearchSchemaSortOrder): Promise<SearchSchemaResult> {
        return this._runBackendTask(
            () => this._comm.searchSchema(filters, sortOrder),
            () => ({ matches: [] })
        );
    }

    /**
     * Get column profiles (async with callback)
     */
    async getColumnProfiles(
        callbackId: string,
        profiles: ColumnProfileRequest[]
    ): Promise<void> {
        if (profiles.length === 0) {
            return;
        }
        return this._runBackendTask(
            () => this._comm.getColumnProfiles(callbackId, profiles, this._profileFormatOptions),
            () => { }
        );
    }

    /**
     * Request column profiles and await results
     */
    async requestColumnProfiles(
        profiles: ColumnProfileRequest[]
    ): Promise<ColumnProfileResult[]> {
        if (profiles.length === 0) {
            return [];
        }
        const callbackId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const promise = new Promise<ColumnProfileResult[]>((resolve, reject) => {
            const timeoutMs = 60000;
            const timeoutHandle = setTimeout(() => {
                if (!this._asyncTasks.has(callbackId)) {
                    return;
                }

                this._asyncTasks.delete(callbackId);
                const timeoutSeconds = Math.round(timeoutMs / 100) / 10;
                reject(new Error(`get_column_profiles timed out after ${timeoutSeconds} seconds`));
            }, timeoutMs);

            this._asyncTasks.set(callbackId, { resolve, reject, timeoutHandle });
        });
        try {
            await this.getColumnProfiles(callbackId, profiles);
        } catch (error) {
            const pendingTask = this._asyncTasks.get(callbackId);
            if (pendingTask) {
                clearTimeout(pendingTask.timeoutHandle);
                this._asyncTasks.delete(callbackId);
            }
            throw error;
        }
        return promise;
    }

    /**
     * Export data selection
     */
    async exportDataSelection(selection: TableSelection, format: ExportFormat): Promise<ExportedData> {
        return this._runBackendTask(
            () => this._comm.exportDataSelection(selection, format),
            () => ({ data: '', format })
        );
    }

    /**
     * Suggest a code syntax for converting the current view to code.
     */
    async suggestCodeSyntax(): Promise<CodeSyntaxName | undefined> {
        await this._ensureConvertToCodeSupported();
        return this._runBackendTask(
            () => this._comm.suggestCodeSyntax(),
            () => undefined
        );
    }

    /**
     * Ask the backend to open a new standalone Data Explorer for this dataset.
     */
    async openDataExplorer(): Promise<void> {
        return this._comm.openDataExplorer();
    }

    /**
     * Convert current filters and sort keys to code in the selected syntax.
     */
    async convertToCode(desiredSyntax: CodeSyntaxName): Promise<ConvertedCode> {
        const state = await this.getBackendState(true);
        await this._ensureConvertToCodeSupported(state);

        const supportedSyntaxes = state.supported_features.convert_to_code.code_syntaxes;
        if (
            desiredSyntax &&
            supportedSyntaxes &&
            supportedSyntaxes.length > 0 &&
            !supportedSyntaxes.some(
                syntax => syntax.code_syntax_name === desiredSyntax.code_syntax_name
            )
        ) {
            throw new Error(`Code syntax "${desiredSyntax.code_syntax_name}" is not supported by this backend.`);
        }

        return this._runBackendTask(
            () => this._comm.convertToCode(
                state.column_filters,
                state.row_filters,
                state.sort_keys,
                desiredSyntax
            ),
            () => ({ converted_code: [''] })
        );
    }

    /**
     * Set import options for file-based data sources.
     */
    async setDatasetImportOptions(options: DatasetImportOptions): Promise<SetDatasetImportOptionsResult> {
        return this._runBackendTask(
            () => this._comm.setDatasetImportOptions(options),
            () => ({})
        );
    }

    /**
     * Get supported features
     */
    getSupportedFeatures(): SupportedFeatures {
        if (this._cachedBackendState === undefined) {
            return DATA_EXPLORER_DISCONNECTED_STATE.supported_features;
        }
        return this._cachedBackendState.supported_features;
    }

    dispose(): void {
        for (const [callbackId, pendingTask] of this._asyncTasks) {
            clearTimeout(pendingTask.timeoutHandle);
            pendingTask.reject(new Error('Data Explorer client disposed while waiting for column profiles.'));
            this._asyncTasks.delete(callbackId);
        }
        this._disposables.forEach(d => d.dispose());
        this._comm.closeClient();
        this._comm.dispose();
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private async _runBackendTask<T>(
        task: () => Promise<T>,
        disconnectedResult: () => T
    ): Promise<T> {
        if (this._status === DataExplorerClientStatus.Disconnected) {
            return disconnectedResult();
        }

        this._numPendingTasks += 1;
        this._setStatus(DataExplorerClientStatus.Computing);

        try {
            return await task();
        } finally {
            this._numPendingTasks -= 1;
            if (this._numPendingTasks === 0) {
                this._setStatus(DataExplorerClientStatus.Idle);
            }
        }
    }

    private _setStatus(status: DataExplorerClientStatus): void {
        this._status = status;
        this._onDidStatusUpdate.fire(status);
    }

    private async _waitForPendingTasks(timeoutMs: number = 30000): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            let disposable: vscode.Disposable | undefined;
            const timeoutHandle = setTimeout(() => {
                disposable?.dispose();
                const timeoutSeconds = Math.round(timeoutMs / 100) / 10;
                reject(new Error(`Waiting for pending tasks timed out after ${timeoutSeconds} seconds`));
            }, timeoutMs);

            disposable = this.onDidStatusUpdate(status => {
                if (status !== DataExplorerClientStatus.Idle) {
                    return;
                }

                disposable?.dispose();
                clearTimeout(timeoutHandle);
                resolve();
            });
        });
    }

    private async _ensureConvertToCodeSupported(
        backendState?: BackendState
    ): Promise<void> {
        const state = backendState ?? await this.getBackendState();
        if (state.supported_features.convert_to_code.support_status === SupportStatus.Unsupported) {
            throw new Error('Code syntax conversion is not supported by this backend.');
        }
    }
}

export { DataExplorerClientInstance as LanguageRuntimeDataExplorerClient };
