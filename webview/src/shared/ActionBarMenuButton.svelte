<!--
  ActionBarMenuButton.svelte
  Menu button with optional icon, label, and dropdown chevron.
  Corresponds to Positron's ActionBarMenuButton.
-->
<script lang="ts">
    import '../shared/actionBar.css';
    import ContextMenu, {
        type ContextMenuEntry,
    } from './ContextMenu.svelte';

    interface MenuItem {
        id: string;
        label: string;
        icon?: string;
        checked?: boolean;
        disabled?: boolean;
        separator?: boolean;
        onSelected?: () => void;
    }

    interface Props {
        icon?: string;
        label?: string;
        tooltip?: string;
        ariaLabel?: string;
        disabled?: boolean;
        align?: 'left' | 'right';
        buttonClass?: string;
        actions: () => MenuItem[];
    }

    let {
        icon,
        label,
        tooltip,
        ariaLabel,
        disabled = false,
        align = 'left',
        buttonClass = '',
        actions,
    }: Props = $props();

    let menuVisible = $state(false);
    let buttonEl = $state<HTMLButtonElement | null>(null);
    let suppressClick = $state(false);
    let initialFocus = $state<'first' | 'last'>('first');

    function buildMenuEntries(): ContextMenuEntry[] {
        return actions().map((item) =>
            item.separator
                ? { separator: true }
                : {
                      id: item.id,
                      label: item.label,
                      icon: item.icon,
                      checked: item.checked,
                      disabled: item.disabled,
                      onSelected: () => selectItem(item),
                  },
        );
    }

    function toggleMenu(nextInitialFocus: 'first' | 'last' = 'first') {
        if (disabled) return;

        const entries = buildMenuEntries();
        if (
            !entries.some(
                (entry) => !('separator' in entry && entry.separator),
            )
        ) {
            return;
        }

        initialFocus = nextInitialFocus;
        menuVisible = !menuVisible;
    }

    function handleMouseDown(event: MouseEvent) {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        suppressClick = true;
        toggleMenu();
    }

    function handleClick(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        if (suppressClick) {
            suppressClick = false;
            return;
        }

        toggleMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
        switch (event.key) {
            case 'Enter':
            case ' ':
            case 'ArrowDown':
                event.preventDefault();
                event.stopPropagation();
                suppressClick = true;
                if (!menuVisible) {
                    toggleMenu('first');
                }
                break;
            case 'ArrowUp':
                event.preventDefault();
                event.stopPropagation();
                suppressClick = true;
                if (!menuVisible) {
                    toggleMenu('last');
                }
                break;
            case 'Escape':
                if (!menuVisible) {
                    break;
                }
                event.preventDefault();
                event.stopPropagation();
                menuVisible = false;
                break;
        }
    }

    function selectItem(item: MenuItem) {
        if (item.disabled) return;
        item.onSelected?.();
        menuVisible = false;
    }

    function closeMenu(options?: { restoreFocus?: boolean }) {
        menuVisible = false;

        if (options?.restoreFocus !== false) {
            queueMicrotask(() => {
                buttonEl?.focus();
            });
        }
    }
</script>

<div class="menu-button-container">
    <button
        bind:this={buttonEl}
        type="button"
        class={`action-bar-button action-bar-menu-button ${buttonClass}`.trim()}
        class:has-label={!!label}
        {disabled}
        title={tooltip || ariaLabel || label || ''}
        aria-label={ariaLabel || label || ''}
        aria-expanded={menuVisible ? "true" : undefined}
        aria-haspopup="menu"
        onmousedown={handleMouseDown}
        onclick={handleClick}
        onkeydown={handleKeyDown}
    >
        <div aria-hidden="true" class="action-bar-button-face">
            {#if icon}
                <span
                    class="action-bar-button-icon action-bar-menu-icon codicon codicon-{icon}"
                ></span>
            {/if}
            {#if label}
                <span
                    class="action-bar-button-label menu-label"
                    style:margin-left={icon ? '0' : '4px'}
                >
                    {label}
                </span>
            {/if}
            <span class="action-bar-button-drop-down-container action-bar-menu-drop-down-container">
                <span
                    class="action-bar-button-drop-down-arrow action-bar-menu-drop-down-arrow codicon codicon-positron-drop-down-arrow"
                ></span>
            </span>
        </div>
    </button>

    {#if menuVisible && buttonEl}
        <ContextMenu
            entries={buildMenuEntries()}
            anchorEl={buttonEl}
            {align}
            {initialFocus}
            onclose={closeMenu}
        />
    {/if}
</div>

<style>
    .menu-button-container {
        display: flex;
        min-width: 0;
    }
</style>
