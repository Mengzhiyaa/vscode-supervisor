<!--
  NullPercentIndicator.svelte - Pill-shaped progress bar for null percentage
  Port from Positron's ColumnNullPercent component in columnSummaryCell.tsx
-->
<script lang="ts">
    import { onDestroy } from "svelte";
    import type { DataGridHoverManager } from "../../dataGrid/dataGridInstance";
    import { localize } from "../nls";

    interface Props {
        nullPercent?: number;
        nullCount?: number;
        hoverManager?: DataGridHoverManager;
    }

    let { nullPercent, nullCount, hoverManager }: Props = $props();
    let containerRef = $state<HTMLDivElement | null>(null);

    const graphNullPercent = $derived.by(() => {
        if (nullPercent === undefined) {
            return undefined;
        }

        if (nullPercent <= 0) {
            return 0;
        }

        if (nullPercent >= 100) {
            return 100;
        }

        return Math.min(Math.max(nullPercent, 5), 95);
    });

    const displayNullPercent = $derived.by(() => {
        if (nullPercent === undefined) {
            return undefined;
        }

        if (nullPercent <= 0) {
            return "0%";
        }

        if (nullPercent >= 100) {
            return "100%";
        }

        if (nullPercent > 0 && nullPercent < 1) {
            return "<1%";
        }

        return `${Math.floor(nullPercent)}%`;
    });

    const tooltipText = $derived.by(() => {
        if (nullPercent === undefined || nullCount === undefined) {
            return localize(
                "positron.missingValues.calculating",
                "Calculating...",
            );
        }

        if (nullPercent === 0) {
            return localize(
                "positron.missingValues.none",
                "No missing values",
            );
        }

        if (nullPercent === 100) {
            return localize(
                "positron.missingValues.all",
                "All values are missing ({0} values)",
                nullCount.toLocaleString(),
            );
        }

        return localize(
            "positron.missingValues.some",
            "{0} of values are missing ({1} values)",
            displayNullPercent ?? "",
            nullCount.toLocaleString(),
        );
    });

    const indicatorWidth = $derived.by(() => {
        if (graphNullPercent === undefined) {
            return 0;
        }

        return 50 * ((100 - graphNullPercent) / 100);
    });

    function handleMouseEnter() {
        if (!hoverManager || !containerRef) {
            return;
        }

        hoverManager.showHover(containerRef, tooltipText);
    }

    function handleMouseLeave() {
        hoverManager?.hideHover();
    }

    onDestroy(() => {
        hoverManager?.hideHover();
    });
</script>

<div
    bind:this={containerRef}
    class="column-null-percent"
    role="presentation"
    title={!hoverManager ? tooltipText : undefined}
    onmouseenter={handleMouseEnter}
    onmouseleave={handleMouseLeave}
>
    {#if displayNullPercent !== undefined}
        <div class="text-percent" class:zero={nullPercent === 0}>
            {displayNullPercent}
        </div>
    {/if}

    <div class="graph-percent">
        <svg shape-rendering="geometricPrecision" viewBox="0 0 52 14" width="25" height="14">
            <defs>
                <clipPath id="clip-indicator">
                    <rect height="12" rx="6" ry="6" width="50" x="1" y="1" />
                </clipPath>
            </defs>

            {#if graphNullPercent === undefined}
                <g>
                    <rect
                        class="empty"
                        height="12"
                        rx="6"
                        ry="6"
                        stroke-width="1"
                        width="50"
                        x="1"
                        y="1"
                    />
                </g>
            {:else}
                <g>
                    <rect
                        class="background"
                        height="12"
                        rx="6"
                        ry="6"
                        stroke-width="1"
                        width="50"
                        x="1"
                        y="1"
                    />
                    <rect
                        class="indicator"
                        clip-path="url(#clip-indicator)"
                        height="12"
                        rx="6"
                        ry="6"
                        width={indicatorWidth}
                        x="1"
                        y="1"
                    />
                </g>
            {/if}
        </svg>
    </div>
</div>

<style>
    .column-null-percent {
        display: grid;
        grid-gap: 5px;
        align-items: center;
        grid-template-columns: [percent] 35px [graph] 25px [end];
    }

    .column-null-percent .text-percent {
        font-size: 90%;
        text-align: right;
        grid-column: percent / graph;
    }

    .column-null-percent .text-percent.zero {
        opacity: 50%;
    }

    .column-null-percent .graph-percent {
        display: flex;
        grid-column: graph / end;
    }

    .column-null-percent .graph-percent .empty {
        fill: transparent;
        stroke: var(--vscode-positronDataExplorer-columnNullPercentGraphBackgroundStroke, var(--vscode-editorGroup-border));
    }

    .column-null-percent .graph-percent .background {
        fill: var(--vscode-positronDataExplorer-columnNullPercentGraphBackgroundFill, var(--vscode-inputValidation-warningBackground, rgba(255, 204, 0, 0.2)));
        stroke: var(--vscode-positronDataExplorer-columnNullPercentGraphBackgroundStroke, var(--vscode-editorGroup-border));
    }

    .column-null-percent .graph-percent .indicator {
        fill: var(--vscode-positronDataExplorer-columnNullPercentGraphIndicatorFill, var(--vscode-progressBar-background, #0e70c0));
    }
</style>
