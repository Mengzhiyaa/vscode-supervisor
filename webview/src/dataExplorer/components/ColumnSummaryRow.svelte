<!--
  ColumnSummaryRow.svelte - Single row in column summary panel
  Port from Positron's columnSummaryCell.tsx for 1:1 UI replication
-->
<script lang="ts">
    import { getDataExplorerContext } from "../context";
    import { localize } from "../nls";
    import {
        canExpandSummaryForDisplayType,
        getEffectiveColumnDisplayType,
        getSummaryDataTypeIcon,
        isBooleanDisplayType,
        isNumericDisplayType,
        isStringDisplayType,
    } from "../columnDisplayTypeUtils";
    import type { ColumnProfileResult } from "../columnProfileTypes";
    import type { DataGridHoverManager } from "../../dataGrid/dataGridInstance";
    import NullPercentIndicator from "./NullPercentIndicator.svelte";
    import VectorFrequencyTable from "./VectorFrequencyTable.svelte";
    import VectorHistogram from "./VectorHistogram.svelte";
    import ColumnProfileExpanded from "./ColumnProfileExpanded.svelte";
    import { renderLeadingTrailingWhitespace } from "./tableDataCell";

    interface Props {
        columnIndex: number;
        columnName: string;
        columnType: string;
        typeDisplay: string;
        columnLabel?: string;
        profile?: ColumnProfileResult;
        nullPercent?: number;
        expanded?: boolean;
        summaryStatsSupported?: boolean;
        isCursor?: boolean;
        isFocused?: boolean;
        hoverManager?: DataGridHoverManager;
        onToggle?: (expanded: boolean) => void;
        onSelect?: () => void;
        onDoubleClick?: () => void;
    }

    let {
        columnIndex,
        columnName,
        columnType,
        typeDisplay,
        columnLabel,
        profile,
        nullPercent,
        expanded: expandedProp = false,
        summaryStatsSupported: summaryStatsSupportedProp,
        isCursor = false,
        isFocused = false,
        hoverManager,
        onToggle,
        onSelect,
        onDoubleClick,
    }: Props = $props();

    const context = getDataExplorerContext();

    let dataTypeRef = $state<HTMLDivElement | undefined>(undefined);
    let columnNameRef = $state<HTMLDivElement | undefined>(undefined);
    let expanded = $state(false);

    $effect(() => {
        expanded = expandedProp ?? false;
    });

    const effectiveType = $derived(
        getEffectiveColumnDisplayType(typeDisplay, columnType),
    );
    const resolvedProfileType = $derived.by(() =>
        getEffectiveColumnDisplayType(
            profile?.summary_stats?.type_display,
            effectiveType,
        ),
    );
    const dataTypeIconClass = $derived(
        getSummaryDataTypeIcon(resolvedProfileType),
    );
    const isNumeric = $derived(isNumericDisplayType(resolvedProfileType));
    const isString = $derived(isStringDisplayType(resolvedProfileType));
    const isBoolean = $derived(isBooleanDisplayType(resolvedProfileType));
    const renderedColumnName = $derived.by(() =>
        renderLeadingTrailingWhitespace(columnName),
    );
    const summaryStatsSupported = $derived.by(() => {
        if (summaryStatsSupportedProp !== undefined) {
            return summaryStatsSupportedProp;
        }

        return canExpandSummaryForDisplayType(resolvedProfileType);
    });

    const histogramData = $derived.by(() => {
        if (profile?.small_histogram) {
            return profile.small_histogram;
        }

        if (profile?.histogram && profile.histogram.length > 0) {
            const binEdges: string[] = [];
            const binCounts: number[] = [];
            for (const bin of profile.histogram) {
                if (binEdges.length === 0) {
                    binEdges.push(bin.bin_start);
                }
                binEdges.push(bin.bin_end);
                binCounts.push(bin.count);
            }
            return { bin_edges: binEdges, bin_counts: binCounts };
        }

        return null;
    });

    const frequencyTableData = $derived.by(() => {
        if (profile?.small_frequency_table) {
            return profile.small_frequency_table;
        }

        if (profile?.frequency_table) {
            return {
                values: profile.frequency_table.map((entry) => entry.value),
                counts: profile.frequency_table.map((entry) => entry.count),
            };
        }

        return null;
    });

    function renderNamePart(
        part: string | { kind: "whitespace"; text: string },
    ): { text: string; whitespace: boolean } {
        if (typeof part === "string") {
            return { text: part, whitespace: false };
        }

        return { text: part.text, whitespace: true };
    }

    function toggleExpanded() {
        if (!summaryStatsSupported) {
            return;
        }

        onToggle?.(!expanded);
    }

    function handleMouseDown() {
        onSelect?.();
    }

    function handleDoubleClick() {
        if (onDoubleClick) {
            onDoubleClick();
            return;
        }

        const gridInstance = context.gridInstance;
        if (gridInstance) {
            gridInstance.setCursorPosition(columnIndex, 0);
        }
    }

    function handleDataTypeMouseEnter() {
        if (!hoverManager || !dataTypeRef) {
            return;
        }

        hoverManager.showHover(dataTypeRef, `${columnType}`);
    }

    function handleColumnNameMouseEnter() {
        if (!hoverManager || !columnNameRef || !columnLabel) {
            return;
        }

        hoverManager.showHover(columnNameRef, columnLabel);
    }

    function handleHoverLeave() {
        hoverManager?.hideHover();
    }
</script>

<div
    class="column-summary"
    class:expanded
    onmousedown={handleMouseDown}
    ondblclick={handleDoubleClick}
    role="row"
    tabindex={-1}
>
    <div
        class="cursor-indicator"
        class:cursor={isCursor}
        class:focused={isCursor && isFocused}
    ></div>

    <div class="basic-info">
        <div class="left-gutter"></div>

        <button
            class="expand-collapse-button"
            class:disabled={!summaryStatsSupported}
            onclick={toggleExpanded}
            disabled={!summaryStatsSupported}
            title={expanded
                ? localize("positron.columnSummary.collapse", "Collapse")
                : localize("positron.columnSummary.expand", "Expand")}
        >
            {#if expanded}
                <span class="expand-collapse-icon codicon codicon-chevron-down"></span>
            {:else}
                <span class="expand-collapse-icon codicon codicon-chevron-right"></span>
            {/if}
        </button>

        <div
            bind:this={dataTypeRef}
            class="data-type-icon codicon {dataTypeIconClass}"
            role="presentation"
            title={!hoverManager ? columnType : undefined}
            onmouseenter={handleDataTypeMouseEnter}
            onmouseleave={handleHoverLeave}
        ></div>

        <div
            bind:this={columnNameRef}
            class="column-name"
            role="presentation"
            title={!hoverManager ? columnLabel : undefined}
            onmouseenter={handleColumnNameMouseEnter}
            onmouseleave={handleHoverLeave}
        >
            {#each renderedColumnName as part, index (index)}
                {@const renderedPart = renderNamePart(part)}
                <span class:whitespace={renderedPart.whitespace}
                    >{renderedPart.text}</span
                >
            {/each}
        </div>

        {#if !expanded}
            <div class="column-sparkline">
                {#if isNumeric && histogramData}
                    <VectorHistogram
                        histogram={histogramData}
                        width={80}
                        height={20}
                        xAxisHeight={0.5}
                        displayType={resolvedProfileType}
                        {hoverManager}
                    />
                {:else if (isString || isBoolean) && frequencyTableData}
                    <VectorFrequencyTable
                        frequencyTable={frequencyTableData}
                        width={80}
                        height={20}
                        xAxisHeight={0.5}
                        {hoverManager}
                    />
                {:else if isNumeric || isString || isBoolean}
                    <svg
                        class="loading-sparkline"
                        shape-rendering="crispEdges"
                        viewBox="0 0 80 20.5"
                        width="80"
                        height="20.5"
                    >
                        <g>
                            <rect
                                class="x-axis"
                                height="0.5"
                                width="80"
                                x="0"
                                y="19.5"
                            />
                            <rect
                                class="loading-indicator"
                                height="6"
                                rx="2"
                                width="64"
                                x="8"
                                y="10"
                            />
                        </g>
                    </svg>
                {/if}
            </div>
        {/if}

        <NullPercentIndicator
            {nullPercent}
            nullCount={profile?.null_count}
            {hoverManager}
        />

        <div class="right-gutter"></div>
    </div>

    {#if expanded}
        <div class="column-profile-info">
            <ColumnProfileExpanded
                {columnIndex}
                {columnType}
                {typeDisplay}
                resolvedTypeDisplay={resolvedProfileType}
                {profile}
                {hoverManager}
            />
        </div>
    {/if}
</div>

<style>
    .column-summary {
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        z-index: 0;
        display: grid;
        overflow: hidden;
        position: absolute;
        grid-template-rows: [basic-info] 34px [profile-info] 1fr [end-rows];
    }

    .column-summary .cursor-indicator {
        top: 2px;
        right: 2px;
        bottom: 2px;
        left: 2px;
        z-index: -1;
        opacity: 50%;
        position: absolute;
        border-radius: 4px;
    }

    .column-summary:hover .cursor-indicator {
        background-color: var(--vscode-positronDataGrid-selectionBackground);
    }

    .column-summary .cursor-indicator.cursor {
        background-color: var(--vscode-positronDataGrid-selectionBackground);
    }

    .column-summary .cursor-indicator.cursor.focused {
        opacity: 100%;
        border: 1px solid var(--vscode-positronDataGrid-selectionBorder);
    }

    .column-summary .basic-info {
        display: grid;
        align-items: center;
        white-space: nowrap;
        grid-row: basic-info / profile-info;
        grid-template-columns:
            [left-gutter] 5px
            [expand-collapse] 25px
            [datatype-icon] 25px
            [title] 1fr
            [sparkline] min-content
            [missing-values] min-content
            [right-gutter] 12px
            [end-columns];
    }

    .column-summary .basic-info .expand-collapse-button {
        width: 25px;
        height: 25px;
        display: flex;
        cursor: pointer;
        align-items: center;
        justify-content: center;
        grid-column: expand-collapse / datatype-icon;
        background: transparent;
        border: none;
        color: inherit;
        padding: 0;
    }

    .column-summary .basic-info .expand-collapse-button.disabled {
        opacity: 0%;
        cursor: default;
    }

    .column-summary .basic-info .expand-collapse-button:focus {
        outline: none !important;
    }

    .column-summary .basic-info .expand-collapse-button:focus-visible {
        border-radius: 6px;
        outline: 1px solid var(--vscode-focusBorder) !important;
    }

    .column-summary .basic-info .data-type-icon {
        width: 25px;
        height: 25px;
        opacity: 80%;
        display: flex;
        align-items: center;
        justify-content: center;
        grid-column: datatype-icon / title;
    }

    .column-summary .basic-info .column-name {
        overflow: hidden;
        font-weight: 600;
        margin-right: 4px;
        text-overflow: ellipsis;
        grid-column: title / sparkline;
    }

    .column-summary .basic-info .column-name .whitespace {
        opacity: 50%;
    }

    .column-summary .basic-info .column-sparkline {
        pointer-events: none;
        grid-column: sparkline / missing-values;
    }

    .column-summary
        .basic-info
        .column-sparkline
        .loading-sparkline
        .loading-indicator {
        fill: var(--vscode-positronDataExplorer-columnNullPercentGraphBackgroundFill);
        stroke: var(--vscode-positronDataExplorer-columnNullPercentGraphBackgroundStroke);
        opacity: 0.5;
        animation: pulse 1.5s infinite ease-in-out;
    }

    @keyframes pulse {
        0% {
            opacity: 0.2;
        }
        50% {
            opacity: 0.5;
        }
        100% {
            opacity: 0.2;
        }
    }

    .column-summary .column-profile-info {
        display: grid;
        margin: 0 auto;
        pointer-events: none;
        grid-row: profile-info / end-rows;
        grid-template-rows:
            [sparkline] min-content
            [tabular-info] min-content
            [end-rows];
        grid-template-columns:
            [left-gutter] 55px
            [sparkline-tabular-info] 1fr
            [right-gutter] 30px
            [end-column];
    }

    .column-summary .column-profile-info :global(.column-profile-expanded) {
        grid-row: sparkline / end-rows;
        grid-column: sparkline-tabular-info / right-gutter;
    }

    .column-summary .basic-info .data-type-icon::before {
        font-size: 16px;
    }
</style>
