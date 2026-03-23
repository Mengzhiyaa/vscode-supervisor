<!--
    ResourceUsageStats.svelte - CPU/Memory usage stats component
    Based on Positron's ResourceUsageStats.tsx
-->
<script lang="ts">
    // Props
    let {
        cpuPercent = 0,
        memoryBytes = 0,
    }: {
        cpuPercent: number;
        memoryBytes: number;
    } = $props();

    /**
     * Format bytes to human readable format
     */
    function formatBytes(bytes: number): string {
        const size = Number.isFinite(bytes) ? bytes : 0;
        const KB = 1024;
        const MB = KB * KB;
        const GB = MB * KB;
        const TB = GB * KB;

        if (size < KB) {
            return `${size.toFixed(0)}B`;
        }

        if (size < MB) {
            return `${(size / KB).toFixed(2)}KB`;
        }

        if (size < GB) {
            return `${(size / MB).toFixed(2)}MB`;
        }

        if (size < TB) {
            return `${(size / GB).toFixed(2)}GB`;
        }

        return `${(size / TB).toFixed(2)}TB`;
    }
</script>

<dl class="resource-usage-stats" aria-live="polite" aria-atomic="true">
    <div class="resource-usage-cpu">
        <dt class="resource-usage-label">CPU</dt>
        <dd class="resource-usage-value">{cpuPercent.toFixed(0)}%</dd>
    </div>
    <div class="resource-usage-memory">
        <dt class="resource-usage-label">MEM</dt>
        <dd class="resource-usage-value">{formatBytes(memoryBytes)}</dd>
    </div>
</dl>

<style>
    .resource-usage-stats {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        font-size: 9px;
        font-weight: 400;
        font-variant-numeric: tabular-nums;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        line-height: 1.1;
        color: var(--vscode-descriptionForeground);
        margin: 2px 0 0;
        padding: 0;
        min-width: 0;
    }

    .resource-usage-cpu,
    .resource-usage-memory {
        white-space: nowrap;
        display: flex;
        gap: 4px;
        flex-direction: row;
        align-items: baseline;
        min-width: 0;
    }

    .resource-usage-cpu {
        flex: 0 0 auto;
    }

    .resource-usage-label {
        margin: 0;
        font-weight: 400;
        line-height: inherit;
    }

    .resource-usage-value {
        margin: 0;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: inherit;
    }

    .resource-usage-memory {
        flex: 1 1 auto;
        justify-content: flex-end;
    }

    .resource-usage-memory .resource-usage-value {
        flex: 0 1 auto;
        text-align: right;
    }

    @container (max-width: 115px) {
        .resource-usage-label {
            display: none;
        }
    }

    @container (max-width: 64px) {
        .resource-usage-cpu {
            display: none;
        }

        .resource-usage-stats {
            justify-content: flex-end;
        }
    }
</style>
