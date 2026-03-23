/*---------------------------------------------------------------------------------------------
 *  Column Profile Evaluator
 *  Computes column statistics (null counts, summary stats, histograms, frequency tables)
 *  using DuckDB SQL queries.
 *
 *  Aligned with positron: zero-row handling, WHERE clause pass-through,
 *  FreedmanDiaconis/Sturges histogram methods, DECIMAL/TIMESTAMP support.
 *--------------------------------------------------------------------------------------------*/

import { DuckDBInstance } from './duckdbInstance';
import { escapeIdentifier } from './sqlBuilder';
import {
    ColumnSchema,
    ColumnDisplayType,
    ColumnProfileRequest,
    ColumnProfileResult,
    ColumnProfileSpec,
    ColumnProfileType,
    ColumnSummaryStats,
    ColumnHistogram,
    ColumnFrequencyTable,
    ColumnHistogramParams,
    ColumnFrequencyTableParams,
    ColumnHistogramParamsMethod,
    FormatOptions,
    SummaryStatsNumber,
    SummaryStatsString,
    SummaryStatsBoolean,
    SummaryStatsDate,
    SummaryStatsDatetime,
    SummaryStatsOther,
} from '../../runtime/comms/positronDataExplorerComm';

function getResultRowValue(
    row: any,
    result: any,
    index: number,
    preferredKeys: string[] = []
): unknown {
    if (!row) {
        return undefined;
    }

    for (const key of preferredKeys) {
        const value = row[key];
        if (value !== undefined) {
            return value;
        }
    }

    const fieldName = result?.schema?.fields?.[index]?.name;
    if (fieldName) {
        const value = row[fieldName];
        if (value !== undefined) {
            return value;
        }
    }

    if (row[index] !== undefined) {
        return row[index];
    }

    if (typeof row === 'object' && row !== null) {
        const values = Object.values(row as Record<string, unknown>);
        if (index < values.length) {
            return values[index];
        }
    }

    return undefined;
}

function getFirstResultValue(
    result: any,
    index: number,
    preferredKeys: string[] = []
): unknown {
    return getResultRowValue(result?.get?.(0), result, index, preferredKeys);
}

/**
 * Evaluates column profiles by generating and executing DuckDB SQL.
 */
export class ColumnProfileEvaluator {
    private readonly _duckdb: DuckDBInstance;

    constructor() {
        this._duckdb = DuckDBInstance.getInstance();
    }

    /**
     * Evaluate all requested column profiles.
     * @param tableName The DuckDB table name
     * @param schema Column schemas
     * @param profiles Requested profile specs
     * @param _formatOptions Format options (reserved for future use)
     * @param whereClause Optional WHERE clause for filtered data
     * @param filteredRowCount Current filtered row count (for zero-row optimization)
     */
    async evaluateProfiles(
        tableName: string,
        schema: ColumnSchema[],
        profiles: ColumnProfileRequest[],
        _formatOptions: FormatOptions,
        whereClause: string = '',
        filteredRowCount?: number
    ): Promise<ColumnProfileResult[]> {
        // Zero-row optimization (aligned with positron)
        if (filteredRowCount === 0) {
            return profiles.map(request => {
                const colSchema = schema[request.column_index];
                return this._createEmptyProfileResult(colSchema, request.profiles);
            });
        }

        const results: ColumnProfileResult[] = [];

        for (const request of profiles) {
            const colSchema = schema[request.column_index];
            if (!colSchema) {
                results.push({});
                continue;
            }

            const result: ColumnProfileResult = {};

            for (const spec of request.profiles) {
                await this._evaluateSingleProfile(
                    tableName, colSchema, spec, result, whereClause
                );
            }

            results.push(result);
        }

        return results;
    }

    /**
     * Create empty profile results for zero-row case (aligned with positron).
     */
    private _createEmptyProfileResult(
        colSchema: ColumnSchema | undefined,
        specs: ColumnProfileSpec[]
    ): ColumnProfileResult {
        const result: ColumnProfileResult = {};

        for (const spec of specs) {
            switch (spec.profile_type) {
                case ColumnProfileType.NullCount:
                    result.null_count = 0;
                    break;
                case ColumnProfileType.SmallHistogram:
                case ColumnProfileType.LargeHistogram:
                    if (spec.profile_type === ColumnProfileType.SmallHistogram) {
                        result.small_histogram = {
                            bin_edges: ['NULL', 'NULL'],
                            bin_counts: [0],
                            quantiles: [],
                        };
                    } else {
                        result.large_histogram = {
                            bin_edges: ['NULL', 'NULL'],
                            bin_counts: [0],
                            quantiles: [],
                        };
                    }
                    break;
                case ColumnProfileType.SmallFrequencyTable:
                case ColumnProfileType.LargeFrequencyTable:
                    if (spec.profile_type === ColumnProfileType.SmallFrequencyTable) {
                        result.small_frequency_table = {
                            values: [],
                            counts: [],
                            other_count: 0,
                        };
                    } else {
                        result.large_frequency_table = {
                            values: [],
                            counts: [],
                            other_count: 0,
                        };
                    }
                    break;
                case ColumnProfileType.SummaryStats:
                    if (colSchema) {
                        result.summary_stats = this._createEmptySummaryStats(colSchema);
                    }
                    break;
            }
        }

        return result;
    }

    /**
     * Create empty summary stats for zero-row case (aligned with positron).
     */
    private _createEmptySummaryStats(colSchema: ColumnSchema): ColumnSummaryStats {
        const typeDisplay = colSchema.type_display;
        const stats: ColumnSummaryStats = { type_display: typeDisplay };

        if (this._isNumericType(typeDisplay)) {
            stats.number_stats = {};
        } else if (this._isStringType(typeDisplay)) {
            stats.string_stats = { num_unique: 0, num_empty: 0 };
        } else if (this._isBooleanType(typeDisplay)) {
            stats.boolean_stats = { true_count: 0, false_count: 0 };
        } else if (typeDisplay === ColumnDisplayType.Datetime) {
            stats.datetime_stats = { num_unique: 0 };
        } else if (typeDisplay === ColumnDisplayType.Date) {
            stats.date_stats = { num_unique: 0 };
        }

        return stats;
    }

    private async _evaluateSingleProfile(
        tableName: string,
        colSchema: ColumnSchema,
        spec: ColumnProfileSpec,
        result: ColumnProfileResult,
        whereClause: string
    ): Promise<void> {
        const col = escapeIdentifier(colSchema.column_name);
        const table = escapeIdentifier(tableName);

        try {
            switch (spec.profile_type) {
                case ColumnProfileType.NullCount: {
                    const res = await this._duckdb.query(
                        `SELECT COUNT(*) FILTER (WHERE ${col} IS NULL) AS null_count FROM ${table}${whereClause}`
                    );
                    result.null_count = Number(getFirstResultValue(res, 0, ['null_count']) ?? 0);
                    break;
                }

                case ColumnProfileType.SummaryStats: {
                    result.summary_stats = await this._computeSummaryStats(
                        tableName, colSchema, whereClause
                    );
                    break;
                }

                case ColumnProfileType.SmallHistogram: {
                    const params = spec.params as ColumnHistogramParams | undefined;
                    result.small_histogram = await this._computeHistogram(
                        tableName, colSchema, params?.num_bins ?? 80,
                        params?.method, whereClause
                    );
                    break;
                }

                case ColumnProfileType.LargeHistogram: {
                    const params = spec.params as ColumnHistogramParams | undefined;
                    result.large_histogram = await this._computeHistogram(
                        tableName, colSchema, params?.num_bins ?? 100,
                        params?.method, whereClause
                    );
                    break;
                }

                case ColumnProfileType.SmallFrequencyTable: {
                    const params = spec.params as ColumnFrequencyTableParams | undefined;
                    result.small_frequency_table = await this._computeFrequencyTable(
                        tableName, colSchema, params?.limit ?? 8, whereClause
                    );
                    break;
                }

                case ColumnProfileType.LargeFrequencyTable: {
                    const params = spec.params as ColumnFrequencyTableParams | undefined;
                    result.large_frequency_table = await this._computeFrequencyTable(
                        tableName, colSchema, params?.limit ?? 16, whereClause
                    );
                    break;
                }
            }
        } catch {
            // Silently skip individual profile errors to avoid breaking the whole request
        }
    }

    private async _computeSummaryStats(
        tableName: string,
        colSchema: ColumnSchema,
        whereClause: string
    ): Promise<ColumnSummaryStats> {
        const col = escapeIdentifier(colSchema.column_name);
        const table = escapeIdentifier(tableName);
        const typeDisplay = colSchema.type_display;
        const typeName = colSchema.type_name.toUpperCase();

        const stats: ColumnSummaryStats = { type_display: typeDisplay };

        // WHERE clause for non-null values
        const notNullWhere = whereClause
            ? `${whereClause} AND ${col} IS NOT NULL`
            : ` WHERE ${col} IS NOT NULL`;

        if (this._isNumericType(typeDisplay) || typeName.startsWith('DECIMAL')) {
            // For DECIMAL types, cast min/max to VARCHAR but mean/stdev/median to DOUBLE
            //  (aligned with positron's DECIMAL handling)
            const isDecimal = typeName.startsWith('DECIMAL');
            const castExpr = isDecimal ? `CAST(${col} AS DOUBLE)` : col;

            const res = await this._duckdb.query(
                `SELECT
                    MIN(${col})::VARCHAR AS min_val,
                    MAX(${col})::VARCHAR AS max_val,
                    AVG(${castExpr})::VARCHAR AS mean_val,
                    MEDIAN(${castExpr})::VARCHAR AS median_val,
                    STDDEV_SAMP(${castExpr})::VARCHAR AS stdev_val
                FROM ${table}${notNullWhere}`
            );
            const row = res.get(0);
            if (row) {
                stats.number_stats = {
                    min_value: String(getResultRowValue(row, res, 0, ['min_val']) ?? ''),
                    max_value: String(getResultRowValue(row, res, 1, ['max_val']) ?? ''),
                    mean: String(getResultRowValue(row, res, 2, ['mean_val']) ?? ''),
                    median: String(getResultRowValue(row, res, 3, ['median_val']) ?? ''),
                    stdev: String(getResultRowValue(row, res, 4, ['stdev_val']) ?? ''),
                };
            }

            // Override type_display for DECIMAL
            if (isDecimal) {
                stats.type_display = ColumnDisplayType.Decimal;
            }
        } else if (this._isStringType(typeDisplay)) {
            const res = await this._duckdb.query(
                `SELECT
                    COUNT(DISTINCT ${col}) AS num_unique,
                    SUM(CASE WHEN ${col} = '' THEN 1 ELSE 0 END) AS num_empty
                FROM ${table}${notNullWhere}`
            );
            const row = res.get(0);
            if (row) {
                stats.string_stats = {
                    num_unique: Number(getResultRowValue(row, res, 0, ['num_unique']) ?? 0),
                    num_empty: Number(getResultRowValue(row, res, 1, ['num_empty']) ?? 0),
                };
            }
        } else if (this._isBooleanType(typeDisplay)) {
            const res = await this._duckdb.query(
                `SELECT
                    SUM(CASE WHEN ${col} THEN 1 ELSE 0 END) AS true_count,
                    SUM(CASE WHEN NOT ${col} THEN 1 ELSE 0 END) AS false_count
                FROM ${table}${notNullWhere}`
            );
            const row = res.get(0);
            if (row) {
                stats.boolean_stats = {
                    true_count: Number(getResultRowValue(row, res, 0, ['true_count']) ?? 0),
                    false_count: Number(getResultRowValue(row, res, 1, ['false_count']) ?? 0),
                };
            }
        } else if (typeDisplay === ColumnDisplayType.Datetime) {
            // Aligned with positron: use epoch_ms for mean/median
            const res = await this._duckdb.query(
                `SELECT
                    COUNT(DISTINCT ${col}) AS num_unique,
                    MIN(${col})::VARCHAR AS min_date,
                    MAX(${col})::VARCHAR AS max_date,
                    strftime(MAKE_TIMESTAMP(CAST(AVG(epoch_ms(${col})) * 1000 AS BIGINT)), '%Y-%m-%d %H:%M:%S') AS mean_ts,
                    strftime(MAKE_TIMESTAMP(CAST(MEDIAN(epoch_ms(${col})) * 1000 AS BIGINT)), '%Y-%m-%d %H:%M:%S') AS median_ts
                FROM ${table}${notNullWhere}`
            );
            const row = res.get(0);
            if (row) {
                stats.datetime_stats = {
                    num_unique: Number(getResultRowValue(row, res, 0, ['num_unique']) ?? 0),
                    min_date: String(getResultRowValue(row, res, 1, ['min_date']) ?? ''),
                    max_date: String(getResultRowValue(row, res, 2, ['max_date']) ?? ''),
                    mean_date: String(getResultRowValue(row, res, 3, ['mean_ts']) ?? ''),
                    median_date: String(getResultRowValue(row, res, 4, ['median_ts']) ?? ''),
                };
            }
        } else if (typeDisplay === ColumnDisplayType.Date) {
            const res = await this._duckdb.query(
                `SELECT
                    COUNT(DISTINCT ${col}) AS num_unique,
                    MIN(${col})::VARCHAR AS min_date,
                    MAX(${col})::VARCHAR AS max_date
                FROM ${table}${notNullWhere}`
            );
            const row = res.get(0);
            if (row) {
                stats.date_stats = {
                    num_unique: Number(getResultRowValue(row, res, 0, ['num_unique']) ?? 0),
                    min_date: String(getResultRowValue(row, res, 1, ['min_date']) ?? ''),
                    max_date: String(getResultRowValue(row, res, 2, ['max_date']) ?? ''),
                };
            }
        } else {
            // Other types — just count unique values
            const res = await this._duckdb.query(
                `SELECT COUNT(DISTINCT ${col}) AS num_unique FROM ${table}${notNullWhere}`
            );
            const row = res.get(0);
            if (row) {
                stats.other_stats = {
                    num_unique: Number(getResultRowValue(row, res, 0, ['num_unique']) ?? 0),
                };
            }
        }

        return stats;
    }

    /**
     * Compute histogram with support for Fixed, FreedmanDiaconis, and Sturges methods.
     * Aligned with positron: integer optimization when peak-to-peak <= numBins.
     */
    private async _computeHistogram(
        tableName: string,
        colSchema: ColumnSchema,
        numBins: number,
        method?: ColumnHistogramParamsMethod,
        whereClause: string = ''
    ): Promise<ColumnHistogram> {
        const col = escapeIdentifier(colSchema.column_name);
        const table = escapeIdentifier(tableName);
        const typeName = colSchema.type_name.toUpperCase();

        const notNullWhere = whereClause
            ? `${whereClause} AND ${col} IS NOT NULL`
            : ` WHERE ${col} IS NOT NULL`;

        // Get min, max, count, and optionally IQR for FreedmanDiaconis
        const statsQuery = method === ColumnHistogramParamsMethod.FreedmanDiaconis
            ? `SELECT
                MIN(${col})::DOUBLE AS min_val,
                MAX(${col})::DOUBLE AS max_val,
                COUNT(*)::INTEGER AS total,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${col})::DOUBLE AS q1,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${col})::DOUBLE AS q3
               FROM ${table}${notNullWhere}`
            : `SELECT
                MIN(${col})::DOUBLE AS min_val,
                MAX(${col})::DOUBLE AS max_val,
                COUNT(*)::INTEGER AS total
               FROM ${table}${notNullWhere}`;

        const rangeRes = await this._duckdb.query(statsQuery);
        const rangeRow = rangeRes.get(0);
        const minVal = Number(getResultRowValue(rangeRow, rangeRes, 0, ['min_val']) ?? 0);
        const maxVal = Number(getResultRowValue(rangeRow, rangeRes, 1, ['max_val']) ?? 0);
        const totalCount = Number(getResultRowValue(rangeRow, rangeRes, 2, ['total']) ?? 0);

        if (totalCount === 0 || minVal === maxVal) {
            const countValue = totalCount;
            return {
                bin_edges: [String(minVal), String(maxVal)],
                bin_counts: [countValue],
                quantiles: [],
            };
        }

        const peakToPeak = maxVal - minVal;

        // Determine actual number of bins based on method
        let actualBins = numBins;
        const isInteger = typeName.includes('INT') || typeName === 'HUGEINT';

        // Integer optimization: when peak-to-peak <= numBins, use exact bins
        if (isInteger && peakToPeak <= numBins) {
            actualBins = Math.round(peakToPeak);
        } else if (method === ColumnHistogramParamsMethod.FreedmanDiaconis) {
            const q1 = Number(getResultRowValue(rangeRow, rangeRes, 3, ['q1']) ?? 0);
            const q3 = Number(getResultRowValue(rangeRow, rangeRes, 4, ['q3']) ?? 0);
            const iqr = q3 - q1;
            if (iqr > 0) {
                const binWidth = 2 * iqr * Math.pow(totalCount, -1 / 3);
                actualBins = Math.max(1, Math.ceil(peakToPeak / binWidth));
            }
        } else if (method === ColumnHistogramParamsMethod.Sturges) {
            actualBins = Math.max(1, Math.ceil(Math.log2(totalCount) + 1));
        }
        // else: Fixed or default — use numBins as-is

        // Clamp bins to reasonable range
        actualBins = Math.max(1, Math.min(actualBins, 1000));

        const binWidth = peakToPeak / actualBins;
        const binEdges: string[] = [];
        for (let i = 0; i <= actualBins; i++) {
            binEdges.push(String(minVal + i * binWidth));
        }

        // Use WIDTH_BUCKET to count bins
        const histRes = await this._duckdb.query(
            `SELECT WIDTH_BUCKET(${col}::DOUBLE, ${minVal}, ${maxVal + binWidth * 0.001}, ${actualBins}) AS bucket, COUNT(*) AS cnt
             FROM ${table}${notNullWhere}
             GROUP BY bucket
             ORDER BY bucket`
        );

        const binCounts = new Array(actualBins).fill(0);
        for (let r = 0; r < histRes.numRows; r++) {
            const row = histRes.get(r);
            if (!row) { continue; }
            const bucket = Number(getResultRowValue(row, histRes, 0, ['bucket']) ?? 0) - 1;
            if (bucket >= 0 && bucket < actualBins) {
                binCounts[bucket] = Number(getResultRowValue(row, histRes, 1, ['cnt']) ?? 0);
            }
        }

        // Compute quantiles
        const quantileRes = await this._duckdb.query(
            `SELECT
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${col})::VARCHAR AS q25,
                PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${col})::VARCHAR AS q50,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${col})::VARCHAR AS q75
             FROM ${table}${notNullWhere}`
        );
        const qRow = quantileRes.get(0);
        const quantiles = [
            { q: 0.25, value: String(getResultRowValue(qRow, quantileRes, 0, ['q25']) ?? ''), exact: false },
            { q: 0.50, value: String(getResultRowValue(qRow, quantileRes, 1, ['q50']) ?? ''), exact: false },
            { q: 0.75, value: String(getResultRowValue(qRow, quantileRes, 2, ['q75']) ?? ''), exact: false },
        ];

        return { bin_edges: binEdges, bin_counts: binCounts, quantiles };
    }

    private async _computeFrequencyTable(
        tableName: string,
        colSchema: ColumnSchema,
        limit: number,
        whereClause: string = ''
    ): Promise<ColumnFrequencyTable> {
        const col = escapeIdentifier(colSchema.column_name);
        const table = escapeIdentifier(tableName);

        const notNullWhere = whereClause
            ? `${whereClause} AND ${col} IS NOT NULL`
            : ` WHERE ${col} IS NOT NULL`;

        const res = await this._duckdb.query(
            `SELECT ${col}::VARCHAR AS val, COUNT(*) AS cnt
             FROM ${table}${notNullWhere}
             GROUP BY ${col}
             ORDER BY cnt DESC
             LIMIT ${limit + 1}`
        );

        const values: (string | number)[] = [];
        const counts: number[] = [];
        let otherCount: number | undefined;

        for (let r = 0; r < Math.min(res.numRows, limit); r++) {
            const row = res.get(r);
            if (!row) { continue; }
            values.push(String(getResultRowValue(row, res, 0, ['val']) ?? ''));
            counts.push(Number(getResultRowValue(row, res, 1, ['cnt']) ?? 0));
        }

        // If there are more results than the limit, compute an "other" count
        if (res.numRows > limit) {
            const totalRes = await this._duckdb.query(
                `SELECT COUNT(*) FROM ${table}${notNullWhere}`
            );
            const total = Number(getFirstResultValue(totalRes, 0) ?? 0);
            const counted = counts.reduce((a, b) => a + b, 0);
            otherCount = total - counted;
        }

        return { values, counts, other_count: otherCount };
    }

    // Type helpers
    private _isNumericType(t: ColumnDisplayType): boolean {
        return t === ColumnDisplayType.Integer ||
            t === ColumnDisplayType.Floating ||
            t === ColumnDisplayType.Decimal;
    }

    private _isStringType(t: ColumnDisplayType): boolean {
        return t === ColumnDisplayType.String;
    }

    private _isBooleanType(t: ColumnDisplayType): boolean {
        return t === ColumnDisplayType.Boolean;
    }

    private _isDateType(t: ColumnDisplayType): boolean {
        return t === ColumnDisplayType.Date || t === ColumnDisplayType.Datetime;
    }
}
