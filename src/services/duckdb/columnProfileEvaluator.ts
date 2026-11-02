/*---------------------------------------------------------------------------------------------
 *  DuckDB column profile computations aligned with Positron's DuckDBTableView.
 *--------------------------------------------------------------------------------------------*/

import { DuckDBInstance } from './duckdbInstance';
import { escapeIdentifier as quoteIdentifier } from './sqlBuilder';
import { formatFloat, formatNumericStat } from './valueFormatting';
import {
    ColumnSchema,
    ColumnDisplayType,
    ColumnProfileRequest,
    ColumnProfileResult,
    ColumnProfileType,
    ColumnSummaryStats,
    ColumnHistogram,
    ColumnFrequencyTable,
    ColumnHistogramParams,
    ColumnFrequencyTableParams,
    ColumnHistogramParamsMethod,
    FormatOptions,
} from '../../runtime/comms/positronDataExplorerComm';

/** Keeps the extension's evaluator entry point while sharing Positron's calculations. */
export class ColumnProfileEvaluator {
    private readonly _duckdb = DuckDBInstance.getInstance();

    async evaluateProfiles(
        tableName: string,
        schema: ColumnSchema[],
        profiles: ColumnProfileRequest[],
        formatOptions: FormatOptions,
        whereClause = '',
        filteredRowCount?: number,
    ): Promise<ColumnProfileResult[]> {
        const relation = quoteIdentifier(tableName);
        const runQuery = async (sql: string): Promise<Record<string, unknown>[]> => {
            const result = await this._duckdb.query(sql);
            return Array.from({ length: result.numRows }, (_, index) => {
                const row = result.get(index);
                return Object.fromEntries(
                    result.schema.fields.map((field: { name: string }) => [
                        field.name,
                        row?.[field.name],
                    ]),
                );
            });
        };
        const filteredRows =
            filteredRowCount ??
            Number(
                (await runQuery(`SELECT count(*) AS n FROM ${relation}${whereClause}`))[0]?.n ?? 0,
            );
        const evaluator = new DuckDBColumnProfiles({ runQuery }, relation, schema, whereClause);
        return evaluator.computeColumnProfiles(profiles, filteredRows, formatOptions);
    }
}

class DuckDBColumnProfiles {
    constructor(
        private readonly client: { runQuery(sql: string): Promise<Record<string, unknown>[]> },
        private readonly relation: string,
        private readonly schema: ColumnSchema[],
        private readonly _whereClause: string,
    ) {}

    private async _relation(): Promise<string> {
        return this.relation;
    }

    async computeColumnProfiles(
        requests: ColumnProfileRequest[],
        filteredRows: number,
        formatOptions: FormatOptions,
    ): Promise<ColumnProfileResult[]> {
        const profiles: ColumnProfileResult[] = [];
        for (const request of requests) {
            if (!this.schema[request.column_index]) {
                throw new Error(`Unknown profile column index: ${request.column_index}`);
            }
            profiles.push(
                await this._computeOneColumnProfile(request, filteredRows, formatOptions),
            );
        }
        return profiles;
    }

    private async _computeOneColumnProfile(
        request: ColumnProfileRequest,
        filteredRows: number,
        formatOptions: FormatOptions,
    ): Promise<ColumnProfileResult> {
        const entry = this.schema[request.column_index];
        const quotedName = quoteIdentifier(entry.column_name);
        const result: ColumnProfileResult = {};

        for (const spec of request.profiles) {
            switch (spec.profile_type) {
                case ColumnProfileType.NullCount:
                    result.null_count = await this._nullCount(quotedName);
                    break;
                case ColumnProfileType.SummaryStats:
                    result.summary_stats =
                        filteredRows === 0
                            ? this._emptySummaryStats(entry)
                            : await this._summaryStats(entry, quotedName, formatOptions);
                    break;
                case ColumnProfileType.SmallFrequencyTable:
                case ColumnProfileType.LargeFrequencyTable:
                    result[spec.profile_type] = await this._frequencyTable(
                        quotedName,
                        (spec.params as ColumnFrequencyTableParams).limit,
                        filteredRows,
                    );
                    break;
                case ColumnProfileType.SmallHistogram:
                case ColumnProfileType.LargeHistogram:
                    result[spec.profile_type] = await this._histogram(
                        entry,
                        quotedName,
                        spec.params as ColumnHistogramParams,
                        filteredRows,
                    );
                    break;
                default:
                    break;
            }
        }
        return result;
    }

    private async _nullCount(quotedName: string): Promise<number> {
        const rows = await this.client.runQuery(
            `SELECT count(*) - count(${quotedName}) AS n FROM ${await this._relation()}${this._whereClause}`,
        );
        return Number(rows[0]?.n ?? 0);
    }

    private _wherePlus(predicate: string): string {
        return this._whereClause ? `${this._whereClause} AND ${predicate}` : `\nWHERE ${predicate}`;
    }

    private async _summaryStats(
        entry: ColumnSchema,
        quotedName: string,
        formatOptions: FormatOptions,
    ): Promise<ColumnSummaryStats> {
        const display = entry.type_display;
        const relation = await this._relation();
        if (
            display === ColumnDisplayType.Integer ||
            display === ColumnDisplayType.Floating ||
            display === ColumnDisplayType.Decimal
        ) {
            // One pass for the moment-based stats; a second query for the median.
            const rows = await this.client.runQuery(
                `SELECT count(${quotedName}) AS n, CAST(min(${quotedName}) AS VARCHAR) AS lo, CAST(max(${quotedName}) AS VARCHAR) AS hi, ` +
                    `sum(CAST(${quotedName} AS DOUBLE)) AS s, sum(CAST(${quotedName} AS DOUBLE) * CAST(${quotedName} AS DOUBLE)) AS ss ` +
                    `FROM ${relation}${this._whereClause}`,
            );
            const n = Number(rows[0]?.n ?? 0);
            const sum = Number(rows[0]?.s ?? 0);
            const sumsq = Number(rows[0]?.ss ?? 0);
            const mean = n > 0 ? sum / n : 0;
            // Sample standard deviation from the sums of values and squares.
            const variance = n > 1 ? Math.max(0, (sumsq - n * mean * mean) / (n - 1)) : 0;
            const median = await this._quantile(quotedName, 0.5, n);
            const fmt = (v: number) => formatFloat(v, formatOptions);
            return {
                type_display: display,
                number_stats: {
                    min_value:
                        rows[0]?.lo === null || rows[0]?.lo === undefined
                            ? undefined
                            : String(rows[0].lo),
                    max_value:
                        rows[0]?.hi === null || rows[0]?.hi === undefined
                            ? undefined
                            : String(rows[0].hi),
                    mean: n > 0 ? fmt(mean) : undefined,
                    median: formatNumericStat(median, display, formatOptions),
                    stdev: n > 1 ? fmt(Math.sqrt(variance)) : undefined,
                },
            };
        }
        if (display === ColumnDisplayType.String) {
            const rows = await this.client.runQuery(
                `SELECT count(DISTINCT ${quotedName}) AS nunique, ` +
                    `count(CASE WHEN ${quotedName} = '' THEN 1 END) AS nempty ` +
                    `FROM ${relation}${this._whereClause}`,
            );
            return {
                type_display: ColumnDisplayType.String,
                string_stats: {
                    num_unique: Number(rows[0]?.nunique ?? 0),
                    num_empty: Number(rows[0]?.nempty ?? 0),
                },
            };
        }
        if (display === ColumnDisplayType.Boolean) {
            // DuckDB has real booleans, so test the column directly rather than comparing to 0/1.
            const rows = await this.client.runQuery(
                `SELECT count(CASE WHEN ${quotedName} THEN 1 END) AS ntrue, ` +
                    `count(CASE WHEN NOT ${quotedName} THEN 1 END) AS nfalse ` +
                    `FROM ${relation}${this._whereClause}`,
            );
            return {
                type_display: ColumnDisplayType.Boolean,
                boolean_stats: {
                    true_count: Number(rows[0]?.ntrue ?? 0),
                    false_count: Number(rows[0]?.nfalse ?? 0),
                },
            };
        }
        if (display === ColumnDisplayType.Date || display === ColumnDisplayType.Datetime) {
            const rows = await this.client.runQuery(
                `SELECT CAST(min(${quotedName}) AS VARCHAR) AS lo, CAST(max(${quotedName}) AS VARCHAR) AS hi, count(DISTINCT ${quotedName}) AS nunique ` +
                    `FROM ${relation}${this._whereClause}`,
            );
            const stats = {
                num_unique: Number(rows[0]?.nunique ?? 0),
                min_date:
                    rows[0]?.lo === null || rows[0]?.lo === undefined
                        ? undefined
                        : String(rows[0].lo),
                max_date:
                    rows[0]?.hi === null || rows[0]?.hi === undefined
                        ? undefined
                        : String(rows[0].hi),
            };
            return display === ColumnDisplayType.Date
                ? { type_display: display, date_stats: stats }
                : { type_display: display, datetime_stats: stats };
        }
        const rows = await this.client.runQuery(
            `SELECT count(DISTINCT ${quotedName}) AS nunique FROM ${relation}${this._whereClause}`,
        );
        return {
            type_display: display,
            other_stats: { num_unique: Number(rows[0]?.nunique ?? 0) },
        };
    }

    private _emptySummaryStats(entry: ColumnSchema): ColumnSummaryStats {
        switch (entry.type_display) {
            case ColumnDisplayType.Integer:
            case ColumnDisplayType.Floating:
            case ColumnDisplayType.Decimal:
                return { type_display: entry.type_display, number_stats: {} };
            case ColumnDisplayType.String:
                return {
                    type_display: ColumnDisplayType.String,
                    string_stats: { num_unique: 0, num_empty: 0 },
                };
            case ColumnDisplayType.Boolean:
                return {
                    type_display: ColumnDisplayType.Boolean,
                    boolean_stats: { true_count: 0, false_count: 0 },
                };
            case ColumnDisplayType.Date:
                return { type_display: ColumnDisplayType.Date, date_stats: { num_unique: 0 } };
            case ColumnDisplayType.Datetime:
                return {
                    type_display: ColumnDisplayType.Datetime,
                    datetime_stats: { num_unique: 0 },
                };
            default:
                return { type_display: entry.type_display, other_stats: { num_unique: 0 } };
        }
    }

    /**
     * Computes a quantile (0..1) by ordering the non-null values and reading the value at the
     * corresponding offset. `n` is the count of non-null values.
     *
     * Returns the raw cell value rather than a JS number, because its callers want different things
     * from it. The median is reported to the user, and a DECIMAL/NUMERIC median arrives as an exact
     * digit string that a double cannot hold, so `formatNumericStat` formats it textually. The
     * histogram's interquartile range is arithmetic on a bin width, which is approximate either way,
     * so those callers coerce.
     */
    private async _quantile(quotedName: string, q: number, n: number): Promise<unknown> {
        if (n === 0) {
            return undefined;
        }
        const offset = Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))));
        const rows = await this.client.runQuery(
            `SELECT CAST(${quotedName} AS VARCHAR) AS v FROM ${await this._relation()}${this._wherePlus(`${quotedName} IS NOT NULL`)} ` +
                `ORDER BY ${quotedName} LIMIT 1 OFFSET ${offset}`,
        );
        const value = rows[0]?.v;
        return value === null ? undefined : value;
    }

    private async _frequencyTable(
        quotedName: string,
        limit: number,
        filteredRows: number,
    ): Promise<ColumnFrequencyTable> {
        const rows = await this.client.runQuery(
            `SELECT CAST(${quotedName} AS VARCHAR) AS value, count(*) AS freq FROM ${await this._relation()}` +
                `${this._wherePlus(`${quotedName} IS NOT NULL`)} GROUP BY ${quotedName} ` +
                `ORDER BY freq DESC, ${quotedName} ASC LIMIT ${limit}`,
        );
        const values: string[] = [];
        const counts: number[] = [];
        let total = 0;
        for (const row of rows) {
            values.push(String(row.value));
            const freq = Number(row.freq);
            counts.push(freq);
            total += freq;
        }
        const nullCount = await this._nullCount(quotedName);
        return { values, counts, other_count: Math.max(0, filteredRows - total - nullCount) };
    }

    private async _histogram(
        entry: ColumnSchema,
        quotedName: string,
        params: ColumnHistogramParams,
        filteredRows: number,
    ): Promise<ColumnHistogram> {
        const nullCount = await this._nullCount(quotedName);
        const nonNull = filteredRows - nullCount;
        if (nonNull <= 0) {
            return { bin_edges: ['NULL', 'NULL'], bin_counts: [nullCount], quantiles: [] };
        }

        const rows = await this.client.runQuery(
            `SELECT CAST(min(${quotedName}) AS VARCHAR) AS lo, CAST(max(${quotedName}) AS VARCHAR) AS hi FROM ${await this._relation()}${this._whereClause}`,
        );
        const minValue = Number(rows[0]?.lo);
        const maxValue = Number(rows[0]?.hi);
        const peakToPeak = maxValue - minValue;

        // A degenerate range (single distinct value) collapses to one bin.
        if (!isFinite(peakToPeak) || peakToPeak === 0) {
            return {
                bin_edges: [String(minValue), String(maxValue)],
                bin_counts: [nonNull],
                quantiles: [],
            };
        }

        let binWidth = 0;
        switch (params.method) {
            case ColumnHistogramParamsMethod.Fixed:
                binWidth = peakToPeak / params.num_bins;
                break;
            case ColumnHistogramParamsMethod.FreedmanDiaconis: {
                const q1 = Number((await this._quantile(quotedName, 0.25, nonNull)) ?? 0);
                const q3 = Number((await this._quantile(quotedName, 0.75, nonNull)) ?? 0);
                const iqr = q3 - q1;
                if (iqr > 0) {
                    binWidth = 2 * iqr * Math.pow(nonNull, -1 / 3);
                }
                break;
            }
            case ColumnHistogramParamsMethod.Sturges:
            case ColumnHistogramParamsMethod.Scott:
            default:
                binWidth = peakToPeak / (Math.log2(nonNull) + 1);
                break;
        }
        if (binWidth <= 0) {
            binWidth = peakToPeak / params.num_bins;
        }

        let numBins = Math.ceil(peakToPeak / binWidth);
        if (numBins > params.num_bins) {
            numBins = params.num_bins;
            binWidth = peakToPeak / numBins;
        }
        if (entry.type_display === ColumnDisplayType.Integer && peakToPeak <= numBins) {
            numBins = peakToPeak + 1;
            binWidth = peakToPeak / numBins;
        }

        const binRows = await this.client.runQuery(
            `SELECT CAST(FLOOR((${quotedName} * 1.0 - ${minValue}) / ${binWidth}) AS INTEGER) AS bin_id, count(*) AS bin_count ` +
                `FROM ${await this._relation()}${this._wherePlus(`${quotedName} IS NOT NULL`)} GROUP BY bin_id`,
        );
        const histEntries = new Map<number, number>(
            binRows.map((row) => [Number(row.bin_id), Number(row.bin_count)]),
        );

        const histogram: ColumnHistogram = { bin_edges: [], bin_counts: [], quantiles: [] };
        for (let i = 0; i < numBins; i++) {
            histogram.bin_edges.push(String(minValue + binWidth * i));
            histogram.bin_counts.push(histEntries.get(i) ?? 0);
        }
        // The final bin edge is exclusive, so fold the overflow bin into the last bin.
        histogram.bin_counts[numBins - 1] += histEntries.get(numBins) ?? 0;
        histogram.bin_edges.push(String(minValue + binWidth * numBins));
        return histogram;
    }
}
