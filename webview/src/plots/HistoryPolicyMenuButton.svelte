<!--
  HistoryPolicyMenuButton.svelte
  Menu button for plot history visibility policy and position
-->
<script lang="ts">
    import { tick } from "svelte";
    import { HistoryPolicy, HistoryPosition } from "./types";

    // Props using Svelte 5 runes
    interface Props {
        currentPolicy?: HistoryPolicy;
        currentPosition?: HistoryPosition;
        onselectPolicy?: (policy: HistoryPolicy) => void;
        onselectPosition?: (position: HistoryPosition) => void;
    }

    let {
        currentPolicy = HistoryPolicy.Automatic,
        currentPosition = HistoryPosition.Auto,
        onselectPolicy,
        onselectPosition,
    }: Props = $props();

    // Policy labels (matching Positron's localized strings)
    const policyLabels: Record<HistoryPolicy, string> = {
        [HistoryPolicy.AlwaysVisible]: "Always",
        [HistoryPolicy.Automatic]: "Auto",
        [HistoryPolicy.NeverVisible]: "Never",
    };

    // Position labels
    const positionLabels: Record<HistoryPosition, string> = {
        [HistoryPosition.Auto]: "Auto",
        [HistoryPosition.Bottom]: "Bottom",
        [HistoryPosition.Right]: "Right",
    };

    const tooltip = "Set plot history visibility and position";
    const policies: HistoryPolicy[] = [
        HistoryPolicy.AlwaysVisible,
        HistoryPolicy.Automatic,
        HistoryPolicy.NeverVisible,
    ];

    const positions: HistoryPosition[] = [
        HistoryPosition.Auto,
        HistoryPosition.Bottom,
        HistoryPosition.Right,
    ];

    let menuOpen = $state(false);
    let focusedItemIndex = $state(0);
    // svelte-ignore non_reactive_update
    let menuButtonElement: HTMLButtonElement | undefined;
    // svelte-ignore non_reactive_update
    let menuDropdownElement: HTMLDivElement | undefined;

    const totalMenuItems = policies.length + positions.length;

    function getDefaultFocusedIndex() {
        const selectedPolicyIndex = policies.indexOf(currentPolicy);
        return selectedPolicyIndex >= 0 ? selectedPolicyIndex : 0;
    }

    async function focusMenuItem(index: number) {
        focusedItemIndex = index;
        await tick();
        const menuItem = menuDropdownElement?.querySelector<HTMLButtonElement>(
            `[data-menu-index="${index}"]`,
        );
        menuItem?.focus();
    }

    function openMenu(preferredIndex?: number) {
        if (menuOpen) {
            return;
        }

        menuOpen = true;
        const nextIndex = preferredIndex ?? getDefaultFocusedIndex();
        void focusMenuItem(nextIndex);
    }

    function closeMenu(restoreFocus = true) {
        if (!menuOpen) {
            return;
        }

        menuOpen = false;
        if (restoreFocus) {
            void tick().then(() => menuButtonElement?.focus());
        }
    }

    function toggleMenu() {
        if (menuOpen) {
            closeMenu(false);
            return;
        }
        openMenu();
    }

    function moveFocus(offset: number) {
        const nextIndex =
            (focusedItemIndex + offset + totalMenuItems) % totalMenuItems;
        void focusMenuItem(nextIndex);
    }

    function focusFirstItem() {
        void focusMenuItem(0);
    }

    function focusLastItem() {
        void focusMenuItem(totalMenuItems - 1);
    }

    function activateFocusedItem() {
        if (focusedItemIndex < policies.length) {
            selectPolicy(policies[focusedItemIndex]);
            return;
        }

        const positionIndex = focusedItemIndex - policies.length;
        selectPosition(positions[positionIndex]);
    }

    function selectPolicy(policy: HistoryPolicy) {
        onselectPolicy?.(policy);
        closeMenu();
    }

    function selectPosition(position: HistoryPosition) {
        onselectPosition?.(position);
        closeMenu();
    }

    function handleButtonKeydown(event: KeyboardEvent) {
        switch (event.key) {
            case "ArrowDown":
            case "Enter":
            case " ":
            case "Spacebar":
                event.preventDefault();
                openMenu(getDefaultFocusedIndex());
                break;
            case "ArrowUp":
                event.preventDefault();
                openMenu(totalMenuItems - 1);
                break;
            case "Escape":
                event.preventDefault();
                closeMenu();
                break;
        }
    }

    function handleMenuKeydown(event: KeyboardEvent) {
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                moveFocus(1);
                break;
            case "ArrowUp":
                event.preventDefault();
                moveFocus(-1);
                break;
            case "Home":
                event.preventDefault();
                focusFirstItem();
                break;
            case "End":
                event.preventDefault();
                focusLastItem();
                break;
            case "Enter":
            case " ":
            case "Spacebar":
                event.preventDefault();
                activateFocusedItem();
                break;
            case "Escape":
                event.preventDefault();
                closeMenu();
                break;
            case "Tab":
                closeMenu(false);
                break;
        }
    }

    function handleItemMouseEnter(index: number) {
        focusedItemIndex = index;
    }

    function handleClickOutside(event: MouseEvent) {
        if (!menuOpen) {
            return;
        }

        const target = event.target as HTMLElement;
        if (!target.closest(".history-policy-menu")) {
            closeMenu(false);
        }
    }
</script>

<svelte:window onclick={handleClickOutside} />

<div class="history-policy-menu">
    <button
        bind:this={menuButtonElement}
        class="action-bar-menu-button"
        title={tooltip}
        aria-label={tooltip}
        aria-haspopup="menu"
        aria-expanded={menuOpen ? "true" : "false"}
        onclick={(e) => {
            e.stopPropagation();
            toggleMenu();
        }}
        onkeydown={handleButtonKeydown}
    >
        <span class="codicon codicon-layout"></span>
    </button>

    {#if menuOpen}
        <div
            bind:this={menuDropdownElement}
            class="menu-dropdown"
            role="menu"
            aria-label={tooltip}
            tabindex="-1"
            onkeydown={handleMenuKeydown}
        >
            <div class="menu-section-header" role="presentation">Visibility</div>
            {#each policies as policy, index}
                <button
                    class="menu-item"
                    class:checked={currentPolicy === policy}
                    role="menuitemradio"
                    aria-checked={currentPolicy === policy}
                    tabindex={focusedItemIndex === index ? 0 : -1}
                    data-menu-index={index}
                    onmouseenter={() => handleItemMouseEnter(index)}
                    onclick={() => selectPolicy(policy)}
                >
                    {#if currentPolicy === policy}
                        <span class="codicon codicon-check"></span>
                    {:else}
                        <span class="check-placeholder"></span>
                    {/if}
                    <span class="label">{policyLabels[policy]}</span>
                </button>
            {/each}

            <div class="menu-separator" role="presentation"></div>

            <div class="menu-section-header" role="presentation">Position</div>
            {#each positions as position, index}
                {@const menuIndex = policies.length + index}
                <button
                    class="menu-item"
                    class:checked={currentPosition === position}
                    role="menuitemradio"
                    aria-checked={currentPosition === position}
                    tabindex={focusedItemIndex === menuIndex ? 0 : -1}
                    data-menu-index={menuIndex}
                    onmouseenter={() => handleItemMouseEnter(menuIndex)}
                    onclick={() => selectPosition(position)}
                >
                    {#if currentPosition === position}
                        <span class="codicon codicon-check"></span>
                    {:else}
                        <span class="check-placeholder"></span>
                    {/if}
                    <span class="label">{positionLabels[position]}</span>
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
    .history-policy-menu {
        position: relative;
    }

    .action-bar-menu-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border: none;
        background: transparent;
        color: var(--vscode-icon-foreground);
        cursor: pointer;
        border-radius: 3px;
    }

    .action-bar-menu-button:hover {
        background-color: var(--vscode-toolbar-hoverBackground);
    }

    .action-bar-menu-button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
    }

    .menu-dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        z-index: 1000;
        min-width: 120px;
        background-color: var(--vscode-menu-background);
        border: 1px solid var(--vscode-menu-border);
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        padding: 4px 0;
    }

    .menu-section-header {
        padding: 4px 12px 2px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.5px;
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
        padding: 4px 12px;
        border: none;
        background: transparent;
        color: var(--vscode-menu-foreground);
        cursor: pointer;
        text-align: left;
        gap: 8px;
        font-size: 12px;
    }

    .menu-item:hover {
        background-color: var(--vscode-menu-selectionBackground);
        color: var(--vscode-menu-selectionForeground);
    }

    .menu-item:focus-visible {
        background-color: var(--vscode-menu-selectionBackground);
        color: var(--vscode-menu-selectionForeground);
        outline: none;
    }

    .check-placeholder {
        width: 16px;
    }

    .codicon-check {
        font-size: 14px;
    }
</style>
