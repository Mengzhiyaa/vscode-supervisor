<!--
  DataExplorer.svelte - Main Data Explorer panel layout (Svelte 5 runes mode)
  Port from Positron's dataExplorer.tsx
-->
<script lang="ts">
    import { onMount } from "svelte";
    import { getDataExplorerContext } from "../../../positronDataExplorerContext";
    import VerticalSplitter from "../../splitters/verticalSplitter.svelte";
    import SummaryRowActionBar from "./summaryRowActionBar/summaryRowActionBar.svelte";
    import { PositronDataGrid } from "../../../../dataGrid";
    import { PositronDataExplorerLayout } from "../../../types";
    import type { WidthCalculators } from "../../../common/tableDataCache";
    import {
        WidthCalculator,
        getComputedFont,
    } from "../../../../dataGrid/classes/widthCalculator";

    const MIN_COLUMN_WIDTH = 300;
    const DEFAULT_SUMMARY_WIDTH = 350;

    const context = getDataExplorerContext();
    const { notifyFocusChanged, stores } = context;
    const { state: explorerState } = stores;
    const layout = $derived(
        $explorerState.layout ?? PositronDataExplorerLayout.SummaryOnLeft,
    );
    const summaryWidth = $derived(
        $explorerState.summaryWidth ?? DEFAULT_SUMMARY_WIDTH,
    );
    const isSummaryCollapsed = $derived($explorerState.summaryCollapsed ?? false);
    const tableDataDataGridInstance = $derived(
        context.instance.tableDataDataGridInstance,
    );
    const tableSchemaDataGridInstance = $derived(
        context.instance.tableSchemaDataGridInstance,
    );

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
    let initialLayoutFrame: number | undefined;

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

    function initializeLayoutState(measuredWidth: number) {
        width = measuredWidth;

        const savedWidth =
            context.instance.summaryWidth > 0
                ? Math.max(context.instance.summaryWidth, MIN_COLUMN_WIDTH)
                : 0;
        const initialColumnsWidth =
            savedWidth > 0 ? savedWidth : DEFAULT_SUMMARY_WIDTH;
        columnsWidth = initialColumnsWidth;

        if (
            measuredWidth > 0 &&
            initialColumnsWidth > measuredWidth * 0.5 &&
            !context.instance.isSummaryCollapsed
        ) {
            context.instance.collapseSummary();
        }
    }

    onMount(() => {
        if (!dataExplorerRef) return;

        initializeLayoutState(dataExplorerRef.offsetWidth);

        if (
            dataExplorerRef.offsetWidth <= 0 &&
            typeof requestAnimationFrame === "function"
        ) {
            initialLayoutFrame = requestAnimationFrame(() => {
                initialLayoutFrame = undefined;
                if (dataExplorerRef) {
                    initializeLayoutState(dataExplorerRef.offsetWidth);
                }
            });
        }

        const resizeObserver = new ResizeObserver((entries) => {
            width = entries[0].contentRect.width;
        });
        resizeObserver.observe(dataExplorerRef);

        // Initialize WidthCalculators from exemplar divs
        initWidthCalculators();

        return () => {
            if (
                initialLayoutFrame !== undefined &&
                typeof cancelAnimationFrame === "function"
            ) {
                cancelAnimationFrame(initialLayoutFrame);
            }
            resizeObserver.disconnect();
        };
    });

    function initWidthCalculators() {
        if (
            !columnNameExemplarRef ||
            !typeNameExemplarRef ||
            !sortIndexExemplarRef
        )
            return;
        if (!tableDataDataGridInstance)
            return;

        const columnNameFont = getComputedFont(columnNameExemplarRef);
        const typeNameFont = getComputedFont(typeNameExemplarRef);
        const sortIndexFont = getComputedFont(sortIndexExemplarRef);

        const widthCalculator = new WidthCalculator({
            columnNameFont,
            typeNameFont,
            sortIndexFont,
            horizontalCellPadding:
                tableDataDataGridInstance.horizontalCellPadding ?? 8,
        });

        const spaceWidth = widthCalculator.measureSpaceWidth(columnNameFont);
        const widthCalculators: WidthCalculators = {
            columnHeaderWidthCalculator: (
                columnName: string,
                typeName: string,
            ) => widthCalculator.calculateColumnHeaderWidth(columnName, typeName),
            columnValueWidthCalculator: (length: number) =>
                widthCalculator.calculateCellValueWidth(length, spaceWidth),
        };

        tableDataDataGridInstance.setWidthCalculators(widthCalculators);
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

    $effect(() => {
        if (!tableSchemaDataGridInstance) {
            return;
        }

        void tableSchemaDataGridInstance.setVisible(!columnsCollapsed);
    });

    const beginResizeHandler = () => ({
        minimumWidth: MIN_COLUMN_WIDTH,
        maximumWidth: Math.trunc((2 * width) / 3),
        startingWidth: columnsWidth,
    });

    const resizeHandler = (newColumnsWidth: number) => {
        columnsWidth = newColumnsWidth;
        context.instance.summaryWidth = newColumnsWidth;
    };

    function handleCollapsedChanged(collapsed: boolean) {
        animateColumnsWidth = !motionReduced();
        if (collapsed) {
            context.instance.collapseSummary();
        } else {
            context.instance.expandSummary();
        }
    }

    function handleSplitterInvert(invert: boolean) {
        context.instance.layout = invert
            ? PositronDataExplorerLayout.SummaryOnRight
            : PositronDataExplorerLayout.SummaryOnLeft;
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
            <SummaryRowActionBar instance={tableSchemaDataGridInstance} />
        {/if}
        <div class="data-grid-container">
            {#if layout === PositronDataExplorerLayout.SummaryOnLeft}
                {#if tableSchemaDataGridInstance && !columnsCollapsed}
                    <div class="summary-data-grid" role="region" aria-label="Column Summary">
                        <PositronDataGrid
                            instance={tableSchemaDataGridInstance}
                            gridRole="summary"
                        />
                    </div>
                {/if}
            {:else if tableDataDataGridInstance}
                <PositronDataGrid
                    instance={tableDataDataGridInstance}
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
            collapseAriaLabel="Collapse summary"
            collapsible={true}
            expandAriaLabel="Expand summary"
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
            <SummaryRowActionBar instance={tableSchemaDataGridInstance} />
        {/if}
        <div class="data-grid-container">
            {#if layout === PositronDataExplorerLayout.SummaryOnLeft}
                {#if tableDataDataGridInstance}
                    <PositronDataGrid
                        instance={tableDataDataGridInstance}
                        onFocusChange={notifyFocusChanged}
                        gridRole="table"
                    />
                {/if}
            {:else}
                {#if tableSchemaDataGridInstance && !columnsCollapsed}
                    <div class="summary-data-grid" role="region" aria-label="Column Summary">
                        <PositronDataGrid
                            instance={tableSchemaDataGridInstance}
                            gridRole="summary"
                        />
                    </div>
                {/if}
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

    .summary-data-grid {
        display: block;
        height: 100%;
        background: var(--vscode-editor-background);
        outline: none;
    }

    .summary-data-grid :global(.data-grid-row) {
        background: transparent;
        border-bottom: none;
    }

    .summary-data-grid :global(.data-grid-row:hover) {
        background: transparent;
    }

    .summary-data-grid :global(.data-grid-row-cell) {
        padding: 0;
        display: block;
        background: transparent;
    }

    .summary-data-grid :global(.data-grid-row-cell .content) {
        padding: 0 !important;
    }

    .summary-data-grid :global(.data-grid-row-cell .border-overlay) {
        border: none;
    }

    .summary-data-grid :global(.data-grid-row-cell .selection-overlay) {
        background: transparent;
        border: none;
    }

    .summary-data-grid :global(.data-grid-row-cell .cursor-border) {
        display: none;
    }

    .summary-data-grid :global(.data-grid-column-header .border-overlay),
    .summary-data-grid :global(.data-grid-corner-top-left .border-overlay),
    .summary-data-grid :global(.data-grid-row-header .border-overlay) {
        border: none;
    }

    .summary-data-grid :global(.data-grid-column-header .selection-overlay),
    .summary-data-grid :global(.data-grid-row-header .selection-overlay) {
        background: transparent;
        border: none;
    }

    .summary-data-grid :global(.column-summary) {
        height: 100%;
    }

</style>
