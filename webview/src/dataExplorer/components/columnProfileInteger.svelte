<!--
  columnProfileInteger.svelte - Expanded integer profile
  Port from Positron's columnProfileInteger.tsx
-->
<script lang="ts">
    import { localize } from "../nls";
    import type { NumericSummaryStats } from "../columnProfileTypes";
    import type { TableSummaryDataGridInstance } from "../tableSummaryDataGridInstance";
    import ColumnProfileNullCountValue from "./columnProfileNullCountValue.svelte";
    import ColumnProfileSparklines from "./columnProfileSparklines.svelte";
    import StatsValue from "./statsValue.svelte";

    interface Props {
        instance: TableSummaryDataGridInstance;
        columnIndex: number;
    }

    let { instance, columnIndex }: Props = $props();

    const columnHistogram = $derived(
        instance.getColumnProfileLargeHistogram(columnIndex),
    );
    const stats = $derived(
        instance.getColumnProfileSummaryStats(columnIndex)?.number_stats,
    );
    const columnSchema = $derived(instance.getColumnSchema(columnIndex));

    const missingLabel = localize("positronMissing", "Missing");
    const minLabel = localize("positronMin", "Min");
    const medianLabel = localize("positronMedian", "Median");
    const meanLabel = localize("positronMean", "Mean");
    const maxLabel = localize("positronMax", "Max");
    const sdLabel = localize("positronSD", "SD");
    const naLabel = localize("positronNA", "N/A");

    function integerStatsValue(
        stats: NumericSummaryStats | undefined,
        value: number | string | undefined,
    ) {
        if (stats === undefined) {
            return "\u22ef";
        }

        if (value === undefined || value === null) {
            return naLabel;
        }

        if (typeof value === "number") {
            return Math.round(value).toString();
        }

        const numericValue = Number.parseFloat(value);
        return Number.isNaN(numericValue)
            ? value
            : Math.round(numericValue).toString();
    }
</script>

<div class="column-profile-expanded column-profile-info">
    <ColumnProfileSparklines
        {columnHistogram}
        displayType={columnSchema?.type_display}
        hoverManager={instance.hoverManager}
    />

    <div class="tabular-info">
        <div class="labels">
            <div class="label">{missingLabel}</div>
            <div class="label">{minLabel}</div>
            <div class="label">{medianLabel}</div>
            <div class="label">{meanLabel}</div>
            <div class="label">{maxLabel}</div>
            <div class="label">{sdLabel}</div>
        </div>
        <div class="spacer"></div>
        <div class="values">
            <ColumnProfileNullCountValue {instance} {columnIndex} />
            {#if stats === undefined}
                <div class="value-placeholder">\u22ef</div>
            {:else}
                <div class="value">{integerStatsValue(stats, stats?.min_value)}</div>
            {/if}
            <StatsValue {stats} value={stats?.median} />
            <StatsValue {stats} value={stats?.mean} />
            {#if stats === undefined}
                <div class="value-placeholder">\u22ef</div>
            {:else}
                <div class="value">{integerStatsValue(stats, stats?.max_value)}</div>
            {/if}
            <StatsValue {stats} value={stats?.stdev} />
        </div>
    </div>
</div>
