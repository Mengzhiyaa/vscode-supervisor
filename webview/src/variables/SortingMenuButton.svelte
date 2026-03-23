<!--
  SortingMenuButton.svelte
  1:1 Positron replication - Menu button for variable sorting options
-->
<script lang="ts">
    import type { VariablesSorting } from "../types/variables";

    // Props using Svelte 5 runes
    interface Props {
        currentSorting?: VariablesSorting;
        highlightRecent?: boolean;
        onselectSorting?: (sorting: VariablesSorting) => void;
        ontoggleHighlightRecent?: () => void;
    }

    let {
        currentSorting = "name",
        highlightRecent = false,
        onselectSorting,
        ontoggleHighlightRecent,
    }: Props = $props();

    const tooltip = "Change how variables are sorted";

    const sortingLabels: Record<VariablesSorting, string> = {
        name: "Name",
        size: "Size",
        recent: "Recent",
    };

    const sortings: VariablesSorting[] = ["name", "size", "recent"];

    let menuOpen = $state(false);

    function toggleMenu() {
        menuOpen = !menuOpen;
    }

    function selectSorting(sorting: VariablesSorting) {
        onselectSorting?.(sorting);
        menuOpen = false;
    }

    function toggleHighlightRecent() {
        ontoggleHighlightRecent?.();
        menuOpen = false;
    }

    function handleClickOutside(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (!target.closest(".sorting-menu")) {
            menuOpen = false;
        }
    }
</script>

<svelte:window onclick={handleClickOutside} />

<div class="sorting-menu">
    <button
        class="action-bar-menu-button"
        title={tooltip}
        aria-label={tooltip}
        onclick={(e) => {
            e.stopPropagation();
            toggleMenu();
        }}
    >
        <span class="codicon codicon-positron-variables-sorting"></span>
    </button>

    {#if menuOpen}
        <div class="menu-dropdown">
            {#each sortings as sorting}
                <button
                    class="menu-item"
                    class:checked={currentSorting === sorting}
                    onclick={() => selectSorting(sorting)}
                >
                    {#if currentSorting === sorting}
                        <span class="codicon codicon-check"></span>
                    {:else}
                        <span class="check-placeholder"></span>
                    {/if}
                    <span class="label">{sortingLabels[sorting]}</span>
                </button>
            {/each}

            <div class="menu-separator"></div>

            <button
                class="menu-item"
                class:checked={highlightRecent}
                onclick={toggleHighlightRecent}
            >
                {#if highlightRecent}
                    <span class="codicon codicon-check"></span>
                {:else}
                    <span class="check-placeholder"></span>
                {/if}
                <span class="label">Highlight recent values</span>
            </button>
        </div>
    {/if}
</div>

<style>
    .sorting-menu {
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
        min-width: 160px;
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
