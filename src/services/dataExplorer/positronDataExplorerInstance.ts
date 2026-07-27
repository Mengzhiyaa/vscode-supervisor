/*---------------------------------------------------------------------------------------------
 *  Positron Data Explorer model and resource lifecycle.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type {
    BackendState,
    ColumnProfileRequest,
    ColumnProfileResult,
    ColumnSelection,
    ColumnSortKey,
    DatasetImportOptions,
    SetDatasetImportOptionsResult,
    TableData,
    TableSchema,
} from '../../runtime/comms/positronDataExplorerComm';
import { TableDataCache } from './common/tableDataCache';
import { TableSummaryCache } from './common/tableSummaryCache';
import type {
    IPositronDataExplorerInstance,
    PositronDataExplorerDataRequest,
    PositronDataExplorerLayout,
    PositronDataExplorerSelection,
    PositronDataExplorerUiState,
} from './interfaces/positronDataExplorerInstance';
import type { DataExplorerClientInstance } from './languageRuntimeDataExplorerClient';
import { createDefaultDataExplorerUiState } from './positronDataExplorerSummary';

export class PositronDataExplorerInstance implements IPositronDataExplorerInstance {
    private readonly _disposables: vscode.Disposable[] = [];
    private _clientDisposables: vscode.Disposable[] = [];
    private readonly _onDidClose = this._registerEmitter(new vscode.EventEmitter<void>());
    private readonly _onDidDispose = this._registerEmitter(new vscode.EventEmitter<void>());
    private readonly _onDidUpdateBackendState = this._registerEmitter(new vscode.EventEmitter<BackendState>());
    private readonly _onDidRequestFocus = this._registerEmitter(new vscode.EventEmitter<void>());
    private readonly _onDidChangeUiState = this._registerEmitter(new vscode.EventEmitter<PositronDataExplorerUiState>());
    private readonly _onDidChangeForegroundLoading = this._registerEmitter(new vscode.EventEmitter<boolean>());
    private readonly _onDidInvalidateData = this._registerEmitter(new vscode.EventEmitter<{ generation: number; schemaChanged: boolean }>());
    private readonly _onDidChangeSelection = this._registerEmitter(new vscode.EventEmitter<PositronDataExplorerSelection | undefined>());
    private readonly _schemaCache = new Map<number, TableSchema['columns'][number]>();
    private readonly _visibilityOwners = new Set<string>();
    private readonly _tableDataCache: TableDataCache;
    private readonly _tableSummaryCache: TableSummaryCache;
    private readonly _identifier: string;
    private _clientInstance: DataExplorerClientInstance;
    private _uiState: PositronDataExplorerUiState = createDefaultDataExplorerUiState();
    private _focused = false;
    private _foregroundLoadingCount = 0;
    private _dataGeneration = 0;
    private _lastDataRequest: PositronDataExplorerDataRequest | undefined;
    private _selection: PositronDataExplorerSelection | undefined;
    private _dataMutationQueue: Promise<void> = Promise.resolve();
    private _fileHasHeaderRow = true;
    private _fileSheetName: string | undefined;
    private _disposed = false;

    constructor(
        clientInstance: DataExplorerClientInstance,
        private readonly _languageName: string,
        private readonly _inlineOnly = false,
        private readonly _sessionId?: string,
    ) {
        this._identifier = clientInstance.clientId;
        this._clientInstance = clientInstance;
        this._tableDataCache = new TableDataCache(clientInstance);
        this._tableSummaryCache = new TableSummaryCache(clientInstance);
        this._bindClientInstance();
    }

    private _registerEmitter<T>(emitter: vscode.EventEmitter<T>): vscode.EventEmitter<T> {
        this._disposables.push(emitter);
        return emitter;
    }

    get identifier(): string { return this._identifier; }
    get displayName(): string { return this.backendState?.display_name ?? 'Data'; }
    get languageName(): string { return this._languageName; }
    get sessionId(): string | undefined { return this._sessionId; }
    get clientInstance(): DataExplorerClientInstance { return this._clientInstance; }
    get backendState(): BackendState | undefined { return this._clientInstance.cachedBackendState; }
    get numColumns(): number { return this.backendState?.table_shape.num_columns ?? 0; }
    get numRows(): number { return this.backendState?.table_shape.num_rows ?? 0; }
    get supportsFileOptions(): boolean { return this.identifier.startsWith('duckdb:'); }
    get fileHasHeaderRow(): boolean { return this._fileHasHeaderRow; }
    get fileAvailableSheets(): readonly string[] { return this.backendState?.available_sheets ?? []; }
    get fileSelectedSheet(): string | undefined { return this._fileSheetName ?? this.fileAvailableSheets[0]; }
    get inlineOnly(): boolean { return this._inlineOnly; }
    get uiState(): PositronDataExplorerUiState { return this._uiState; }
    get focused(): boolean { return this._focused; }
    get dataGeneration(): number { return this._dataGeneration; }
    get lastDataRequest(): PositronDataExplorerDataRequest | undefined { return this._lastDataRequest; }
    get selection(): PositronDataExplorerSelection | undefined { return this._selection; }

    readonly onDidClose = this._onDidClose.event;
    readonly onDidDispose = this._onDidDispose.event;
    readonly onDidUpdateBackendState = this._onDidUpdateBackendState.event;
    readonly onDidRequestFocus = this._onDidRequestFocus.event;
    readonly onDidChangeUiState = this._onDidChangeUiState.event;
    readonly onDidChangeForegroundLoading = this._onDidChangeForegroundLoading.event;
    readonly onDidInvalidateData = this._onDidInvalidateData.event;
    readonly onDidChangeSelection = this._onDidChangeSelection.event;

    requestFocus(): void { this._onDidRequestFocus.fire(); }

    setLayout(layout: PositronDataExplorerLayout): void {
        if (this._uiState.layout === layout) { return; }
        this._uiState = { ...this._uiState, layout };
        this._onDidChangeUiState.fire(this._uiState);
    }

    setSummaryCollapsed(summaryCollapsed: boolean): void {
        if (this._uiState.summaryCollapsed === summaryCollapsed) { return; }
        this._uiState = { ...this._uiState, summaryCollapsed };
        this._onDidChangeUiState.fire(this._uiState);
    }

    setSummaryWidth(summaryWidth: number): void {
        const normalizedWidth = Math.max(200, Math.min(800, Math.round(summaryWidth)));
        if (this._uiState.summaryWidth === normalizedWidth) { return; }
        this._uiState = { ...this._uiState, summaryWidth: normalizedWidth };
        this._onDidChangeUiState.fire(this._uiState);
    }

    setFocused(focused: boolean): void {
        if (this._focused === focused) { return; }
        this._focused = focused;
    }

    acquireVisibility(ownerId: string): vscode.Disposable {
        if (this._disposed || this._visibilityOwners.has(ownerId)) {
            return new vscode.Disposable(() => undefined);
        }
        this._visibilityOwners.add(ownerId);
        let disposed = false;
        return new vscode.Disposable(() => {
            if (disposed) { return; }
            disposed = true;
            this._visibilityOwners.delete(ownerId);
        });
    }

    async runWithForegroundLoading<T>(task: () => Promise<T>): Promise<T> {
        this._foregroundLoadingCount++;
        if (this._foregroundLoadingCount === 1) {
            this._onDidChangeForegroundLoading.fire(true);
        }
        try {
            return await task();
        } finally {
            this._foregroundLoadingCount--;
            if (this._foregroundLoadingCount === 0) {
                this._onDidChangeForegroundLoading.fire(false);
            }
        }
    }

    async runDataMutation(task: () => Promise<void>, schemaChanged = false): Promise<void> {
        this.invalidateData(schemaChanged);
        const queuedMutation = this._dataMutationQueue.then(task, task);
        this._dataMutationQueue = queuedMutation.then(() => undefined, () => undefined);
        await queuedMutation;
    }

    invalidateData(schemaChanged: boolean): number {
        const generation = ++this._dataGeneration;
        this._tableDataCache.invalidate(generation);
        this._tableSummaryCache.invalidate(generation);
        if (schemaChanged) {
            this._schemaCache.clear();
        }
        this._lastDataRequest = undefined;
        this._onDidInvalidateData.fire({ generation, schemaChanged });
        return generation;
    }

    setLastDataRequest(request: PositronDataExplorerDataRequest): void {
        if (request.generation === this._dataGeneration) {
            this._lastDataRequest = request;
        }
    }

    setSelection(selection: PositronDataExplorerSelection | undefined): void {
        if (JSON.stringify(this._selection) === JSON.stringify(selection)) { return; }
        this._selection = selection;
        this._onDidChangeSelection.fire(selection);
    }

    async setSortColumns(sortKeys: ColumnSortKey[]): Promise<void> {
        await this.runDataMutation(async () => {
            await this._clientInstance.setSortColumns(sortKeys);
            await this._clientInstance.updateBackendState();
        });
    }

    rebindClientInstance(clientInstance: DataExplorerClientInstance): void {
        if (this._disposed) {
            clientInstance.dispose();
            throw new Error(`Cannot reconnect disposed Data Explorer ${this.identifier}.`);
        }
        if (clientInstance.clientId !== this.identifier) {
            clientInstance.dispose();
            throw new Error(`Cannot reconnect ${this.identifier} with client ${clientInstance.clientId}.`);
        }
        this._disposeClientBindings();
        const previousClientInstance = this._clientInstance;
        this._clientInstance = clientInstance;
        this._tableDataCache.rebindClientInstance(clientInstance);
        this._tableSummaryCache.rebindClientInstance(clientInstance);
        this.invalidateData(true);
        this._bindClientInstance();
        previousClientInstance.dispose();
        const state = clientInstance.cachedBackendState;
        if (state) {
            this._onDidUpdateBackendState.fire(state);
        }
    }

    async getSchema(columnIndices: number[]): Promise<TableSchema> {
        if (columnIndices.length === 0) { return { columns: [] }; }
        const uniqueColumnIndices = [...new Set(columnIndices)];
        const missing = uniqueColumnIndices.filter(index => !this._schemaCache.has(index));
        if (missing.length > 0) {
            const schema = await this._clientInstance.getSchema(missing);
            schema.columns.forEach(column => this._schemaCache.set(column.column_index, column));
        }
        return {
            columns: columnIndices
                .map(index => this._schemaCache.get(index))
                .filter((column): column is TableSchema['columns'][number] => Boolean(column)),
        };
    }

    getDataValues(columns: ColumnSelection[], generation: number): Promise<TableData> {
        return this._tableDataCache.getDataValues(columns, generation);
    }

    requestColumnProfiles(
        profiles: ColumnProfileRequest[],
        generation: number,
        token?: vscode.CancellationToken,
    ): Promise<ColumnProfileResult[]> {
        return this._tableSummaryCache.requestColumnProfiles(profiles, generation, token);
    }

    getTableDataTsv(
        token?: vscode.CancellationToken,
        onProgress?: (completedRows: number, totalRows: number) => void,
    ): Promise<string> {
        return this._tableDataCache.getTableDataTsv(
            this.numRows,
            this.numColumns,
            this._dataGeneration,
            token,
            onProgress,
        );
    }

    async setDatasetImportOptions(options: DatasetImportOptions): Promise<SetDatasetImportOptionsResult> {
        let result: SetDatasetImportOptionsResult = {};
        await this.runDataMutation(async () => {
            result = await this._clientInstance.setDatasetImportOptions(options);
            if (options.has_header_row !== undefined) { this._fileHasHeaderRow = options.has_header_row; }
            if (Object.prototype.hasOwnProperty.call(options, 'sheet_name')) { this._fileSheetName = options.sheet_name; }
        }, true);
        return result;
    }

    dispose(): void {
        if (this._disposed) { return; }
        this._disposed = true;
        this._visibilityOwners.clear();
        this._disposeClientBindings();
        this._tableDataCache.dispose();
        this._tableSummaryCache.dispose();
        this._clientInstance.dispose();
        this._onDidDispose.fire();
        this._disposables.forEach(disposable => disposable.dispose());
    }

    private _bindClientInstance(): void {
        this._clientDisposables = [
            this._clientInstance.onDidClose(() => {
                if (this._disposed) { return; }
                this.invalidateData(true);
                this._onDidClose.fire();
            }),
            this._clientInstance.onDidUpdateBackendState(state => {
                this._onDidUpdateBackendState.fire(state);
            }),
            this._clientInstance.onDidSchemaUpdate(() => this.invalidateData(true)),
            this._clientInstance.onDidDataUpdate(() => this.invalidateData(false)),
        ];
    }

    private _disposeClientBindings(): void {
        this._clientDisposables.forEach(disposable => disposable.dispose());
        this._clientDisposables = [];
    }

}

export type {
    IPositronDataExplorerInstance,
    PositronDataExplorerDataRequest,
    PositronDataExplorerLayout,
    PositronDataExplorerSelection,
    PositronDataExplorerUiState,
} from './interfaces/positronDataExplorerInstance';
