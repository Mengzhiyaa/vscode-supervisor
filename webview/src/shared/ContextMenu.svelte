<!--
  ContextMenu.svelte
  Overflow context menu for DynamicActionBar.
  Anchors to a reference element and renders overflow actions.
-->
<script lang="ts">
    import { onMount } from 'svelte';
    import '../shared/actionBar.css';

    export interface ContextMenuItem {
        id?: string;
        label: string;
        icon?: string;
        checked?: boolean;
        disabled?: boolean;
        onSelected: () => void;
    }

    export interface ContextMenuSeparator {
        separator: true;
    }

    export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

    function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
        return 'separator' in entry && entry.separator === true;
    }

    interface Props {
        entries: ContextMenuEntry[];
        anchorEl: HTMLElement | null;
        anchorPoint?: { x: number; y: number } | null;
        onclose: (options?: { restoreFocus?: boolean }) => void;
        align?: 'left' | 'right';
        initialFocus?: 'first' | 'last';
    }

    let {
        entries,
        anchorEl,
        anchorPoint = null,
        onclose,
        align = 'left',
        initialFocus = 'first',
    }: Props = $props();

    let menuEl = $state<HTMLDivElement | null>(null);
    let menuStyle = $state('');
    let restoreFocus = $state(true);

    const directPositronIcons = new Set([
        'positron-add-filter',
        'positron-clear-row-filters',
        'positron-clear-sorting',
        'positron-hide-filters',
        'positron-show-filters',
    ]);

    const iconAliases: Record<string, string> = {
    };

    function getIconClass(icon: string) {
        if (icon.startsWith('codicon-')) {
            return icon;
        }

        if (directPositronIcons.has(icon)) {
            return `codicon-${icon}`;
        }

        const alias = iconAliases[icon] ?? icon;
        return alias.startsWith('codicon-') ? alias : `codicon-${alias}`;
    }

    function getMenuItems(): HTMLButtonElement[] {
        if (!menuEl) {
            return [];
        }

        return Array.from(
            menuEl.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)'),
        );
    }

    function focusMenuItem(index: number) {
        const items = getMenuItems();
        if (!items.length) {
            menuEl?.focus();
            return;
        }

        const safeIndex = Math.max(0, Math.min(index, items.length - 1));
        items[safeIndex]?.focus();
    }

    function focusInitialMenuItem() {
        focusMenuItem(
            initialFocus === 'last' ? Number.MAX_SAFE_INTEGER : 0,
        );
    }

    function focusRelativeMenuItem(delta: number) {
        const items = getMenuItems();
        if (!items.length) {
            menuEl?.focus();
            return;
        }

        const activeElement =
            document.activeElement instanceof HTMLButtonElement
                ? document.activeElement
                : null;
        const currentIndex = activeElement ? items.indexOf(activeElement) : -1;
        const nextIndex =
            currentIndex === -1
                ? delta >= 0
                    ? 0
                    : items.length - 1
                : (currentIndex + delta + items.length) % items.length;

        items[nextIndex]?.focus();
    }

    function updatePosition() {
        if (!menuEl) {
            return;
        }

        const viewportPadding = 8;
        const anchorRect = anchorEl?.getBoundingClientRect();
        const menuRect = menuEl.getBoundingClientRect();

        const baseLeft = anchorPoint
            ? anchorPoint.x
            : align === 'right'
              ? (anchorRect?.right ?? 0) - menuRect.width
              : (anchorRect?.left ?? 0);
        const baseTop = anchorPoint
            ? anchorPoint.y
            : (anchorRect?.bottom ?? 0) + 2;

        let left = baseLeft;
        let top = baseTop;

        left = Math.min(
            Math.max(left, viewportPadding),
            Math.max(viewportPadding, window.innerWidth - menuRect.width - viewportPadding),
        );
        top = Math.min(
            Math.max(top, viewportPadding),
            Math.max(viewportPadding, window.innerHeight - menuRect.height - viewportPadding),
        );

        menuStyle = `top: ${Math.round(top)}px; left: ${Math.round(left)}px;`;
    }

    function isInsideAnchor(target: EventTarget | null): boolean {
        return !!anchorEl && target instanceof Node && anchorEl.contains(target);
    }

    function requestClose(options?: { restoreFocus?: boolean }) {
        restoreFocus = options?.restoreFocus ?? true;
        onclose(options);
    }

    function handleOutsidePointer(event: MouseEvent) {
        if (menuEl?.contains(event.target as Node) || isInsideAnchor(event.target)) {
            return;
        }

        requestClose({ restoreFocus: false });
    }

    $effect(() => {
        document.addEventListener('mousedown', handleOutsidePointer, true);
        document.addEventListener('contextmenu', handleOutsidePointer, true);
        return () => {
            document.removeEventListener('mousedown', handleOutsidePointer, true);
            document.removeEventListener('contextmenu', handleOutsidePointer, true);
        };
    });

    $effect(() => {
        if (!menuEl) {
            return;
        }

        updatePosition();
        const handleViewportChange = () => updatePosition();

        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);

        return () => {
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
        };
    });

    // Close on Escape
    function handleKeydown(event: KeyboardEvent) {
        switch (event.key) {
            case 'Escape':
            case 'ArrowLeft':
                event.preventDefault();
                event.stopPropagation();
                requestClose();
                break;
            case 'ArrowDown':
                event.preventDefault();
                focusRelativeMenuItem(1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                focusRelativeMenuItem(-1);
                break;
            case 'Home':
                event.preventDefault();
                focusMenuItem(0);
                break;
            case 'End':
                event.preventDefault();
                focusMenuItem(Number.MAX_SAFE_INTEGER);
                break;
            case 'Tab':
                requestClose({ restoreFocus: false });
                break;
        }
    }

    onMount(() => {
        if (menuEl && menuEl.parentElement !== document.body) {
            document.body.appendChild(menuEl);
        }

        requestAnimationFrame(() => {
            updatePosition();
            focusInitialMenuItem();
        });

        return () => {
            if (menuEl?.parentElement) {
                menuEl.parentElement.removeChild(menuEl);
            }

            if (restoreFocus) {
                queueMicrotask(() => {
                    anchorEl?.focus();
                });
            }
        };
    });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={menuEl}
    class="action-bar-context-menu"
    style={menuStyle}
    onkeydown={handleKeydown}
    role="menu"
    tabindex="-1"
>
    {#each entries as entry}
        {#if isSeparator(entry)}
            <div class="menu-separator"></div>
        {:else}
            {@const checkable = entry.checked !== undefined}
            <button
                class="menu-item"
                class:checkable={checkable}
                disabled={entry.disabled}
                type="button"
                role={checkable ? 'menuitemcheckbox' : 'menuitem'}
                aria-checked={checkable ? entry.checked : undefined}
                onclick={() => {
                    if (!entry.disabled) {
                        entry.onSelected();
                        requestClose();
                    }
                }}
            >
                {#if checkable}
                    <span class="check-slot" aria-hidden="true">
                        {#if entry.checked}
                            <span class="codicon codicon-check"></span>
                        {/if}
                    </span>
                {/if}

                {#if entry.icon}
                    <span
                        class="menu-icon codicon {getIconClass(entry.icon)}"
                        aria-hidden="true"
                    ></span>
                {:else}
                    <span class="menu-icon icon-placeholder" aria-hidden="true"></span>
                {/if}

                <span class="menu-title">{entry.label}</span>
            </button>
        {/if}
    {/each}
</div>

<style>
    .action-bar-context-menu {
        position: fixed;
    }
</style>
