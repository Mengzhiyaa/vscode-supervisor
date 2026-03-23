<script lang="ts">
    /**
     * ContextMenu.svelte
     * Reusable context menu component matching Positron's behavior.
     */
    import { onMount } from "svelte";

    interface MenuItem {
        id: string;
        label: string;
        icon?: string;
        separator?: boolean;
        disabled?: boolean;
        checked?: boolean;
    }

    interface Props {
        items: MenuItem[];
        position: { x: number; y: number };
        onSelect: (id: string) => void;
        onClose: () => void;
    }

    let { items, position, onSelect, onClose }: Props = $props();

    let menuRef = $state<HTMLDivElement | undefined>();

    // Adjust position to keep menu in viewport
    const adjustedPosition = $derived.by(() => {
        if (!menuRef) return position;

        const rect = menuRef.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let x = position.x;
        let y = position.y;

        // Adjust horizontal position
        if (x + rect.width > viewportWidth) {
            x = viewportWidth - rect.width - 4;
        }

        // Adjust vertical position
        if (y + rect.height > viewportHeight) {
            y = viewportHeight - rect.height - 4;
        }

        return { x: Math.max(4, x), y: Math.max(4, y) };
    });

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        }
    }

    function handleItemClick(item: MenuItem) {
        if (item.disabled || item.separator) return;
        onSelect(item.id);
        onClose();
    }

    onMount(() => {
        // Focus the menu for keyboard events
        menuRef?.focus();

        // Close on outside click
        function handleClickOutside(e: MouseEvent) {
            if (menuRef && !menuRef.contains(e.target as Node)) {
                onClose();
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        return () =>
            document.removeEventListener("mousedown", handleClickOutside);
    });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
    class="context-menu-overlay"
    role="menu"
    tabindex="0"
    onkeydown={handleKeyDown}
>
    <div
        class="context-menu"
        bind:this={menuRef}
        style="left: {adjustedPosition.x}px; top: {adjustedPosition.y}px;"
    >
        {#each items as item (item.id)}
            {#if item.separator}
                <div class="menu-separator"></div>
            {:else}
                <button
                    class="menu-item"
                    class:disabled={item.disabled}
                    class:checked={item.checked}
                    disabled={item.disabled}
                    onclick={() => handleItemClick(item)}
                    role="menuitem"
                >
                    {#if item.icon}
                        <span class="menu-icon codicon {item.icon}"></span>
                    {:else}
                        <span class="menu-icon-placeholder"></span>
                    {/if}
                    <span class="menu-label">{item.label}</span>
                    {#if item.checked}
                        <span class="menu-check codicon codicon-check"></span>
                    {/if}
                </button>
            {/if}
        {/each}
    </div>
</div>

<style>
    .context-menu-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
    }

    .context-menu {
        position: absolute;
        min-width: 160px;
        max-width: 300px;
        background: var(--vscode-menu-background);
        border: 1px solid var(--vscode-menu-border);
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        padding: 4px 0;
        z-index: 1001;
    }

    .menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 4px 12px;
        border: none;
        background: transparent;
        color: var(--vscode-menu-foreground);
        font-size: 13px;
        text-align: left;
        cursor: pointer;
    }

    .menu-item:hover:not(.disabled) {
        background: var(--vscode-menu-selectionBackground);
        color: var(--vscode-menu-selectionForeground);
    }

    .menu-item.disabled {
        opacity: 0.5;
        cursor: default;
    }

    .menu-icon {
        width: 16px;
        font-size: 14px;
    }

    .menu-icon-placeholder {
        width: 16px;
    }

    .menu-label {
        flex: 1;
    }

    .menu-check {
        font-size: 12px;
    }

    .menu-separator {
        height: 1px;
        background: var(--vscode-menu-separatorBackground);
        margin: 4px 0;
    }
</style>
