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
    Decimal = 'decimal',
}

export enum RowFilterCondition {
    And = 'and',
    Or = 'or',
}

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
    SetMembership = 'set_membership',
}

export enum FilterComparisonOp {
    Eq = '=',
    NotEq = '!=',
    Lt = '<',
    LtEq = '<=',
    Gt = '>',
    GtEq = '>=',
}

export enum TextSearchType {
    Contains = 'contains',
    NotContains = 'not_contains',
    StartsWith = 'starts_with',
    EndsWith = 'ends_with',
    RegexMatch = 'regex_match',
}

export enum ColumnFilterType {
    TextSearch = 'text_search',
    MatchDataTypes = 'match_data_types',
}

export enum ColumnProfileType {
    NullCount = 'null_count',
    SummaryStats = 'summary_stats',
    SmallFrequencyTable = 'small_frequency_table',
    LargeFrequencyTable = 'large_frequency_table',
    SmallHistogram = 'small_histogram',
    LargeHistogram = 'large_histogram',
}

export enum ExportFormat {
    Csv = 'csv',
    Tsv = 'tsv',
    Html = 'html',
}

export enum SupportStatus {
    Unsupported = 'unsupported',
    Supported = 'supported',
}

export const SearchSchemaSortOrder = {
    Original: 'original',
    AscendingName: 'ascending_name',
    DescendingName: 'descending_name',
    AscendingType: 'ascending_type',
    DescendingType: 'descending_type',
} as const;

export type SearchSchemaSortOrder =
    typeof SearchSchemaSortOrder[keyof typeof SearchSchemaSortOrder];

export interface ColumnSchema {
    column_name: string;
    column_label?: string;
    column_index: number;
    type_name: string;
    type_display: ColumnDisplayType;
    description?: string;
    children?: ColumnSchema[];
    precision?: number;
    scale?: number;
    timezone?: string;
    type_size?: number;
}

export interface TableShape {
    num_rows: number;
    num_columns: number;
}

export interface FilterBetween {
    left_value: string;
    right_value: string;
}

export interface FilterComparison {
    op: FilterComparisonOp;
    value: string;
}

export interface FilterSetMembership {
    values: string[];
    inclusive: boolean;
}

export interface FilterTextSearch {
    search_type: TextSearchType;
    term: string;
    case_sensitive: boolean;
}

export interface FilterMatchDataTypes {
    display_types: ColumnDisplayType[];
}

export type RowFilterParams =
    | FilterBetween
    | FilterComparison
    | FilterSetMembership
    | FilterTextSearch;

export type ColumnFilterParams =
    | FilterTextSearch
    | FilterMatchDataTypes;

export interface RowFilter {
    filter_id: string;
    filter_type: RowFilterType;
    column_schema: ColumnSchema;
    condition: RowFilterCondition;
    is_valid?: boolean;
    error_message?: string;
    params?: RowFilterParams;
}

export interface ColumnFilter {
    filter_type: ColumnFilterType;
    params: ColumnFilterParams;
}

export interface ColumnSortKey {
    column_index: number;
    ascending: boolean;
}

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

export interface SearchSchemaFeatures {
    support_status: SupportStatus;
    supported_types: ColumnFilterTypeSupportStatus[];
}

export interface SetColumnFiltersFeatures {
    support_status: SupportStatus;
    supported_types: ColumnFilterTypeSupportStatus[];
}

export interface SetRowFiltersFeatures {
    support_status: SupportStatus;
    supports_conditions: SupportStatus;
    supported_types: RowFilterTypeSupportStatus[];
}

export interface GetColumnProfilesFeatures {
    support_status: SupportStatus;
    supported_types: ColumnProfileTypeSupportStatus[];
}

export interface SetSortColumnsFeatures {
    support_status: SupportStatus;
}

export interface ExportDataSelectionFeatures {
    support_status: SupportStatus;
    supported_formats: ExportFormat[];
}

export interface CodeSyntaxName {
    code_syntax_name: string;
}

export interface SummaryStatsNumber {
    min_value?: string;
    max_value?: string;
    mean?: string;
    median?: string;
    stdev?: string;
}

export type NumericSummaryStats = SummaryStatsNumber;

export interface SummaryStatsBoolean {
    true_count: number;
    false_count: number;
}

export type BooleanSummaryStats = SummaryStatsBoolean;

export interface SummaryStatsOther {
    num_unique?: number;
}

export type OtherSummaryStats = SummaryStatsOther;

export interface SummaryStatsString {
    num_empty: number;
    num_unique: number;
}

export type StringSummaryStats = SummaryStatsString;

export interface SummaryStatsDate {
    num_unique?: number;
    min_date?: string;
    mean_date?: string;
    median_date?: string;
    max_date?: string;
}

export type DateSummaryStats = SummaryStatsDate;

export interface SummaryStatsDatetime extends SummaryStatsDate {
    timezone?: string;
}

export type DatetimeSummaryStats = SummaryStatsDatetime;

export interface ColumnSummaryStats {
    type_display?: ColumnDisplayType;
    number_stats?: SummaryStatsNumber;
    string_stats?: SummaryStatsString;
    boolean_stats?: SummaryStatsBoolean;
    date_stats?: SummaryStatsDate;
    datetime_stats?: SummaryStatsDatetime;
    other_stats?: SummaryStatsOther;
}

export interface ColumnQuantileValue {
    q: number;
    value: string;
    exact: boolean;
}

export interface ColumnHistogram {
    bin_edges: Array<string>;
    bin_counts: Array<number>;
    quantiles?: Array<ColumnQuantileValue>;
}

export type HistogramData = ColumnHistogram;

export interface ColumnFrequencyTable {
    values: Array<string>;
    counts: Array<number>;
    other_count?: number;
}

export type FrequencyTableData = ColumnFrequencyTable;

export interface ColumnProfileResult {
    null_count?: number;
    summary_stats?: ColumnSummaryStats;
    small_histogram?: ColumnHistogram;
    large_histogram?: ColumnHistogram;
    small_frequency_table?: ColumnFrequencyTable;
    large_frequency_table?: ColumnFrequencyTable;
}

export interface ConvertToCodeFeatures {
    support_status: SupportStatus;
    code_syntaxes?: CodeSyntaxName[];
}

export interface SupportedFeatures {
    search_schema: SearchSchemaFeatures;
    set_column_filters: SetColumnFiltersFeatures;
    set_row_filters: SetRowFiltersFeatures;
    get_column_profiles: GetColumnProfilesFeatures;
    set_sort_columns: SetSortColumnsFeatures;
    export_data_selection: ExportDataSelectionFeatures;
    convert_to_code: ConvertToCodeFeatures;
}

export interface BackendState {
    display_name: string;
    table_shape: TableShape;
    table_unfiltered_shape: TableShape;
    has_row_labels: boolean;
    column_filters: ColumnFilter[];
    row_filters: RowFilter[];
    sort_keys: ColumnSortKey[];
    supported_features: SupportedFeatures;
    connected?: boolean;
    error_message?: string;
}
