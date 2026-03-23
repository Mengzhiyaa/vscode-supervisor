<script lang="ts">
    /**
     * ConsoleTabList.svelte - Session sidebar with tabs
     * Based on Positron's ConsoleTabList in consoleTabList.tsx
     */
    import type { ConsoleState } from "../types/console";
    import ConsoleTab from "./ConsoleTab.svelte";

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
        sessions = [],
        activeSessionId,
        width = 200,
        height = 400,
        resourceUsageBySession = new Map<string, any>(),
        onSelectSession,
        onDeleteSession,
        onRenameSession,
    }: {
        sessions: SessionInfo[];
        activeSessionId: string | undefined;
        width: number;
        height: number;
        resourceUsageBySession: Map<string, any>;
        onSelectSession: (sessionId: string) => void;
        onDeleteSession: (sessionId: string) => void;
        onRenameSession: (sessionId: string, newName: string) => void;
    } = $props();

    // Refs
    let tabListRef: HTMLDivElement;
    let showResourceMonitor = $state(true);

    // Sort sessions by creation order (we use id as a proxy for now)
    // In practice, sessions should have a createdTimestamp
    $effect(() => {
        // Sessions are already sorted from backend
    });

    /**
     * Handle session selection
     */
    function handleSelectSession(sessionId: string) {
        onSelectSession(sessionId);
    }

    /**
     * Handle session deletion
     */
    function handleDeleteSession(sessionId: string) {
        onDeleteSession(sessionId);
    }

    /**
     * Handle session rename
     */
    function handleRenameSession(sessionId: string, newName: string) {
        onRenameSession(sessionId, newName);
    }

    /**
     * Handle keyboard navigation
     */
    function handleKeyDown(e: KeyboardEvent) {
        if (sessions.length === 0) return;

        const activeIndex = sessions.findIndex((s) => s.id === activeSessionId);
        let newIndex = activeIndex;

        switch (e.code) {
            case "ArrowDown":
                e.preventDefault();
                e.stopPropagation();
                newIndex = Math.min(sessions.length - 1, activeIndex + 1);
                break;
            case "ArrowUp":
                e.preventDefault();
                e.stopPropagation();
                newIndex = Math.max(0, activeIndex - 1);
                break;
            case "Home":
                e.preventDefault();
                e.stopPropagation();
                newIndex = 0;
                break;
            case "End":
                e.preventDefault();
                e.stopPropagation();
                newIndex = sessions.length - 1;
                break;
            default:
                return;
        }

        if (
            newIndex !== activeIndex &&
            newIndex >= 0 &&
            newIndex < sessions.length
        ) {
            const session = sessions[newIndex];
            handleSelectSession(session.id);

            // Focus the new tab
            setTimeout(() => {
                const tabElements = tabListRef?.children;
                if (tabElements && tabElements[newIndex]) {
                    (tabElements[newIndex] as HTMLElement).focus();
                }
            }, 0);
        }
    }
</script>

<div
    bind:this={tabListRef}
    class="tabs-container"
    role="tablist"
    aria-orientation="vertical"
    style="height: {height}px; width: {width}px;"
    tabindex="0"
    onkeydown={handleKeyDown}
>
    {#each sessions as session (session.id)}
        <ConsoleTab
            {session}
            active={session.id === activeSessionId}
            {width}
            resourceUsageHistory={resourceUsageBySession.get(session.id) || []}
            {showResourceMonitor}
            onSelect={() => handleSelectSession(session.id)}
            onDelete={() => handleDeleteSession(session.id)}
            onRename={(newName) => handleRenameSession(session.id, newName)}
            onToggleResourceMonitor={() =>
                (showResourceMonitor = !showResourceMonitor)}
        />
    {/each}

    {#if sessions.length === 0}
        <div class="no-sessions">
            <p>No sessions</p>
        </div>
    {/if}
</div>

<style>
    .tabs-container {
        border-top: 1px solid var(--vscode-positronActionBar-border);
        background-color: var(--vscode-tab-inactiveBackground);
        flex-grow: 1;
        overflow-y: auto;
    }

    .tabs-container:focus {
        outline: none;
    }

    .no-sessions {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
    }

    .no-sessions p {
        margin: 0;
        font-size: 12px;
    }
</style>
