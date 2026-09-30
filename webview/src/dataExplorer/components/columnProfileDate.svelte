<!--
  columnProfileDate.svelte - Expanded date profile
  Port from Positron's columnProfileDate.tsx
-->
<script lang="ts">
    import { localize } from "../nls";
    import type { TableSummaryDataGridInstance } from "../tableSummaryDataGridInstance";
    import ColumnProfileNullCountValue from "./columnProfileNullCountValue.svelte";
    import StatsValue from "./statsValue.svelte";

    interface Props {
        instance: TableSummaryDataGridInstance;
        columnIndex: number;
    }

    let { instance, columnIndex }: Props = $props();

    const columnProfiles = $derived(instance.columnProfiles);
    const stats = $derived(
        $columnProfiles.get(columnIndex)?.summary_stats?.date_stats,
    );

    const missingLabel = localize("positronMissing", "Missing");
    const minLabel = localize("positronMin", "Min");
    const medianLabel = localize("positronMedian", "Median");
    const maxLabel = localize("positronMax", "Max");
</script>

<div class="column-profile-expanded column-profile-info">
    <div class="tabular-info">
        <div class="labels">
            <div class="label">{missingLabel}</div>
            <div class="label">{minLabel}</div>
            <div class="label">{medianLabel}</div>
            <div class="label">{maxLabel}</div>
        </div>
        <div class="spacer"></div>
        <div class="values">
            <ColumnProfileNullCountValue {instance} {columnIndex} />
            <StatsValue {stats} value={stats?.min_date} />
            <StatsValue {stats} value={stats?.median_date} />
            <StatsValue {stats} value={stats?.max_date} />
        </div>
    </div>
</div>
