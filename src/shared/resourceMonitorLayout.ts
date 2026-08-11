export interface ResourceMonitorLayout {
    showGraph: boolean;
    graphWidth: number;
    showMemory: boolean;
}

const MIN_GRAPH_WIDTH = 50;
const MAX_GRAPH_WIDTH = 150;
const MEMORY_WIDTH = 82;
const GAP = 6;
const FIXED_FOOTPRINT = 10;

export function computeResourceMonitorLayout(width: number): ResourceMonitorLayout {
    const available = Math.max(0, Math.floor(width) - FIXED_FOOTPRINT);
    const showMemory = available >= MEMORY_WIDTH;
    const graphSpace = available - (showMemory ? MEMORY_WIDTH + GAP : 0);
    const showGraph = showMemory && graphSpace >= MIN_GRAPH_WIDTH;
    return {
        showGraph,
        graphWidth: showGraph
            ? Math.max(MIN_GRAPH_WIDTH, Math.min(MAX_GRAPH_WIDTH, graphSpace))
            : 0,
        showMemory,
    };
}
