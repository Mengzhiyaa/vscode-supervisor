<!--
  columnProfileNullCountValue.svelte - Expanded profile null count value
  Port from Positron's columnProfileNullCountValue.tsx
-->
<script lang="ts">
    import type { TableSummaryDataGridInstance } from "../tableSummaryDataGridInstance";

    interface Props {
        instance: TableSummaryDataGridInstance;
        columnIndex: number;
    }

    let { instance, columnIndex }: Props = $props();

    const columnProfileNullCount = $derived(
        instance.getColumnProfileNullCount(columnIndex),
    );
</script>

{#if columnProfileNullCount === undefined}
    <div class="value-placeholder">\u22ef</div>
{:else}
    <div class="value">{columnProfileNullCount}</div>
{/if}
