<!--
  StatusBar.svelte - Bottom status bar (Svelte 5 runes mode)
  Port from Positron's statusBar.tsx
-->
<script lang="ts">
    import { getDataExplorerContext } from "../../../positronDataExplorerContext";
    import { localize } from "../../../nls";
    import StatusBarActivityIndicator from "./statusBarActivityIndicator.svelte";

    const context = getDataExplorerContext();
    const { stores } = context;
    const { numRows, numColumns, numUnfilteredRows, rowFilters } = stores;

    const hasFilters = $derived($rowFilters.length > 0);
    const filteredPercent = $derived.by(() => {
        const total = $numUnfilteredRows || 0;
        if (total === 0) return 0;
        return (100 * $numRows) / total;
    });
</script>

<div class="status-bar">
    <StatusBarActivityIndicator />
    {#if hasFilters}
        <span class="label"
            >{localize("positron.statusBar.showing", "Showing")}</span
        >
        <span>&nbsp;</span>
        <span class="counter">{$numRows.toLocaleString()}</span>
        <span>&nbsp;</span>
        <span class="label"
            >{localize("positron.statusBar.rows", "rows")}&nbsp;(</span
        >
        <span class="counter">{filteredPercent.toFixed(2)}%</span>
        <span class="label">&nbsp;of&nbsp;</span>
        <span class="counter">{$numUnfilteredRows.toLocaleString()}</span>
        <span class="label"
            >&nbsp;{localize("positron.statusBar.total", "total")})</span
        >
        <span>&nbsp;&nbsp;</span>
        <span class="counter">{$numColumns.toLocaleString()}</span>
        <span>&nbsp;</span>
        <span class="label"
            >{localize("positron.statusBar.columns", "columns")}</span
        >
    {:else}
        <span class="counter">{$numRows.toLocaleString()}</span>
        <span>&nbsp;</span>
        <span class="label"
            >{localize("positron.statusBar.rows", "rows")}</span
        >
        <span>&nbsp;&nbsp;</span>
        <span class="counter">{$numColumns.toLocaleString()}</span>
        <span>&nbsp;</span>
        <span class="label"
            >{localize("positron.statusBar.columns", "columns")}</span
        >
    {/if}
</div>

<style>
    .status-bar {
        padding: 0;
        display: flex;
        align-items: center;
        grid-row: status-bar / end;
        border-top: 1px solid var(--vscode-positronDataExplorer-border);
        background-color: var(--vscode-positronDataExplorer-contrastBackground);
    }

    .label {
        opacity: 0.8;
    }
</style>
