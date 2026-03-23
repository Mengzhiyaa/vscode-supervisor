<script lang="ts">
    /**
     * DropdownMenu - Reusable dropdown menu component
     * Used for grouping and sorting selection in Variables panel.
     */
    interface Option {
        id: string;
        label: string;
        icon?: string;
        separator?: boolean; // If true, render a separator line
        toggle?: boolean; // If true, this is a toggle item (checkbox style)
        checked?: boolean; // For toggle items
    }

    interface Props {
        icon: string;
        title: string;
        options: Option[];
        selected: string;
        onSelect: (id: string) => void;
        onToggle?: (id: string, checked: boolean) => void;
    }

    let { icon, title, options, selected, onSelect, onToggle }: Props =
        $props();
    let isOpen = $state(false);

    function handleSelect(option: Option) {
        if (option.toggle && onToggle) {
            onToggle(option.id, !option.checked);
        } else if (!option.separator) {
            onSelect(option.id);
        }
        if (!option.toggle) {
            isOpen = false;
        }
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            isOpen = false;
        }
    }

    function handleClickOutside(e: MouseEvent) {
        const target = e.target as HTMLElement;
        if (!target.closest(".dropdown")) {
            isOpen = false;
        }
    }

    $effect(() => {
        if (isOpen) {
            document.addEventListener("click", handleClickOutside);
            return () =>
                document.removeEventListener("click", handleClickOutside);
        }
    });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="dropdown" role="group" onkeydown={handleKeyDown}>
    <button
        class="dropdown-trigger"
        onclick={(e) => {
            e.stopPropagation();
            isOpen = !isOpen;
        }}
        {title}
        aria-haspopup="true"
        aria-expanded={isOpen}
    >
        <span class="codicon {icon}"></span>
        <span class="codicon codicon-chevron-down chevron"></span>
    </button>

    {#if isOpen}
        <div class="dropdown-menu" role="menu">
            {#each options as option (option.id)}
                {#if option.separator}
                    <div class="dropdown-separator"></div>
                {:else}
                    <button
                        class="dropdown-item"
                        class:selected={!option.toggle &&
                            option.id === selected}
                        onclick={() => handleSelect(option)}
                        role="menuitem"
                    >
                        {#if option.toggle}
                            <span
                                class="codicon {option.checked
                                    ? 'codicon-check'
                                    : ''}"
                            ></span>
                        {:else if option.icon}
                            <span class="codicon {option.icon}"></span>
                        {/if}
                        <span class="item-label">{option.label}</span>
                        {#if !option.toggle && option.id === selected}
                            <span class="codicon codicon-check"></span>
                        {/if}
                    </button>
                {/if}
            {/each}
        </div>
    {/if}
</div>

<style>
    .dropdown {
        position: relative;
        display: inline-block;
    }

    .dropdown-trigger {
        display: flex;
        align-items: center;
        gap: 2px;
        background: transparent;
        border: none;
        color: var(--vscode-foreground);
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 2px;
        height: 20px;
    }

    .dropdown-trigger:hover {
        background: var(--vscode-toolbar-hoverBackground);
    }

    .dropdown-trigger .chevron {
        font-size: 10px;
        opacity: 0.7;
    }

    .dropdown-menu {
        position: absolute;
        top: 100%;
        left: 0;
        z-index: 1000;
        min-width: 140px;
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        padding: 4px 0;
        margin-top: 2px;
    }

    .dropdown-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 6px 12px;
        background: transparent;
        border: none;
        color: var(--vscode-dropdown-foreground);
        cursor: pointer;
        text-align: left;
        font-size: 13px;
    }

    .dropdown-item:hover {
        background: var(--vscode-list-hoverBackground);
    }

    .dropdown-item.selected {
        background: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
    }

    .item-label {
        flex: 1;
    }

    .dropdown-item .codicon-check {
        font-size: 12px;
        opacity: 0.8;
    }

    .dropdown-separator {
        height: 1px;
        margin: 4px 8px;
        background: var(
            --vscode-menu-separatorBackground,
            var(--vscode-panel-border)
        );
    }
</style>
