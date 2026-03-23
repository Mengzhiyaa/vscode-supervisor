<!--
  ColumnProfileExpanded.svelte - Expanded column profile view
  Port from Positron's ColumnProfile* components
-->
<script lang="ts">
    import type { DataGridHoverManager } from "../../dataGrid/dataGridInstance";
    import {
        getEffectiveColumnDisplayType,
        isBooleanDisplayType,
        isDateDisplayType,
        isDatetimeDisplayType,
        isIntegerDisplayType,
        isNumericDisplayType,
        isObjectDisplayType,
        isStringDisplayType,
    } from "../columnDisplayTypeUtils";
    import type {
        ColumnProfileResult,
        ColumnSummaryStats,
        NumericSummaryStats,
    } from "../columnProfileTypes";
    import { localize } from "../nls";
    import VectorFrequencyTable from "./VectorFrequencyTable.svelte";
    import VectorHistogram from "./VectorHistogram.svelte";

    interface Props {
        columnIndex: number;
        columnType: string;
        typeDisplay: string;
        resolvedTypeDisplay?: string;
        profile?: ColumnProfileResult;
        hoverManager?: DataGridHoverManager;
    }

    let {
        columnType,
        typeDisplay,
        resolvedTypeDisplay,
        profile,
        hoverManager,
    }: Props = $props();

    type SummaryValue = { text: string; placeholder: boolean; title?: string };
    type SummaryRow = { label: string; value: SummaryValue };

    const effectiveType = $derived(
        getEffectiveColumnDisplayType(typeDisplay, columnType),
    );
    const profileDisplayType = $derived.by(() =>
        getEffectiveColumnDisplayType(
            resolvedTypeDisplay ?? profile?.summary_stats?.type_display,
            effectiveType,
        ),
    );
    const isInteger = $derived(isIntegerDisplayType(profileDisplayType));
    const isNumeric = $derived(isNumericDisplayType(profileDisplayType));
    const isBoolean = $derived(isBooleanDisplayType(profileDisplayType));
    const isString = $derived(isStringDisplayType(profileDisplayType));
    const isDateOnly = $derived(isDateDisplayType(profileDisplayType));
    const isDateTime = $derived(isDatetimeDisplayType(profileDisplayType));
    const isObject = $derived(isObjectDisplayType(profileDisplayType));
    const summaryStats = $derived(
        profile?.summary_stats as ColumnSummaryStats | undefined,
    );
    const numberStats = $derived(summaryStats?.number_stats);
    const booleanStats = $derived(summaryStats?.boolean_stats);
    const stringStats = $derived(summaryStats?.string_stats);
    const dateStats = $derived(summaryStats?.date_stats);
    const datetimeStats = $derived(summaryStats?.datetime_stats);
    const otherStats = $derived(summaryStats?.other_stats);

    const missingLabel = localize("positronMissing", "Missing");
    const minLabel = localize("positronMin", "Min");
    const medianLabel = localize("positronMedian", "Median");
    const meanLabel = localize("positronMean", "Mean");
    const maxLabel = localize("positronMax", "Max");
    const sdLabel = localize("positronSD", "SD");
    const trueLabel = localize("positronTrue", "True");
    const falseLabel = localize("positronFalse", "False");
    const emptyLabel = localize("positronEmpty", "Empty");
    const uniqueLabel = localize("positronUnique", "Unique");
    const timezoneLabel = localize("positronTimezone", "Timezone");
    const naLabel = localize("positronNA", "N/A");

    const largeHistogramData = $derived.by(() => {
        if (profile?.large_histogram) {
            return profile.large_histogram;
        }

        if (profile?.histogram && profile.histogram.length > 0) {
            const binEdges: string[] = [];
            const binCounts: number[] = [];

            for (const bin of profile.histogram) {
                if (binEdges.length === 0) {
                    binEdges.push(bin.bin_start);
                }

                binEdges.push(bin.bin_end);
                binCounts.push(bin.count);
            }

            return { bin_edges: binEdges, bin_counts: binCounts };
        }

        return null;
    });

    const largeFrequencyTableData = $derived.by(() => {
        if (isBoolean && profile?.small_frequency_table) {
            return profile.small_frequency_table;
        }

        if (isString && profile?.large_frequency_table) {
            return profile.large_frequency_table;
        }

        if (profile?.frequency_table) {
            return {
                values: profile.frequency_table.map((entry) => entry.value),
                counts: profile.frequency_table.map((entry) => entry.count),
            };
        }

        return null;
    });

    function nullCountValue(): SummaryValue {
        if (profile?.null_count === undefined) {
            return { text: "\u22ef", placeholder: true };
        }

        const text = String(profile.null_count);
        return { text, placeholder: false, title: text };
    }

    function statsValue(stats: unknown, value: unknown): SummaryValue {
        if (stats === undefined) {
            return { text: "\u22ef", placeholder: true };
        }

        if (value === undefined || value === null) {
            return { text: naLabel, placeholder: false, title: naLabel };
        }

        const text = String(value);
        return { text, placeholder: false, title: text };
    }

    function integerBoundaryValue(
        stats: NumericSummaryStats | undefined,
        value: unknown,
    ): SummaryValue {
        if (stats === undefined) {
            return { text: "\u22ef", placeholder: true };
        }

        if (value === undefined || value === null) {
            return { text: naLabel, placeholder: false, title: naLabel };
        }

        if (typeof value === "number") {
            const text = Math.round(value).toString();
            return { text, placeholder: false, title: text };
        }

        const parsedValue = Number.parseFloat(
            String(value).replaceAll(",", ""),
        );
        if (!Number.isNaN(parsedValue)) {
            const text = Math.round(parsedValue).toString();
            return { text, placeholder: false, title: text };
        }

        const text = String(value);
        return { text, placeholder: false, title: text };
    }

    const rows = $derived.by((): SummaryRow[] => {
        if (isNumeric) {
            return [
                { label: missingLabel, value: nullCountValue() },
                {
                    label: minLabel,
                    value: isInteger
                        ? integerBoundaryValue(numberStats, numberStats?.min_value)
                        : statsValue(numberStats, numberStats?.min_value),
                },
                {
                    label: medianLabel,
                    value: statsValue(numberStats, numberStats?.median),
                },
                { label: meanLabel, value: statsValue(numberStats, numberStats?.mean) },
                {
                    label: maxLabel,
                    value: isInteger
                        ? integerBoundaryValue(numberStats, numberStats?.max_value)
                        : statsValue(numberStats, numberStats?.max_value),
                },
                { label: sdLabel, value: statsValue(numberStats, numberStats?.stdev) },
            ];
        }

        if (isBoolean) {
            return [
                { label: missingLabel, value: nullCountValue() },
                {
                    label: trueLabel,
                    value: statsValue(booleanStats, booleanStats?.true_count),
                },
                {
                    label: falseLabel,
                    value: statsValue(booleanStats, booleanStats?.false_count),
                },
            ];
        }

        if (isString) {
            return [
                { label: missingLabel, value: nullCountValue() },
                {
                    label: emptyLabel,
                    value: statsValue(stringStats, stringStats?.num_empty),
                },
                {
                    label: uniqueLabel,
                    value: statsValue(stringStats, stringStats?.num_unique),
                },
            ];
        }

        if (isDateOnly) {
            return [
                { label: missingLabel, value: nullCountValue() },
                { label: minLabel, value: statsValue(dateStats, dateStats?.min_date) },
                {
                    label: medianLabel,
                    value: statsValue(dateStats, dateStats?.median_date),
                },
                { label: maxLabel, value: statsValue(dateStats, dateStats?.max_date) },
            ];
        }

        if (isDateTime) {
            return [
                { label: missingLabel, value: nullCountValue() },
                {
                    label: minLabel,
                    value: statsValue(datetimeStats, datetimeStats?.min_date),
                },
                {
                    label: medianLabel,
                    value: statsValue(datetimeStats, datetimeStats?.median_date),
                },
                {
                    label: maxLabel,
                    value: statsValue(datetimeStats, datetimeStats?.max_date),
                },
                {
                    label: timezoneLabel,
                    value: statsValue(datetimeStats, datetimeStats?.timezone),
                },
            ];
        }

        if (isObject) {
            return [
                { label: missingLabel, value: nullCountValue() },
                {
                    label: uniqueLabel,
                    value: statsValue(otherStats, otherStats?.num_unique),
                },
            ];
        }

        return [];
    });
</script>

<div class="column-profile-expanded">
    {#if isNumeric && largeHistogramData}
        <div class="profile-sparkline">
            <VectorHistogram
                histogram={largeHistogramData}
                width={200}
                height={50}
                xAxisHeight={0.5}
                displayType={profileDisplayType}
                {hoverManager}
            />
        </div>
    {:else if (isBoolean || isString) && largeFrequencyTableData}
        <div class="profile-sparkline">
            <VectorFrequencyTable
                frequencyTable={largeFrequencyTableData}
                width={200}
                height={50}
                xAxisHeight={0.5}
                {hoverManager}
            />
        </div>
    {/if}

    <div class="tabular-info">
        <div class="labels">
            {#each rows as row, index (index)}
                <div class="label">{row.label}</div>
            {/each}
        </div>

        <div class="spacer"></div>

        <div class="values">
            {#each rows as row, index (index)}
                <div
                    class={row.value.placeholder ? "value-placeholder" : "value"}
                    title={row.value.placeholder ? undefined : row.value.title}
                >
                    {row.value.text}
                </div>
            {/each}
        </div>
    </div>
</div>

<style>
    .column-profile-expanded {
        display: grid;
        grid-template-rows:
            [sparkline] min-content
            [tabular-info] min-content
            [end-rows];
        grid-template-columns: 1fr;
    }

    .profile-sparkline {
        margin-bottom: 10px;
        grid-row: sparkline / tabular-info;
    }

    .tabular-info {
        display: grid;
        margin: 0 auto;
        min-width: 200px;
        overflow: hidden;
        grid-row: tabular-info / end-rows;
        grid-template-columns:
            [labels] min-content
            [spacer] 1fr
            [values] auto
            [end-columns];
    }

    .tabular-info .labels {
        margin-right: 10px;
        grid-column: labels / spacer;
    }

    .tabular-info .labels .label {
        height: 20px;
    }

    .tabular-info .spacer {
        grid-column: spacer / values;
    }

    .tabular-info .values {
        overflow: hidden;
        text-align: right;
        grid-column: values / end-columns;
    }

    .tabular-info .values .value {
        height: 20px;
        font-weight: 600;
        overflow: hidden;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        font-variant-numeric: tabular-nums;
    }

    .tabular-info .values .value-placeholder {
        height: 20px;
    }
</style>
