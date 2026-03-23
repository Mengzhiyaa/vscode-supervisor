/*---------------------------------------------------------------------------------------------
 *  DuckDB Data Explorer Comm
 *  Implements IDataExplorerComm interface backed by DuckDBTableView
 *  This adapts DuckDB SQL queries to the Data Explorer communication protocol
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DuckDBTableView } from './duckdbTableView';
import { ColumnProfileEvaluator } from './columnProfileEvaluator';
import {
    IDataExplorerComm,
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
    SearchSchemaResult,
    SearchSchemaSortOrder,
    ConvertedCode,
    CodeSyntaxName,
    DatasetImportOptions,
    SetDatasetImportOptionsResult,
    SchemaUpdateEvent,
    DataUpdateEvent,
    ReturnColumnProfilesEvent,
} from '../../runtime/comms/positronDataExplorerComm';

/**
 * IDataExplorerComm implementation backed by DuckDB-WASM.
 * Bridges the Data Explorer protocol to SQL queries via DuckDBTableView.
 */
export class DuckDBDataExplorerComm implements IDataExplorerComm {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _profileEvaluator: ColumnProfileEvaluator;
    private _fileWatcher: vscode.FileSystemWatcher | undefined;
    private _disposed = false;

    // Event emitters
    private readonly _onDidSchemaUpdate = new vscode.EventEmitter<SchemaUpdateEvent>();
    private readonly _onDidDataUpdate = new vscode.EventEmitter<DataUpdateEvent>();
    private readonly _onDidReturnColumnProfiles = new vscode.EventEmitter<ReturnColumnProfilesEvent>();
    private readonly _onDidClose = new vscode.EventEmitter<void>();

    readonly onDidSchemaUpdate = this._onDidSchemaUpdate.event;
    readonly onDidDataUpdate = this._onDidDataUpdate.event;
    readonly onDidReturnColumnProfiles = this._onDidReturnColumnProfiles.event;
    readonly onDidClose = this._onDidClose.event;

    constructor(
        private readonly _tableView: DuckDBTableView,
        private readonly _logChannel: vscode.LogOutputChannel
    ) {
        this._profileEvaluator = new ColumnProfileEvaluator();
        this._disposables.push(this._onDidSchemaUpdate);
        this._disposables.push(this._onDidDataUpdate);
        this._disposables.push(this._onDidReturnColumnProfiles);
        this._disposables.push(this._onDidClose);

        this._setupFileWatcher();
    }

    // --- IDataExplorerComm properties ---

    get clientId(): string {
        return `duckdb:${this._tableView.uri.toString()}`;
    }

    // --- RPC Methods ---

    async getState(): Promise<BackendState> {
        return this._tableView.getState();
    }

    async getSchema(columnIndices: number[]): Promise<TableSchema> {
        return this._tableView.getSchema(columnIndices);
    }

    async searchSchema(
        filters: ColumnFilter[],
        sortOrder: SearchSchemaSortOrder
    ): Promise<SearchSchemaResult> {
        return this._tableView.searchSchema(filters, sortOrder);
    }

    async getDataValues(
        columns: ColumnSelection[],
        formatOptions: FormatOptions
    ): Promise<TableData> {
        return this._tableView.getDataValues(columns, formatOptions);
    }

    async getRowLabels(
        selection: ArraySelection,
        formatOptions: FormatOptions
    ): Promise<TableRowLabels> {
        return this._tableView.getRowLabels(selection, formatOptions);
    }

    async exportDataSelection(
        selection: TableSelection,
        format: ExportFormat
    ): Promise<ExportedData> {
        return this._tableView.exportDataSelection(selection, format);
    }

    async convertToCode(
        columnFilters: ColumnFilter[],
        rowFilters: RowFilter[],
        sortKeys: ColumnSortKey[],
        codeSyntaxName: CodeSyntaxName
    ): Promise<ConvertedCode> {
        return this._tableView.convertToCode(
            columnFilters, rowFilters, sortKeys, codeSyntaxName
        );
    }

    async suggestCodeSyntax(): Promise<CodeSyntaxName | undefined> {
        return this._tableView.suggestCodeSyntax();
    }

    async openDataExplorer(): Promise<void> {
        // No-op: the Data Explorer is already open when this comm exists
    }

    async setColumnFilters(filters: ColumnFilter[]): Promise<void> {
        this._tableView.setColumnFilters(filters);
    }

    async setRowFilters(filters: RowFilter[]): Promise<FilterResult> {
        return this._tableView.setRowFilters(filters);
    }

    async setSortColumns(sortKeys: ColumnSortKey[]): Promise<void> {
        this._tableView.setSortColumns(sortKeys);
    }

    async getColumnProfiles(
        callbackId: string,
        profiles: ColumnProfileRequest[],
        formatOptions: FormatOptions
    ): Promise<void> {
        // Compute profiles asynchronously, then fire the event
        try {
            const results = await this._profileEvaluator.evaluateProfiles(
                this._tableView.tableName,
                this._tableView.schema,
                profiles,
                formatOptions,
                this._tableView.whereClause,
                this._tableView.filteredRowCount
            );

            this._onDidReturnColumnProfiles.fire({
                callback_id: callbackId,
                profiles: results,
            });
        } catch (error) {
            this._logChannel.error(`[DuckDB] Column profile evaluation failed: ${error}`);
            this._onDidReturnColumnProfiles.fire({
                callback_id: callbackId,
                profiles: profiles.map(() => ({})),
                error_message: String(error),
            });
        }
    }

    async setDatasetImportOptions(
        options: DatasetImportOptions
    ): Promise<SetDatasetImportOptionsResult> {
        const result = await this._tableView.setDatasetImportOptions(options);
        if (!result.error_message) {
            // Re-import succeeded — fire schema and data update events
            this._onDidSchemaUpdate.fire({});
            this._onDidDataUpdate.fire({});
        }
        return result;
    }

    // --- Lifecycle ---

    closeClient(): void {
        this.dispose();
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;

        this._onDidClose.fire();

        if (this._fileWatcher) {
            this._fileWatcher.dispose();
            this._fileWatcher = undefined;
        }

        // Dispose the table view (drops DuckDB resources)
        this._tableView.dispose().catch(() => { });

        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables.length = 0;
    }

    // --- Private ---

    private _setupFileWatcher(): void {
        const uri = this._tableView.uri;

        // Only watch local files
        if (uri.scheme !== 'file') {
            return;
        }

        try {
            const pattern = new vscode.RelativePattern(
                vscode.Uri.file(uri.path.substring(0, uri.path.lastIndexOf('/'))),
                uri.path.split('/').pop()!
            );

            this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

            this._fileWatcher.onDidChange(async () => {
                this._logChannel.info(`[DuckDB] File changed: ${uri.toString()}`);
                try {
                    // Use onFileUpdated() to re-import AND reapply existing filters
                    // (aligned with positron's file change handling)
                    await this._tableView.onFileUpdated();
                    this._onDidSchemaUpdate.fire({});
                    this._onDidDataUpdate.fire({});
                } catch (error) {
                    this._logChannel.error(`[DuckDB] File reload failed: ${error}`);
                }
            });

            this._fileWatcher.onDidDelete(() => {
                this._logChannel.info(`[DuckDB] File deleted: ${uri.toString()}`);
                this.dispose();
            });
        } catch (error) {
            this._logChannel.warn(`[DuckDB] File watcher setup failed: ${error}`);
        }
    }
}
