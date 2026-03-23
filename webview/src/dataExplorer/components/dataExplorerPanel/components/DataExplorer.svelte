<!--
  DataExplorer.svelte - Main Data Explorer panel layout (Svelte 5 runes mode)
  Port from Positron's dataExplorer.tsx
-->
<script lang="ts">
    import { onMount } from "svelte";
    import { getDataExplorerContext } from "../../../context";
    import SummaryPanel from "../../SummaryPanel.svelte";
    import VerticalSplitter from "../../VerticalSplitter.svelte";
    import SummaryRowActionBar from "./summaryRowActionBar/SummaryRowActionBar.svelte";
    import { DataGrid } from "../../../../dataGrid";
    import { PositronDataExplorerLayout } from "../../../types";
    import {
        WidthCalculator,
        getComputedFont,
    } from "../../../../dataGrid/classes/widthCalculator";
    import { DataExplorerInstance } from "../../../dataExplorerInstance";

    const MIN_COLUMN_WIDTH = 300;
    const DEFAULT_SUMMARY_WIDTH = 350;

    interface Props {
        layout: PositronDataExplorerLayout;
        summaryWidth: number;
        isSummaryCollapsed: boolean;
        onSummaryWidthChange?: (width: number) => void;
        onSummaryCollapsedChange?: (collapsed: boolean) => void;
        onLayoutChange?: (layout: PositronDataExplorerLayout) => void;
    }

    let {
        layout,
        summaryWidth,
        isSummaryCollapsed,
        onSummaryWidthChange,
        onSummaryCollapsedChange,
        onLayoutChange,
    }: Props = $props();

    const { gridInstance, notifyFocusChanged } = getDataExplorerContext();

    let dataExplorerRef: HTMLDivElement | null = null;
    let leftColumnRef: HTMLDivElement | null = null;
    let rightColumnRef: HTMLDivElement | null = null;
    let columnNameExemplarRef: HTMLDivElement | null = null;
    let typeNameExemplarRef: HTMLDivElement | null = null;
    let sortIndexExemplarRef: HTMLDivElement | null = null;

    let width = $state(0);
    let columnsWidth = $state(0);
    let animateColumnsWidth = $state(false);
    let columnsCollapsed = $state(false);

    const motionReduced = () =>
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    $effect(() => {
        columnsCollapsed = isSummaryCollapsed;
    });

    $effect(() => {
        if (!columnsCollapsed) {
            const base =
                summaryWidth > 0 ? summaryWidth : DEFAULT_SUMMARY_WIDTH;
            columnsWidth = Math.max(base, MIN_COLUMN_WIDTH);
        }
    });

    onMount(() => {
        if (!dataExplorerRef) return;
        const initialWidth = dataExplorerRef.offsetWidth;
        width = initialWidth;

        const savedWidth =
            summaryWidth > 0 ? Math.max(summaryWidth, MIN_COLUMN_WIDTH) : 0;
        const initialColumnsWidth =
            savedWidth > 0 ? savedWidth : DEFAULT_SUMMARY_WIDTH;
        columnsWidth = initialColumnsWidth;

        if (initialColumnsWidth > initialWidth * 0.5 && !columnsCollapsed) {
            columnsCollapsed = true;
            onSummaryCollapsedChange?.(true);
        }

        const resizeObserver = new ResizeObserver((entries) => {
            width = entries[0].contentRect.width;
        });
        resizeObserver.observe(dataExplorerRef);

        // Initialize WidthCalculator from exemplar divs
        initWidthCalculator();

        return () => resizeObserver.disconnect();
    });

    function initWidthCalculator() {
        if (
            !columnNameExemplarRef ||
            !typeNameExemplarRef ||
            !sortIndexExemplarRef
        )
            return;
        if (!gridInstance || !(gridInstance instanceof DataExplorerInstance))
            return;

        const columnNameFont = getComputedFont(columnNameExemplarRef);
        const typeNameFont = getComputedFont(typeNameExemplarRef);
        const sortIndexFont = getComputedFont(sortIndexExemplarRef);

        const calc = new WidthCalculator({
            columnNameFont,
            typeNameFont,
            sortIndexFont,
            horizontalCellPadding: gridInstance.horizontalCellPadding ?? 8,
        });

        gridInstance.setWidthCalculator(calc);
    }

    $effect(() => {
        if (!leftColumnRef || !rightColumnRef) return;
        const tableSchemaColumn =
            layout === PositronDataExplorerLayout.SummaryOnLeft
                ? leftColumnRef
                : rightColumnRef;
        const tableDataColumn =
            layout === PositronDataExplorerLayout.SummaryOnLeft
                ? rightColumnRef
                : leftColumnRef;

        tableDataColumn.style.width = "auto";
        if (columnsCollapsed) {
            tableSchemaColumn.style.width = "0";
            tableSchemaColumn.style.transition = animateColumnsWidth
                ? "width 0.1s ease-out"
                : "";
            animateColumnsWidth = false;
        } else {
            tableSchemaColumn.style.width = `${columnsWidth}px`;
            tableSchemaColumn.style.transition = animateColumnsWidth
                ? "width 0.1s ease-out"
                : "";
            animateColumnsWidth = false;
        }
    });

    const beginResizeHandler = () => ({
        minimumWidth: MIN_COLUMN_WIDTH,
        maximumWidth: Math.trunc((2 * width) / 3),
        startingWidth: columnsWidth,
    });

    const resizeHandler = (newColumnsWidth: number) => {
        columnsWidth = newColumnsWidth;
        onSummaryWidthChange?.(newColumnsWidth);
    };

    function handleCollapsedChanged(collapsed: boolean) {
        animateColumnsWidth = !motionReduced();
        columnsCollapsed = collapsed;
        onSummaryCollapsedChange?.(collapsed);
    }

    function handleSplitterInvert(invert: boolean) {
        onLayoutChange?.(
            invert
                ? PositronDataExplorerLayout.SummaryOnRight
                : PositronDataExplorerLayout.SummaryOnLeft,
        );
    }
</script>

<div
    class="data-explorer"
    class:summary-on-left={layout === PositronDataExplorerLayout.SummaryOnLeft}
    class:summary-on-right={layout ===
        PositronDataExplorerLayout.SummaryOnRight}
    bind:this={dataExplorerRef}
>
    <div class="column-name-exemplar" bind:this={columnNameExemplarRef}></div>
    <div class="type-name-exemplar" bind:this={typeNameExemplarRef}></div>
    <div class="sort-index-exemplar" bind:this={sortIndexExemplarRef}></div>

    <div class="left-column" bind:this={leftColumnRef}>
        {#if layout === PositronDataExplorerLayout.SummaryOnLeft}
            <SummaryRowActionBar />
        {/if}
        <div class="data-grid-container">
            {#if layout === PositronDataExplorerLayout.SummaryOnLeft}
                <SummaryPanel visible={!columnsCollapsed} />
            {:else if gridInstance}
                <DataGrid
                    instance={gridInstance}
                    onFocusChange={notifyFocusChanged}
                    gridRole="table"
                />
            {/if}
        </div>
    </div>

    {#if layout === PositronDataExplorerLayout.SummaryOnLeft && columnsCollapsed}
        <div class="collapsed-left-spacer"></div>
    {/if}

    <div class="splitter">
        <VerticalSplitter
            alwaysShowExpandCollapseButton={true}
            collapsible={true}
            invert={layout === PositronDataExplorerLayout.SummaryOnRight}
            isCollapsed={columnsCollapsed}
            showSash={true}
            onBeginResize={beginResizeHandler}
            onCollapsedChanged={handleCollapsedChanged}
            onInvert={handleSplitterInvert}
            onResize={resizeHandler}
        />
    </div>

    {#if layout === PositronDataExplorerLayout.SummaryOnRight && columnsCollapsed}
        <div class="collapsed-right-spacer"></div>
    {/if}

    <div class="right-column" bind:this={rightColumnRef}>
        {#if layout !== PositronDataExplorerLayout.SummaryOnLeft}
            <SummaryRowActionBar />
        {/if}
        <div class="data-grid-container">
            {#if layout === PositronDataExplorerLayout.SummaryOnLeft}
                {#if gridInstance}
                    <DataGrid
                        instance={gridInstance}
                        onFocusChange={notifyFocusChanged}
                        gridRole="table"
                    />
                {/if}
            {:else}
                <SummaryPanel visible={!columnsCollapsed} />
            {/if}
        </div>
    </div>
</div>

<style>
    :global(.data-explorer-panel) .data-explorer {
        min-width: 0;
        min-height: 0;
        display: grid;
        overflow: hidden;
        grid-row: data-explorer / status-bar;
        grid-template-rows: [main-row] 1fr [end-rows];
        position: relative;
    }

    :global(.data-explorer-panel) .data-explorer.summary-on-left {
        grid-template-columns: [left-column] min-content [collapsed-left-spacer] min-content [splitter] max-content [collapsed-right-spacer] min-content [right-column] 1fr [end-columns];
    }

    :global(.data-explorer-panel) .data-explorer.summary-on-right {
        grid-template-columns: [left-column] 1fr [collapsed-left-spacer] min-content [splitter] max-content [collapsed-right-spacer] min-content [right-column] min-content [end-columns];
    }

    :global(.data-explorer-panel) .data-explorer .column-name-exemplar,
    :global(.data-explorer-panel) .data-explorer .type-name-exemplar,
    :global(.data-explorer-panel) .data-explorer .sort-index-exemplar {
        position: absolute;
        visibility: hidden;
        pointer-events: none;
    }

    :global(.data-explorer-panel) .data-explorer .column-name-exemplar {
        font-weight: var(
            --positron-data-grid-column-header-title-font-weight,
            600
        );
        font-size: var(
            --positron-data-grid-column-header-title-font-size,
            12px
        );
    }

    :global(.data-explorer-panel) .data-explorer .type-name-exemplar {
        font-size: var(
            --positron-data-grid-column-header-description-font-size,
            11px
        );
    }

    :global(.data-explorer-panel) .data-explorer .sort-index-exemplar {
        font-size: var(
            --positron-data-grid-column-header-sort-index-font-size,
            10px
        );
        font-weight: var(
            --positron-data-grid-column-header-sort-index-font-weight,
            600
        );
        font-variant-numeric: var(
            --positron-data-grid-column-header-sort-index-font-variant-numeric,
            tabular-nums
        );
    }

    :global(.data-explorer-panel) .data-explorer .left-column {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-columns: 100%;
        grid-row: main-row / end-rows;
        grid-column: left-column / collapsed-left-spacer;
    }

    :global(.data-explorer-panel) .data-explorer.summary-on-left .left-column {
        grid-template-rows: [summary-row-action-bar] 36px [data-grid] 1fr [end-rows];
    }

    :global(.data-explorer-panel) .data-explorer.summary-on-left .right-column {
        grid-template-rows: [data-grid] 1fr [end-rows];
    }

    :global(.data-explorer-panel)
        .data-explorer
        .left-column
        .data-grid-container {
        min-height: 0;
        grid-row: data-grid / end-rows;
        position: relative;
    }

    :global(.data-explorer-panel) .data-explorer .collapsed-left-spacer {
        width: 10px;
        grid-row: main-row / end-rows;
        grid-column: collapsed-left-spacer / splitter;
        background-color: var(--vscode-positronDataExplorer-contrastBackground);
    }

    :global(.data-explorer-panel) .data-explorer .splitter {
        display: grid;
        grid-row: main-row / end-rows;
        grid-column: splitter / collapsed-right-spacer;
    }

    :global(.data-explorer-panel) .data-explorer .collapsed-right-spacer {
        width: 10px;
        grid-row: main-row / end-rows;
        grid-column: collapsed-right-spacer / right-column;
        background-color: var(--vscode-positronDataExplorer-contrastBackground);
    }

    :global(.data-explorer-panel) .data-explorer .right-column {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-columns: 100%;
        grid-row: main-row / end-rows;
        grid-column: right-column / end-columns;
    }

    :global(.data-explorer-panel) .data-explorer.summary-on-right .left-column {
        grid-template-rows: [data-grid] 1fr [end-rows];
    }

    :global(.data-explorer-panel)
        .data-explorer.summary-on-right
        .right-column {
        grid-template-rows: [summary-row-action-bar] 36px [data-grid] 1fr [end-rows];
    }

    :global(.data-explorer-panel)
        .data-explorer
        .right-column
        .data-grid-container {
        min-height: 0;
        grid-row: data-grid / end-rows;
        position: relative;
    }

</style>
