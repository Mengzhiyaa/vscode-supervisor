<!--
  VectorHistogram.svelte - Histogram sparkline visualization
  Port from Positron's VectorHistogram component
-->
<script lang="ts">
    import type { DataGridHoverManager } from "../../dataGrid/dataGridInstance";
    import { isIntegerDisplayType } from "../columnDisplayTypeUtils";

    interface Props {
        histogram: {
            bin_edges: string[];
            bin_counts: number[];
        };
        displayType?: string;
        width?: number;
        height?: number;
        xAxisHeight?: number;
        hoverManager?: DataGridHoverManager;
    }

    let {
        histogram,
        displayType,
        width = 80,
        height = 20,
        xAxisHeight = 0.5,
        hoverManager,
    }: Props = $props();
    let hoveredIndex = $state<number | null>(null);

    const bars = $derived.by(() => {
        if (!histogram?.bin_counts?.length) {
            return [];
        }

        const counts = histogram.bin_counts;
        const maxCount = Math.max(...counts);
        if (maxCount === 0) {
            return [];
        }

        const totalCount = counts.reduce((sum, count) => sum + count, 0);
        const barCount = counts.length;
        const barWidth = width / barCount;
        const graphHeight = height;

        return counts.map((count, index) => {
            const percent =
                totalCount > 0
                    ? ((count / totalCount) * 100).toFixed(1)
                    : "0.0";
            const start = histogram.bin_edges[index] ?? "";
            const end = histogram.bin_edges[index + 1] ?? "";
            const barHeight = (count / maxCount) * graphHeight;
            const integerType = displayType
                ? isIntegerDisplayType(displayType)
                : false;
            const parsedStart = Number.parseFloat(start.replaceAll(",", ""));
            const parsedEnd = Number.parseFloat(end.replaceAll(",", ""));
            const formattedStart =
                integerType && !Number.isNaN(parsedStart)
                    ? Math.ceil(parsedStart).toString()
                    : String(start);
            const formattedEnd =
                integerType && !Number.isNaN(parsedEnd)
                    ? Math.floor(parsedEnd).toString()
                    : String(end);

            return {
                x: index * barWidth,
                y: graphHeight - xAxisHeight - barHeight,
                width: barWidth,
                height: barHeight,
                tooltip: `Range: ${formattedStart} to ${formattedEnd}\nCount: ${count} (${percent}%)`,
            };
        });
    });

    const histogramPath = $derived.by(() => {
        if (!bars.length) {
            return "";
        }

        let path = "";
        const baseLineY = height - xAxisHeight;

        for (const [index, bar] of bars.entries()) {
            const nextX = bar.x + bar.width;

            if (index === 0) {
                path += `M ${bar.x} ${baseLineY} `;
            }

            path += `L ${bar.x} ${bar.y} `;
            path += `L ${nextX} ${bar.y} `;
            path += `L ${nextX} ${baseLineY} `;
        }

        path += "Z";
        return path;
    });

    function handleBarEnter(anchor: HTMLElement, index: number, tooltip: string) {
        hoveredIndex = index;
        hoverManager?.showHover(anchor, tooltip);
    }

    function handleBarLeave() {
        hoveredIndex = null;
        hoverManager?.hideHover();
    }
</script>

<div
    class="vector-histogram-container"
    style:width="{width}px"
    style:height="{height + xAxisHeight}px"
>
    <svg
        class="vector-histogram"
        viewBox="0 0 {width} {height + xAxisHeight}"
        width="100%"
        height="100%"
        shape-rendering="crispEdges"
    >
        <rect
            class="x-axis"
            x="0"
            y={height - xAxisHeight}
            width={width}
            height={xAxisHeight}
        />

        <path class="bin-count" d={histogramPath} />

        {#each bars as bar, i (i)}
            <rect
                class="bin-count-hover"
                class:hovered={hoveredIndex === i}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
            >
                {#if !hoverManager}
                    <title>{bar.tooltip}</title>
                {/if}
            </rect>
        {/each}
    </svg>

    {#if hoverManager}
        {#each bars as bar, i (i)}
            <div
                class="hover-hitbox"
                style:left="{bar.x}px"
                style:top="0px"
                style:width="{Math.max(bar.width, 1)}px"
                style:height="{height}px"
                role="presentation"
                aria-hidden="true"
                onmouseenter={(event) =>
                    handleBarEnter(
                        event.currentTarget as HTMLElement,
                        i,
                        bar.tooltip,
                    )}
                onmouseleave={handleBarLeave}
            ></div>
        {/each}
    {/if}
</div>

<style>
    .vector-histogram-container {
        position: relative;
        display: block;
        pointer-events: all;
    }

    .vector-histogram {
        display: block;
    }

    .vector-histogram .bin-count {
        fill: var(--vscode-positronDataExplorer-sparklineFill, #56a2dd);
    }

    .vector-histogram .bin-count-hover {
        display: none;
        fill: var(--vscode-positronDataExplorer-sparklineHover, #ff8c69);
    }

    .vector-histogram .bin-count-hover.hovered {
        display: block;
    }

    .vector-histogram .x-axis {
        fill: var(--vscode-positronDataExplorer-sparklineAxis, #b5b5b5);
    }

    .hover-hitbox {
        position: absolute;
        z-index: 1;
        cursor: default;
        pointer-events: all;
    }
</style>
