<!--
  columnProfileString.svelte - Expanded string profile
  Port from Positron's columnProfileString.tsx
-->
<script lang="ts">
    import { localize } from "../nls";
    import type { TableSummaryDataGridInstance } from "../tableSummaryDataGridInstance";
    import ColumnProfileNullCountValue from "./columnProfileNullCountValue.svelte";
    import ColumnProfileSparklines from "./columnProfileSparklines.svelte";
    import StatsValue from "./statsValue.svelte";

    interface Props {
        instance: TableSummaryDataGridInstance;
        columnIndex: number;
    }

    let { instance, columnIndex }: Props = $props();

    const columnFrequencyTable = $derived(
        instance.getColumnProfileLargeFrequencyTable(columnIndex),
    );
    const stats = $derived(
        instance.getColumnProfileSummaryStats(columnIndex)?.string_stats,
    );

    const missingLabel = localize("positronMissing", "Missing");
    const emptyLabel = localize("positronEmpty", "Empty");
    const uniqueLabel = localize("positronUnique", "Unique");
</script>

<div class="column-profile-expanded column-profile-info">
    <ColumnProfileSparklines
        {columnFrequencyTable}
        hoverManager={instance.hoverManager}
    />

    <div class="tabular-info">
        <div class="labels">
            <div class="label">{missingLabel}</div>
            <div class="label">{emptyLabel}</div>
            <div class="label">{uniqueLabel}</div>
        </div>
        <div class="spacer"></div>
        <div class="values">
            <ColumnProfileNullCountValue {instance} {columnIndex} />
            <StatsValue {stats} value={stats?.num_empty} />
            <StatsValue {stats} value={stats?.num_unique} />
        </div>
    </div>
</div>
