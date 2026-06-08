<script lang="ts">
    import type {
        MemorySessionUsage,
        MemoryUsageSnapshot,
    } from "../types/memory";

    interface Segment {
        id: string;
        bytes: number;
        className: string;
    }

    interface UsageRow {
        id: string;
        name: string;
        bytes: number;
        className: string;
    }

    interface Props {
        enabled?: boolean;
        snapshot?: MemoryUsageSnapshot;
    }

    let { enabled = true, snapshot }: Props = $props();

    let expanded = $state(false);
    let anchorEl = $state<HTMLButtonElement | null>(null);
    let dropdownEl = $state<HTMLDivElement | null>(null);
    let dropdownStyle = $state("");
    let highlightedSegmentId = $state<string | null>(null);

    const loading = $derived(enabled && !snapshot);
    const lowMemory = $derived(snapshot?.lowMemory);
    const supervisorBytes = $derived(
        snapshot
            ? snapshot.kernelTotalBytes +
                  snapshot.positronOverheadBytes +
                  snapshot.extensionHostOverheadBytes
            : 0,
    );
    const usedSystemBytes = $derived(
        snapshot
            ? Math.max(0, snapshot.totalSystemMemory - snapshot.freeSystemMemory)
            : 0,
    );
    const usedPercent = $derived(
        snapshot?.totalSystemMemory
            ? Math.min(
                  100,
                  Math.round((usedSystemBytes / snapshot.totalSystemMemory) * 100),
              )
            : 0,
    );
    const tooltip = $derived.by(() => {
        if (!snapshot) {
            return "Computing memory usage...";
        }

        return [
            `Supervisor + kernels: ${formatBytes(supervisorBytes)}`,
            `Other: ${formatBytes(snapshot.otherProcessesBytes)}`,
            `Free: ${formatBytes(snapshot.freeSystemMemory)}`,
        ].join(" | ");
    });
    const segments = $derived.by(() => {
        if (!snapshot) {
            return [] as Segment[];
        }

        const nextSegments: Segment[] = [];
        snapshot.kernelSessions.forEach((session, index) => {
            if (session.memoryBytes > 0) {
                nextSegments.push({
                    id: `session:${index}`,
                    bytes: session.memoryBytes,
                    className: "kernel",
                });
            }
        });

        if (snapshot.positronOverheadBytes > 0) {
            nextSegments.push({
                id: "overhead:platform",
                bytes: snapshot.positronOverheadBytes,
                className: "overhead",
            });
        }

        if (snapshot.extensionHostOverheadBytes > 0) {
            nextSegments.push({
                id: "overhead:extension-host",
                bytes: snapshot.extensionHostOverheadBytes,
                className: "overhead",
            });
        }

        if (snapshot.otherProcessesBytes > 0) {
            nextSegments.push({
                id: "system:other",
                bytes: snapshot.otherProcessesBytes,
                className: "other",
            });
        }

        if (snapshot.freeSystemMemory > 0) {
            nextSegments.push({
                id: "system:free",
                bytes: snapshot.freeSystemMemory,
                className: "free",
            });
        }

        return nextSegments;
    });
    const sessionRows = $derived.by(() =>
        snapshot
            ? snapshot.kernelSessions.map((session, index) => ({
                  id: `session:${index}`,
                  name: getSessionLabel(session),
                  bytes: session.memoryBytes,
                  className: "kernel",
              }))
            : [],
    );
    const overheadRows = $derived.by(() =>
        snapshot
            ? [
                  {
                      id: "overhead:platform",
                      name: "Platform",
                      bytes: snapshot.positronOverheadBytes,
                      className: "overhead",
                  },
                  {
                      id: "overhead:extension-host",
                      name: "Extension Host",
                      bytes: snapshot.extensionHostOverheadBytes,
                      className: "overhead",
                  },
              ]
            : [],
    );
    const systemRows = $derived.by(() =>
        snapshot
            ? [
                  {
                      id: "system:other",
                      name: "Other",
                      bytes: snapshot.otherProcessesBytes,
                      className: "other",
                  },
                  {
                      id: "system:free",
                      name: "Free",
                      bytes: snapshot.freeSystemMemory,
                      className: "free",
                  },
              ]
            : [],
    );
    const maxRowBytes = $derived(
        Math.max(
            1,
            ...sessionRows.map((row) => row.bytes),
            ...overheadRows.map((row) => row.bytes),
            supervisorBytes,
            ...systemRows.map((row) => row.bytes),
        ),
    );

    function getSessionLabel(session: MemorySessionUsage) {
        if (session.sessionName) {
            return session.sessionName;
        }

        if (session.languageId) {
            return session.languageId;
        }

        return session.sessionId;
    }

    function formatBytes(bytes: number): string {
        if (!Number.isFinite(bytes) || bytes <= 0) {
            return "0 B";
        }

        const units = ["B", "KB", "MB", "GB", "TB"];
        let value = bytes;
        let unitIndex = 0;
        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex++;
        }

        const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
        return `${value.toFixed(digits)} ${units[unitIndex]}`;
    }

    function segmentWidth(bytes: number): number {
        if (!snapshot?.totalSystemMemory) {
            return 0;
        }

        return Math.max(0, (bytes / snapshot.totalSystemMemory) * 100);
    }

    function rowWidth(bytes: number): number {
        return Math.max(2, (bytes / maxRowBytes) * 100);
    }

    function pctLabel(bytes: number): string {
        if (!snapshot?.totalSystemMemory || bytes <= 0) {
            return "0%";
        }

        const pct = (bytes / snapshot.totalSystemMemory) * 100;
        return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
    }

    function lowMemoryLabel(): string {
        if (!lowMemory) {
            return "";
        }

        if (lowMemory.unit === "percent") {
            return `Less than ${lowMemory.threshold}% memory remaining`;
        }

        return `Less than ${lowMemory.threshold} MB memory remaining`;
    }

    function updateDropdownPosition() {
        if (!anchorEl || !dropdownEl) {
            return;
        }

        const anchorRect = anchorEl.getBoundingClientRect();
        const dropdownRect = dropdownEl.getBoundingClientRect();
        const viewportPadding = 8;
        const width = Math.min(400, Math.max(300, window.innerWidth - viewportPadding * 2));
        const left = Math.min(
            Math.max(anchorRect.right - width, viewportPadding),
            Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
        );
        const top = Math.min(
            Math.max(anchorRect.bottom + 4, viewportPadding),
            Math.max(
                viewportPadding,
                window.innerHeight - dropdownRect.height - viewportPadding,
            ),
        );

        dropdownStyle = `left: ${Math.round(left)}px; top: ${Math.round(top)}px; width: ${Math.round(width)}px;`;
    }

    function closeDropdown() {
        expanded = false;
        highlightedSegmentId = null;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
        const target = event.target;
        if (!(target instanceof Node)) {
            return;
        }

        if (anchorEl?.contains(target) || dropdownEl?.contains(target)) {
            return;
        }

        closeDropdown();
    }

    function handleKeyDown(event: KeyboardEvent) {
        switch (event.key) {
            case "Enter":
            case " ":
            case "ArrowDown":
                event.preventDefault();
                expanded = true;
                break;
            case "Escape":
                if (expanded) {
                    event.preventDefault();
                    closeDropdown();
                }
                break;
        }
    }

    $effect(() => {
        if (!expanded) {
            return;
        }

        document.addEventListener("mousedown", handleDocumentMouseDown, true);
        window.addEventListener("resize", updateDropdownPosition);
        window.addEventListener("scroll", updateDropdownPosition, true);
        requestAnimationFrame(updateDropdownPosition);

        return () => {
            document.removeEventListener("mousedown", handleDocumentMouseDown, true);
            window.removeEventListener("resize", updateDropdownPosition);
            window.removeEventListener("scroll", updateDropdownPosition, true);
        };
    });

    $effect(() => {
        if (expanded) {
            requestAnimationFrame(updateDropdownPosition);
        }
    });
</script>

{#snippet memoryBar(compact = false)}
    <div
        class:compact
        class:low-memory={!!lowMemory}
        class="memory-bar"
        aria-hidden="true"
    >
        {#if snapshot}
            {#each segments as segment (segment.id)}
                {@const width = segmentWidth(segment.bytes)}
                {#if width > 0}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class={`memory-segment ${segment.className}`}
                        class:highlighted={highlightedSegmentId === segment.id}
                        class:dimmed={!!highlightedSegmentId &&
                            highlightedSegmentId !== segment.id}
                        style:flex-basis={`${width}%`}
                        onmouseenter={() => (highlightedSegmentId = segment.id)}
                        onmouseleave={() => (highlightedSegmentId = null)}
                    ></div>
                {/if}
            {/each}
        {/if}
    </div>
{/snippet}

{#snippet usageRow(row: UsageRow)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="usage-row"
        onmouseenter={() => (highlightedSegmentId = row.id)}
        onmouseleave={() => (highlightedSegmentId = null)}
    >
        <span class="usage-name" title={row.name}>{row.name}</span>
        <span class="usage-size">{formatBytes(row.bytes)}</span>
        <div class="usage-bar-cell" aria-hidden="true">
            <div
                class={`usage-bar ${row.className}`}
                class:highlighted={highlightedSegmentId === row.id}
                class:dimmed={!!highlightedSegmentId &&
                    highlightedSegmentId !== row.id}
                style:flex-basis={`${rowWidth(row.bytes)}%`}
            ></div>
            <span class="usage-percent">{pctLabel(row.bytes)}</span>
        </div>
    </div>
{/snippet}

{#if enabled}
    <button
        bind:this={anchorEl}
        class="memory-usage-meter"
        class:low-memory={!!lowMemory}
        title={tooltip}
        type="button"
        aria-label={tooltip}
        aria-expanded={expanded}
        aria-haspopup="dialog"
        onclick={() => (expanded = !expanded)}
        onkeydown={handleKeyDown}
    >
        {#if lowMemory}
            <span
                class="memory-warning codicon codicon-warning"
                title={lowMemoryLabel()}
                aria-hidden="true"
            ></span>
        {/if}
        {@render memoryBar(true)}
        <span class="memory-label">{loading ? "Mem" : formatBytes(supervisorBytes)}</span>
        <span
            class="memory-arrow codicon codicon-positron-drop-down-arrow"
            aria-hidden="true"
        ></span>
    </button>

    {#if expanded}
        <div
            bind:this={dropdownEl}
            class="memory-dropdown"
            class:low-memory={!!lowMemory}
            style={dropdownStyle}
            role="dialog"
            aria-label="Memory usage"
        >
            {#if loading || !snapshot}
                <div class="memory-loading">Computing memory usage...</div>
            {:else}
                <div class="memory-summary">
                    <div class="summary-title">
                        <span>{usedPercent}% of {formatBytes(snapshot.totalSystemMemory)}</span>
                        <span>{formatBytes(usedSystemBytes)} used</span>
                    </div>
                    {@render memoryBar(false)}
                    {#if lowMemory}
                        <div class="low-memory-message">
                            <span class="codicon codicon-warning" aria-hidden="true"></span>
                            <span>{lowMemoryLabel()}</span>
                        </div>
                    {/if}
                </div>

                <div class="memory-breakdown">
                    {#if sessionRows.length > 0}
                        <div class="section-header">
                            Sessions ({formatBytes(snapshot.kernelTotalBytes)})
                        </div>
                        {#each sessionRows as row (row.id)}
                            {@render usageRow(row)}
                        {/each}
                    {/if}

                    <div class="section-header">
                        Overhead ({formatBytes(snapshot.positronOverheadBytes + snapshot.extensionHostOverheadBytes)})
                    </div>
                    {#each overheadRows as row (row.id)}
                        {@render usageRow(row)}
                    {/each}

                    <div class="section-header">Summary</div>
                    {@render usageRow({
                        id: "summary:supervisor",
                        name: "Supervisor + kernels",
                        bytes: supervisorBytes,
                        className: "supervisor",
                    })}

                    {#each systemRows as row (row.id)}
                        {@render usageRow(row)}
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
{/if}

<style>
    .memory-usage-meter {
        width: 100%;
        height: 24px;
        min-width: 0;
        container-type: inline-size;
        border: 0;
        border-radius: 4px;
        padding: 0 4px;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        color: var(--vscode-positronActionBar-foreground, var(--vscode-foreground));
        background: transparent;
        cursor: pointer;
        overflow: hidden;
        box-sizing: border-box;
    }

    .memory-usage-meter:hover {
        background: var(--vscode-positronActionBar-hoverBackground, var(--vscode-toolbar-hoverBackground));
    }

    .memory-usage-meter:focus {
        outline: none;
    }

    .memory-usage-meter:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
    }

    .memory-warning {
        color: var(--vscode-editorWarning-foreground, var(--vscode-notificationsWarningIcon-foreground));
        font-size: 14px;
        flex: 0 0 auto;
    }

    .memory-bar {
        height: 16px;
        border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
        border-radius: 2px;
        display: flex;
        overflow: hidden;
        background: transparent;
        box-sizing: border-box;
        min-width: 0;
    }

    .memory-bar.compact {
        height: 10px;
        width: 70px;
        flex: 1 1 70px;
        max-width: 100px;
        min-width: 26px;
    }

    .memory-bar.low-memory {
        border-color: var(--vscode-errorForeground);
    }

    .memory-segment {
        height: 100%;
        flex-shrink: 0;
        min-width: 0;
    }

    .memory-segment.kernel {
        background: var(--vscode-charts-blue, var(--vscode-charts-foreground));
    }

    .memory-segment.overhead,
    .memory-segment.supervisor {
        background: var(--vscode-charts-green, var(--vscode-gauge-foreground));
    }

    .memory-segment.other {
        background: var(--vscode-charts-yellow, var(--vscode-gauge-background));
    }

    .memory-segment.free {
        background: transparent;
    }

    .memory-bar.low-memory .memory-segment.overhead,
    .memory-bar.low-memory .memory-segment.other {
        background: var(--vscode-errorForeground);
    }

    .memory-segment.highlighted,
    .usage-bar.highlighted {
        outline: 2px solid var(--vscode-editorWidget-foreground, var(--vscode-foreground));
        outline-offset: 0;
        z-index: 1;
    }

    .memory-segment.dimmed,
    .usage-bar.dimmed {
        opacity: 0.55;
    }

    .memory-label {
        min-width: 36px;
        flex: 0 0 auto;
        text-align: right;
        font-size: 10px;
        line-height: 1;
        color: var(--vscode-descriptionForeground);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        user-select: none;
    }

    .low-memory .memory-label {
        color: var(--vscode-editorWarning-foreground, var(--vscode-notificationsWarningIcon-foreground));
    }

    .memory-arrow {
        flex: 0 0 auto;
        font-size: 18px;
        color: var(--vscode-positronActionBar-foreground, var(--vscode-foreground));
    }

    .memory-dropdown {
        position: fixed;
        z-index: 1000;
        border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
        border-radius: 4px;
        color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
        background: var(--vscode-editorWidget-background, var(--vscode-menu-background));
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
        box-sizing: border-box;
    }

    .memory-loading {
        padding: 8px 12px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        white-space: nowrap;
    }

    .memory-summary {
        padding: 12px 12px 8px;
        border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
    }

    .summary-title {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
        font-size: 12px;
        color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
    }

    .low-memory-message {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        margin-top: 8px;
        font-size: 12px;
    }

    .low-memory-message .codicon {
        color: var(--vscode-editorWarning-foreground, var(--vscode-notificationsWarningIcon-foreground));
    }

    .memory-breakdown {
        padding: 10px 12px 12px;
    }

    .section-header {
        padding: 6px 0 4px;
        color: var(--vscode-descriptionForeground);
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        user-select: none;
    }

    .section-header:first-child {
        padding-top: 0;
    }

    .usage-row {
        display: grid;
        grid-template-columns: minmax(84px, 1fr) 62px minmax(80px, 1.1fr);
        align-items: center;
        gap: 8px;
        padding: 2px 0;
        min-width: 0;
    }

    .usage-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
    }

    .usage-size {
        color: var(--vscode-descriptionForeground);
        font-family: var(--monaco-monospace-font, monospace);
        font-size: 11px;
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }

    .usage-bar-cell {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .usage-bar {
        height: 10px;
        border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
        border-radius: 1px;
        box-sizing: border-box;
        flex-shrink: 0;
    }

    .usage-bar.kernel {
        background: var(--vscode-charts-blue, var(--vscode-charts-foreground));
    }

    .usage-bar.overhead,
    .usage-bar.supervisor {
        background: var(--vscode-charts-green, var(--vscode-gauge-foreground));
    }

    .usage-bar.other {
        background: var(--vscode-charts-yellow, var(--vscode-gauge-background));
    }

    .usage-bar.free {
        background: transparent;
    }

    .low-memory .usage-bar.overhead,
    .low-memory .usage-bar.supervisor,
    .low-memory .usage-bar.other {
        background: var(--vscode-errorForeground);
    }

    .usage-percent {
        flex: 0 0 24px;
        color: var(--vscode-descriptionForeground);
        font-size: 9px;
        text-align: right;
        white-space: nowrap;
        user-select: none;
    }

    @container (max-width: 96px) {
        .memory-bar.compact {
            display: none;
        }
    }

    @container (max-width: 66px) {
        .memory-warning {
            display: none;
        }

        .memory-label {
            min-width: 28px;
        }
    }
</style>
