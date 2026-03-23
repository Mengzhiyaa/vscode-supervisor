<!--
  DropDownListBox.svelte - Generic drop-down list box for row filter conditions
  Port from Positron's DropDownListBox behavior
-->
<script lang="ts">
    import ModalPopup from "../../../shared/ModalPopup.svelte";

    export interface DropDownListBoxEntry {
        identifier: string;
        title: string;
        subtitle?: string;
        group?: string;
        isSeparator?: boolean;
        disabled?: boolean;
        icon?: string;
    }

    interface Props {
        className?: string;
        entries: DropDownListBoxEntry[];
        selectedIdentifier?: string;
        title?: string;
        disabled?: boolean;
        onSelectionChanged: (entry: DropDownListBoxEntry) => void;
    }

    let {
        className = "",
        entries,
        selectedIdentifier,
        title = "Select Condition",
        disabled = false,
        onSelectionChanged,
    }: Props = $props();

    let buttonRef = $state<HTMLButtonElement | null>(null);
    let popupItemsRef = $state<HTMLDivElement | null>(null);
    let showDropDown = $state(false);
    let highlightIndex = $state(-1);

    const itemEntries = $derived(entries.filter((entry) => !entry.isSeparator));
    const navigableEntries = $derived(
        itemEntries.filter((entry) => !entry.disabled),
    );

    const selectedEntry = $derived.by(() =>
        itemEntries.find((entry) => entry.identifier === selectedIdentifier),
    );

    const highlightedEntry = $derived.by(() => {
        if (
            !showDropDown ||
            highlightIndex < 0 ||
            highlightIndex >= navigableEntries.length
        ) {
            return undefined;
        }

        return navigableEntries[highlightIndex];
    });

    function updateHighlightFromSelection() {
        const index = navigableEntries.findIndex(
            (entry) => entry.identifier === selectedIdentifier,
        );
        highlightIndex = index >= 0 ? index : 0;
    }

    function focusHighlightedItem() {
        if (!popupItemsRef) {
            return;
        }

        const items = popupItemsRef.querySelectorAll<HTMLButtonElement>(
            ".item:not(:disabled)",
        );
        const safeIndex = Math.max(
            0,
            Math.min(highlightIndex, items.length - 1),
        );
        const item = items[safeIndex];
        item?.focus();
        item?.scrollIntoView({ block: "nearest" });
    }

    function openDropDown() {
        if (disabled || showDropDown) {
            return;
        }

        showDropDown = true;
        updateHighlightFromSelection();

        requestAnimationFrame(() => {
            focusHighlightedItem();
        });
    }

    function closeDropDown(options?: { restoreFocus?: boolean }) {
        if (!showDropDown) {
            return;
        }

        showDropDown = false;
        highlightIndex = -1;

        if (options?.restoreFocus !== false) {
            queueMicrotask(() => {
                buttonRef?.focus();
            });
        }
    }

    function toggleDropDown() {
        if (disabled) {
            return;
        }

        if (showDropDown) {
            closeDropDown();
        } else {
            openDropDown();
        }
    }

    function handleMouseDown(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
    }

    function handleSelect(entry: DropDownListBoxEntry) {
        if (entry.disabled) {
            return;
        }

        closeDropDown({ restoreFocus: false });
        onSelectionChanged(entry);
    }

    function moveHighlight(delta: number) {
        if (!navigableEntries.length) {
            highlightIndex = -1;
            return;
        }

        const current = highlightIndex < 0 ? 0 : highlightIndex;
        highlightIndex =
            (current + delta + navigableEntries.length) %
            navigableEntries.length;

        requestAnimationFrame(() => {
            focusHighlightedItem();
        });
    }

    function handleButtonKeyDown(event: KeyboardEvent) {
        if (disabled) {
            return;
        }

        switch (event.code) {
            case "Enter":
            case "Space":
            case "ArrowDown":
                event.preventDefault();
                openDropDown();
                break;

            case "ArrowUp":
                event.preventDefault();
                openDropDown();
                moveHighlight(-1);
                break;
        }
    }

    function handlePopupKeyDown(event: KeyboardEvent) {
        switch (event.code) {
            case "Tab":
                closeDropDown({ restoreFocus: false });
                break;
            case "ArrowDown":
                event.preventDefault();
                moveHighlight(1);
                break;
            case "ArrowUp":
                event.preventDefault();
                moveHighlight(-1);
                break;
            case "Home":
                event.preventDefault();
                highlightIndex = 0;
                requestAnimationFrame(() => {
                    focusHighlightedItem();
                });
                break;
            case "End":
                event.preventDefault();
                highlightIndex = Math.max(navigableEntries.length - 1, 0);
                requestAnimationFrame(() => {
                    focusHighlightedItem();
                });
                break;
        }
    }

    export function focus() {
        buttonRef?.focus();
    }
</script>

<button
    class={`drop-down-list-box ${className}`.trim()}
    bind:this={buttonRef}
    onclick={toggleDropDown}
    onkeydown={handleButtonKeyDown}
    onmousedown={handleMouseDown}
    aria-haspopup="menu"
    aria-expanded={showDropDown}
    {disabled}
    type="button"
>
    <div class="title">
        {#if highlightedEntry}
            {highlightedEntry.title}
        {:else if selectedEntry}
            {selectedEntry.title}
        {:else}
            {title}
        {/if}
    </div>

    <div aria-hidden="true" class="chevron">
        <div class="codicon codicon-chevron-down"></div>
    </div>
</button>

{#if showDropDown && buttonRef}
    <ModalPopup
        anchorElement={buttonRef}
        width={buttonRef.offsetWidth}
        popupAlignment="left"
        popupPosition="auto"
        keyboardNavigationStyle="menu"
        focusableElementSelectors=".drop-down-list-box-items button:not([disabled])"
        onClose={() => closeDropDown()}
    >
        <div
            class="drop-down-list-box-items"
            bind:this={popupItemsRef}
            onkeydown={handlePopupKeyDown}
            role="menu"
            tabindex="-1"
        >
            {#each entries as entry}
                {#if entry.isSeparator}
                    <div class="separator"></div>
                {:else}
                    {@const navigableIndex = navigableEntries.indexOf(entry)}
                    <button
                        class="item"
                        class:highlighted={navigableIndex === highlightIndex}
                        class:disabled={entry.disabled}
                        disabled={entry.disabled}
                        type="button"
                        onfocus={() => {
                            if (navigableIndex >= 0) {
                                highlightIndex = navigableIndex;
                            }
                        }}
                        onmouseover={() => {
                            if (navigableIndex >= 0) {
                                highlightIndex = navigableIndex;
                            }
                        }}
                        onmousedown={handleMouseDown}
                        onclick={() => handleSelect(entry)}
                        role="menuitemradio"
                        aria-checked={entry.identifier === selectedIdentifier}
                    >
                        <div class="dropdown-entry">
                            <div class="item-title" class:disabled={entry.disabled}>
                                {entry.title}
                            </div>
                            {#if entry.group}
                                <div class="item-group">{entry.group}</div>
                            {/if}
                            {#if entry.subtitle}
                                <div class="item-subtitle">{entry.subtitle}</div>
                            {/if}
                        </div>

                        {#if entry.icon}
                            <div
                                class="item-icon codicon codicon-{entry.icon}"
                                class:disabled={entry.disabled}
                                title={entry.title}
                            ></div>
                        {/if}
                    </button>
                {/if}
            {/each}
        </div>
    </ModalPopup>
{/if}

<style>
    .drop-down-list-box {
        width: 100%;
        padding: 4px;
        display: grid;
        margin: 0;
        font: inherit;
        font-size: 12px;
        line-height: 16px;
        border-radius: 4px;
        min-height: 26px;
        align-items: center;
        text-align: inherit;
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        grid-template-columns: [title] 1fr [chevron] 22px [end];
        color: var(--vscode-positronDropDownListBox-foreground);
        border: 1px solid var(--vscode-positronDropDownListBox-border) !important;
    }

    .drop-down-list-box:focus {
        outline: none !important;
    }

    .drop-down-list-box:focus-visible {
        outline: 1px solid var(--vscode-focusBorder) !important;
        outline-offset: 0;
    }

    .drop-down-list-box:disabled {
        opacity: 50%;
    }

    .drop-down-list-box .title {
        display: flex;
        padding-left: 6px;
        align-items: center;
        overflow: hidden;
        text-align: left;
        white-space: nowrap;
        text-overflow: ellipsis;
        grid-column: title / chevron;
        color: var(--vscode-positronContextMenu-foreground);
    }

    .drop-down-list-box .chevron {
        display: flex;
        align-items: center;
        justify-content: center;
        grid-column: chevron / end;
    }

    .drop-down-list-box .chevron .codicon {
        font-size: 16px;
    }

    .drop-down-list-box-items {
        margin: 4px;
        display: flex;
        flex-direction: column;
        background: var(--vscode-positronDropDownListBox-background);
    }

    .drop-down-list-box-items .separator {
        height: 1px;
        margin: 4px 10px;
        background: var(--vscode-positronDropDownListBox-separatorBackground);
    }

    .drop-down-list-box-items .item {
        min-height: 26px;
        padding: 0 6px;
        border: none;
        display: grid;
        margin: 0;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        line-height: 16px;
        align-items: center;
        text-align: inherit;
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        color: var(--vscode-positronDropDownListBox-foreground);
        grid-template-columns: [title] 1fr [icon] min-content [end];
    }

    .drop-down-list-box-items .item:hover:not(.disabled),
    .drop-down-list-box-items .item.highlighted:not(.disabled) {
        border-radius: 4px;
        color: var(--vscode-positronDropDownListBox-hoverForeground);
        background: var(--vscode-positronDropDownListBox-hoverBackground);
    }

    .drop-down-list-box-items .item:focus {
        outline: none !important;
    }

    .drop-down-list-box-items .item:focus-visible {
        border-radius: 4px;
        outline: 1px solid var(--vscode-focusBorder) !important;
    }

    .drop-down-list-box-items .item:not(.disabled):focus-visible {
        background: var(--vscode-positronDropDownListBox-hoverBackground);
    }

    .drop-down-list-box-items .item .dropdown-entry {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 8px;
        grid-column: title / icon;
    }

    .drop-down-list-box-items .item .item-title {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .drop-down-list-box-items .item .item-title.disabled,
    .drop-down-list-box-items .item .item-group.disabled,
    .drop-down-list-box-items .item .item-subtitle.disabled {
        opacity: 75%;
    }

    .drop-down-list-box-items .item .item-group,
    .drop-down-list-box-items .item .item-subtitle {
        opacity: 75%;
        white-space: nowrap;
    }

    .drop-down-list-box-items .item .item-icon {
        padding: 10px;
        grid-column: icon / end;
    }

    .drop-down-list-box-items .item .item-icon.disabled {
        opacity: 50%;
    }
</style>
