<!--
  VectorFrequencyTable.svelte - Frequency table sparkline visualization
  Port from Positron's VectorFrequencyTable component
-->
<script lang="ts">
    import type { DataGridHoverManager } from "../../dataGrid/dataGridInstance";

    interface Props {
        frequencyTable: {
            values: string[];
            counts: number[];
            other_count?: number;
        };
        width?: number;
        height?: number;
        xAxisHeight?: number;
        hoverManager?: DataGridHoverManager;
    }

    let {
        frequencyTable,
        width = 80,
        height = 20,
        xAxisHeight = 0.5,
        hoverManager,
    }: Props = $props();
    let hoveredIndex = $state<number | null>(null);

    const bars = $derived.by(() => {
        const counts = frequencyTable?.counts ?? [];
        const values = frequencyTable?.values ?? [];
        const otherCount = frequencyTable?.other_count ?? 0;
        const slotCount = counts.length + (otherCount > 0 ? 1 : 0);
        if (!slotCount) {
            return [];
        }

        const maxCount = Math.max(...counts, otherCount, 0);
        if (maxCount <= 0) {
            return [];
        }

        const totalCount =
            counts.reduce((sum, count) => sum + count, 0) + otherCount;
        const barWidth = (width - (slotCount - 1)) / slotCount;
        const graphHeight = height;

        const nextBars = counts.map((count, index) => {
            const percent =
                totalCount > 0
                    ? ((count / totalCount) * 100).toFixed(1)
                    : "0.0";
            const barHeight = Math.max(1, (count / maxCount) * graphHeight);

            return {
                x: index * (barWidth + 1),
                width: barWidth,
                y: graphHeight - xAxisHeight - barHeight,
                height: barHeight,
                other: false,
                tooltip: `Value: ${values[index] ?? ""}\nCount: ${count} (${percent}%)`,
            };
        });

        if (otherCount > 0) {
            const percent =
                totalCount > 0
                    ? ((otherCount / totalCount) * 100).toFixed(1)
                    : "0.0";
            const barHeight = Math.max(1, (otherCount / maxCount) * graphHeight);

            nextBars.push({
                x: counts.length * (barWidth + 1),
                width: barWidth,
                y: graphHeight - xAxisHeight - barHeight,
                height: barHeight,
                other: true,
                tooltip: `Other values\nCount: ${otherCount} (${percent}%)`,
            });
        }

        return nextBars;
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
    class="vector-frequency-table-container"
    style:width="{width}px"
    style:height="{height}px"
>
    <svg
        class="vector-frequency-table"
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

        {#each bars as bar, i (i)}
            <rect
                class="count"
                class:count-hover={hoveredIndex === i}
                class:other={bar.other}
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
    .vector-frequency-table-container {
        position: relative;
        display: block;
        pointer-events: all;
    }

    .vector-frequency-table {
        display: block;
    }

    .vector-frequency-table .count {
        fill: var(--vscode-positronDataExplorer-sparklineFill, #56a2dd);
    }

    .vector-frequency-table .count-hover {
        fill: var(--vscode-positronDataExplorer-sparklineHover, #ff8c69);
    }

    .vector-frequency-table .count.other {
        opacity: 0.65;
    }

    .vector-frequency-table .x-axis {
        fill: var(--vscode-positronDataExplorer-sparklineAxis, #b5b5b5);
    }

    .hover-hitbox {
        position: absolute;
        z-index: 1;
        cursor: default;
        pointer-events: all;
    }
</style>
