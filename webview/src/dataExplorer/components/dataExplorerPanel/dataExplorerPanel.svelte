<!--
  DataExplorerPanel.svelte - Panel layout
  Port from Positron's dataExplorerPanel.tsx
-->
<script lang="ts">
    import StatusBar from "./components/statusBar.svelte";
    import RowFilterBar from "./components/rowFilterBar/rowFilterBar.svelte";
    import DataExplorer from "./components/dataExplorer.svelte";
</script>

<div class="data-explorer-panel">
    <RowFilterBar />

    <DataExplorer />

    <StatusBar />
</div>

<style>
    .data-explorer-panel {
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-row: data-explorer-panel / end;
        grid-column: content / end-columns;
        grid-template-rows: [filter-bar] min-content [data-explorer] 1fr [status-bar] 24px [end];
    }
</style>
