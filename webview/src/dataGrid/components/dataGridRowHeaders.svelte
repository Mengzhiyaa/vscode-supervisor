<!--
  dataGridRowHeaders.svelte - Row number headers (Svelte 5 runes mode)
  Port from Positron's dataGridRowHeaders.tsx
-->
<script lang="ts">
    import { getPositronDataGridContext } from "../positronDataGridContext";
    import DataGridRowHeader from "./dataGridRowHeader.svelte";
    import type { RowDescriptors } from "../classes/dataGridInstance";

    interface Props {
        height: number;
        rowDescriptors: RowDescriptors;
    }

    let { rowDescriptors }: Props = $props();

    const { instance } = getPositronDataGridContext();
</script>

<div class="data-grid-row-headers" style:width="{instance.rowHeadersWidth}px">
    {#each rowDescriptors.pinnedRowDescriptors as row (row.rowIndex)}
        <DataGridRowHeader
            rowIndex={row.rowIndex}
            top={row.top}
            height={row.height}
            pinned={true}
        />
    {/each}

    {#each rowDescriptors.unpinnedRowDescriptors as row (row.rowIndex)}
        <DataGridRowHeader
            rowIndex={row.rowIndex}
            top={row.top - instance.verticalScrollOffset}
            height={row.height}
            pinned={false}
        />
    {/each}
</div>

<style>
    .data-grid-row-headers {
        overflow: hidden;
        position: relative;
        grid-row: waffle / end-waffle;
        grid-column: headers / waffle;
    }
</style>
