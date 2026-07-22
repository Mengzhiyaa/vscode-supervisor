<script lang="ts">
    import ResourceUsageGraph from "./ResourceUsageGraph.svelte";
    import ResourceUsageStats from "./ResourceUsageStats.svelte";

    interface ResourceUsage {
        cpu_percent: number;
        memory_bytes: number;
    }

    let { resourceUsageHistory = [] }: { resourceUsageHistory: ResourceUsage[] } = $props();
    const latest = $derived(resourceUsageHistory.at(-1));
</script>

{#if latest}
    <div class="console-resource-monitor" aria-label="Runtime resource usage">
        <ResourceUsageGraph data={resourceUsageHistory} width={56} height={20} />
        <ResourceUsageStats
            cpuPercent={latest.cpu_percent}
            memoryBytes={latest.memory_bytes}
        />
    </div>
{/if}

<style>
    .console-resource-monitor {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 24px;
        min-width: 118px;
        max-width: 180px;
        container-type: inline-size;
        color: var(--vscode-descriptionForeground);
    }

    .console-resource-monitor :global(.resource-usage-stats) {
        flex: 1 1 auto;
        margin: 0;
        gap: 6px;
    }
</style>
