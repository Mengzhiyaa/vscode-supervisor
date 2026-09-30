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

    const columnProfiles = $derived(instance.columnProfiles);
    const columnProfileNullCount = $derived(
        $columnProfiles.get(columnIndex)?.null_count,
    );
</script>

{#if columnProfileNullCount === undefined}
    <div class="value-placeholder">&#x22ef;</div>
{:else}
    <div class="value">{columnProfileNullCount}</div>
{/if}
