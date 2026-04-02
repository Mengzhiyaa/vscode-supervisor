<!--
  DataExplorerPanel.svelte - Panel layout
  Port from Positron's dataExplorerPanel.tsx
-->
<script lang="ts">
    import { onMount } from "svelte";
    import { getDataExplorerContext } from "../../positronDataExplorerContext";
    import StatusBar from "./components/statusBar.svelte";
    import RowFilterBar from "./components/rowFilterBar/rowFilterBar.svelte";
    import DataExplorer from "./components/dataExplorer.svelte";
    import { PositronDataExplorerLayout } from "../../types";
    import { getVsCodeState, setVsCodeState } from "$lib/rpc/client";

    const context = getDataExplorerContext();
    const { stores } = context;
    const { state: explorerState } = stores;
    const layout = $derived(
        $explorerState.layout ?? PositronDataExplorerLayout.SummaryOnLeft,
    );
    const summaryWidth = $derived($explorerState.summaryWidth ?? 350);
    const isSummaryCollapsed = $derived($explorerState.summaryCollapsed ?? false);

    type PersistedPanelState = {
        layout: PositronDataExplorerLayout;
        summaryWidth: number;
        isSummaryCollapsed: boolean;
    };

    onMount(() => {
        const persisted = getVsCodeState<{
            dataExplorerPanel?: PersistedPanelState;
        }>();
        const panelState = persisted?.dataExplorerPanel;
        if (panelState) {
            stores.state.update((state) => ({
                ...state,
                layout:
                    panelState.layout ??
                    state.layout ??
                    PositronDataExplorerLayout.SummaryOnLeft,
                summaryWidth: panelState.summaryWidth ?? state.summaryWidth ?? 350,
                summaryCollapsed:
                    panelState.isSummaryCollapsed ?? state.summaryCollapsed ?? false,
            }));
        }
    });

    $effect(() => {
        const existing = getVsCodeState<Record<string, unknown>>() ?? {};
        setVsCodeState({
            ...existing,
            dataExplorerPanel: {
                layout,
                summaryWidth,
                isSummaryCollapsed,
            },
        });
    });

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
