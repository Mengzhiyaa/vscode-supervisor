/*---------------------------------------------------------------------------------------------
 *  Column Profile Types - Types for column statistics and profiles
 *--------------------------------------------------------------------------------------------*/

import {
    getEffectiveColumnDisplayType,
    isBooleanDisplayType,
    isDateDisplayType,
    isNumericDisplayType,
    isStringDisplayType,
} from './columnDisplayTypeUtils';

/**
 * Column profile type
 */
export type ColumnProfileType =
    | 'null_count'
    | 'summary_stats'
    | 'small_frequency_table'
    | 'large_frequency_table'
    | 'small_histogram'
    | 'large_histogram';

/**
 * Summary statistics for numeric columns
 */
export interface NumericSummaryStats {
    min_value?: string;
    max_value?: string;
    mean?: string;
    median?: string;
    stdev?: string;
}

/**
 * Summary statistics for string columns
 */
export interface StringSummaryStats {
    num_empty: number;
    num_unique: number;
}

/**
 * Summary statistics for boolean columns
 */
export interface BooleanSummaryStats {
    true_count: number;
    false_count: number;
}

/**
 * Summary statistics for object columns
 */
export interface OtherSummaryStats {
    num_unique?: number;
}

/**
 * Summary statistics for date columns
 */
export interface DateSummaryStats {
    num_unique?: number;
    min_date?: string;
    mean_date?: string;
    median_date?: string;
    max_date?: string;
}

/**
 * Summary statistics for datetime columns
 */
export interface DatetimeSummaryStats extends DateSummaryStats {
    timezone?: string;
}

/**
 * Summary statistics payload returned by the backend.
 */
export interface ColumnSummaryStats {
    type_display?: string;
    number_stats?: NumericSummaryStats;
    string_stats?: StringSummaryStats;
    boolean_stats?: BooleanSummaryStats;
    date_stats?: DateSummaryStats;
    datetime_stats?: DatetimeSummaryStats;
    other_stats?: OtherSummaryStats;
}

/**
 * Frequency table entry
 */
export interface FrequencyTableEntry {
    value: string;
    count: number;
    percentage?: number;
}

/**
 * Frequency table payload as returned by the backend.
 */
export interface FrequencyTableData {
    values: string[];
    counts: number[];
    other_count?: number;
}

/**
 * Histogram payload as returned by the backend.
 */
export interface HistogramData {
    bin_edges: string[];
    bin_counts: number[];
}

/**
 * Histogram bin
 */
export interface HistogramBin {
    bin_start: string;
    bin_end: string;
    count: number;
    percentage?: number;
}

/**
 * Column profile result
 */
export interface ColumnProfileResult {
    null_count?: number;
    summary_stats?: ColumnSummaryStats;
    small_frequency_table?: FrequencyTableData;
    large_frequency_table?: FrequencyTableData;
    small_histogram?: HistogramData;
    large_histogram?: HistogramData;
    frequency_table?: FrequencyTableEntry[];
    histogram?: HistogramBin[];
}

/**
 * Column profile with type information
 */
export interface ColumnProfile {
    columnIndex: number;
    columnName: string;
    columnType: string;
    profile: ColumnProfileResult;
    isLoading?: boolean;
    error?: string;
}

/**
 * Get summary stats type based on column type
 */
export function isNumericType(typeName: string): boolean {
    return isNumericDisplayType(getEffectiveColumnDisplayType(typeName));
}

export function isStringType(typeName: string): boolean {
    return isStringDisplayType(getEffectiveColumnDisplayType(typeName));
}

export function isBooleanType(typeName: string): boolean {
    return isBooleanDisplayType(getEffectiveColumnDisplayType(typeName));
}

export function isDateType(typeName: string): boolean {
    const lowerType = getEffectiveColumnDisplayType(typeName);
    return (
        isDateDisplayType(lowerType) ||
        lowerType === 'datetime' ||
        lowerType === 'time' ||
        lowerType.includes('timestamp')
    );
}
