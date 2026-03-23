<script lang="ts">
    /**
     * ConsoleTab.svelte - Individual session tab component
     * Based on Positron's ConsoleTab in consoleTabList.tsx
     */
    import ContextMenu, {
        type ContextMenuEntry,
    } from "../shared/ContextMenu.svelte";
    import type { ConsoleState } from "../types/console";
    import ConsoleInstanceState from "./ConsoleInstanceState.svelte";
    import RuntimeIcon from "./RuntimeIcon.svelte";
    import ResourceUsageGraph from "./ResourceUsageGraph.svelte";
    import ResourceUsageStats from "./ResourceUsageStats.svelte";

    interface ResourceUsage {
        cpu_percent: number;
        memory_bytes: number;
    }

    interface SessionInfo {
        id: string;
        name: string;
        runtimeName: string;
        state: ConsoleState;
        runtimePath?: string;
        runtimeVersion?: string;
        runtimeSource?: string;
        base64EncodedIconSvg?: string;
    }

    // Props
    let {
        session,
        active = false,
        width = 200,
        resourceUsageHistory = [],
        showResourceMonitor = true,
        onSelect,
        onDelete,
        onRename,
        onToggleResourceMonitor = () => {},
    }: {
        session: SessionInfo;
        active: boolean;
        width: number;
        resourceUsageHistory?: ResourceUsage[];
        showResourceMonitor?: boolean;
        onSelect: () => void;
        onDelete: () => void;
        onRename: (newName: string) => void;
        onToggleResourceMonitor?: () => void;
    } = $props();

    // State
    let isRenaming = $state(false);
    // svelte-ignore state_referenced_locally
    let editName = $state(
        session.name ||
            session.runtimeVersion ||
            session.runtimeName ||
            "Session",
    );
    let deleteDisabled = $state(false);
    // svelte-ignore non_reactive_update
    let inputRef: HTMLInputElement;
    // svelte-ignore non_reactive_update
    let tabRef: HTMLDivElement;

    // Context menu state
    let showContextMenu = $state(false);
    let contextMenuX = $state(0);
    let contextMenuY = $state(0);

    // Minimum width for showing delete button
    const MINIMUM_ACTION_TAB_WIDTH = 110;
    const RESOURCE_GRAPH_HEIGHT = 24;

    // Computed values for resource usage
    let graphWidth = $derived(Math.max(0, width - 20));
    let latestResourceUsage = $derived(
        resourceUsageHistory.length > 0
            ? resourceUsageHistory[resourceUsageHistory.length - 1]
            : null,
    );
    let showResourceUsage = $derived(
        active &&
            showResourceMonitor &&
            resourceUsageHistory.length > 0 &&
            session.state !== "exited",
    );
    let primarySessionName = $derived(
        session.name ||
            session.runtimeVersion ||
            session.runtimeName ||
            "Session",
    );
    const showResourceMonitorLabel = $derived("Show Resource Monitor");
    const contextMenuEntries = $derived.by(
        (): ContextMenuEntry[] => [
            {
                label: "Rename...",
                icon: "edit",
                onSelected: () => startRename(),
            },
            {
                label: "Delete",
                icon: "trash",
                disabled: deleteDisabled,
                onSelected: () => {
                    void deleteSession();
                },
            },
            {
                label: showResourceMonitorLabel,
                checked: showResourceMonitor,
                onSelected: () => onToggleResourceMonitor(),
            },
        ],
    );

    /**
     * Handle tab click
     */
    function handleClick(e: MouseEvent) {
        e.stopPropagation();
        closeContextMenu();
        onSelect();
        // Focus tab after selection
        setTimeout(() => tabRef?.focus(), 0);
    }

    /**
     * Handle context menu (right-click)
     */
    function handleMouseDown(e: MouseEvent) {
        const isContextMenuTrigger =
            e.button === 2 || (e.button === 0 && e.ctrlKey);
        if (!isContextMenuTrigger) {
            closeContextMenu();
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        onSelect();

        contextMenuX = e.clientX;
        contextMenuY = e.clientY;
        showContextMenu = true;

        setTimeout(() => tabRef?.focus(), 0);
    }

    /**
     * Close context menu
     */
    function closeContextMenu() {
        showContextMenu = false;
    }

    /**
     * Handle context menu item click
     */
    async function deleteSession() {
        if (deleteDisabled) return;
        deleteDisabled = true;
        try {
            await onDelete();
        } catch (error) {
            console.error("Failed to delete session:", error);
            deleteDisabled = false;
        }
    }

    /**
     * Handle delete button click
     */
    async function handleDeleteClick(e: MouseEvent) {
        e.stopPropagation();
        closeContextMenu();
        await deleteSession();
    }

    function handleDeleteMouseDown(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();
    }

    function handleDeleteKeyDown(e: KeyboardEvent) {
        if (e.key !== "Enter") {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();
        void deleteSession();
    }

    /**
     * Start renaming
     */
    function startRename() {
        editName = primarySessionName;
        isRenaming = true;
        setTimeout(() => {
            inputRef?.focus();
            inputRef?.select();
        }, 0);
    }

    /**
     * Submit rename
     */
    function submitRename() {
        const newName = editName.trim();
        if (newName.length === 0 || newName === primarySessionName) {
            editName = primarySessionName;
            isRenaming = false;
            return;
        }
        onRename(newName);
        isRenaming = false;
    }

    function getInputSelectionRange() {
        if (
            !inputRef ||
            typeof inputRef.selectionStart !== "number" ||
            typeof inputRef.selectionEnd !== "number"
        ) {
            return undefined;
        }

        return {
            start: inputRef.selectionStart,
            end: inputRef.selectionEnd,
        };
    }

    function restoreInputSelection(cursorStart: number, cursorEnd = cursorStart) {
        requestAnimationFrame(() => {
            inputRef?.focus();
            inputRef?.setSelectionRange(cursorStart, cursorEnd);
        });
    }

    /**
     * Handle input keydown
     */
    async function handleInputKeyDown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            e.preventDefault();
            submitRename();
            return;
        }

        if (e.key === "Escape") {
            e.preventDefault();
            editName = primarySessionName;
            isRenaming = false;
            return;
        }

        const modifierPressed = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();

        if (!modifierPressed) {
            return;
        }

        if (key === "a") {
            e.preventDefault();
            e.stopPropagation();
            inputRef?.select();
            return;
        }

        if (key === "c" || key === "x") {
            e.preventDefault();
            e.stopPropagation();

            const selection = getInputSelectionRange();
            if (!selection || selection.start === selection.end) {
                return;
            }

            const selectedText = editName.slice(selection.start, selection.end);

            try {
                await navigator.clipboard.writeText(selectedText);
            } catch (error) {
                console.warn("Failed to write rename selection to clipboard:", error);
                return;
            }

            if (key === "x") {
                editName =
                    editName.slice(0, selection.start) +
                    editName.slice(selection.end);
                restoreInputSelection(selection.start);
            }

            return;
        }

        if (key === "v") {
            e.preventDefault();
            e.stopPropagation();

            let clipboardText = "";

            try {
                clipboardText = await navigator.clipboard.readText();
            } catch (error) {
                console.warn("Failed to read clipboard for rename input:", error);
                return;
            }

            const selection = getInputSelectionRange();
            if (!selection) {
                editName = clipboardText;
                return;
            }

            editName =
                editName.slice(0, selection.start) +
                clipboardText +
                editName.slice(selection.end);
            restoreInputSelection(selection.start + clipboardText.length);
        }
    }

    /**
     * Handle tab keydown for rename shortcut
     */
    function handleTabKeyDown(e: KeyboardEvent) {
        if (e.key === "F2" && !isRenaming) {
            e.preventDefault();
            startRename();
        }
    }
</script>

<div
    bind:this={tabRef}
    class="tab-button"
    class:tab-button--active={active}
    role="tab"
    tabindex={active ? 0 : -1}
    aria-selected={active}
    aria-controls="console-panel-{session.id}"
    aria-label={session.name}
    data-testid="console-tab-{session.id}"
    onclick={handleClick}
    onmousedown={handleMouseDown}
    oncontextmenu={(e) => e.preventDefault()}
    onkeydown={handleTabKeyDown}
>
    <div class="tab-header">
        <ConsoleInstanceState state={session.state} />

        <!-- Runtime icon using RuntimeIcon component -->
        <RuntimeIcon
            sessionMode="console"
            base64EncodedIconSvg={session.base64EncodedIconSvg}
        />

        {#if isRenaming}
            <input
                bind:this={inputRef}
                type="text"
                class="session-name-input"
                bind:value={editName}
                onblur={submitRename}
                onkeydown={handleInputKeyDown}
                onclick={(e) => e.stopPropagation()}
                onmousedown={(e) => e.stopPropagation()}
            />
        {:else}
            <!-- Positron style: Tab title is session label (rename target) -->
            <p class="session-name">
                {primarySessionName}
            </p>

            {#if width > MINIMUM_ACTION_TAB_WIDTH}
                <button
                    class="delete-button"
                    title="Delete Session"
                    data-testid="trash-session"
                    disabled={deleteDisabled}
                    onclick={handleDeleteClick}
                    onkeydown={handleDeleteKeyDown}
                    onmousedown={handleDeleteMouseDown}
                >
                    <span class="codicon codicon-trash"></span>
                </button>
            {/if}
        {/if}
    </div>

    <!-- Resource usage section (Positron pattern) -->
    {#if showResourceUsage}
        <div class="resource-usage-section">
            <ResourceUsageGraph
                data={resourceUsageHistory}
                width={graphWidth}
                height={RESOURCE_GRAPH_HEIGHT}
            />
            {#if latestResourceUsage}
                <ResourceUsageStats
                    cpuPercent={latestResourceUsage.cpu_percent}
                    memoryBytes={latestResourceUsage.memory_bytes}
                />
            {/if}
        </div>
    {/if}
</div>

{#if showContextMenu && tabRef}
    <ContextMenu
        entries={contextMenuEntries}
        anchorEl={tabRef}
        anchorPoint={{ x: contextMenuX, y: contextMenuY }}
        onclose={closeContextMenu}
    />
{/if}

<style>
    .tab-button {
        background-color: inherit;
        border-left: 1px solid transparent;
        color: var(--vscode-foreground);
        cursor: pointer;
        padding: 4px 10px;
        width: 100%;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
    }

    .tab-button:hover {
        background-color: var(--vscode-list-hoverBackground);
    }

    .tab-button:focus,
    .tab-button:focus-visible {
        outline: none;
    }

    .tab-button:focus-within:not(.tab-button--active) {
        background-color: var(--vscode-list-hoverBackground);
    }

    .tab-button--active {
        background-color: var(--vscode-list-inactiveSelectionBackground);
        border-left: 1px solid var(--vscode-panelTitle-activeBorder);
    }

    .tab-button--active:hover,
    .tab-button--active:focus-within {
        background-color: var(--vscode-list-activeSelectionBackground);
    }

    .tab-header {
        display: flex;
        align-items: center;
        height: 22px;
        width: 100%;
    }

    .session-name {
        flex: 1;
        margin: 0;
        line-height: 22px;
        overflow: hidden;
        min-width: 0;
        text-overflow: ellipsis;
    }

    .session-name-input {
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        color: var(--vscode-input-foreground);
        flex: 1;
        min-width: 0;
        box-sizing: border-box;
        width: 100%;
        height: 22px;
        margin: 0;
        padding: 0 4px;
        line-height: 20px;
        font: inherit;
    }

    .session-name-input:focus {
        border-color: var(--vscode-focusBorder);
    }

    .delete-button {
        display: none;
        background-color: transparent;
        border: none;
        cursor: pointer;
        height: 22px;
        padding: 2px;
        border-radius: 5px;
    }

    .tab-button:hover .delete-button,
    .tab-button:focus-within .delete-button {
        display: unset;
    }

    .delete-button:hover {
        background-color: var(--vscode-toolbar-hoverBackground);
    }

    .delete-button:focus {
        outline: 1px solid var(--vscode-focusBorder);
    }

    .delete-button .codicon {
        height: 15px;
        width: 15px;
        vertical-align: text-bottom;
    }

    .delete-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* Resource usage section (Positron pattern) */
    .resource-usage-section {
        width: 100%;
        margin-top: 4px;
        container-type: inline-size;
    }

</style>
