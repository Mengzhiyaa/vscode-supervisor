<!--
  columnProfileSparklines.svelte - Expanded profile sparkline wrapper
  Port from Positron's columnProfileSparklines.tsx
-->
<script lang="ts">
    import type { DataGridHoverManager } from "../../dataGrid/classes/dataGridInstance";
    import VectorFrequencyTable from "./vectorFrequencyTable.svelte";
    import VectorHistogram from "./vectorHistogram.svelte";

    const GRAPH_WIDTH = 200;
    const GRAPH_HEIGHT = 50;
    const X_AXIS_HEIGHT = 0.5;

    interface Props {
        columnHistogram?: {
            bin_edges: string[];
            bin_counts: number[];
        };
        columnFrequencyTable?: {
            values: string[];
            counts: number[];
            other_count?: number;
        };
        displayType?: string;
        hoverManager?: DataGridHoverManager;
    }

    let {
        columnHistogram,
        columnFrequencyTable,
        displayType,
        hoverManager,
    }: Props = $props();
</script>

{#if columnHistogram}
    <div
        class="column-profile-sparkline"
        style:width="{GRAPH_WIDTH}px"
        style:height="{GRAPH_HEIGHT + X_AXIS_HEIGHT}px"
    >
        <VectorHistogram
            histogram={columnHistogram}
            {displayType}
            width={GRAPH_WIDTH}
            height={GRAPH_HEIGHT}
            xAxisHeight={X_AXIS_HEIGHT}
            {hoverManager}
        />
    </div>
{:else if columnFrequencyTable}
    <div
        class="column-profile-sparkline"
        style:width="{GRAPH_WIDTH}px"
        style:height="{GRAPH_HEIGHT}px"
    >
        <VectorFrequencyTable
            frequencyTable={columnFrequencyTable}
            width={GRAPH_WIDTH}
            height={GRAPH_HEIGHT}
            xAxisHeight={X_AXIS_HEIGHT}
            {hoverManager}
        />
    </div>
{/if}
