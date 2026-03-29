/*---------------------------------------------------------------------------------------------
 *  Data Explorer Communication Protocol Types
 *  1:1 port from Positron's positronDataExplorerComm.ts (auto-generated from data_explorer.json)
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    ColumnDisplayType,
    ColumnFilterType,
    ColumnProfileType,
    ExportFormat,
    FilterComparisonOp,
    RowFilterCondition,
    RowFilterType,
    SearchSchemaSortOrder,
    SupportStatus,
    TextSearchType,
} from '../../shared/dataExplorer';
import type {
    BackendState,
    CodeSyntaxName,
    ColumnFilter,
    ColumnFilterParams,
    ColumnFilterTypeSupportStatus,
    ColumnProfileTypeSupportStatus,
    ColumnSchema,
    ColumnFrequencyTable,
    ColumnHistogram,
    ColumnProfileResult,
    ColumnSortKey,
    ColumnSummaryStats,
    ColumnQuantileValue,
    ConvertToCodeFeatures,
    SummaryStatsBoolean,
    SummaryStatsDate,
    SummaryStatsDatetime,
    SummaryStatsNumber,
    SummaryStatsOther,
    SummaryStatsString,
    ExportDataSelectionFeatures,
    FilterBetween,
    FilterComparison,
    FilterMatchDataTypes,
    FilterSetMembership,
    FilterTextSearch,
    GetColumnProfilesFeatures,
    RowFilter,
    RowFilterParams,
    RowFilterTypeSupportStatus,
    SearchSchemaFeatures,
    SetColumnFiltersFeatures,
    SetRowFiltersFeatures,
    SetSortColumnsFeatures,
    SupportedFeatures,
    TableShape,
} from '../../shared/dataExplorer';
import { RuntimeClientInstance } from '../RuntimeClientInstance';
import { PositronBaseComm, PositronCommOptions } from './positronBaseComm';

export {
    ColumnDisplayType,
    ColumnFilterType,
    ColumnProfileType,
    ExportFormat,
    FilterComparisonOp,
    RowFilterCondition,
    RowFilterType,
    SearchSchemaSortOrder,
    SupportStatus,
    TextSearchType,
} from '../../shared/dataExplorer';
export type {
    BackendState,
    CodeSyntaxName,
    ColumnFilter,
    ColumnFilterParams,
    ColumnFilterTypeSupportStatus,
    ColumnProfileTypeSupportStatus,
    ColumnSchema,
    ColumnFrequencyTable,
    ColumnHistogram,
    ColumnProfileResult,
    ColumnSortKey,
    ColumnSummaryStats,
    ColumnQuantileValue,
    ConvertToCodeFeatures,
    SummaryStatsBoolean,
    SummaryStatsDate,
    SummaryStatsDatetime,
    SummaryStatsNumber,
    SummaryStatsOther,
    SummaryStatsString,
    ExportDataSelectionFeatures,
    FilterBetween,
    FilterComparison,
    FilterMatchDataTypes,
    FilterSetMembership,
    FilterTextSearch,
    GetColumnProfilesFeatures,
    RowFilter,
    RowFilterParams,
    RowFilterTypeSupportStatus,
    SearchSchemaFeatures,
    SetColumnFiltersFeatures,
    SetRowFiltersFeatures,
    SetSortColumnsFeatures,
    SupportedFeatures,
    TableShape,
} from '../../shared/dataExplorer';

// Event types are defined inline

// ============================================================================
// Enums
// ============================================================================

/**
 * Possible values for ColumnHistogramParamsMethod
 */
export enum ColumnHistogramParamsMethod {
    Sturges = 'sturges',
    FreedmanDiaconis = 'freedman_diaconis',
    Scott = 'scott',
    Fixed = 'fixed'
}

/**
 * Possible values for TableSelectionKind
 */
export enum TableSelectionKind {
    SingleCell = 'single_cell',
    CellRange = 'cell_range',
    ColumnRange = 'column_range',
    RowRange = 'row_range',
    ColumnIndices = 'column_indices',
    RowIndices = 'row_indices',
    CellIndices = 'cell_indices'
}

export enum DataExplorerFrontendEvent {
    SchemaUpdate = 'schema_update',
    DataUpdate = 'data_update',
    ReturnColumnProfiles = 'return_column_profiles'
}

export enum DataExplorerBackendRequest {
    OpenDataset = 'open_dataset',
    OpenDataExplorer = 'open_data_explorer',
    GetSchema = 'get_schema',
    SearchSchema = 'search_schema',
    GetDataValues = 'get_data_values',
    GetRowLabels = 'get_row_labels',
    ExportDataSelection = 'export_data_selection',
    ConvertToCode = 'convert_to_code',
    SuggestCodeSyntax = 'suggest_code_syntax',
    SetColumnFilters = 'set_column_filters',
    SetRowFilters = 'set_row_filters',
    SetSortColumns = 'set_sort_columns',
    GetColumnProfiles = 'get_column_profiles',
    SetDatasetImportOptions = 'set_dataset_import_options',
    GetState = 'get_state'
}

// ============================================================================
// Interfaces
// ============================================================================

/**
 * The schema for a table-like object
 */
export interface TableSchema {
    columns: Array<ColumnSchema>;
}

/**
 * Table values formatted as strings
 */
export interface TableData {
    columns: Array<Array<ColumnValue>>;
}

/**
 * Formatted table row labels
 */
export interface TableRowLabels {
    row_labels: Array<Array<string>>;
}

/**
 * Formatting options for returning data values as strings
 */
export interface FormatOptions {
    large_num_digits: number;
    small_num_digits: number;
    max_integral_digits: number;
    max_value_length: number;
    thousands_sep?: string;
}

/**
 * A single column profile request
 */
export interface ColumnProfileRequest {
    column_index: number;
    profiles: Array<ColumnProfileSpec>;
}

/**
 * Parameters for a single column profile
 */
export interface ColumnProfileSpec {
    profile_type: ColumnProfileType;
    params?: ColumnProfileParams;
}

/**
 * Parameters for a column histogram profile request
 */
export interface ColumnHistogramParams {
    method: ColumnHistogramParamsMethod;
    num_bins: number;
    quantiles?: Array<number>;
}

/**
 * Parameters for a frequency_table profile request
 */
export interface ColumnFrequencyTableParams {
    limit: number;
}

/**
 * Search schema result
 */
export interface SearchSchemaResult {
    matches: Array<number>;
}

/**
 * The result of applying filters to a table
 */
export interface FilterResult {
    selected_num_rows: number;
    had_errors?: boolean;
}

/**
 * Exported data
 */
export interface ExportedData {
    data: string;
    format: ExportFormat;
}

/**
 * Code snippet for the current data view.
 */
export interface ConvertedCode {
    converted_code: Array<string>;
}

/**
 * Result of setting import options.
 */
export interface SetDatasetImportOptionsResult {
    error_message?: string;
}

/**
 * Import options for file-based data sources.
 */
export interface DatasetImportOptions {
    has_header_row?: boolean;
}

/**
 * A selection on the data grid
 */
export interface TableSelection {
    kind: TableSelectionKind;
    selection: Selection;
}

export interface DataSelectionSingleCell {
    row_index: number;
    column_index: number;
}

export interface DataSelectionCellRange {
    first_row_index: number;
    last_row_index: number;
    first_column_index: number;
    last_column_index: number;
}

export interface DataSelectionCellIndices {
    row_indices: Array<number>;
    column_indices: Array<number>;
}

export interface DataSelectionRange {
    first_index: number;
    last_index: number;
}

export interface DataSelectionIndices {
    indices: Array<number>;
}

/**
 * A union of selection types for column values
 */
export interface ColumnSelection {
    column_index: number;
    spec: ArraySelection;
}

// ============================================================================
// Type Aliases
// ============================================================================

export type ColumnValue = number | string;
export type ColumnProfileParams = ColumnHistogramParams | ColumnFrequencyTableParams;
export type Selection = DataSelectionSingleCell | DataSelectionCellRange | DataSelectionCellIndices | DataSelectionRange | DataSelectionIndices;
export type ArraySelection = DataSelectionRange | DataSelectionIndices;

// ============================================================================
// Events
// ============================================================================

/**
 * Event: Request to sync after a schema change
 */
export interface SchemaUpdateEvent {
}

/**
 * Event: Clear cache and request fresh data
 */
export interface DataUpdateEvent {
}

/**
 * Event: Return async result of get_column_profiles request
 */
export interface ReturnColumnProfilesEvent {
    callback_id: string;
    profiles: Array<ColumnProfileResult>;
    error_message?: string;
}

/**
 * Shared interface for Data Explorer backends.
 * Both PositronDataExplorerComm (R/Python) and DuckDBDataExplorerComm implement this.
 */
export interface IDataExplorerComm extends vscode.Disposable {
    /** Unique identifier for this comm / backend client */
    readonly clientId: string;

    // --- Events ---
    readonly onDidSchemaUpdate: vscode.Event<SchemaUpdateEvent>;
    readonly onDidDataUpdate: vscode.Event<DataUpdateEvent>;
    readonly onDidReturnColumnProfiles: vscode.Event<ReturnColumnProfilesEvent>;
    readonly onDidClose: vscode.Event<void>;

    // --- RPC Methods ---
    getState(): Promise<BackendState>;
    getSchema(columnIndices: Array<number>): Promise<TableSchema>;
    searchSchema(filters: Array<ColumnFilter>, sortOrder: SearchSchemaSortOrder): Promise<SearchSchemaResult>;
    getDataValues(columns: Array<ColumnSelection>, formatOptions: FormatOptions): Promise<TableData>;
    getRowLabels(selection: ArraySelection, formatOptions: FormatOptions): Promise<TableRowLabels>;
    exportDataSelection(selection: TableSelection, format: ExportFormat): Promise<ExportedData>;
    convertToCode(
        columnFilters: Array<ColumnFilter>,
        rowFilters: Array<RowFilter>,
        sortKeys: Array<ColumnSortKey>,
        codeSyntaxName: CodeSyntaxName
    ): Promise<ConvertedCode>;
    suggestCodeSyntax(): Promise<CodeSyntaxName | undefined>;
    openDataExplorer(): Promise<void>;
    setColumnFilters(filters: Array<ColumnFilter>): Promise<void>;
    setRowFilters(filters: Array<RowFilter>): Promise<FilterResult>;
    setSortColumns(sortKeys: Array<ColumnSortKey>): Promise<void>;
    getColumnProfiles(
        callbackId: string,
        profiles: Array<ColumnProfileRequest>,
        formatOptions: FormatOptions
    ): Promise<void>;
    setDatasetImportOptions(options: DatasetImportOptions): Promise<SetDatasetImportOptionsResult>;

    // --- Lifecycle ---
    closeClient(): void;
}

/**
 * Typed comm wrapper for Data Explorer RPC/event protocol.
 */
export class PositronDataExplorerComm extends PositronBaseComm implements IDataExplorerComm {
    readonly onDidSchemaUpdate: vscode.Event<SchemaUpdateEvent>;
    readonly onDidDataUpdate: vscode.Event<DataUpdateEvent>;
    readonly onDidReturnColumnProfiles: vscode.Event<ReturnColumnProfilesEvent>;

    constructor(
        client: RuntimeClientInstance,
        options?: PositronCommOptions<DataExplorerBackendRequest>
    ) {
        super(client, options);
        this.onDidSchemaUpdate = this.createEventEmitter('schema_update', []);
        this.onDidDataUpdate = this.createEventEmitter('data_update', []);
        this.onDidReturnColumnProfiles = this.createEventEmitter(
            'return_column_profiles',
            ['callback_id', 'profiles', 'error_message']
        );
    }

    getSchema(columnIndices: Array<number>): Promise<TableSchema> {
        return this.performRpc('get_schema', ['column_indices'], [columnIndices]);
    }

    searchSchema(filters: Array<ColumnFilter>, sortOrder: SearchSchemaSortOrder): Promise<SearchSchemaResult> {
        return this.performRpc('search_schema', ['filters', 'sort_order'], [filters, sortOrder]);
    }

    getDataValues(columns: Array<ColumnSelection>, formatOptions: FormatOptions): Promise<TableData> {
        return this.performRpc('get_data_values', ['columns', 'format_options'], [columns, formatOptions]);
    }

    getRowLabels(selection: ArraySelection, formatOptions: FormatOptions): Promise<TableRowLabels> {
        return this.performRpc('get_row_labels', ['selection', 'format_options'], [selection, formatOptions]);
    }

    exportDataSelection(selection: TableSelection, format: ExportFormat): Promise<ExportedData> {
        return this.performRpc('export_data_selection', ['selection', 'format'], [selection, format]);
    }

    convertToCode(
        columnFilters: Array<ColumnFilter>,
        rowFilters: Array<RowFilter>,
        sortKeys: Array<ColumnSortKey>,
        codeSyntaxName: CodeSyntaxName
    ): Promise<ConvertedCode> {
        return this.performRpc(
            'convert_to_code',
            ['column_filters', 'row_filters', 'sort_keys', 'code_syntax_name'],
            [columnFilters, rowFilters, sortKeys, codeSyntaxName]
        );
    }

    suggestCodeSyntax(): Promise<CodeSyntaxName | undefined> {
        return this.performRpc('suggest_code_syntax', [], []);
    }

    openDataExplorer(): Promise<void> {
        return this.performRpc('open_data_explorer', [], []);
    }

    setColumnFilters(filters: Array<ColumnFilter>): Promise<void> {
        return this.performRpc('set_column_filters', ['filters'], [filters]);
    }

    setRowFilters(filters: Array<RowFilter>): Promise<FilterResult> {
        return this.performRpc('set_row_filters', ['filters'], [filters]);
    }

    setSortColumns(sortKeys: Array<ColumnSortKey>): Promise<void> {
        return this.performRpc('set_sort_columns', ['sort_keys'], [sortKeys]);
    }

    getColumnProfiles(
        callbackId: string,
        profiles: Array<ColumnProfileRequest>,
        formatOptions: FormatOptions
    ): Promise<void> {
        return this.performRpc(
            'get_column_profiles',
            ['callback_id', 'profiles', 'format_options'],
            [callbackId, profiles, formatOptions]
        );
    }

    setDatasetImportOptions(options: DatasetImportOptions): Promise<SetDatasetImportOptionsResult> {
        return this.performRpc('set_dataset_import_options', ['options'], [options]);
    }

    getState(): Promise<BackendState> {
        return this.performRpc('get_state', [], []);
    }

    /**
     * Closes the underlying runtime comm client.
     */
    closeClient(): void {
        this.clientInstance.dispose();
    }
}
