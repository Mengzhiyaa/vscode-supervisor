<!--
  GroupingMenuButton.svelte
  1:1 Positron replication - Menu button for variable grouping options
-->
<script lang="ts">
    import type { VariablesGrouping } from "../types/variables";

    // Props using Svelte 5 runes
    interface Props {
        currentGrouping?: VariablesGrouping;
        onselectGrouping?: (grouping: VariablesGrouping) => void;
    }

    let { currentGrouping = "none", onselectGrouping }: Props = $props();

    const tooltip = "Change how variables are grouped";

    const groupingLabels: Record<VariablesGrouping, string> = {
        none: "None",
        kind: "Kind",
        size: "Size",
    };

    const groupings: VariablesGrouping[] = ["none", "kind", "size"];

    let menuOpen = $state(false);

    function toggleMenu() {
        menuOpen = !menuOpen;
    }

    function selectGrouping(grouping: VariablesGrouping) {
        onselectGrouping?.(grouping);
        menuOpen = false;
    }

    function handleClickOutside(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (!target.closest(".grouping-menu")) {
            menuOpen = false;
        }
    }
</script>

<svelte:window onclick={handleClickOutside} />

<div class="grouping-menu">
    <button
        class="action-bar-menu-button"
        title={tooltip}
        aria-label={tooltip}
        onclick={(e) => {
            e.stopPropagation();
            toggleMenu();
        }}
    >
        <span class="codicon codicon-positron-variables-grouping"></span>
    </button>

    {#if menuOpen}
        <div class="menu-dropdown">
            {#each groupings as grouping, index}
                {#if index === 1}
                    <div class="menu-separator"></div>
                {/if}
                <button
                    class="menu-item"
                    class:checked={currentGrouping === grouping}
                    onclick={() => selectGrouping(grouping)}
                >
                    {#if currentGrouping === grouping}
                        <span class="codicon codicon-check"></span>
                    {:else}
                        <span class="check-placeholder"></span>
                    {/if}
                    <span class="label">{groupingLabels[grouping]}</span>
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
    .grouping-menu {
        position: relative;
    }

    .action-bar-menu-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        color: var(--vscode-icon-foreground);
        cursor: pointer;
        border-radius: 4px;
    }

    .action-bar-menu-button:hover {
        background-color: var(--vscode-toolbar-hoverBackground);
    }

    .menu-dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        z-index: 1000;
        min-width: 100px;
        background-color: var(--vscode-menu-background);
        border: 1px solid var(--vscode-menu-border);
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        padding: 4px 0;
    }

    .menu-separator {
        height: 1px;
        background-color: var(--vscode-menu-separatorBackground);
        margin: 4px 0;
    }

    .menu-item {
        display: flex;
        align-items: center;
        width: 100%;
        padding: 6px 12px;
        border: none;
        background: transparent;
        color: var(--vscode-menu-foreground);
        cursor: pointer;
        text-align: left;
        gap: 8px;
    }

    .menu-item:hover {
        background-color: var(--vscode-menu-selectionBackground);
        color: var(--vscode-menu-selectionForeground);
    }

    .check-placeholder {
        width: 16px;
    }

    .codicon-check {
        font-size: 14px;
    }
</style>
