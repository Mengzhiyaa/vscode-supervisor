/*---------------------------------------------------------------------------------------------
 *  DuckDB Table View
 *  Manages a single file opened as a table in DuckDB, maintaining sort/filter state
 *  and generating SQL queries for all Data Explorer operations.
 *
 *  Aligned with positron's DuckDBTableView: server-side SQL formatting, TABLE-based
 *  import with VFS cleanup, rowid stable sorting, gzip support, CSV retry.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { readImportFile, throwIfImportCancelled } from './fileImport';
import { DuckDBInstance } from './duckdbInstance';
import { readXlsxWorksheetMetadata, type XlsxWorksheetMetadata } from './xlsxWorkbook';
import {
    escapeIdentifier,
    escapeValue,
    buildWhereClause,
    buildCountQuery,
} from './sqlBuilder';
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

function escapeDelimitedValue(value: string, delimiter: string): string {
    if (
        !value.includes(delimiter) &&
        !value.includes('"') &&
        !value.includes('\n') &&
        !value.includes('\r')
    ) {
        return value;
    }

    return `"${value.replace(/"/g, '""')}"`;
}

function escapeHtmlCell(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case '&':
                return '&amp;';
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            case '\'':
                return '&#39;';
            default:
                return char;
        }
    });
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

    get uri(): vscode.Uri { return this._uri; }
    get tableName(): string { return this._tableName; }
    get displayName(): string { return this._displayName; }
    get schema(): ColumnSchema[] { return this._fullSchema; }
    get hasHeaderRow(): boolean { return this._hasHeaderRow; }
    get whereClause(): string { return this._whereClause; }
    get filteredRowCount(): number { return this._filteredRowCount; }

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
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Importing ${this._displayName}`,
                cancellable: true,
            }, async (progress, progressToken) => {
                const cancellation = new vscode.CancellationTokenSource();
                const subscriptions = [
                    this._importLifetime.token.onCancellationRequested(() => cancellation.cancel()),
                    progressToken.onCancellationRequested(() => cancellation.cancel()),
                    token?.onCancellationRequested(() => cancellation.cancel()),
                ];
                if (this._disposed || token?.isCancellationRequested || progressToken.isCancellationRequested) {
                    cancellation.cancel();
                }
                const staged = new DuckDBTableView(this._uri);
                const optionsChanged = options?.sheet_name !== this.importOptions?.sheet_name ||
                    (options?.has_header_row ?? true) !== this._hasHeaderRow;
                let committed = false;
                try {
                    staged._rowFilters = optionsChanged ? [] : this._rowFilters;
                    staged._rebuildWhereClause();
                    await staged._importFile(options, cancellation.token, progress);
                    throwIfImportCancelled(cancellation.token);
                    const notifyTextImport = staged._xlsxImportedAsText && (!this._xlsxImportedAsText || optionsChanged);
                    const notifySkippedRecovery = staged._xlsxRecoverySkipped && !this._xlsxRecoverySkipped;
                    const previousTable = this._tableName;
                    this._tableName = staged._tableName;
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
                        void vscode.window.showWarningMessage(vscode.l10n.t(
                            'The worksheet in {0} contains mixed cell types and was imported as text to preserve its values. Numbers and dates will use text sorting and filtering.',
                            this._displayName,
                        ));
                    }
                    if (notifySkippedRecovery) {
                        void vscode.window.showWarningMessage(vscode.l10n.t(
                            'The declared worksheet range in {0} is too large for automatic recovery. The displayed table may be incomplete.',
                            this._displayName,
                        ));
                    }
                    await this._duckdb.query(`DROP TABLE IF EXISTS ${escapeIdentifier(previousTable)}`)
                        .catch(() => undefined);
                } finally {
                    subscriptions.forEach(subscription => subscription?.dispose());
                    cancellation.dispose();
                    if (!committed) {
                        await staged.dispose();
                    } else {
                        staged._importLifetime.dispose();
                    }
                }
            });
        });
        this._importQueue = operation.then(() => undefined, () => undefined);
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
            this._xlsxMetadata = await readXlsxWorksheetMetadata(fileData, options?.sheet_name, token);
            this._availableSheets = this._xlsxMetadata.sheets ?? [];
            if (options?.sheet_name && this._xlsxMetadata.sheets && !this._availableSheets.includes(options.sheet_name)) {
                throw new Error(
                    `Worksheet '${options.sheet_name}' was not found. Available worksheets: ` +
                    `${this._availableSheets.join(', ') || '(unknown)'}.`,
                );
            }
        }

        // Register the file buffer in DuckDB VFS.
        // For gzipped files, use the base name without .gz so DuckDB sees the correct extension.
        const originalName = this._uri.path.split('/').pop() || 'data';
        const virtualPath = this._isGzipped
            ? originalName.replace(/\.gz$/i, '')
            : originalName;
        const vfsName = `${this._tableName}_${virtualPath}`;

        // Use a tightly packed Uint8Array to avoid transfer issues
        const buffer = fileData.byteOffset === 0 && fileData.byteLength === fileData.buffer.byteLength
            ? fileData
            : new Uint8Array(fileData.buffer.slice(
                fileData.byteOffset, fileData.byteOffset + fileData.byteLength,
            ));
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
            if (error instanceof vscode.CancellationError || this._fileType !== 'xlsx' ||
                !options?.sheet_name || !/(?:work)?sheet\b.*\bnot found/i.test(String(error))) {
                throw error;
            }
            if (this.importOptions !== options) {
                return;
            }
            const previousSheet = options.sheet_name;
            await this.importFile({ ...options, sheet_name: undefined });
            void vscode.window.showInformationMessage(vscode.l10n.t(
                'Worksheet {0} is no longer available in {1}. The first worksheet has been opened instead.',
                previousSheet, this._displayName,
            ));
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
                `CREATE OR REPLACE TABLE ${escapeIdentifier(this._tableName)} AS SELECT * FROM parquet_scan(${escapeValue(vfsName)})`, token
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
                throw new Error(`DuckDB Excel support could not be loaded: ${String(error)}`);
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
            if (range) { options.push(`range=${escapeValue(range)}`); }
            if (text) { options.push('all_varchar=true'); }
            return `CREATE OR REPLACE TABLE ${escapeIdentifier(tableName)} AS ` +
                `SELECT * FROM read_xlsx(${escapeValue(vfsName)}, ${options.join(', ')})`;
        };
        try {
            await this._duckdb.query(query(asText), token);
            return asText;
        } catch (error) {
            throwIfImportCancelled(token);
            if (asText || !/(?:could not|cannot|can't|failed to) (?:convert|cast)|conversion error|failed to parse cell/i.test(String(error))) {
                throw error;
            }
            await this._duckdb.query(query(true), token);
            return true;
        }
    }

    private async _createXlsxTable(vfsName: string, token?: vscode.CancellationToken): Promise<void> {
        await this._ensureExcelExtension(token);
        let firstError: unknown;
        let firstReadFailed = false;
        try {
            this._xlsxImportedAsText = await this._readXlsxTable(vfsName, this._tableName, undefined, false, token);
        } catch (error) {
            throwIfImportCancelled(token);
            firstError = error;
            firstReadFailed = true;
        }
        const shape = firstReadFailed ? undefined : await this._xlsxTableShape(this._tableName, token);
        const range = this._xlsxMetadata.range;
        const needsRecovery = range && (firstReadFailed || (shape &&
            (shape.columns <= 1 || shape.rows === 0) &&
            (shape.columns < range.width || shape.rows === 0)));
        if (range && needsRecovery) {
            // Some producers mark an entire worksheet as used. Never materialize
            // such an advisory range without a bound, even for a tiny ZIP file.
            const maxRecoveryCells = 5_000_000;
            if (range.width * range.height > maxRecoveryCells) {
                if (firstReadFailed) {
                    throw new Error(`${String(firstError)}. The declared worksheet range is too large for automatic recovery.`);
                }
                this._xlsxRecoverySkipped = true;
                return;
            }
            const recoveryTable = `__dex_${_tableCounter++}`;
            let recovered = false;
            try {
                const asText = await this._readXlsxTable(vfsName, recoveryTable, range.ref, this._xlsxImportedAsText, token);
                const recoveredShape = await this._xlsxTableShape(recoveryTable, token);
                throwIfImportCancelled(token);
                if (!shape || (recoveredShape.columns >= shape.columns && recoveredShape.rows >= shape.rows)) {
                    const previousTable = this._tableName;
                    this._tableName = recoveryTable;
                    this._xlsxImportedAsText = asText;
                    recovered = true;
                    await this._duckdb.query(`DROP TABLE IF EXISTS ${escapeIdentifier(previousTable)}`).catch(() => undefined);
                    return;
                }
            } catch (error) {
                throwIfImportCancelled(token);
                if (firstReadFailed) { throw firstError; }
                // Keep the successfully imported table when advisory metadata is stale.
            } finally {
                if (!recovered) {
                    await this._duckdb.query(`DROP TABLE IF EXISTS ${escapeIdentifier(recoveryTable)}`).catch(() => undefined);
                }
            }
        }
        if (firstReadFailed) { throw firstError; }
    }

    private async _xlsxTableShape(table: string, token?: vscode.CancellationToken): Promise<{ columns: number; rows: number }> {
        const schema = await this._duckdb.query(`DESCRIBE ${escapeIdentifier(table)}`, token);
        const count = await this._duckdb.query(`SELECT COUNT(*) AS cnt FROM ${escapeIdentifier(table)}`, token);
        return { columns: schema.numRows, rows: Number(getFirstRowValue(count, ['cnt']) ?? 0) };
    }

    private async _loadSchema(token?: vscode.CancellationToken): Promise<void> {
        const result = await this._duckdb.query(`DESCRIBE ${escapeIdentifier(this._tableName)}`, token);
        this._fullSchema = [];

        for (let i = 0; i < result.numRows; i++) {
            const row = result.get(i);
            if (!row) { continue; }

            const columnName = String(row['column_name'] ?? row[0] ?? `column_${i}`);
            const typeName = String(row['column_type'] ?? row[1] ?? 'VARCHAR');

            this._fullSchema.push({
                column_name: columnName,
                column_index: i,
                type_name: typeName,
                type_display: this._mapDuckDBType(typeName),
            });
        }
    }

    private _mapDuckDBType(duckdbType: string): ColumnDisplayType {
        const t = duckdbType.toUpperCase();
        if (t.includes('INT') || t === 'HUGEINT' || t === 'UHUGEINT') {
            return ColumnDisplayType.Integer;
        }
        if (t.includes('FLOAT') || t.includes('DOUBLE') || t.includes('REAL') || t === 'DECIMAL' || t.startsWith('DECIMAL(')) {
            return ColumnDisplayType.Floating;
        }
        if (t === 'BOOLEAN' || t === 'BOOL') {
            return ColumnDisplayType.Boolean;
        }
        if (t === 'DATE') {
            return ColumnDisplayType.Date;
        }
        if (t.includes('TIMESTAMP') || t.includes('DATETIME')) {
            return ColumnDisplayType.Datetime;
        }
        if (t === 'TIME') {
            return ColumnDisplayType.Time;
        }
        if (t === 'INTERVAL') {
            return ColumnDisplayType.Interval;
        }
        if (t.includes('VARCHAR') || t === 'TEXT' || t === 'STRING' || t.includes('CHAR')) {
            return ColumnDisplayType.String;
        }
        if (t === 'BLOB' || t.startsWith('LIST') || t.startsWith('MAP')) {
            return ColumnDisplayType.Array;
        }
        if (t.startsWith('STRUCT')) {
            return ColumnDisplayType.Struct;
        }
        return ColumnDisplayType.Unknown;
    }

    private async _updateRowCounts(token?: vscode.CancellationToken): Promise<void> {
        // Unfiltered count
        const unfilteredResult = await this._duckdb.query(
            buildCountQuery(this._tableName, []), token
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
        const columns = columnIndices.map(i => this._fullSchema[i]).filter(Boolean);
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
        formatOptions: FormatOptions
    ): Promise<TableData> {

        // Early return if table has 0 rows
        if (this._filteredRowCount === 0) {
            return { columns: Array.from({ length: columns.length }, () => []) };
        }

        // Compute the row range across all selections
        let lowerLimit = Infinity;
        let upperLimit = -Infinity;

        const smallNumDigits = formatOptions.small_num_digits;
        const largeNumDigits = formatOptions.large_num_digits;
        const thousandsSep = formatOptions.thousands_sep;
        const sciNotationLimit = '1' + '0'.repeat(formatOptions.max_integral_digits);
        const varcharLimit = formatOptions.max_value_length;

        // Build format strings
        let smallFloatFormat: string, largeFloatFormat: string;
        if (thousandsSep) {
            largeFloatFormat = `'{:,.${largeNumDigits}f}'`;
            smallFloatFormat = `'{:,.${smallNumDigits}f}'`;
        } else {
            largeFloatFormat = `'{:.${largeNumDigits}f}'`;
            smallFloatFormat = `'{:.${smallNumDigits}f}'`;
        }

        const columnSelectors: string[] = [];
        const selectedColumns: string[] = [];

        for (const column of columns) {
            if (isSelectionRange(column.spec)) {
                lowerLimit = Math.min(lowerLimit, column.spec.first_index);
                upperLimit = Math.max(upperLimit, column.spec.last_index);
            } else {
                // DataSelectionIndices
                const indices = (column.spec as DataSelectionIndices).indices;
                lowerLimit = Math.min(lowerLimit, ...indices);
                upperLimit = Math.max(upperLimit, ...indices);
            }

            const columnSchema = this._fullSchema[column.column_index];
            if (!columnSchema) { continue; }
            const quotedName = quoteIdentifier(columnSchema.column_name);
            const typeName = columnSchema.type_name.toUpperCase();

            const smallRounded = `ROUND(${quotedName}, ${smallNumDigits})`;
            const largeRounded = `ROUND(${quotedName}, ${largeNumDigits})`;

            let columnSelector: string;
            switch (true) {
                case typeName === 'TINYINT' || typeName === 'SMALLINT' ||
                     typeName === 'INTEGER' || typeName === 'BIGINT' ||
                     typeName === 'UTINYINT' || typeName === 'USMALLINT' ||
                     typeName === 'UINTEGER' || typeName === 'UBIGINT':
                    if (thousandsSep) {
                        columnSelector = `FORMAT('{:,}', ${quotedName})`;
                        if (thousandsSep !== ',') {
                            columnSelector = `REPLACE(${columnSelector}, ',', '${thousandsSep}')`;
                        }
                    } else {
                        columnSelector = `FORMAT('{:d}', ${quotedName})`;
                    }
                    break;

                case typeName === 'FLOAT' || typeName === 'DOUBLE': {
                    let largeFormatter = `FORMAT(${largeFloatFormat}, ${largeRounded})`;
                    let smallFormatter = `FORMAT(${smallFloatFormat}, ${smallRounded})`;
                    if (thousandsSep && thousandsSep !== ',') {
                        largeFormatter = `REPLACE(${largeFormatter}, ',', '${thousandsSep}')`;
                        smallFormatter = `REPLACE(${smallFormatter}, ',', '${thousandsSep}')`;
                    }
                    columnSelector = `CASE WHEN ${quotedName} IS NULL THEN 'NULL'
WHEN isinf(${quotedName}) AND ${quotedName} > 0 THEN 'Inf'
WHEN isinf(${quotedName}) AND ${quotedName} < 0 THEN '-Inf'
WHEN isnan(${quotedName}) THEN 'NaN'
WHEN abs(${quotedName}) >= ${sciNotationLimit} THEN FORMAT('{:.${largeNumDigits}e}', ${quotedName})
WHEN abs(${quotedName}) < 1 AND abs(${quotedName}) > 0 THEN ${smallFormatter}
ELSE ${largeFormatter}
END`;
                    break;
                }

                case typeName === 'VARCHAR':
                    columnSelector = `SUBSTRING(${quotedName}, 1, ${varcharLimit})`;
                    break;

                case typeName === 'TIMESTAMP' || typeName === 'TIMESTAMP_NS':
                    columnSelector = `strftime(${quotedName} AT TIME ZONE 'UTC', '%Y-%m-%d %H:%M:%S')`;
                    break;

                case typeName === 'TIMESTAMP WITH TIME ZONE' ||
                     typeName === 'TIMESTAMP_NS WITH TIME ZONE':
                    columnSelector = `strftime(${quotedName}, '%Y-%m-%d %H:%M:%S%z')`;
                    break;

                default:
                    columnSelector = `CAST(${quotedName} AS VARCHAR)`;
                    break;
            }
            selectedColumns.push(quotedName);
            columnSelectors.push(`${columnSelector} AS formatted_${columnSelectors.length}`);
        }

        if (columnSelectors.length === 0) {
            return { columns: [] };
        }

        let numRows = 0;
        if (isFinite(lowerLimit) && isFinite(upperLimit)) {
            numRows = upperLimit - lowerLimit + 1;
        }
        if (numRows === 0) {
            return { columns: Array.from({ length: columns.length }, () => []) };
        }

        // Use positron's subquery optimization: sort/limit/offset in subquery, format in outer.
        const query = `SELECT\n${columnSelectors.join(',\n    ')}
FROM (
    SELECT ${selectedColumns.join(', ')} FROM
    ${escapeIdentifier(this._tableName)}${this._whereClause}${this._sortClause}
    LIMIT ${numRows}
    OFFSET ${lowerLimit}
) t;`;

        const queryResult = await this._duckdb.query(query);

        const result: TableData = { columns: [] };

        // Adapter for float columns — converts sentinel string values to numeric codes
        const floatAdapter = (field: any, i: number): ColumnValue => {
            const value: string = field.get(i - lowerLimit);
            switch (value) {
                case 'NaN': return SENTINEL_NAN;
                case 'NULL': return SENTINEL_NULL;
                case 'Inf': return SENTINEL_INF;
                case '-Inf': return SENTINEL_NEGINF;
                default: return value;
            }
        };

        // Default adapter for non-float columns
        const defaultAdapter = (field: any, i: number): ColumnValue => {
            const relIndex = i - lowerLimit;
            return field.isValid(relIndex) ? field.get(relIndex) : SENTINEL_NULL;
        };

        for (let i = 0; i < queryResult.numCols; i++) {
            const column = columns[i];
            const spec = column.spec;
            const field = queryResult.getChildAt(i);
            if (!field) { result.columns.push([]); continue; }

            const columnSchema = this._fullSchema[column.column_index];
            const isFloat = columnSchema &&
                (columnSchema.type_name.toUpperCase() === 'FLOAT' ||
                 columnSchema.type_name.toUpperCase() === 'DOUBLE');
            const adapter = isFloat ? floatAdapter : defaultAdapter;

            const fetchValues = (): Array<string | number> => {
                if (isSelectionRange(spec)) {
                    const lastIndex = Math.min(
                        spec.last_index,
                        spec.first_index + queryResult.numRows - 1
                    );
                    const columnValues: Array<string | number> = [];
                    for (let j = spec.first_index; j <= lastIndex; ++j) {
                        columnValues.push(adapter(field, j));
                    }
                    return columnValues;
                } else {
                    // DataSelectionIndices
                    return (spec as DataSelectionIndices).indices.map(j => adapter(field, j));
                }
            };

            result.columns.push(fetchValues());
        }

        return result;
    }

    async getRowLabels(
        selection: ArraySelection,
        _formatOptions: FormatOptions
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

        const hasErrors = filters.some(f => f.is_valid === false);
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
     * Set sort columns with rowid appended for stable sorting (aligned with positron).
     */
    setSortColumns(sortKeys: ColumnSortKey[]): void {
        this._sortKeys = sortKeys;
        this._rebuildSortClause();
    }

    private _rebuildSortClause(): void {
        if (this._sortKeys.length === 0) {
            this._sortClause = '';
            return;
        }

        const sortExprs: string[] = [];
        for (const key of this._sortKeys) {
            const col = this._fullSchema[key.column_index];
            if (!col) { continue; }
            const modifier = key.ascending ? '' : ' DESC';
            sortExprs.push(`${quoteIdentifier(col.column_name)}${modifier}`);
        }

        // Add rowid as the final sort key to ensure stable sorting (positron pattern)
        sortExprs.push('rowid');

        this._sortClause = `\nORDER BY ${sortExprs.join(', ')}`;
    }

    setColumnFilters(filters: ColumnFilter[]): void {
        this._columnFilters = filters;
    }

    searchSchema(
        filters: ColumnFilter[],
        sortOrder: SearchSchemaSortOrder
    ): SearchSchemaResult {
        let indices = this._fullSchema.map((_, i) => i);

        // Apply column filters (enhanced with case sensitivity and regex support)
        for (const filter of filters) {
            if (filter.filter_type === ColumnFilterType.TextSearch) {
                const params = filter.params as FilterTextSearch;
                const caseSensitive = params.case_sensitive ?? false;

                indices = indices.filter(i => {
                    const col = this._fullSchema[i];
                    const columnName = caseSensitive
                        ? col.column_name
                        : col.column_name.toLowerCase();
                    const searchTerm = caseSensitive
                        ? params.term
                        : params.term.toLowerCase();

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
                                const regex = new RegExp(
                                    params.term,
                                    caseSensitive ? '' : 'i'
                                );
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
                indices = indices.filter(i => {
                    const col = this._fullSchema[i];
                    return types.has(col.type_display);
                });
            }
        }

        // Apply sort order
        switch (sortOrder) {
            case SearchSchemaSortOrder.AscendingName:
                indices.sort((a, b) =>
                    this._fullSchema[a].column_name.toLowerCase().localeCompare(
                        this._fullSchema[b].column_name.toLowerCase()
                    )
                );
                break;
            case SearchSchemaSortOrder.DescendingName:
                indices.sort((a, b) =>
                    this._fullSchema[b].column_name.toLowerCase().localeCompare(
                        this._fullSchema[a].column_name.toLowerCase()
                    )
                );
                break;
            case SearchSchemaSortOrder.AscendingType:
                indices.sort((a, b) =>
                    this._fullSchema[a].type_name.toLowerCase().localeCompare(
                        this._fullSchema[b].type_name.toLowerCase()
                    )
                );
                break;
            case SearchSchemaSortOrder.DescendingType:
                indices.sort((a, b) =>
                    this._fullSchema[b].type_name.toLowerCase().localeCompare(
                        this._fullSchema[a].type_name.toLowerCase()
                    )
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
        format: ExportFormat
    ): Promise<ExportedData> {
        const kind = selection.kind;

        // Helper to build column selectors with format-safe casting
        const getColumnSelectors = (columns: ColumnSchema[]): string[] => {
            return columns.map((col, idx) => {
                const quotedName = quoteIdentifier(col.column_name);
                const typeName = col.type_name.toUpperCase();

                let selector: string;
                switch (typeName) {
                    case 'FLOAT':
                    case 'DOUBLE':
                        selector = `CASE WHEN isinf(${quotedName}) AND ${quotedName} > 0 THEN 'Inf'
WHEN isinf(${quotedName}) AND ${quotedName} < 0 THEN '-Inf'
WHEN isnan(${quotedName}) THEN 'NaN'
ELSE CAST(${quotedName} AS VARCHAR)
END`;
                        break;
                    case 'TIMESTAMP':
                    case 'TIMESTAMP_NS':
                        selector = `strftime(${quotedName} AT TIME ZONE 'UTC', '%Y-%m-%d %H:%M:%S')`;
                        break;
                    case 'TIMESTAMP WITH TIME ZONE':
                    case 'TIMESTAMP_NS WITH TIME ZONE':
                        selector = `strftime(${quotedName}, '%Y-%m-%d %H:%M:%S%z')`;
                        break;
                    default:
                        selector = `CAST(${quotedName} AS VARCHAR)`;
                        break;
                }
                return `CASE WHEN ${quotedName} IS NULL THEN 'NULL' ELSE ${selector} END AS formatted_${idx}`;
            });
        };

        // Helper to export query result
        const exportQueryOutput = async (query: string, columns: ColumnSchema[]): Promise<ExportedData> => {
            const queryResult = await this._duckdb.query(query);
            const names = queryResult.schema.fields.map((f: any) => f.name);
            const unboxed: string[][] = [
                columns.map(s => s.column_name),
                ...Array.from({ length: queryResult.numRows }, (_, r) => {
                    const row = queryResult.get(r);
                    return row ? names.map((name: string) => String(row[name] ?? '')) : [];
                })
            ];

            let data: string;
            switch (format) {
                case ExportFormat.Csv:
                    data = unboxed
                        .map((row) => row.map((value) => escapeDelimitedValue(value, ',')).join(','))
                        .join('\n');
                    break;
                case ExportFormat.Tsv:
                    data = unboxed
                        .map((row) => row.map((value) => escapeDelimitedValue(value, '\t')).join('\t'))
                        .join('\n');
                    break;
                case ExportFormat.Html:
                    data = unboxed
                        .map((row) => `<tr>${row.map((value) => `<td>${escapeHtmlCell(value)}</td>`).join('')}</tr>`)
                        .join('\n');
                    break;
                default:
                    data = unboxed
                        .map((row) => row.map((value) => escapeDelimitedValue(value, ',')).join(','))
                        .join('\n');
                    break;
            }

            return { data, format };
        };

        const tableName = escapeIdentifier(this._tableName);

        switch (kind) {
            case TableSelectionKind.SingleCell: {
                const sel = selection.selection as DataSelectionSingleCell;
                const col = this._fullSchema[sel.column_index];
                if (!col) { return { data: '', format }; }
                const selectors = getColumnSelectors([col]);
                const query = `SELECT ${selectors[0]} FROM ${tableName}${this._whereClause}${this._sortClause} LIMIT 1 OFFSET ${sel.row_index};`;
                const result = await this._duckdb.query(query);
                const row = result.get(0);
                return {
                    data: row ? String(row[result.schema.fields[0].name] ?? '') : '',
                    format
                };
            }
            case TableSelectionKind.CellRange: {
                const sel = selection.selection as DataSelectionCellRange;
                const columns = this._fullSchema.slice(sel.first_column_index, sel.last_column_index + 1);
                const selectors = getColumnSelectors(columns);
                const query = `SELECT ${selectors.join(',')} FROM ${tableName}${this._whereClause}${this._sortClause} LIMIT ${sel.last_row_index - sel.first_row_index + 1} OFFSET ${sel.first_row_index};`;
                return await exportQueryOutput(query, columns);
            }
            case TableSelectionKind.RowRange: {
                const sel = selection.selection as DataSelectionRange;
                const selectors = getColumnSelectors(this._fullSchema);
                const query = `SELECT ${selectors.join(',')} FROM ${tableName}${this._whereClause}${this._sortClause} LIMIT ${sel.last_index - sel.first_index + 1} OFFSET ${sel.first_index};`;
                return await exportQueryOutput(query, this._fullSchema);
            }
            case TableSelectionKind.ColumnRange: {
                const sel = selection.selection as DataSelectionRange;
                const columns = this._fullSchema.slice(sel.first_index, sel.last_index + 1);
                const selectors = getColumnSelectors(columns);
                const query = `SELECT ${selectors.join(',')} FROM ${tableName}${this._whereClause}${this._sortClause}`;
                return await exportQueryOutput(query, columns);
            }
            case TableSelectionKind.RowIndices: {
                const sel = selection.selection as DataSelectionIndices;
                // Row indexes refer to the displayed table, just like cell indexes.
                return this.exportDataSelection({
                    kind: TableSelectionKind.CellIndices,
                    selection: {
                        column_indices: this._fullSchema.map((_, index) => index),
                        row_indices: sel.indices,
                    },
                }, format);
            }
            case TableSelectionKind.ColumnIndices: {
                const sel = selection.selection as DataSelectionIndices;
                const columns = sel.indices.map(i => this._fullSchema[i]).filter(Boolean);
                const selectors = getColumnSelectors(columns);
                const query = `SELECT ${selectors.join(',')} FROM ${tableName}${this._whereClause}${this._sortClause}`;
                return await exportQueryOutput(query, columns);
            }
            case TableSelectionKind.CellIndices: {
                const sel = selection.selection as DataSelectionCellIndices;
                const columns = sel.column_indices.map(i => this._fullSchema[i]).filter(Boolean);
                if (sel.row_indices.length === 0 || columns.length === 0) {
                    return { data: '', format };
                }
                const selectors = getColumnSelectors(columns);

                if (this._sortClause || this._whereClause) {
                    // Aligned with positron: use ROW_NUMBER() for sort-aware cell selection
                    const sortedTableQuery = `SELECT *, ROW_NUMBER() OVER(${this._sortClause || 'ORDER BY rowid'}) - 1 AS sorted_row_index
FROM ${tableName}${this._whereClause}${this._sortClause}`;
                    const orderValues = sel.row_indices.map((rowIdx, idx) => `(${rowIdx}, ${idx})`).join(', ');
                    const query = `SELECT ${selectors.join(',')}
FROM (${sortedTableQuery}) sorted_table
JOIN (VALUES ${orderValues}) AS row_order(sorted_row_index, selection_order) ON sorted_table.sorted_row_index = row_order.sorted_row_index
ORDER BY row_order.selection_order`;
                    return await exportQueryOutput(query, columns);
                } else {
                    const orderValues = sel.row_indices.map((rowId, idx) => `(${rowId}, ${idx})`).join(', ');
                    const query = `SELECT ${selectors.join(',')}
FROM ${tableName}
JOIN (VALUES ${orderValues}) AS row_order(rowid, sort_order) ON ${tableName}.rowid = row_order.rowid
ORDER BY row_order.sort_order`;
                    return await exportQueryOutput(query, columns);
                }
            }
            default: {
                // Fallback: all data
                const selectors = getColumnSelectors(this._fullSchema);
                const query = `SELECT ${selectors.join(',')} FROM ${tableName}${this._whereClause}${this._sortClause}`;
                return await exportQueryOutput(query, this._fullSchema);
            }
        }
    }

    /**
     * Convert current filters and sort to SQL code.
     * Uses filename without extension as table name (aligned with positron).
     */
    convertToCode(
        _columnFilters: ColumnFilter[],
        rowFilters: RowFilter[],
        sortKeys: ColumnSortKey[],
        _codeSyntaxName: CodeSyntaxName
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
                if (!col) { continue; }
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
        options: DatasetImportOptions
    ): Promise<SetDatasetImportOptionsResult> {
        try {
            await this.reimport(options);
            return {};
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }
            return { error_message: String(error) };
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
                    { column_filter_type: ColumnFilterType.TextSearch, support_status: SupportStatus.Supported },
                    { column_filter_type: ColumnFilterType.MatchDataTypes, support_status: SupportStatus.Supported },
                ],
            },
            set_column_filters: {
                support_status: SupportStatus.Supported,
                supported_types: [
                    { column_filter_type: ColumnFilterType.TextSearch, support_status: SupportStatus.Supported },
                    { column_filter_type: ColumnFilterType.MatchDataTypes, support_status: SupportStatus.Supported },
                ],
            },
            set_row_filters: {
                support_status: SupportStatus.Supported,
                supports_conditions: SupportStatus.Supported,
                supported_types: [
                    { row_filter_type: RowFilterType.Between, support_status: SupportStatus.Supported },
                    { row_filter_type: RowFilterType.Compare, support_status: SupportStatus.Supported },
                    { row_filter_type: RowFilterType.IsEmpty, support_status: SupportStatus.Supported },
                    { row_filter_type: RowFilterType.IsFalse, support_status: SupportStatus.Supported },
                    { row_filter_type: RowFilterType.IsNull, support_status: SupportStatus.Supported },
                    { row_filter_type: RowFilterType.IsTrue, support_status: SupportStatus.Supported },
                    { row_filter_type: RowFilterType.NotBetween, support_status: SupportStatus.Supported },
                    { row_filter_type: RowFilterType.NotEmpty, support_status: SupportStatus.Supported },
                    { row_filter_type: RowFilterType.NotNull, support_status: SupportStatus.Supported },
                    { row_filter_type: RowFilterType.Search, support_status: SupportStatus.Supported },
                    { row_filter_type: RowFilterType.SetMembership, support_status: SupportStatus.Supported },
                ],
            },
            get_column_profiles: {
                support_status: SupportStatus.Supported,
                supported_types: [
                    { profile_type: ColumnProfileType.NullCount, support_status: SupportStatus.Supported },
                    { profile_type: ColumnProfileType.SummaryStats, support_status: SupportStatus.Supported },
                    { profile_type: ColumnProfileType.SmallHistogram, support_status: SupportStatus.Supported },
                    { profile_type: ColumnProfileType.LargeHistogram, support_status: SupportStatus.Supported },
                    { profile_type: ColumnProfileType.SmallFrequencyTable, support_status: SupportStatus.Supported },
                    { profile_type: ColumnProfileType.LargeFrequencyTable, support_status: SupportStatus.Supported },
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
