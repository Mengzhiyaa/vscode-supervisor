<script lang="ts">
    import ResourceUsageGraph from "./ResourceUsageGraph.svelte";
    import ResourceUsageStats from "./ResourceUsageStats.svelte";

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
    const latest = $derived(resourceUsageHistory.at(-1));
</script>

{#if latest}
    <div
        class:busy
        class="console-resource-monitor"
        aria-label="Runtime resource usage"
    >
        <ResourceUsageGraph data={resourceUsageHistory} width={56} height={20} />
        <ResourceUsageStats
            cpuPercent={latest.cpu_percent}
            memoryBytes={latest.memory_bytes}
        />
    </div>
{/if}

<style>
    .console-resource-monitor {
        width: 100%;
        min-width: 0;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        overflow: hidden;
        container-type: inline-size;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
    }

    .console-resource-monitor.busy {
        padding-left: 2px;
    }

    .console-resource-monitor :global(.resource-usage-stats) {
        flex: 0 1 auto;
        margin: 0;
        gap: 6px;
    }
</style>
