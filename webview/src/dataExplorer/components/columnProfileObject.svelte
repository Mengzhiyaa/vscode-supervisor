<!--
  columnProfileObject.svelte - Expanded object profile
  Port from Positron's columnProfileObject.tsx
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

    const stats = $derived(
        instance.getColumnProfileSummaryStats(columnIndex)?.other_stats,
    );

    const missingLabel = localize("positronMissing", "Missing");
    const uniqueLabel = localize("positronUnique", "Unique");
</script>

<div class="column-profile-expanded column-profile-info">
    <div class="tabular-info">
        <div class="labels">
            <div class="label">{missingLabel}</div>
            <div class="label">{uniqueLabel}</div>
        </div>
        <div class="spacer"></div>
        <div class="values">
            <ColumnProfileNullCountValue {instance} {columnIndex} />
            <StatsValue {stats} value={stats?.num_unique} />
        </div>
    </div>
</div>
