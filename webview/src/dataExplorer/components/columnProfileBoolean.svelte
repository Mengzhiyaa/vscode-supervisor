<!--
  columnProfileBoolean.svelte - Expanded boolean profile
  Port from Positron's columnProfileBoolean.tsx
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
        instance.getColumnProfileSmallFrequencyTable(columnIndex),
    );
    const stats = $derived(
        instance.getColumnProfileSummaryStats(columnIndex)?.boolean_stats,
    );

    const missingLabel = localize("positronMissing", "Missing");
    const trueLabel = localize("positronTrue", "True");
    const falseLabel = localize("positronFalse", "False");
</script>

<div class="column-profile-expanded column-profile-info">
    <ColumnProfileSparklines
        {columnFrequencyTable}
        hoverManager={instance.hoverManager}
    />

    <div class="tabular-info">
        <div class="labels">
            <div class="label">{missingLabel}</div>
            <div class="label">{trueLabel}</div>
            <div class="label">{falseLabel}</div>
        </div>
        <div class="spacer"></div>
        <div class="values">
            <ColumnProfileNullCountValue {instance} {columnIndex} />
            <StatsValue {stats} value={stats?.true_count} />
            <StatsValue {stats} value={stats?.false_count} />
        </div>
    </div>
</div>
