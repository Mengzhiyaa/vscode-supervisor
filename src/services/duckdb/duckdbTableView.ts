/*---------------------------------------------------------------------------------------------
 *  DuckDB Table View
 *  Manages a single file opened as a table in DuckDB, maintaining sort/filter state
 *  and generating SQL queries for all Data Explorer operations.
 *
 *  Aligned with positron's DuckDBTableView: server-side SQL formatting, TABLE-based
 *  import with VFS cleanup, rowid stable sorting, gzip support, CSV retry.
 *--------------------------------------------------------------------------------------------*/

import { getErrorMessage } from '../../shared/errors';
import * as vscode from 'vscode';
import * as path from 'path';
import { readImportFile, throwIfImportCancelled } from './fileImport';
import { formatExport, stringifyExportCell } from './exportFormatting';
import { DuckDBInstance } from './duckdbInstance';
import {
    formatDecimal,
    formatFloat,
    formatInteger,
    isDecimalLiteral,
    isIntegerLiteral,
    truncate,
} from './valueFormatting';
import { createDuckDBReadPlan, type IDuckDBReadPlan } from './duckdbReadPlan';
import { readXlsxWorksheetMetadata, type XlsxWorksheetMetadata } from './xlsxWorkbook';
import { escapeIdentifier, escapeValue, buildWhereClause, buildCountQuery } from './sqlBuilder';
import {
    ColumnSchema,
    ColumnDisplayType,
    TableSchema,
    TableData,
    TableRowLabels,
    FormatOptions,
    ColumnSelection,
    ColumnFilter,
    ColumnFilterType,
    RowFilter,
    ColumnSortKey,
    FilterResult,
    ExportedData,
    ExportFormat,
    TableSelection,
    BackendState,
    SupportedFeatures,
    SupportStatus,
    SearchSchemaResult,
    SearchSchemaSortOrder,
    ConvertedCode,
    CodeSyntaxName,
    DatasetImportOptions,
    SetDatasetImportOptionsResult,
    ArraySelection,
    DataSelectionRange,
    DataSelectionIndices,
    FilterTextSearch,
    FilterMatchDataTypes,
    TextSearchType,
    RowFilterType,
    ColumnProfileType,
    TableSelectionKind,
    DataSelectionSingleCell,
    DataSelectionCellRange,
    DataSelectionCellIndices,
    ColumnValue,
} from '../../runtime/comms/positronDataExplorerComm';

export function duckdbDisplayType(dataType: string): ColumnDisplayType {
    const type = dataType.toUpperCase();

    if (type.includes('BOOL')) {
        return ColumnDisplayType.Boolean;
    }
    if (type.includes('TIMESTAMP') || type.includes('DATETIME')) {
        return ColumnDisplayType.Datetime;
    }
    if (type.includes('INTERVAL')) {
        return ColumnDisplayType.Interval;
    }
    if (type.includes('DATE')) {
        return ColumnDisplayType.Date;
    }
    if (type.includes('TIME')) {
        return ColumnDisplayType.Time;
    }
    if (type.includes('DECIMAL') || type.includes('NUMERIC')) {
        return ColumnDisplayType.Decimal;
    }
    if (type.includes('INT')) {
        return ColumnDisplayType.Integer;
    }
    if (type.includes('DOUBLE') || type.includes('FLOAT') || type.includes('REAL')) {
        return ColumnDisplayType.Floating;
    }
    if (
        type.includes('CHAR') ||
        type.includes('TEXT') ||
        type.includes('STRING') ||
        type.includes('UUID')
    ) {
        return ColumnDisplayType.String;
    }
    if (type.includes('BLOB') || type.includes('BYTEA')) {
        return ColumnDisplayType.Object;
    }
    // Anything else (JSON, nested types, etc.) renders as a string.
    return ColumnDisplayType.String;
}

let _tableCounter = 0;

// Sentinel values for special float representations (aligned with positron)
const SENTINEL_NULL = 0;
const SENTINEL_NAN = 2;
const SENTINEL_INF = 10;
const SENTINEL_NEGINF = 11;

/**
 * Type guard to check if an ArraySelection is a DataSelectionRange.
 */
function isSelectionRange(spec: ArraySelection): spec is DataSelectionRange {
    return (spec as DataSelectionRange).first_index !== undefined;
}

/**
 * Properly quotes and escapes an identifier for use in DuckDB SQL.
 * (Re-exported from sqlBuilder but needed locally for SQL generation)
 */
function quoteIdentifier(fieldName: string): string {
    return '"' + fieldName.replace(/"/g, '""') + '"';
}

function getFirstRowValue(result: any, preferredKeys: string[] = []): unknown {
    const row = result?.get?.(0);
    if (!row) {
        return undefined;
    }

    for (const key of preferredKeys) {
        const value = row[key];
        if (value !== undefined) {
            return value;
        }
    }

    const firstFieldName = result?.schema?.fields?.[0]?.name;
    if (firstFieldName) {
        const value = row[firstFieldName];
        if (value !== undefined) {
            return value;
        }
    }

    if (row[0] !== undefined) {
        return row[0];
    }

    if (typeof row === 'object' && row !== null) {
        const [firstValue] = Object.values(row as Record<string, unknown>);
        return firstValue;
    }

    return undefined;
}

/**
 * Per-file table view that maintains the Data Explorer state for one file.
 */
export class DuckDBTableView {
    private readonly _duckdb: DuckDBInstance;
    private _tableName: string;
    private readPlan: IDuckDBReadPlan | undefined;
    private readonly _uri: vscode.Uri;
    private readonly _importLifetime = new vscode.CancellationTokenSource();
    private _importQueue: Promise<void> = Promise.resolve();
    private _disposed = false;

    private _fullSchema: ColumnSchema[] = [];
    private _rowFilters: RowFilter[] = [];
    private _sortKeys: ColumnSortKey[] = [];
    private _columnFilters: ColumnFilter[] = [];
    private _unfilteredRowCount = 0;
    private _filteredRowCount = 0;
    private _hasHeaderRow = true;
    private _displayName = '';
    private _fileType: 'csv' | 'tsv' | 'parquet' | 'xlsx' = 'csv';
    private _isGzipped = false;
    private _availableSheets: readonly string[] = [];
    private _xlsxMetadata: XlsxWorksheetMetadata = {};
    private _xlsxImportedAsText = false;
    private _xlsxRecoverySkipped = false;

    // Cached clause strings for performance (aligned with positron)
    private _whereClause = '';
    private _sortClause = '';

    /** Import options for delimited files */
    importOptions?: DatasetImportOptions;

    constructor(uri: vscode.Uri) {
        this._duckdb = DuckDBInstance.getInstance();
        this._tableName = `__dex_${_tableCounter++}`;
        this._uri = uri;
        this._displayName = uri.path.split('/').pop() || 'data';
        this._detectFileType();
    }

    get uri(): vscode.Uri {
        return this._uri;
    }
    get tableName(): string {
        return this._tableName;
    }
    get displayName(): string {
        return this._displayName;
    }
    get schema(): ColumnSchema[] {
        return this._fullSchema;
    }
    get hasHeaderRow(): boolean {
        return this._hasHeaderRow;
    }
    get whereClause(): string {
        return this._whereClause;
    }
    get filteredRowCount(): number {
        return this._filteredRowCount;
    }

    // =========================================================================
    // File import (aligned with positron: TABLE-based, gzip, retry)
    // =========================================================================

    /**
     * Import a file into DuckDB. Reads file, optionally decompresses gzip,
     * registers buffer, creates TABLE (not VIEW), retrieves schema.
     */
    importFile(options?: DatasetImportOptions, token?: vscode.CancellationToken): Promise<void> {
        const operation = this._importQueue.then(async () => {
            if (this._disposed) {
                throw new vscode.CancellationError();
            }
            throwIfImportCancelled(token);
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Importing ${this._displayName}`,
                    cancellable: true,
                },
                async (progress, progressToken) => {
                    const cancellation = new vscode.CancellationTokenSource();
                    const subscriptions = [
                        this._importLifetime.token.onCancellationRequested(() =>
                            cancellation.cancel(),
                        ),
                        progressToken.onCancellationRequested(() => cancellation.cancel()),
                        token?.onCancellationRequested(() => cancellation.cancel()),
                    ];
                    if (
                        this._disposed ||
                        token?.isCancellationRequested ||
                        progressToken.isCancellationRequested
                    ) {
                        cancellation.cancel();
                    }
                    const staged = new DuckDBTableView(this._uri);
                    const optionsChanged =
                        options?.sheet_name !== this.importOptions?.sheet_name ||
                        (options?.has_header_row ?? true) !== this._hasHeaderRow;
                    let committed = false;
                    try {
                        staged._rowFilters = optionsChanged ? [] : this._rowFilters;
                        staged._rebuildWhereClause();
                        await staged._importFile(options, cancellation.token, progress);
                        throwIfImportCancelled(cancellation.token);
                        const notifyTextImport =
                            staged._xlsxImportedAsText &&
                            (!this._xlsxImportedAsText || optionsChanged);
                        const notifySkippedRecovery =
                            staged._xlsxRecoverySkipped && !this._xlsxRecoverySkipped;
                        const previousTable = this._tableName;
                        const previousReadPlan = this.readPlan;
                        this._tableName = staged._tableName;
                        this.readPlan = staged.readPlan;
                        staged.readPlan = undefined;
                        this._fullSchema = staged._fullSchema;
                        this._availableSheets = staged._availableSheets;
                        this._hasHeaderRow = staged._hasHeaderRow;
                        this._xlsxImportedAsText = staged._xlsxImportedAsText;
                        this._xlsxRecoverySkipped = staged._xlsxRecoverySkipped;
                        this.importOptions = staged.importOptions;
                        this._unfilteredRowCount = staged._unfilteredRowCount;
                        this._filteredRowCount = staged._filteredRowCount;
                        this._rowFilters = staged._rowFilters;
                        if (optionsChanged) {
                            this._sortKeys = [];
                            this._columnFilters = [];
                        }
                        this._rebuildWhereClause();
                        this._rebuildSortClause();
                        committed = true;
                        if (notifyTextImport) {
                            void vscode.window.showWarningMessage(
                                vscode.l10n.t(
                                    'The worksheet in {0} contains mixed cell types and was imported as text to preserve its values. Numbers and dates will use text sorting and filtering.',
                                    this._displayName,
                                ),
                            );
                        }
                        if (notifySkippedRecovery) {
                            void vscode.window.showWarningMessage(
                                vscode.l10n.t(
                                    'The declared worksheet range in {0} is too large for automatic recovery. The displayed table may be incomplete.',
                                    this._displayName,
                                ),
                            );
                        }
                        await previousReadPlan?.dispose();
                        await this._duckdb
                            .query(`DROP TABLE IF EXISTS ${escapeIdentifier(previousTable)}`)
                            .catch(() => undefined);
                    } finally {
                        subscriptions.forEach((subscription) => subscription?.dispose());
                        cancellation.dispose();
                        if (!committed) {
                            await staged.dispose();
                        } else {
                            staged._importLifetime.dispose();
                        }
                    }
                },
            );
        });
        this._importQueue = operation.then(
            () => undefined,
            () => undefined,
        );
        return operation;
    }

    private async _importFile(
        options: DatasetImportOptions | undefined,
        token: vscode.CancellationToken,
        progress: vscode.Progress<{ message?: string }>,
    ): Promise<void> {
        this.importOptions = options;
        if (options?.has_header_row !== undefined) {
            this._hasHeaderRow = options.has_header_row;
        }

        // Read the file
        const fileData = await readImportFile(this._uri, this._isGzipped, token, progress);
        throwIfImportCancelled(token);

        if (this._fileType === 'xlsx') {
            this._xlsxMetadata = await readXlsxWorksheetMetadata(
                fileData,
                options?.sheet_name,
                token,
            );
            this._availableSheets = this._xlsxMetadata.sheets ?? [];
            if (
                options?.sheet_name &&
                this._xlsxMetadata.sheets &&
                !this._availableSheets.includes(options.sheet_name)
            ) {
                throw new Error(
                    `Worksheet '${options.sheet_name}' was not found. Available worksheets: ` +
                        `${this._availableSheets.join(', ') || '(unknown)'}.`,
                );
            }
        }

        // Register the file buffer in DuckDB VFS.
        // For gzipped files, use the base name without .gz so DuckDB sees the correct extension.
        const originalName = this._uri.path.split('/').pop() || 'data';
        const virtualPath = this._isGzipped ? originalName.replace(/\.gz$/i, '') : originalName;
        const vfsName = `${this._tableName}_${virtualPath}`;

        // Use a tightly packed Uint8Array to avoid transfer issues
        const buffer =
            fileData.byteOffset === 0 && fileData.byteLength === fileData.buffer.byteLength
                ? fileData
                : new Uint8Array(
                      fileData.buffer.slice(
                          fileData.byteOffset,
                          fileData.byteOffset + fileData.byteLength,
                      ),
                  );
        throwIfImportCancelled(token);
        progress.report({ message: 'Importing table…' });
        await this._duckdb.registerFileBuffer(vfsName, buffer);

        try {
            // Create a TABLE (not VIEW) based on file type.
            // Using CREATE OR REPLACE TABLE — no need for a separate DROP TABLE query.
            throwIfImportCancelled(token);
            await this._createTable(vfsName, token);
        } finally {
            // Release the VFS buffer — data is now materialized in the TABLE
            await this._duckdb.dropFile(vfsName);
        }

        // Retrieve schema
        throwIfImportCancelled(token);
        await this._loadSchema(token);
        await this._relation(token);

        progress.report({ message: 'Reading table metadata…' });
        await this._updateRowCounts(token);
    }

    /**
     * Re-import the file (e.g., after header row toggle or external edit).
     */
    async reimport(options?: DatasetImportOptions): Promise<void> {
        await this.importFile(options);
    }

    /**
     * Called when the underlying file is updated externally.
     * Re-imports data and reapplies existing filters (aligned with positron).
     */
    async onFileUpdated(): Promise<void> {
        const options = this.importOptions;
        try {
            await this.importFile(options);
        } catch (error) {
            if (
                error instanceof vscode.CancellationError ||
                this._fileType !== 'xlsx' ||
                !options?.sheet_name ||
                !/(?:work)?sheet\b.*\bnot found/i.test(getErrorMessage(error))
            ) {
                throw error;
            }
            if (this.importOptions !== options) {
                return;
            }
            const previousSheet = options.sheet_name;
            await this.importFile({ ...options, sheet_name: undefined });
            void vscode.window.showInformationMessage(
                vscode.l10n.t(
                    'Worksheet {0} is no longer available in {1}. The first worksheet has been opened instead.',
                    previousSheet,
                    this._displayName,
                ),
            );
        }
    }

    private _detectFileType(): void {
        const lowerPath = this._uri.path.toLowerCase();
        // Check for gzip first
        if (lowerPath.endsWith('.gz')) {
            this._isGzipped = true;
            const basePath = lowerPath.slice(0, -3);
            if (basePath.endsWith('.tsv')) {
                this._fileType = 'tsv';
            } else if (basePath.endsWith('.parquet') || basePath.endsWith('.parq')) {
                this._fileType = 'parquet';
            } else {
                this._fileType = 'csv';
            }
        } else if (lowerPath.endsWith('.parquet') || lowerPath.endsWith('.parq')) {
            this._fileType = 'parquet';
        } else if (lowerPath.endsWith('.xlsx')) {
            this._fileType = 'xlsx';
        } else if (lowerPath.endsWith('.tsv')) {
            this._fileType = 'tsv';
        } else {
            this._fileType = 'csv';
        }
    }

    /**
     * Create a TABLE from file. For CSV/TSV, retries with sample_size=-1 on failure
     * (aligned with positron's error recovery).
     */
    private async _createTable(vfsName: string, token?: vscode.CancellationToken): Promise<void> {
        if (this._fileType === 'parquet') {
            await this._duckdb.query(
                `CREATE OR REPLACE TABLE ${escapeIdentifier(this._tableName)} AS SELECT * FROM parquet_scan(${escapeValue(vfsName)})`,
                token,
            );
            return;
        }

        if (this._fileType === 'xlsx') {
            await this._createXlsxTable(vfsName, token);
            return;
        }

        // CSV / TSV
        const buildSql = (extraOptions: string[] = []): string => {
            const options: string[] = [`header=${this._hasHeaderRow}`];
            if (this._fileType === 'tsv') {
                options.push(`delim='\\t'`);
            }
            options.push(...extraOptions);
            return `CREATE OR REPLACE TABLE ${escapeIdentifier(this._tableName)} AS SELECT * FROM read_csv_auto(${escapeValue(vfsName)}, ${options.join(', ')})`;
        };

        try {
            await this._duckdb.query(buildSql(), token);
        } catch {
            throwIfImportCancelled(token);
            // Retry with sample_size=-1 to disable sampling if type inference fails
            // (aligned with positron's error recovery)
            await this._duckdb.query(buildSql(['sample_size=-1']), token);
        }
    }

    private async _ensureExcelExtension(token?: vscode.CancellationToken): Promise<void> {
        try {
            await this._duckdb.query('LOAD excel', token);
        } catch {
            throwIfImportCancelled(token);
            try {
                await this._duckdb.query('INSTALL excel', token);
                await this._duckdb.query('LOAD excel', token);
            } catch (error) {
                throwIfImportCancelled(token);
                throw new Error(
                    `DuckDB Excel support could not be loaded: ${getErrorMessage(error)}`,
                );
            }
        }
    }

    /** A conversion error retries as text; cells are never silently replaced with NULL. */
    private async _readXlsxTable(
        vfsName: string,
        tableName: string,
        range: string | undefined,
        asText: boolean,
        token?: vscode.CancellationToken,
    ): Promise<boolean> {
        const query = (text: boolean) => {
            const options = [`header=${this._hasHeaderRow}`, 'stop_at_empty=false'];
            if (this.importOptions?.sheet_name) {
                options.push(`sheet=${escapeValue(this.importOptions.sheet_name)}`);
            }
            if (range) {
                options.push(`range=${escapeValue(range)}`);
            }
            if (text) {
                options.push('all_varchar=true');
            }
            return (
                `CREATE OR REPLACE TABLE ${escapeIdentifier(tableName)} AS ` +
                `SELECT * FROM read_xlsx(${escapeValue(vfsName)}, ${options.join(', ')})`
            );
        };
        try {
            await this._duckdb.query(query(asText), token);
            return asText;
        } catch (error) {
            throwIfImportCancelled(token);
            if (
                asText ||
                !/(?:could not|cannot|can't|failed to) (?:convert|cast)|conversion error|failed to parse cell/i.test(
                    getErrorMessage(error),
                )
            ) {
                throw error;
            }
            await this._duckdb.query(query(true), token);
            return true;
        }
    }

    private async _createXlsxTable(
        vfsName: string,
        token?: vscode.CancellationToken,
    ): Promise<void> {
        await this._ensureExcelExtension(token);
        let firstError: unknown;
        let firstReadFailed = false;
        try {
            this._xlsxImportedAsText = await this._readXlsxTable(
                vfsName,
                this._tableName,
                undefined,
                false,
                token,
            );
        } catch (error) {
            throwIfImportCancelled(token);
            firstError = error;
            firstReadFailed = true;
        }
        const shape = firstReadFailed
            ? undefined
            : await this._xlsxTableShape(this._tableName, token);
        const range = this._xlsxMetadata.range;
        const needsRecovery =
            range &&
            (firstReadFailed ||
                (shape &&
                    (shape.columns <= 1 || shape.rows === 0) &&
                    (shape.columns < range.width || shape.rows === 0)));
        if (range && needsRecovery) {
            // Some producers mark an entire worksheet as used. Never materialize
            // such an advisory range without a bound, even for a tiny ZIP file.
            const maxRecoveryCells = 5_000_000;
            if (range.width * range.height > maxRecoveryCells) {
                if (firstReadFailed) {
                    throw new Error(
                        `${getErrorMessage(firstError)}. The declared worksheet range is too large for automatic recovery.`,
                    );
                }
                this._xlsxRecoverySkipped = true;
                return;
            }
            const recoveryTable = `__dex_${_tableCounter++}`;
            let recovered = false;
            try {
                const asText = await this._readXlsxTable(
                    vfsName,
                    recoveryTable,
                    range.ref,
                    this._xlsxImportedAsText,
                    token,
                );
                const recoveredShape = await this._xlsxTableShape(recoveryTable, token);
                throwIfImportCancelled(token);
                if (
                    !shape ||
                    (recoveredShape.columns >= shape.columns && recoveredShape.rows >= shape.rows)
                ) {
                    const previousTable = this._tableName;
                    this._tableName = recoveryTable;
                    this._xlsxImportedAsText = asText;
                    recovered = true;
                    await this._duckdb
                        .query(`DROP TABLE IF EXISTS ${escapeIdentifier(previousTable)}`)
                        .catch(() => undefined);
                    return;
                }
            } catch (error) {
                throwIfImportCancelled(token);
                if (firstReadFailed) {
                    throw firstError;
                }
                // Keep the successfully imported table when advisory metadata is stale.
            } finally {
                if (!recovered) {
                    await this._duckdb
                        .query(`DROP TABLE IF EXISTS ${escapeIdentifier(recoveryTable)}`)
                        .catch(() => undefined);
                }
            }
        }
        if (firstReadFailed) {
            throw firstError;
        }
    }

    private async _xlsxTableShape(
        table: string,
        token?: vscode.CancellationToken,
    ): Promise<{ columns: number; rows: number }> {
        const schema = await this._duckdb.query(`DESCRIBE ${escapeIdentifier(table)}`, token);
        const count = await this._duckdb.query(
            `SELECT COUNT(*) AS cnt FROM ${escapeIdentifier(table)}`,
            token,
        );
        return { columns: schema.numRows, rows: Number(getFirstRowValue(count, ['cnt']) ?? 0) };
    }

    private async _loadSchema(token?: vscode.CancellationToken): Promise<void> {
        const result = await this._duckdb.query(
            `DESCRIBE ${escapeIdentifier(this._tableName)}`,
            token,
        );
        this._fullSchema = [];

        for (let i = 0; i < result.numRows; i++) {
            const row = result.get(i);
            if (!row) {
                continue;
            }

            const columnName = String(row['column_name'] ?? row[0] ?? `column_${i}`);
            const typeName = String(row['column_type'] ?? row[1] ?? 'VARCHAR');

            this._fullSchema.push({
                column_name: columnName,
                column_index: i,
                type_name: typeName,
                type_display: duckdbDisplayType(typeName),
            });
        }
    }

    private _getReadPlan(): IDuckDBReadPlan {
        return (this.readPlan ??= createDuckDBReadPlan(
            this._duckdb,
            escapeIdentifier(this._tableName),
            'table',
            this._fullSchema.map((column) => column.column_name),
        ));
    }

    private _relation(token?: vscode.CancellationToken): Promise<string> {
        return this._getReadPlan().relation(token);
    }

    private async _updateRowCounts(token?: vscode.CancellationToken): Promise<void> {
        // Unfiltered count
        const unfilteredResult = await this._duckdb.query(
            buildCountQuery(this._tableName, []),
            token,
        );
        this._unfilteredRowCount = Number(getFirstRowValue(unfilteredResult, ['cnt']) ?? 0);

        // Filtered count
        await this._updateFilteredCount(token);
    }

    private async _updateFilteredCount(token?: vscode.CancellationToken): Promise<void> {
        if (this._rowFilters.length > 0) {
            const countSql = `SELECT COUNT(*) AS cnt FROM ${escapeIdentifier(this._tableName)}${this._whereClause}`;
            const filteredResult = await this._duckdb.query(countSql, token);
            this._filteredRowCount = Number(getFirstRowValue(filteredResult, ['cnt']) ?? 0);
        } else {
            this._filteredRowCount = this._unfilteredRowCount;
        }
    }

    // =========================================================================
    // Data Explorer protocol methods
    // =========================================================================

    async getState(): Promise<BackendState> {
        return {
            display_name: path.basename(this._uri.path),
            table_shape: {
                num_rows: this._filteredRowCount,
                num_columns: this._fullSchema.length,
            },
            table_unfiltered_shape: {
                num_rows: this._unfilteredRowCount,
                num_columns: this._fullSchema.length,
            },
            has_row_labels: false,
            column_filters: this._columnFilters,
            row_filters: this._rowFilters,
            sort_keys: this._sortKeys,
            supported_features: this._getSupportedFeatures(),
            connected: true,
            available_sheets: [...this._availableSheets],
            file_import_options: {
                has_header_row: this._hasHeaderRow,
                sheet_name: this.importOptions?.sheet_name ?? this._availableSheets[0],
            },
        };
    }

    getSchema(columnIndices: number[]): TableSchema {
        const columns = columnIndices.map((i) => this._fullSchema[i]).filter(Boolean);
        return { columns };
    }

    /**
     * Get data values with server-side SQL formatting (aligned with positron).
     *
     * Uses SQL CASE/FORMAT expressions for number formatting, VARCHAR truncation,
     * TIMESTAMP formatting, and sentinel values for special float states.
     */
    async getDataValues(
        columns: ColumnSelection[],
        formatOptions: FormatOptions,
    ): Promise<TableData> {
        if (this._filteredRowCount === 0 || columns.length === 0) {
            return { columns: Array.from({ length: columns.length }, () => []) };
        }
        let lowerLimit = Infinity;
        let upperLimit = -Infinity;
        for (const column of columns) {
            if (isSelectionRange(column.spec)) {
                lowerLimit = Math.min(lowerLimit, column.spec.first_index);
                upperLimit = Math.max(upperLimit, column.spec.last_index);
            } else {
                for (const index of column.spec.indices) {
                    lowerLimit = Math.min(lowerLimit, index);
                    upperLimit = Math.max(upperLimit, index);
                }
            }
        }
        if (!isFinite(lowerLimit) || !isFinite(upperLimit)) {
            return { columns: Array.from({ length: columns.length }, () => []) };
        }
        const numRows = upperLimit - lowerLimit + 1;
        const selectors = columns.map((column, i) => {
            const schema = this._fullSchema[column.column_index];
            const quotedName = quoteIdentifier(schema.column_name);
            // Arrow's wide integer, decimal, and temporal representations are transport-specific.
            // Keep exact digits and source date/time text at this boundary.
            const text = [
                ColumnDisplayType.Integer,
                ColumnDisplayType.Decimal,
                ColumnDisplayType.Date,
                ColumnDisplayType.Datetime,
                ColumnDisplayType.Time,
                ColumnDisplayType.Interval,
            ].includes(schema.type_display);
            return `${text ? `CAST(${quotedName} AS VARCHAR)` : quotedName} AS c${i}`;
        });
        const query =
            `SELECT ${selectors.join(', ')} FROM ${await this._relation()}` +
            `${this._whereClause}${this._sortClause} LIMIT ${numRows} OFFSET ${lowerLimit}`;
        const rows = await this._duckdb.query(query);
        const result: TableData = { columns: [] };
        for (let i = 0; i < columns.length; i++) {
            const column = columns[i];
            const displayType = this._fullSchema[column.column_index].type_display;
            const field = rows.getChildAt(i);
            const format = (absIndex: number): ColumnValue => {
                const index = absIndex - lowerLimit;
                return index < 0 || index >= rows.numRows || !field?.isValid(index)
                    ? SENTINEL_NULL
                    : this._formatValue(field.get(index), displayType, formatOptions);
            };
            if (isSelectionRange(column.spec)) {
                const values: ColumnValue[] = [];
                const lastIndex = Math.min(column.spec.last_index, lowerLimit + rows.numRows - 1);
                for (let index = column.spec.first_index; index <= lastIndex; index++) {
                    values.push(format(index));
                }
                result.columns.push(values);
            } else {
                result.columns.push(column.spec.indices.map(format));
            }
        }
        return result;
    }

    private _formatValue(
        value: unknown,
        displayType: ColumnDisplayType,
        opts: FormatOptions,
    ): ColumnValue {
        if (value === null || value === undefined) {
            return SENTINEL_NULL;
        }

        switch (displayType) {
            case ColumnDisplayType.Floating:
            case ColumnDisplayType.Decimal: {
                // `getRowObjectsJS` yields a JS number for DECIMAL columns, so a wide DECIMAL has already
                // lost its precision by the time it reaches here and this guard does not fire. Recovering
                // it means reading those columns as their exact text at the worker boundary, which is
                // separable work (see #15366); the exact-string path is shared with the other drivers so
                // it will simply start working once the values arrive intact.
                if (displayType === ColumnDisplayType.Decimal && isDecimalLiteral(value)) {
                    return formatDecimal(value, opts);
                }
                const num = typeof value === 'number' ? value : Number(value);
                if (Number.isNaN(num)) {
                    return SENTINEL_NAN;
                }
                if (num === Infinity) {
                    return SENTINEL_INF;
                }
                if (num === -Infinity) {
                    return SENTINEL_NEGINF;
                }
                return formatFloat(num, opts);
            }
            case ColumnDisplayType.Integer: {
                // Both wide integer shapes reach the formatter without passing through a JS number, which
                // would round anything beyond 2^53: a 64-bit integer arrives as a bigint, and a
                // DECIMAL(n,0) as an exact digit string. Anything else -- a plain number, or a string that
                // isn't a clean integer literal -- is coerced as before.
                const num =
                    typeof value === 'bigint' || isIntegerLiteral(value) ? value : Number(value);
                return formatInteger(num, opts);
            }
            case ColumnDisplayType.Boolean:
                return typeof value === 'boolean'
                    ? value
                        ? 'true'
                        : 'false'
                    : truncate(String(value), opts);
            case ColumnDisplayType.Object:
                // BLOB and other opaque values.
                if (value instanceof Uint8Array) {
                    return `[BLOB ${value.byteLength} bytes]`;
                }
                return truncate(String(value), opts);
            default:
                return truncate(String(value), opts);
        }
    }

    async getRowLabels(
        selection: ArraySelection,
        _formatOptions: FormatOptions,
    ): Promise<TableRowLabels> {
        // DuckDB doesn't have row labels like R data frames
        // Return sequential row numbers based on the selection
        const labels: string[][] = [];
        if ('first_index' in selection && 'last_index' in selection) {
            const range = selection as DataSelectionRange;
            for (let i = range.first_index; i <= range.last_index; i++) {
                labels.push([String(i + 1)]);
            }
        }
        return { row_labels: labels };
    }

    async setRowFilters(filters: RowFilter[]): Promise<FilterResult> {
        this._rowFilters = filters;
        this._rebuildWhereClause();
        await this._updateFilteredCount();

        const hasErrors = filters.some((f) => f.is_valid === false);
        return {
            selected_num_rows: this._filteredRowCount,
            had_errors: hasErrors,
        };
    }

    /**
     * Rebuild the cached WHERE clause string from current filters.
     */
    private _rebuildWhereClause(): void {
        if (this._rowFilters.length === 0) {
            this._whereClause = '';
            return;
        }
        const clause = buildWhereClause(this._rowFilters);
        this._whereClause = clause ? `\n${clause}` : '';
    }

    /**
     * Set sort columns with the read plan's row order as a stable tiebreaker.
     */
    setSortColumns(sortKeys: ColumnSortKey[]): void {
        this._sortKeys = sortKeys;
        this._rebuildSortClause();
    }

    private _rebuildSortClause(): void {
        this._sortClause = this._buildSortClause(this._sortKeys, true);
    }

    private _buildSortClause(sortKeys: ColumnSortKey[], includeTiebreaker: boolean): string {
        const exprs: string[] = [];
        for (const key of sortKeys) {
            const col = this._fullSchema[key.column_index];
            if (!col) {
                continue;
            }
            const modifier = key.ascending ? '' : ' DESC';
            exprs.push(`${quoteIdentifier(col.column_name)}${modifier}`);
        }

        if (includeTiebreaker && exprs.length > 0) {
            exprs.push(this._getReadPlan().rowOrder);
        }
        return exprs.length > 0 ? `\nORDER BY ${exprs.join(', ')}` : '';
    }

    setColumnFilters(filters: ColumnFilter[]): void {
        void filters;
        throw new Error('set_column_filters is not supported by the DuckDB backend');
    }

    searchSchema(filters: ColumnFilter[], sortOrder: SearchSchemaSortOrder): SearchSchemaResult {
        let indices = this._fullSchema.map((_, i) => i);

        // Apply column filters (enhanced with case sensitivity and regex support)
        for (const filter of filters) {
            if (filter.filter_type === ColumnFilterType.TextSearch) {
                const params = filter.params as FilterTextSearch;
                const caseSensitive = params.case_sensitive ?? false;

                indices = indices.filter((i) => {
                    const col = this._fullSchema[i];
                    const columnName = caseSensitive
                        ? col.column_name
                        : col.column_name.toLowerCase();
                    const searchTerm = caseSensitive ? params.term : params.term.toLowerCase();

                    switch (params.search_type) {
                        case TextSearchType.Contains:
                            return columnName.includes(searchTerm);
                        case TextSearchType.NotContains:
                            return !columnName.includes(searchTerm);
                        case TextSearchType.StartsWith:
                            return columnName.startsWith(searchTerm);
                        case TextSearchType.EndsWith:
                            return columnName.endsWith(searchTerm);
                        case TextSearchType.RegexMatch:
                            try {
                                const regex = new RegExp(params.term, caseSensitive ? '' : 'i');
                                return regex.test(col.column_name);
                            } catch {
                                return false;
                            }
                        default:
                            return true;
                    }
                });
            } else if (filter.filter_type === ColumnFilterType.MatchDataTypes) {
                const params = filter.params as FilterMatchDataTypes;
                const types = new Set(params.display_types);
                indices = indices.filter((i) => {
                    const col = this._fullSchema[i];
                    return types.has(col.type_display);
                });
            }
        }

        // Apply sort order
        switch (sortOrder) {
            case SearchSchemaSortOrder.AscendingName:
                indices.sort((a, b) =>
                    this._fullSchema[a].column_name
                        .toLowerCase()
                        .localeCompare(this._fullSchema[b].column_name.toLowerCase()),
                );
                break;
            case SearchSchemaSortOrder.DescendingName:
                indices.sort((a, b) =>
                    this._fullSchema[b].column_name
                        .toLowerCase()
                        .localeCompare(this._fullSchema[a].column_name.toLowerCase()),
                );
                break;
            case SearchSchemaSortOrder.AscendingType:
                indices.sort((a, b) =>
                    this._fullSchema[a].type_name
                        .toLowerCase()
                        .localeCompare(this._fullSchema[b].type_name.toLowerCase()),
                );
                break;
            case SearchSchemaSortOrder.DescendingType:
                indices.sort((a, b) =>
                    this._fullSchema[b].type_name
                        .toLowerCase()
                        .localeCompare(this._fullSchema[a].type_name.toLowerCase()),
                );
                break;
            // SearchSchemaSortOrder.Original — keep original order
        }

        return { matches: indices };
    }

    /**
     * Export data selection with proper formatting (aligned with positron).
     * Supports SingleCell, CellRange, RowRange, ColumnRange, RowIndices,
     * ColumnIndices, and CellIndices selection types.
     */
    async exportDataSelection(
        selection: TableSelection,
        format: ExportFormat,
    ): Promise<ExportedData> {
        const kind = selection.kind;

        // Keep Arrow's exact integer, decimal, and temporal text at the transport boundary.
        // Other values, including BLOBs, reach stringifyExportCell as raw values.
        const selectorsFor = (columns: ColumnSchema[]): string =>
            columns
                .map((column, index) => {
                    const quotedName = quoteIdentifier(column.column_name);
                    const asText = [
                        ColumnDisplayType.Integer,
                        ColumnDisplayType.Decimal,
                        ColumnDisplayType.Date,
                        ColumnDisplayType.Datetime,
                        ColumnDisplayType.Time,
                        ColumnDisplayType.Interval,
                    ].includes(column.type_display);
                    return `${asText ? `CAST(${quotedName} AS VARCHAR)` : quotedName} AS c${index}`;
                })
                .join(', ');

        const runExport = async (query: string, columns: ColumnSchema[]): Promise<ExportedData> => {
            const queryResult = await this._duckdb.query(query);
            const matrix = [
                columns.map((column) => column.column_name),
                ...Array.from({ length: queryResult.numRows }, (_, index) => {
                    const row = queryResult.get(index);
                    return columns.map((_, columnIndex) =>
                        stringifyExportCell(row?.[`c${columnIndex}`]),
                    );
                }),
            ];
            return { data: formatExport(matrix, format), format };
        };

        const tableName = await this._relation();

        switch (kind) {
            case TableSelectionKind.SingleCell: {
                const sel = selection.selection as DataSelectionSingleCell;
                const col = this._fullSchema[sel.column_index];
                if (!col) {
                    return { data: '', format };
                }
                const selectors = selectorsFor([col]);
                const query = `SELECT ${selectors} FROM ${tableName}${this._whereClause}${this._sortClause} LIMIT 1 OFFSET ${sel.row_index};`;
                const result = await this._duckdb.query(query);
                const row = result.get(0);
                return {
                    data: stringifyExportCell(row?.c0),
                    format,
                };
            }
            case TableSelectionKind.CellRange: {
                const sel = selection.selection as DataSelectionCellRange;
                const columns = this._fullSchema.slice(
                    sel.first_column_index,
                    sel.last_column_index + 1,
                );
                const selectors = selectorsFor(columns);
                const query = `SELECT ${selectors} FROM ${tableName}${this._whereClause}${this._sortClause} LIMIT ${sel.last_row_index - sel.first_row_index + 1} OFFSET ${sel.first_row_index};`;
                return await runExport(query, columns);
            }
            case TableSelectionKind.RowRange: {
                const sel = selection.selection as DataSelectionRange;
                const selectors = selectorsFor(this._fullSchema);
                const query = `SELECT ${selectors} FROM ${tableName}${this._whereClause}${this._sortClause} LIMIT ${sel.last_index - sel.first_index + 1} OFFSET ${sel.first_index};`;
                return await runExport(query, this._fullSchema);
            }
            case TableSelectionKind.ColumnRange: {
                const sel = selection.selection as DataSelectionRange;
                const columns = this._fullSchema.slice(sel.first_index, sel.last_index + 1);
                const selectors = selectorsFor(columns);
                const query = `SELECT ${selectors} FROM ${tableName}${this._whereClause}${this._sortClause}`;
                return await runExport(query, columns);
            }
            case TableSelectionKind.RowIndices: {
                const sel = selection.selection as DataSelectionIndices;
                // Row indexes refer to the displayed table, just like cell indexes.
                return this.exportDataSelection(
                    {
                        kind: TableSelectionKind.CellIndices,
                        selection: {
                            column_indices: this._fullSchema.map((_, index) => index),
                            row_indices: sel.indices,
                        },
                    },
                    format,
                );
            }
            case TableSelectionKind.ColumnIndices: {
                const sel = selection.selection as DataSelectionIndices;
                const columns = sel.indices.map((i) => this._fullSchema[i]).filter(Boolean);
                const selectors = selectorsFor(columns);
                const query = `SELECT ${selectors} FROM ${tableName}${this._whereClause}${this._sortClause}`;
                return await runExport(query, columns);
            }
            case TableSelectionKind.CellIndices: {
                const sel = selection.selection as DataSelectionCellIndices;
                const columns = sel.column_indices.map((i) => this._fullSchema[i]).filter(Boolean);
                if (sel.row_indices.length === 0 || columns.length === 0) {
                    return { data: '', format };
                }
                const selectors = selectorsFor(columns);

                const query = this._rowIndexQuery(tableName, selectors, sel.row_indices);
                return await runExport(query, columns);
            }
            default: {
                // Fallback: all data
                const selectors = selectorsFor(this._fullSchema);
                const query = `SELECT ${selectors} FROM ${tableName}${this._whereClause}${this._sortClause}`;
                return await runExport(query, this._fullSchema);
            }
        }
    }

    /** Selects displayed row positions in the requested order, including pinned rows. */
    private _rowIndexQuery(relation: string, selectors: string, rowIndices: number[]): string {
        const ordering = this._sortClause
            ? this._sortClause.replace(/^\n/, '')
            : `ORDER BY ${this._getReadPlan().rowOrder}`;
        const names = new Set(this._fullSchema.map((column) => column.column_name.toLowerCase()));
        let rowIndexColumn = '__row_index';
        while (names.has(rowIndexColumn.toLowerCase())) {
            rowIndexColumn += '_';
        }
        const index = quoteIdentifier(rowIndexColumn);
        const numbered =
            `SELECT *, ROW_NUMBER() OVER (${ordering}) - 1 AS ${index} ` +
            `FROM ${relation}${this._whereClause}`;
        const order = rowIndices.map((rowIdx, i) => `WHEN ${rowIdx} THEN ${i}`).join(' ');
        const inList = rowIndices.join(', ');
        return (
            `SELECT ${selectors} FROM (${numbered}) WHERE ${index} IN (${inList}) ` +
            `ORDER BY CASE ${index} ${order} END`
        );
    }

    /**
     * Convert current filters and sort to SQL code.
     * Uses filename without extension as table name (aligned with positron).
     */
    convertToCode(
        _columnFilters: ColumnFilter[],
        rowFilters: RowFilter[],
        sortKeys: ColumnSortKey[],
        _codeSyntaxName: CodeSyntaxName,
    ): ConvertedCode {
        // Use filename without extension as the display table name
        const ext = path.extname(this._uri.path);
        const filename = path.basename(this._uri.path, ext);
        const escapedFilename = filename.replace(/"/g, '""');

        const result: string[] = ['SELECT * ', `FROM "${escapedFilename}"`];

        if (this._whereClause) {
            // Use the cached clause, clean up newlines
            const whereClause = this._whereClause.replace(/\n/g, ' ').trim();
            result.push(whereClause);
        }

        if (this._sortKeys.length > 0) {
            // Generate user-facing sort clause WITHOUT the auxiliary rowid
            const sortExprs: string[] = [];
            for (const key of this._sortKeys) {
                const col = this._fullSchema[key.column_index];
                if (!col) {
                    continue;
                }
                const modifier = key.ascending ? '' : ' DESC';
                sortExprs.push(`${quoteIdentifier(col.column_name)}${modifier}`);
            }
            result.push(`ORDER BY ${sortExprs.join(', ')}`);
        }

        return { converted_code: result };
    }

    suggestCodeSyntax(): CodeSyntaxName | undefined {
        return { code_syntax_name: 'SQL' };
    }

    async setDatasetImportOptions(
        options: DatasetImportOptions,
    ): Promise<SetDatasetImportOptionsResult> {
        try {
            await this.reimport(options);
            return {};
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }
            return { error_message: getErrorMessage(error) };
        }
    }

    // =========================================================================
    // Cleanup
    // =========================================================================

    async dispose(): Promise<void> {
        this._disposed = true;
        this._importLifetime.cancel();
        await this._importQueue;
        this._importLifetime.dispose();
        await this.readPlan?.dispose();
        this.readPlan = undefined;
        try {
            await this._duckdb.query(`DROP TABLE IF EXISTS ${escapeIdentifier(this._tableName)}`);
        } catch {
            // Ignore cleanup errors
        }
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    private _getSupportedFeatures(): SupportedFeatures {
        return {
            search_schema: {
                support_status: SupportStatus.Supported,
                supported_types: [
                    {
                        column_filter_type: ColumnFilterType.TextSearch,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        column_filter_type: ColumnFilterType.MatchDataTypes,
                        support_status: SupportStatus.Supported,
                    },
                ],
            },
            set_column_filters: {
                support_status: SupportStatus.Unsupported,
                supported_types: [],
            },
            set_row_filters: {
                support_status: SupportStatus.Supported,
                supports_conditions: SupportStatus.Unsupported,
                supported_types: [
                    {
                        row_filter_type: RowFilterType.Between,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        row_filter_type: RowFilterType.Compare,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        row_filter_type: RowFilterType.IsEmpty,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        row_filter_type: RowFilterType.IsFalse,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        row_filter_type: RowFilterType.IsNull,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        row_filter_type: RowFilterType.IsTrue,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        row_filter_type: RowFilterType.NotBetween,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        row_filter_type: RowFilterType.NotEmpty,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        row_filter_type: RowFilterType.NotNull,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        row_filter_type: RowFilterType.Search,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        row_filter_type: RowFilterType.SetMembership,
                        support_status: SupportStatus.Supported,
                    },
                ],
            },
            get_column_profiles: {
                support_status: SupportStatus.Supported,
                supported_types: [
                    {
                        profile_type: ColumnProfileType.NullCount,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        profile_type: ColumnProfileType.SummaryStats,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        profile_type: ColumnProfileType.SmallHistogram,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        profile_type: ColumnProfileType.LargeHistogram,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        profile_type: ColumnProfileType.SmallFrequencyTable,
                        support_status: SupportStatus.Supported,
                    },
                    {
                        profile_type: ColumnProfileType.LargeFrequencyTable,
                        support_status: SupportStatus.Supported,
                    },
                ],
            },
            set_sort_columns: {
                support_status: SupportStatus.Supported,
            },
            export_data_selection: {
                support_status: SupportStatus.Supported,
                supported_formats: [ExportFormat.Csv, ExportFormat.Tsv, ExportFormat.Html],
            },
            convert_to_code: {
                support_status: SupportStatus.Supported,
                code_syntaxes: [{ code_syntax_name: 'SQL' }],
            },
        };
    }
}
