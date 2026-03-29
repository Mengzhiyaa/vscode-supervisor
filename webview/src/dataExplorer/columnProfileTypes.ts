/*---------------------------------------------------------------------------------------------
 *  Column Profile Types - Types for column statistics and profiles
 *--------------------------------------------------------------------------------------------*/

export type {
    BooleanSummaryStats,
    ColumnProfileType,
    ColumnSummaryStats,
    DateSummaryStats,
    DatetimeSummaryStats,
    FrequencyTableData,
    HistogramData,
    NumericSummaryStats,
    OtherSummaryStats,
    StringSummaryStats,
} from '@shared/dataExplorer';
import type { ColumnProfileResult as SharedColumnProfileResult } from '@shared/dataExplorer';
import {
    getEffectiveColumnDisplayType,
    isBooleanDisplayType,
    isDateDisplayType,
    isNumericDisplayType,
    isStringDisplayType,
} from './columnDisplayTypeUtils';

/**
 * Frequency table entry
 */
export interface FrequencyTableEntry {
    value: string;
    count: number;
    percentage?: number;
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

export interface ColumnProfileViewResult extends SharedColumnProfileResult {
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
    profile: ColumnProfileViewResult;
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
