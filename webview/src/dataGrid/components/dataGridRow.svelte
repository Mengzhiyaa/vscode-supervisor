<!--
  dataGridRow.svelte - Individual data row (Svelte 5 runes mode)
  Port from Positron's dataGridRow.tsx
-->
<script lang="ts">
    import { getPositronDataGridContext } from "../positronDataGridContext";
    import DataGridRowCell from "./dataGridRowCell.svelte";
    import type { ColumnDescriptors } from "../classes/dataGridInstance";

    interface Props {
        columnDescriptors: ColumnDescriptors;
        rowIndex: number;
        top: number;
        height: number;
        pinned: boolean;
        width: number;
    }

    let {
        columnDescriptors,
        rowIndex,
        top,
        height,
        pinned,
    }: Props = $props();

    const { instance } = getPositronDataGridContext();
</script>

<div class="data-grid-row" class:pinned style:top="{top}px" style:height="{height}px">
    {#each columnDescriptors.pinnedColumnDescriptors as column (
        `p-${rowIndex}-${column.columnIndex}`
    )}
        <DataGridRowCell
            columnIndex={column.columnIndex}
            rowIndex={rowIndex}
            height={height}
            left={column.left}
            width={column.width}
            pinned={true}
        />
    {/each}

    {#each columnDescriptors.unpinnedColumnDescriptors as column (
        `u-${rowIndex}-${column.columnIndex}`
    )}
        <DataGridRowCell
            columnIndex={column.columnIndex}
            rowIndex={rowIndex}
            height={height}
            left={column.left - instance.horizontalScrollOffset}
            width={column.width}
            pinned={false}
        />
    {/each}
</div>

<style>
    .data-grid-row {
        top: 0;
        left: 0;
        width: 100%;
        position: absolute;
    }

    .data-grid-row:not(.pinned) {
        z-index: 0;
    }

    .data-grid-row.pinned {
        z-index: 1;
    }
</style>
