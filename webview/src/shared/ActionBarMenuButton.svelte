<!--
  ActionBarMenuButton.svelte
  Menu button with optional icon, label, and dropdown chevron.
  Corresponds to Positron's ActionBarMenuButton.
-->
<script lang="ts">
    import ContextMenu, { type ContextMenuEntry } from './ContextMenu.svelte';

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
        dropdownIndicator?: 'enabled' | 'enabled-split';
        dropdownTooltip?: string;
        dropdownAriaLabel?: string;
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
        dropdownIndicator = 'enabled',
        dropdownTooltip,
        dropdownAriaLabel,
        disabled = false,
        align = 'left',
        buttonClass = '',
        actions,
    }: Props = $props();

    let menuVisible = $state(false);
    let buttonEl = $state<HTMLButtonElement | null>(null);
    let dropdownButtonEl = $state<HTMLButtonElement | null>(null);
    let suppressClick = $state(false);
    let initialFocus = $state<'first' | 'last'>('first');
    const split = $derived(dropdownIndicator === 'enabled-split');
    const menuAnchor = $derived(split ? dropdownButtonEl : buttonEl);

    function runDefaultAction() {
        if (disabled) return;

        // Positron repeats the checked action, falling back to the first action.
        const items = actions().filter((item) => !item.separator);
        const item = items.find((item) => item.checked) ?? items[0];
        if (item) selectItem(item);
    }

    function activate(primary: boolean) {
        if (primary) runDefaultAction();
        else toggleMenu();
    }

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
        if (!entries.some((entry) => !('separator' in entry && entry.separator))) {
            return;
        }

        initialFocus = nextInitialFocus;
        menuVisible = !menuVisible;
    }

    function handleMouseDown(event: MouseEvent, primary = false) {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        suppressClick = true;
        activate(primary);
    }

    function handleClick(event: MouseEvent, primary = false) {
        event.preventDefault();
        event.stopPropagation();

        if (suppressClick) {
            suppressClick = false;
            return;
        }

        activate(primary);
    }

    function handleKeyDown(event: KeyboardEvent, primary = false) {
        switch (event.key) {
            case 'Enter':
            case ' ':
            case 'ArrowDown':
                event.preventDefault();
                event.stopPropagation();
                suppressClick = true;
                if (primary && event.key !== 'ArrowDown') {
                    runDefaultAction();
                } else if (!menuVisible) {
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
                menuAnchor?.focus();
            });
        }
    }
</script>

{#snippet dropdownFace()}
    <span
        aria-hidden="true"
        class="action-bar-button-drop-down-container action-bar-menu-drop-down-container"
    >
        <span
            class="action-bar-button-drop-down-arrow action-bar-menu-drop-down-arrow codicon codicon-positron-drop-down-arrow"
        ></span>
    </span>
{/snippet}

<div class="menu-button-container" class:split>
    <button
        bind:this={buttonEl}
        type="button"
        class={`action-bar-button action-bar-menu-button ${buttonClass}`.trim()}
        class:has-label={!!label}
        {disabled}
        title={tooltip || ariaLabel || label || ''}
        aria-label={ariaLabel || label || ''}
        aria-expanded={!split && menuVisible ? 'true' : undefined}
        aria-haspopup={split ? undefined : 'menu'}
        onmousedown={(event) => handleMouseDown(event, split)}
        onclick={(event) => handleClick(event, split)}
        onkeydown={(event) => handleKeyDown(event, split)}
    >
        <div aria-hidden="true" class="action-bar-button-face">
            {#if icon}
                <span class="action-bar-button-icon action-bar-menu-icon codicon codicon-{icon}"
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
            {#if !split}
                {@render dropdownFace()}
            {/if}
        </div>
    </button>

    {#if split}
        <button
            bind:this={dropdownButtonEl}
            type="button"
            class={`action-bar-button action-bar-menu-button ${buttonClass}`.trim()}
            {disabled}
            title={dropdownTooltip || tooltip || ariaLabel || label || ''}
            aria-label={dropdownAriaLabel || ariaLabel || label || ''}
            aria-expanded={menuVisible ? 'true' : undefined}
            aria-haspopup="menu"
            onmousedown={(event) => handleMouseDown(event)}
            onclick={(event) => handleClick(event)}
            onkeydown={(event) => handleKeyDown(event)}
        >
            {@render dropdownFace()}
        </button>
    {/if}

    {#if menuVisible && menuAnchor}
        <ContextMenu
            entries={buildMenuEntries()}
            anchorEl={menuAnchor}
            {align}
            {initialFocus}
            onclose={closeMenu}
        />
    {/if}
</div>

