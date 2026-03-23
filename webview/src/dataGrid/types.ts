/*---------------------------------------------------------------------------------------------
 *  Data Grid Types - Port from Positron's dataGridInstance
 *  Core interfaces for virtual scrolling data grid
 *--------------------------------------------------------------------------------------------*/

/**
 * Column descriptor for layout calculations
 */
export interface ColumnDescriptor {
    readonly columnIndex: number;
    readonly left: number;
    readonly width: number;
}

/**
 * Row descriptor for layout calculations
 */
export interface RowDescriptor {
    readonly rowIndex: number;
    readonly top: number;
    readonly height: number;
}

/**
 * Cell selection state flags
 */
export enum CellSelectionState {
    None = 0,
    Selected = 1,
    SelectedLeft = 2,
    SelectedRight = 4,
    SelectedTop = 8,
    SelectedBottom = 16
}

/**
 * Column sort key interface
 */
export interface IColumnSortKey {
    readonly sortIndex: number;
    readonly columnIndex: number;
    readonly ascending: boolean;
}

/**
 * Data column interface
 */
export interface IDataColumn {
    readonly name: string;
    readonly type: string;
    readonly description?: string;
}

/**
 * Data grid configuration options
 */
export interface DataGridOptions {
    // Column headers
    columnHeaders: boolean;
    columnHeadersHeight: number;

    // Row headers (row numbers)
    rowHeaders: boolean;
    rowHeadersWidth: number;

    // Default sizes
    defaultColumnWidth: number;
    defaultRowHeight: number;

    // Column resize
    columnResize: boolean;
    minimumColumnWidth: number;
    maximumColumnWidth: number;

    // Scrollbar
    horizontalScrollbar: boolean;
    verticalScrollbar: boolean;
    scrollbarThickness: number;

    // Display options
    cellBorders: boolean;
    horizontalCellPadding: number;
}

/**
 * Viewport state for virtual scrolling
 */
export interface ViewportState {
    width: number;
    height: number;
    scrollTop: number;
    scrollLeft: number;
    firstRowIndex: number;
    visibleRowCount: number;
    firstColumnIndex: number;
    visibleColumnCount: number;
}

/**
 * Cell data for rendering
 */
export interface CellData {
    value: string;
    columnIndex: number;
    rowIndex: number;
}

/**
 * Schema column from backend
 */
export interface SchemaColumn {
    column_name: string;
    column_index: number;
    type_name: string;
    type_display: string;
    description?: string;
}

export type SupportStatus = 'unsupported' | 'supported';

export type ColumnFilterType = 'text_search' | 'match_data_types';

export type RowFilterType =
    | 'between'
    | 'compare'
    | 'is_empty'
    | 'is_false'
    | 'is_null'
    | 'is_true'
    | 'not_between'
    | 'not_empty'
    | 'not_null'
    | 'search'
    | 'set_membership';

export type ColumnProfileType =
    | 'null_count'
    | 'summary_stats'
    | 'small_frequency_table'
    | 'large_frequency_table'
    | 'small_histogram'
    | 'large_histogram';

export type ExportFormat = 'csv' | 'tsv' | 'html';

export interface RowFilterTypeSupportStatus {
    row_filter_type: RowFilterType;
    support_status: SupportStatus;
}

export interface ColumnFilterTypeSupportStatus {
    column_filter_type: ColumnFilterType;
    support_status: SupportStatus;
}

export interface ColumnProfileTypeSupportStatus {
    profile_type: ColumnProfileType;
    support_status: SupportStatus;
}

/**
 * Backend state from Data Explorer
 */
export interface BackendState {
    display_name: string;
    table_shape: {
        num_rows: number;
        num_columns: number;
    };
    table_unfiltered_shape: {
        num_rows: number;
        num_columns: number;
    };
    has_row_labels: boolean;
    column_filters: ColumnFilter[];
    row_filters: RowFilter[];
    sort_keys: SortKey[];
    supported_features: SupportedFeatures;
    connected?: boolean;
    error_message?: string;
}

/**
 * Column filter
 */
export interface ColumnFilter {
    column_index: number;
    filter_type: string;
    params?: Record<string, unknown>;
}

/**
 * Row filter
 */
export interface RowFilter {
    filter_id: string;
    filter_type: string;
    column_schema: SchemaColumn;
    condition: string;
    is_valid: boolean;
    error_message?: string;
    params?: Record<string, unknown>;
}

/**
 * Sort key
 */
export interface SortKey {
    column_index: number;
    ascending: boolean;
}

/**
 * Supported features from backend
 */
export interface SupportedFeatures {
    search_schema: SearchSchemaFeatures;
    set_column_filters: SetColumnFiltersFeatures;
    set_row_filters: SetRowFiltersFeatures;
    get_column_profiles: GetColumnProfilesFeatures;
    set_sort_columns: SetSortColumnsFeatures;
    export_data_selection: ExportDataSelectionFeatures;
    convert_to_code?: ConvertToCodeFeatures;
}

interface SearchSchemaFeatures {
    support_status: SupportStatus;
    supported_types: ColumnFilterTypeSupportStatus[];
}

interface SetColumnFiltersFeatures {
    support_status: SupportStatus;
    supported_types: ColumnFilterTypeSupportStatus[];
}

interface SetRowFiltersFeatures {
    support_status: SupportStatus;
    supports_conditions: SupportStatus;
    supported_types: RowFilterTypeSupportStatus[];
}

interface GetColumnProfilesFeatures {
    support_status: SupportStatus;
    supported_types: ColumnProfileTypeSupportStatus[];
}

interface SetSortColumnsFeatures {
    support_status: SupportStatus;
}

interface ExportDataSelectionFeatures {
    support_status: SupportStatus;
    supported_formats: ExportFormat[];
}

interface ConvertToCodeFeatures {
    support_status: SupportStatus;
    code_syntaxes?: Array<{ code_syntax_name: string }>;
}
