<!--
    ResourceUsageGraph.svelte - CPU/Memory usage graph component
    Based on Positron's ResourceUsageGraph.tsx
-->
<script lang="ts">
    /**
     * Fixed spacing between data points in pixels.
     */
    const PIXELS_PER_POINT = 2;

    /**
     * Vertical padding to prevent stroke clipping at 0% and 100%.
     */
    const VERTICAL_PADDING = 2;

    interface ResourceUsage {
        cpu_percent: number;
        memory_bytes: number;
    }

    // Props
    let {
        data = [],
        width = 100,
        height = 24,
    }: {
        data: ResourceUsage[];
        width: number;
        height: number;
    } = $props();

    // Calculate SVG paths
    let linePath = $derived.by(() => {
        if (data.length === 0) return "";

        const maxPointsForWidth = Math.floor(width / PIXELS_PER_POINT) + 1;
        const visibleData = data.slice(-maxPointsForWidth);

        if (visibleData.length === 0) return "";

        const drawableHeight = height - 2 * VERTICAL_PADDING;

        const points = visibleData.map((d, i) => {
            const x = width - (visibleData.length - 1 - i) * PIXELS_PER_POINT;
            const cpuPercent = Math.max(0, Math.min(100, d.cpu_percent));
            const y =
                VERTICAL_PADDING + ((100 - cpuPercent) / 100) * drawableHeight;
            return { x, y };
        });

        return points
            .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
            .join(" ");
    });

    let fillPath = $derived.by(() => {
        if (data.length === 0) return "";

        const maxPointsForWidth = Math.floor(width / PIXELS_PER_POINT) + 1;
        const visibleData = data.slice(-maxPointsForWidth);

        if (visibleData.length === 0) return "";

        const drawableHeight = height - 2 * VERTICAL_PADDING;

        const points = visibleData.map((d, i) => {
            const x = width - (visibleData.length - 1 - i) * PIXELS_PER_POINT;
            const cpuPercent = Math.max(0, Math.min(100, d.cpu_percent));
            const y =
                VERTICAL_PADDING + ((100 - cpuPercent) / 100) * drawableHeight;
            return { x, y };
        });

        const linePoints = points
            .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
            .join(" ");
        const firstPoint = points[0];
        const lastPoint = points[points.length - 1];
        const bottomY = height - VERTICAL_PADDING;

        return `${linePoints} L ${lastPoint.x} ${bottomY} L ${firstPoint.x} ${bottomY} Z`;
    });
</script>

<svg
    class="resource-usage-graph"
    {width}
    {height}
    viewBox="0 0 {width} {height}"
>
    <title>CPU usage</title>
    {#if fillPath}
        <path class="resource-usage-fill" d={fillPath} />
    {/if}
    {#if linePath}
        <path class="resource-usage-line" d={linePath} />
    {/if}
</svg>

<style>
    .resource-usage-graph {
        display: block;
    }

    .resource-usage-fill {
        fill: var(--vscode-charts-lines, var(--vscode-foreground));
        opacity: 0.2;
    }

    .resource-usage-line {
        fill: none;
        stroke: var(--vscode-charts-lines, var(--vscode-foreground));
        stroke-width: 1.5;
    }
</style>
