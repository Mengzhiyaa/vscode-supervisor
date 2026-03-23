<!--
  DataGridColumnHeaders.svelte - Column header row (Svelte 5 runes mode)
  Port from Positron's dataGridColumnHeaders.tsx
-->
<script lang="ts">
    import { getDataGridContext } from "../context";
    import DataGridColumnHeader from "./DataGridColumnHeader.svelte";
    import type { ColumnDescriptors } from "../dataGridInstance";

    interface Props {
        columnDescriptors: ColumnDescriptors;
        height: number;
        width: number;
    }

    let { columnDescriptors, height }: Props = $props();

    const { instance } = getDataGridContext();
</script>

<div class="data-grid-column-headers" style:height="{height}px">
    {#each columnDescriptors.pinnedColumnDescriptors as column (column.columnIndex)}
        <DataGridColumnHeader
            columnIndex={column.columnIndex}
            left={column.left}
            width={column.width}
            pinned={true}
        />
    {/each}

    {#each columnDescriptors.unpinnedColumnDescriptors as column (
        column.columnIndex
    )}
        <DataGridColumnHeader
            columnIndex={column.columnIndex}
            left={column.left - instance.horizontalScrollOffset}
            width={column.width}
            pinned={false}
        />
    {/each}
</div>

<style>
    .data-grid-column-headers {
        overflow: hidden;
        position: relative;
        grid-column: waffle / end-waffle;
        grid-row: headers / waffle;
    }
</style>
