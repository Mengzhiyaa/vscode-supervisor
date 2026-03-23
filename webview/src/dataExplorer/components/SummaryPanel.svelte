<!--
  SummaryPanel.svelte - Column summary panel
  Port from Positron's TableSummaryDataGridInstance for 1:1 UI replication
-->
<script lang="ts">
    import { getDataExplorerContext } from "../context";
    import { localize } from "../nls";
    import { DataGrid } from "../../dataGrid";

    interface Props {
        visible?: boolean;
        onClose?: () => void;
    }

    let { visible = true, onClose: _onClose }: Props = $props();

    const context = getDataExplorerContext();
    const summaryInstance = $derived(context.summaryInstance);
    $effect(() => {
        if (!summaryInstance) {
            return;
        }

        void summaryInstance.setVisible(visible);
    });
</script>

{#if visible}
    <div
        class="summary-panel"
        role="region"
        aria-label={localize(
            "positron.dataExplorer.columnSummary",
            "Column Summary",
        )}
    >
        {#if summaryInstance}
            <div class="summary-grid">
                <DataGrid instance={summaryInstance} gridRole="summary" />
            </div>
        {/if}
    </div>
{/if}

<style>
    .summary-panel {
        display: block;
        height: 100%;
        background: var(--vscode-editor-background);
        outline: none;
    }

    .summary-grid {
        height: 100%;
        width: 100%;
    }

    .summary-grid :global(.data-grid-row) {
        background: transparent;
        border-bottom: none;
    }

    .summary-grid :global(.data-grid-row:hover) {
        background: transparent;
    }

    .summary-grid :global(.data-grid-row-cell) {
        padding: 0;
        display: block;
        background: transparent;
    }

    .summary-grid :global(.data-grid-row-cell .content) {
        padding: 0 !important;
    }

    .summary-grid :global(.data-grid-row-cell .border-overlay) {
        border: none;
    }

    .summary-grid :global(.data-grid-row-cell .selection-overlay) {
        background: transparent;
        border: none;
    }

    .summary-grid :global(.data-grid-row-cell .cursor-border) {
        display: none;
    }

    .summary-grid :global(.data-grid-column-header .border-overlay),
    .summary-grid :global(.data-grid-corner-top-left .border-overlay),
    .summary-grid :global(.data-grid-row-header .border-overlay) {
        border: none;
    }

    .summary-grid :global(.data-grid-column-header .selection-overlay),
    .summary-grid :global(.data-grid-row-header .selection-overlay) {
        background: transparent;
        border: none;
    }

    .summary-grid :global(.column-summary) {
        height: 100%;
    }

</style>
