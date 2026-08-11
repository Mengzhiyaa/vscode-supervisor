<script lang="ts">
    import { onDestroy } from "svelte";
    import ResourceUsageGraph from "./ResourceUsageGraph.svelte";
    import ResourceUsageStats from "./ResourceUsageStats.svelte";
    import { computeResourceMonitorLayout } from "@shared/resourceMonitorLayout";
    import { localize } from "$lib/localization";

    interface ResourceUsage {
        cpu_percent: number;
        memory_bytes: number;
    }

    let {
        busy = false,
        resourceUsageHistory = [],
    }: {
        busy?: boolean;
        resourceUsageHistory: ResourceUsage[];
    } = $props();
    let monitorRef = $state<HTMLDivElement>();
    let width = $state(0);
    let resizeObserver: ResizeObserver | undefined;
    const latest = $derived(resourceUsageHistory.at(-1));
    const layout = $derived(computeResourceMonitorLayout(width));
    const ariaLabel = $derived(
        latest
            ? localize(
                  "console.resource.aria",
                  "Runtime resource usage: CPU {0}%, memory {1} bytes",
                  latest.cpu_percent.toFixed(0),
                  latest.memory_bytes,
              )
            : localize(
                  "console.resource.unavailable",
                  "Runtime resource usage unavailable",
              ),
    );

    $effect(() => {
        const element = monitorRef;
        resizeObserver?.disconnect();
        resizeObserver = undefined;
        if (!element) return;
        resizeObserver = new ResizeObserver(([entry]) => {
            width = entry.contentRect.width;
        });
        resizeObserver.observe(element);
        width = element.getBoundingClientRect().width;
    });

    onDestroy(() => resizeObserver?.disconnect());
</script>

<div
    bind:this={monitorRef}
    class:busy
    class="console-resource-monitor"
    role="img"
    aria-label={ariaLabel}
>
    {#if latest && layout.showGraph}
        <div
            class="graph-chip"
            title={localize(
                "console.resource.cpuTooltip",
                "CPU {0}%",
                latest.cpu_percent.toFixed(0),
            )}
        >
            <ResourceUsageGraph
                data={resourceUsageHistory}
                width={layout.graphWidth}
                height={16}
            />
        </div>
    {/if}
    {#if latest && layout.showMemory}
        <ResourceUsageStats
            cpuPercent={latest.cpu_percent}
            memoryBytes={latest.memory_bytes}
            showCpu={false}
        />
    {/if}
</div>

<style>
    .console-resource-monitor {
        width: 100%;
        min-width: 0;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        overflow: hidden;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
    }

    .console-resource-monitor.busy {
        padding-left: 2px;
    }

    .graph-chip {
        height: 18px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        overflow: hidden;
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
        border-radius: 3px;
    }

    .console-resource-monitor :global(.resource-usage-stats) {
        flex: 0 0 auto;
        margin: 0;
    }
</style>
