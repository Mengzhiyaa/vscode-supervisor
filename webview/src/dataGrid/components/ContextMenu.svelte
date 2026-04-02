<!--
  ContextMenu.svelte - Positron-style context menu for the DataGrid
  Mirrors the keyboard and visual behavior of Positron's customContextMenu.
-->
<script lang="ts">
    import { onMount } from "svelte";
    import type { DataGridContextMenuItem } from "../classes/dataGridInstance";

    export type ContextMenuItem = DataGridContextMenuItem;

    interface Props {
        anchorElement?: HTMLElement | null;
        x: number;
        y: number;
        items: ContextMenuItem[];
        onClose: () => void;
    }

    let {
        anchorElement = null,
        x,
        y,
        items,
        onClose,
    }: Props = $props();

    let menuRef = $state<HTMLDivElement | null>(null);
    let menuStyle = $state("");
    let restoreFocus = $state(true);
    let focusTarget = $state<HTMLElement | null>(null);

    const directPositronIcons = new Set([
        "positron-add-filter",
        "positron-clear-row-filters",
        "positron-clear-sorting",
        "positron-hide-filters",
        "positron-show-filters",
    ]);

    const iconAliases: Record<string, string> = {
        "positron-select-column": "symbol-field",
        "positron-select-row": "list-selection",
        "positron-pin": "pin",
        "positron-unpin": "pinned",
    };

    function getIconClass(icon: string) {
        if (icon.startsWith("codicon-")) {
            return icon;
        }

        if (directPositronIcons.has(icon)) {
            return `codicon-${icon}`;
        }

        const alias = iconAliases[icon] ?? icon;
        return alias.startsWith("codicon-") ? alias : `codicon-${alias}`;
    }

    function getMenuItems(): HTMLButtonElement[] {
        if (!menuRef) {
            return [];
        }

        return Array.from(
            menuRef.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)"),
        );
    }

    function focusMenuItem(index: number) {
        const menuItems = getMenuItems();
        if (!menuItems.length) {
            menuRef?.focus();
            return;
        }

        const safeIndex = Math.max(0, Math.min(index, menuItems.length - 1));
        menuItems[safeIndex]?.focus();
    }

    function focusRelativeMenuItem(delta: number) {
        const menuItems = getMenuItems();
        if (!menuItems.length) {
            menuRef?.focus();
            return;
        }

        const activeElement =
            document.activeElement instanceof HTMLButtonElement
                ? document.activeElement
                : null;
        const currentIndex = activeElement ? menuItems.indexOf(activeElement) : -1;
        const nextIndex =
            currentIndex === -1
                ? delta >= 0
                    ? 0
                    : menuItems.length - 1
                : (currentIndex + delta + menuItems.length) % menuItems.length;

        menuItems[nextIndex]?.focus();
    }

    function updatePosition() {
        if (!menuRef) {
            return;
        }

        const viewportPadding = 8;
        const menuRect = menuRef.getBoundingClientRect();

        const left = Math.min(
            Math.max(x, viewportPadding),
            Math.max(
                viewportPadding,
                window.innerWidth - menuRect.width - viewportPadding,
            ),
        );
        const top = Math.min(
            Math.max(y, viewportPadding),
            Math.max(
                viewportPadding,
                window.innerHeight - menuRect.height - viewportPadding,
            ),
        );

        menuStyle = `top: ${Math.round(top)}px; left: ${Math.round(left)}px;`;
    }

    function isInsideAnchor(target: EventTarget | null): boolean {
        return !!anchorElement && target instanceof Node && anchorElement.contains(target);
    }

    function requestClose(options?: { restoreFocus?: boolean }) {
        restoreFocus = options?.restoreFocus ?? true;
        onClose();
    }

    function handleItemClick(item: ContextMenuItem) {
        if (item.disabled || item.separator) {
            return;
        }

        item.onClick?.();
        requestClose();
    }

    function handleOutsidePointer(event: MouseEvent) {
        if (menuRef?.contains(event.target as Node) || isInsideAnchor(event.target)) {
            return;
        }

        requestClose({ restoreFocus: false });
    }

    function handleKeyDown(event: KeyboardEvent) {
        switch (event.key) {
            case "Escape":
            case "ArrowLeft":
                event.preventDefault();
                event.stopPropagation();
                requestClose();
                break;

            case "ArrowDown":
                event.preventDefault();
                focusRelativeMenuItem(1);
                break;

            case "ArrowUp":
                event.preventDefault();
                focusRelativeMenuItem(-1);
                break;

            case "Home":
                event.preventDefault();
                focusMenuItem(0);
                break;

            case "End":
                event.preventDefault();
                focusMenuItem(Number.MAX_SAFE_INTEGER);
                break;

            case "Tab":
                requestClose({ restoreFocus: false });
                break;
        }
    }

    $effect(() => {
        if (anchorElement) {
            focusTarget = anchorElement;
        }
    });

    $effect(() => {
        if (!menuRef) {
            return;
        }

        updatePosition();

        const handleViewportChange = () => updatePosition();
        window.addEventListener("resize", handleViewportChange);
        window.addEventListener("scroll", handleViewportChange, true);

        return () => {
            window.removeEventListener("resize", handleViewportChange);
            window.removeEventListener("scroll", handleViewportChange, true);
        };
    });

    onMount(() => {
        if (menuRef && menuRef.parentElement !== document.body) {
            document.body.appendChild(menuRef);
        }

        document.addEventListener("mousedown", handleOutsidePointer, true);
        document.addEventListener("contextmenu", handleOutsidePointer, true);

        requestAnimationFrame(() => {
            updatePosition();
            focusMenuItem(0);
        });

        return () => {
            document.removeEventListener("mousedown", handleOutsidePointer, true);
            document.removeEventListener("contextmenu", handleOutsidePointer, true);

            if (menuRef?.parentElement) {
                menuRef.parentElement.removeChild(menuRef);
            }

            if (restoreFocus) {
                queueMicrotask(() => {
                    focusTarget?.focus();
                });
            }
        };
    });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={menuRef}
    class="data-grid-context-menu"
    style={menuStyle}
    onkeydown={handleKeyDown}
    role="menu"
    tabindex="-1"
>
    <div class="custom-context-menu-items">
        {#each items as item}
            {#if item.separator}
                <div class="menu-separator" role="separator"></div>
            {:else}
                {@const checkable = item.checked !== undefined}
                <button
                    class="menu-item"
                    class:checkable={checkable}
                    disabled={item.disabled}
                    role={checkable ? "menuitemcheckbox" : "menuitem"}
                    aria-checked={checkable ? item.checked : undefined}
                    onclick={() => handleItemClick(item)}
                >
                    {#if checkable}
                        <span class="check-slot" aria-hidden="true">
                            {#if item.checked}
                                <span class="codicon codicon-check"></span>
                            {/if}
                        </span>
                    {/if}

                    {#if item.icon}
                        <span
                            class="menu-icon codicon {getIconClass(item.icon)}"
                            aria-hidden="true"
                        ></span>
                    {:else if checkable}
                        <span class="menu-icon icon-placeholder" aria-hidden="true"></span>
                    {:else}
                        <span class="menu-icon icon-placeholder" aria-hidden="true"></span>
                    {/if}

                    <span class="menu-title">{item.label}</span>
                    <span class="shortcut">{item.shortcut ?? ""}</span>
                </button>
            {/if}
        {/each}
    </div>
</div>

<style>
    .data-grid-context-menu {
        position: fixed;
        z-index: 10000;
    }

    .custom-context-menu-items {
        min-width: 200px;
        max-width: 280px;
        padding: 4px;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        border-radius: 4px;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.12);
        border: 1px solid
            var(--vscode-positronContextMenu-border, var(--vscode-menu-border));
        background: var(
            --vscode-positronContextMenu-background,
            var(--vscode-menu-background)
        );
    }

    .menu-separator {
        height: 1px;
        margin: 4px 0;
        background: var(
            --vscode-positronContextMenu-separatorBackground,
            var(--vscode-menu-separatorBackground)
        );
    }

    .menu-item {
        width: 100%;
        height: 26px;
        border: none;
        display: grid;
        cursor: pointer;
        padding: 0 8px 0 6px;
        text-align: left;
        align-items: center;
        align-content: center;
        border-radius: 0;
        font: inherit;
        font-size: 12px;
        line-height: 16px;
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        color: var(
            --vscode-positronContextMenu-foreground,
            var(--vscode-menu-foreground)
        );
        grid-template-columns:
            [icon] 22px
            [title] 1fr
            [shortcut] min-content
            [end];
    }

    .menu-item.checkable {
        grid-template-columns:
            [check] 22px
            [icon] 22px
            [title] 1fr
            [shortcut] min-content
            [end];
    }

    .menu-item:hover:not(:disabled) {
        color: var(
            --vscode-positronContextMenu-hoverForeground,
            var(--vscode-menu-selectionForeground)
        );
        background: var(
            --vscode-positronContextMenu-hoverBackground,
            var(--vscode-menu-selectionBackground)
        );
    }

    .menu-item:hover:not(:disabled),
    .menu-item:focus-visible {
        border-radius: 4px;
    }

    .menu-item:focus {
        outline: none !important;
    }

    .menu-item:focus-visible {
        outline: 1px solid var(--vscode-focusBorder) !important;
    }

    .menu-item:not(:disabled):focus-visible {
        background: var(
            --vscode-positronContextMenu-hoverBackground,
            var(--vscode-menu-selectionBackground)
        );
    }

    .menu-item:disabled {
        cursor: default;
    }

    .menu-item:disabled .menu-title,
    .menu-item:disabled .menu-icon,
    .menu-item:disabled .check-slot {
        opacity: 50%;
    }

    .check-slot {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        grid-column: check / icon;
    }

    .menu-icon {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        grid-column: icon / title;
    }

    .menu-icon.icon-placeholder {
        font-size: 0;
    }

    .menu-title {
        display: block;
        max-width: 100%;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        margin: 2px 0;
        grid-column: title / shortcut;
    }

    .shortcut {
        padding-inline: 10px;
        white-space: nowrap;
        grid-column: shortcut / end;
    }
</style>
