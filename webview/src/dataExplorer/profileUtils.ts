/*---------------------------------------------------------------------------------------------
 *  Data Explorer profile utilities
 *--------------------------------------------------------------------------------------------*/

import type {
    BooleanSummaryStats,
    ColumnProfileResult,
    ColumnSummaryStats,
    DateSummaryStats,
    DatetimeSummaryStats,
    NumericSummaryStats,
    OtherSummaryStats,
    StringSummaryStats,
} from './columnProfileTypes';

function normalizeHistogram(histogram: any):
    | { bin_edges: string[]; bin_counts: number[] }
    | undefined {
    if (
        !histogram?.bin_counts ||
        !histogram?.bin_edges ||
        histogram.bin_edges.length !== histogram.bin_counts.length + 1
    ) {
        return undefined;
    }

    return {
        bin_edges: histogram.bin_edges.map((edge: unknown) => String(edge ?? '')),
        bin_counts: histogram.bin_counts.map(
            (count: unknown) => Number(count) || 0,
        ),
    };
}

function normalizeFrequencyTable(frequencyTable: any):
    | { values: string[]; counts: number[]; other_count?: number }
    | undefined {
    if (frequencyTable?.values && frequencyTable?.counts) {
        return {
            values: frequencyTable.values.map((value: unknown) => String(value)),
            counts: frequencyTable.counts.map(
                (count: unknown) => Number(count) || 0,
            ),
            other_count:
                frequencyTable.other_count === undefined
                    ? undefined
                    : Number(frequencyTable.other_count) || 0,
        };
    }

    if (Array.isArray(frequencyTable)) {
        return {
            values: frequencyTable.map((entry) => String(entry?.value ?? '')),
            counts: frequencyTable.map(
                (entry) => Number(entry?.count) || 0,
            ),
        };
    }

    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function normalizeNumericSummaryStats(value: unknown): NumericSummaryStats | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const hasNumericValue =
        value.min_value !== undefined ||
        value.max_value !== undefined ||
        value.mean !== undefined ||
        value.median !== undefined ||
        value.stdev !== undefined;
    if (!hasNumericValue) {
        return undefined;
    }

    return {
        min_value:
            value.min_value === undefined || value.min_value === null
                ? undefined
                : String(value.min_value),
        max_value:
            value.max_value === undefined || value.max_value === null
                ? undefined
                : String(value.max_value),
        mean:
            value.mean === undefined || value.mean === null
                ? undefined
                : String(value.mean),
        median:
            value.median === undefined || value.median === null
                ? undefined
                : String(value.median),
        stdev:
            value.stdev === undefined || value.stdev === null
                ? undefined
                : String(value.stdev),
    };
}

function normalizeStringSummaryStats(value: unknown): StringSummaryStats | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const hasNumEmpty = value.num_empty !== undefined;
    const hasNumUnique = value.num_unique !== undefined;
    if (!hasNumEmpty && !hasNumUnique) {
        return undefined;
    }

    return {
        num_empty: Number(value.num_empty) || 0,
        num_unique: Number(value.num_unique) || 0,
    };
}

function normalizeBooleanSummaryStats(
    value: unknown,
): BooleanSummaryStats | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const hasTrueCount = value.true_count !== undefined;
    const hasFalseCount = value.false_count !== undefined;
    if (!hasTrueCount && !hasFalseCount) {
        return undefined;
    }

    return {
        true_count: Number(value.true_count) || 0,
        false_count: Number(value.false_count) || 0,
    };
}

function normalizeDateSummaryStats(value: unknown): DateSummaryStats | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const hasDateValue =
        value.min_date !== undefined ||
        value.mean_date !== undefined ||
        value.median_date !== undefined ||
        value.max_date !== undefined ||
        value.num_unique !== undefined;
    if (!hasDateValue) {
        return undefined;
    }

    return {
        num_unique:
            value.num_unique === undefined
                ? undefined
                : Number(value.num_unique) || 0,
        min_date:
            value.min_date === undefined || value.min_date === null
                ? undefined
                : String(value.min_date),
        mean_date:
            value.mean_date === undefined || value.mean_date === null
                ? undefined
                : String(value.mean_date),
        median_date:
            value.median_date === undefined || value.median_date === null
                ? undefined
                : String(value.median_date),
        max_date:
            value.max_date === undefined || value.max_date === null
                ? undefined
                : String(value.max_date),
    };
}

function normalizeDatetimeSummaryStats(
    value: unknown,
): DatetimeSummaryStats | undefined {
    const dateStats = normalizeDateSummaryStats(value);
    if (!dateStats && (!isRecord(value) || value.timezone === undefined)) {
        return undefined;
    }

    return {
        ...dateStats,
        timezone:
            !isRecord(value) || value.timezone === undefined || value.timezone === null
                ? undefined
                : String(value.timezone),
    };
}

function normalizeOtherSummaryStats(value: unknown): OtherSummaryStats | undefined {
    if (!isRecord(value) || value.num_unique === undefined) {
        return undefined;
    }

    return {
        num_unique: Number(value.num_unique) || 0,
    };
}

function normalizeSummaryStats(summaryStats: unknown): ColumnSummaryStats | undefined {
    if (!isRecord(summaryStats)) {
        return undefined;
    }

    const nestedStats: ColumnSummaryStats = {
        type_display:
            summaryStats.type_display === undefined ||
            summaryStats.type_display === null
                ? undefined
                : String(summaryStats.type_display),
        number_stats: normalizeNumericSummaryStats(summaryStats.number_stats),
        string_stats: normalizeStringSummaryStats(summaryStats.string_stats),
        boolean_stats: normalizeBooleanSummaryStats(summaryStats.boolean_stats),
        date_stats: normalizeDateSummaryStats(summaryStats.date_stats),
        datetime_stats: normalizeDatetimeSummaryStats(summaryStats.datetime_stats),
        other_stats: normalizeOtherSummaryStats(summaryStats.other_stats),
    };

    const hasNestedStats =
        nestedStats.number_stats !== undefined ||
        nestedStats.string_stats !== undefined ||
        nestedStats.boolean_stats !== undefined ||
        nestedStats.date_stats !== undefined ||
        nestedStats.datetime_stats !== undefined ||
        nestedStats.other_stats !== undefined;

    if (hasNestedStats || nestedStats.type_display !== undefined) {
        return nestedStats;
    }

    // Older Ark slices flattened the active summary stats bucket into
    // `summary_stats`. Preserve compatibility while migrating to the
    // Positron-style nested shape.
    return {
        number_stats: normalizeNumericSummaryStats(summaryStats),
        string_stats: normalizeStringSummaryStats(summaryStats),
        boolean_stats: normalizeBooleanSummaryStats(summaryStats),
        datetime_stats: normalizeDatetimeSummaryStats(summaryStats),
        date_stats: normalizeDateSummaryStats(summaryStats),
        other_stats: normalizeOtherSummaryStats(summaryStats),
    };
}

export function simplifyColumnProfile(profile: any): ColumnProfileResult | undefined {
    if (!profile) {
        return undefined;
    }

    const smallHistogram = normalizeHistogram(profile.small_histogram);
    const largeHistogram =
        normalizeHistogram(profile.large_histogram) ?? smallHistogram;
    const histogramData = smallHistogram ?? largeHistogram;
    let histogram:
        | Array<{ bin_start: string; bin_end: string; count: number }>
        | undefined;
    if (
        histogramData?.bin_counts &&
        histogramData?.bin_edges &&
        histogramData.bin_edges.length === histogramData.bin_counts.length + 1
    ) {
        histogram = histogramData.bin_counts.map((count, index) => {
            return {
                bin_start: String(histogramData.bin_edges[index] ?? index),
                bin_end: String(histogramData.bin_edges[index + 1] ?? index + 1),
                count: count ?? 0,
            };
        });
    }

    const smallFrequencyTable = normalizeFrequencyTable(
        profile.small_frequency_table,
    );
    const largeFrequencyTable =
        normalizeFrequencyTable(profile.large_frequency_table) ??
        smallFrequencyTable;
    const frequencyTableData = smallFrequencyTable ?? largeFrequencyTable;
    let frequencyTable:
        | Array<{ value: string; count: number }>
        | undefined;
    if (frequencyTableData?.values && frequencyTableData?.counts) {
        frequencyTable = frequencyTableData.values.map((value, index) => ({
            value,
            count: frequencyTableData.counts[index] ?? 0,
        }));
        if (frequencyTableData.other_count) {
            frequencyTable.push({
                value: 'Other',
                count: frequencyTableData.other_count,
            });
        }
    }

    return {
        null_count:
            profile.null_count === undefined
                ? undefined
                : Number(profile.null_count) || 0,
        summary_stats: normalizeSummaryStats(profile.summary_stats),
        small_histogram: smallHistogram,
        large_histogram: largeHistogram,
        histogram,
        small_frequency_table: smallFrequencyTable,
        large_frequency_table: largeFrequencyTable,
        frequency_table: frequencyTable,
    };
}

export function mergeColumnProfiles(
    existing: ColumnProfileResult | undefined,
    incoming: ColumnProfileResult | undefined,
): ColumnProfileResult | undefined {
    if (!existing) {
        return incoming;
    }

    if (!incoming) {
        return existing;
    }

    return {
        null_count: incoming.null_count ?? existing.null_count,
        summary_stats: incoming.summary_stats ?? existing.summary_stats,
        small_histogram: incoming.small_histogram ?? existing.small_histogram,
        large_histogram: incoming.large_histogram ?? existing.large_histogram,
        small_frequency_table:
            incoming.small_frequency_table ?? existing.small_frequency_table,
        large_frequency_table:
            incoming.large_frequency_table ?? existing.large_frequency_table,
        histogram: incoming.histogram ?? existing.histogram,
        frequency_table: incoming.frequency_table ?? existing.frequency_table,
    };
}
