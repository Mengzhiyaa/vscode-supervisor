/*---------------------------------------------------------------------------------------------
 *  Data Explorer Communication Protocol Types
 *  1:1 port from Positron's positronDataExplorerComm.ts (auto-generated from data_explorer.json)
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RuntimeClientInstance } from '../RuntimeClientInstance';
import { PositronBaseComm, PositronCommOptions } from './positronBaseComm';

// Event types are defined inline

// ============================================================================
// Enums
// ============================================================================

/**
 * Possible values for ColumnDisplayType
 */
export enum ColumnDisplayType {
    Boolean = 'boolean',
    String = 'string',
    Date = 'date',
    Datetime = 'datetime',
    Time = 'time',
    Interval = 'interval',
    Object = 'object',
    Array = 'array',
    Struct = 'struct',
    Unknown = 'unknown',
    Floating = 'floating',
    Integer = 'integer',
    Decimal = 'decimal'
}

/**
 * Possible values for RowFilterCondition
 */
export enum RowFilterCondition {
    And = 'and',
    Or = 'or'
}

/**
 * Possible values for RowFilterType
 */
export enum RowFilterType {
    Between = 'between',
    Compare = 'compare',
    IsEmpty = 'is_empty',
    IsFalse = 'is_false',
    IsNull = 'is_null',
    IsTrue = 'is_true',
    NotBetween = 'not_between',
    NotEmpty = 'not_empty',
    NotNull = 'not_null',
    Search = 'search',
    SetMembership = 'set_membership'
}

/**
 * Possible values for FilterComparisonOp
 */
export enum FilterComparisonOp {
    Eq = '=',
    NotEq = '!=',
    Lt = '<',
    LtEq = '<=',
    Gt = '>',
    GtEq = '>='
}

/**
 * Possible values for TextSearchType
 */
export enum TextSearchType {
    Contains = 'contains',
    NotContains = 'not_contains',
    StartsWith = 'starts_with',
    EndsWith = 'ends_with',
    RegexMatch = 'regex_match'
}

/**
 * Possible values for ColumnFilterType
 */
export enum ColumnFilterType {
    TextSearch = 'text_search',
    MatchDataTypes = 'match_data_types'
}

/**
 * Possible values for ColumnProfileType
 */
export enum ColumnProfileType {
    NullCount = 'null_count',
    SummaryStats = 'summary_stats',
    SmallFrequencyTable = 'small_frequency_table',
    LargeFrequencyTable = 'large_frequency_table',
    SmallHistogram = 'small_histogram',
    LargeHistogram = 'large_histogram'
}

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

/**
 * Possible values for ExportFormat
 */
export enum ExportFormat {
    Csv = 'csv',
    Tsv = 'tsv',
    Html = 'html'
}

/**
 * Possible values for SupportStatus
 */
export enum SupportStatus {
    Unsupported = 'unsupported',
    Supported = 'supported'
}

/**
 * Possible values for SearchSchemaSortOrder
 */
export enum SearchSchemaSortOrder {
    Original = 'original',
    AscendingName = 'ascending_name',
    DescendingName = 'descending_name',
    AscendingType = 'ascending_type',
    DescendingType = 'descending_type'
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
 * Schema for a column in a table
 */
export interface ColumnSchema {
    column_name: string;
    column_label?: string;
    column_index: number;
    type_name: string;
    type_display: ColumnDisplayType;
    description?: string;
    children?: Array<ColumnSchema>;
    precision?: number;
    scale?: number;
    timezone?: string;
    type_size?: number;
}

/**
 * Provides number of rows and columns in a table
 */
export interface TableShape {
    num_rows: number;
    num_columns: number;
}

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
 * Specifies a column to sort by
 */
export interface ColumnSortKey {
    column_index: number;
    ascending: boolean;
}

/**
 * Specifies a table row filter based on a single column's values
 */
export interface RowFilter {
    filter_id: string;
    filter_type: RowFilterType;
    column_schema: ColumnSchema;
    condition: RowFilterCondition;
    is_valid?: boolean;
    error_message?: string;
    params?: RowFilterParams;
}

/**
 * Parameters for the 'between' and 'not_between' filter types
 */
export interface FilterBetween {
    left_value: string;
    right_value: string;
}

/**
 * Parameters for the 'compare' filter type
 */
export interface FilterComparison {
    op: FilterComparisonOp;
    value: string;
}

/**
 * Parameters for the 'set_membership' filter type
 */
export interface FilterSetMembership {
    values: Array<string>;
    inclusive: boolean;
}

/**
 * Parameters for the 'search' filter type
 */
export interface FilterTextSearch {
    search_type: TextSearchType;
    term: string;
    case_sensitive: boolean;
}

/**
 * Parameters for the 'match_data_types' filter type
 */
export interface FilterMatchDataTypes {
    display_types: Array<ColumnDisplayType>;
}

/**
 * A filter that selects a subset of columns
 */
export interface ColumnFilter {
    filter_type: ColumnFilterType;
    params: ColumnFilterParams;
}

/**
 * Support status for a row filter type
 */
export interface RowFilterTypeSupportStatus {
    row_filter_type: RowFilterType;
    support_status: SupportStatus;
}

/**
 * Support status for a column filter type
 */
export interface ColumnFilterTypeSupportStatus {
    column_filter_type: ColumnFilterType;
    support_status: SupportStatus;
}

/**
 * Support status for a column profile type
 */
export interface ColumnProfileTypeSupportStatus {
    profile_type: ColumnProfileType;
    support_status: SupportStatus;
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
 * Result of computing column profile
 */
export interface ColumnProfileResult {
    null_count?: number;
    summary_stats?: ColumnSummaryStats;
    small_histogram?: ColumnHistogram;
    large_histogram?: ColumnHistogram;
    small_frequency_table?: ColumnFrequencyTable;
    large_frequency_table?: ColumnFrequencyTable;
}

/**
 * Profile result containing summary stats for a column
 */
export interface ColumnSummaryStats {
    type_display: ColumnDisplayType;
    number_stats?: SummaryStatsNumber;
    string_stats?: SummaryStatsString;
    boolean_stats?: SummaryStatsBoolean;
    date_stats?: SummaryStatsDate;
    datetime_stats?: SummaryStatsDatetime;
    other_stats?: SummaryStatsOther;
}

export interface SummaryStatsNumber {
    min_value?: string;
    max_value?: string;
    mean?: string;
    median?: string;
    stdev?: string;
}

export interface SummaryStatsBoolean {
    true_count: number;
    false_count: number;
}

export interface SummaryStatsOther {
    num_unique?: number;
}

export interface SummaryStatsString {
    num_empty: number;
    num_unique: number;
}

export interface SummaryStatsDate {
    num_unique?: number;
    min_date?: string;
    mean_date?: string;
    median_date?: string;
    max_date?: string;
}

export interface SummaryStatsDatetime {
    num_unique?: number;
    min_date?: string;
    mean_date?: string;
    median_date?: string;
    max_date?: string;
    timezone?: string;
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
 * Result from a histogram profile request
 */
export interface ColumnHistogram {
    bin_edges: Array<string>;
    bin_counts: Array<number>;
    quantiles: Array<ColumnQuantileValue>;
}

/**
 * Result from a frequency_table profile request
 */
export interface ColumnFrequencyTable {
    values: Array<ColumnValue>;
    counts: Array<number>;
    other_count?: number;
}

/**
 * Parameters for a frequency_table profile request
 */
export interface ColumnFrequencyTableParams {
    limit: number;
}

/**
 * An exact or approximate quantile value from a column
 */
export interface ColumnQuantileValue {
    q: number;
    value: string;
    exact: boolean;
}

/**
 * Search schema result
 */
export interface SearchSchemaResult {
    matches: Array<number>;
}

/**
 * For each field, returns flags indicating supported features
 */
export interface SupportedFeatures {
    search_schema: SearchSchemaFeatures;
    set_column_filters: SetColumnFiltersFeatures;
    set_row_filters: SetRowFiltersFeatures;
    get_column_profiles: GetColumnProfilesFeatures;
    set_sort_columns: SetSortColumnsFeatures;
    export_data_selection: ExportDataSelectionFeatures;
    convert_to_code: ConvertToCodeFeatures;
}

export interface SearchSchemaFeatures {
    support_status: SupportStatus;
    supported_types: Array<ColumnFilterTypeSupportStatus>;
}

export interface SetColumnFiltersFeatures {
    support_status: SupportStatus;
    supported_types: Array<ColumnFilterTypeSupportStatus>;
}

export interface SetRowFiltersFeatures {
    support_status: SupportStatus;
    supports_conditions: SupportStatus;
    supported_types: Array<RowFilterTypeSupportStatus>;
}

export interface GetColumnProfilesFeatures {
    support_status: SupportStatus;
    supported_types: Array<ColumnProfileTypeSupportStatus>;
}

export interface SetSortColumnsFeatures {
    support_status: SupportStatus;
}

export interface ExportDataSelectionFeatures {
    support_status: SupportStatus;
    supported_formats: Array<ExportFormat>;
}

export interface ConvertToCodeFeatures {
    support_status: SupportStatus;
    code_syntaxes?: Array<CodeSyntaxName>;
}

/**
 * The current backend state for the data explorer
 */
export interface BackendState {
    display_name: string;
    table_shape: TableShape;
    table_unfiltered_shape: TableShape;
    has_row_labels: boolean;
    column_filters: Array<ColumnFilter>;
    row_filters: Array<RowFilter>;
    sort_keys: Array<ColumnSortKey>;
    supported_features: SupportedFeatures;
    connected?: boolean;
    error_message?: string;
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
 * Syntax name used for code conversion.
 */
export interface CodeSyntaxName {
    code_syntax_name: string;
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
export type RowFilterParams = FilterBetween | FilterComparison | FilterTextSearch | FilterSetMembership;
export type ColumnFilterParams = FilterTextSearch | FilterMatchDataTypes;
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
