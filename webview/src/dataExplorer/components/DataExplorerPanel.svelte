<!--
  DataExplorerPanel.svelte - Panel layout
  Port from Positron's dataExplorerPanel.tsx
-->
<script lang="ts">
    import { onMount } from "svelte";
    import { getDataExplorerContext } from "../context";
    import StatusBar from "./StatusBar.svelte";
    import RowFilterBar from "./rowFilterBar/RowFilterBar.svelte";
    import DataExplorer from "./dataExplorerPanel/components/DataExplorer.svelte";
    import DataExplorerActionBar from "./DataExplorerActionBar.svelte";
    import type { DataExplorerInstance as DataExplorerGridInstance } from "../dataExplorerInstance";
    import { PositronDataExplorerLayout } from "../types";
    import { getVsCodeState, setVsCodeState } from "$lib/rpc/client";

    const context = getDataExplorerContext();
    const { stores, postMessage } = context;
    const { state: explorerState } = stores;

    // Get gridInstance from context (may be undefined initially)
    const gridInstance = $derived(
        context.gridInstance as DataExplorerGridInstance | undefined,
    );
    const moveToNewWindowDisabled = $derived(
        $explorerState.inNewWindow ?? false,
    );

    // Layout state (Positron-style)
    let layout = $state<PositronDataExplorerLayout>(
        PositronDataExplorerLayout.SummaryOnLeft,
    );
    let summaryWidth = $state(350);
    let isSummaryCollapsed = $state(false);

    function applyLayout(nextLayout: PositronDataExplorerLayout, notify: boolean) {
        if (layout === nextLayout) {
            return;
        }
        layout = nextLayout;
        if (notify) {
            postMessage({ type: "setLayout", layout: nextLayout });
        }
    }

    function applySummaryCollapsed(collapsed: boolean, notify: boolean) {
        if (isSummaryCollapsed === collapsed) {
            return;
        }
        isSummaryCollapsed = collapsed;
        if (notify) {
            postMessage({ type: "setSummaryCollapsed", collapsed });
        }
    }

    type PersistedPanelState = {
        layout: PositronDataExplorerLayout;
        summaryWidth: number;
        isSummaryCollapsed: boolean;
    };

    onMount(() => {
        const persisted = getVsCodeState<{
            dataExplorerPanel?: PersistedPanelState;
        }>();
        const state = persisted?.dataExplorerPanel;
        if (state) {
            layout = state.layout ?? PositronDataExplorerLayout.SummaryOnLeft;
            summaryWidth = state.summaryWidth ?? 350;
            isSummaryCollapsed = state.isSummaryCollapsed ?? false;
        }
    });

    $effect(() => {
        const backendLayout =
            $explorerState.layout ?? PositronDataExplorerLayout.SummaryOnLeft;
        applyLayout(backendLayout, false);
    });

    $effect(() => {
        const backendCollapsed = $explorerState.summaryCollapsed ?? false;
        applySummaryCollapsed(backendCollapsed, false);
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
    <!-- Top action bar -->
    <DataExplorerActionBar
        {layout}
        {moveToNewWindowDisabled}
        onClearSorting={() => gridInstance?.clearSortKeys?.()}
        onLayoutChange={(nextLayout) => {
            applyLayout(nextLayout, true);
        }}
        onMoveToNewWindow={() => {
            postMessage({ type: "moveToNewWindow" });
        }}
    />

    <!-- Row filter bar -->
    <RowFilterBar />

    <DataExplorer
        {layout}
        summaryWidth={summaryWidth}
        isSummaryCollapsed={isSummaryCollapsed}
        onSummaryWidthChange={(width) => {
            summaryWidth = width;
        }}
        onSummaryCollapsedChange={(collapsed) => {
            applySummaryCollapsed(collapsed, true);
        }}
        onLayoutChange={(nextLayout) => {
            applyLayout(nextLayout, true);
        }}
    />

    <!-- Status bar -->
    <StatusBar />
</div>

<style>
    .data-explorer-panel {
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: [action-bar] min-content [filter-bar] min-content [data-explorer] 1fr [status-bar] 24px [end];
    }
</style>
