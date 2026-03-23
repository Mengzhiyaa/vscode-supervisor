<!--
  ColumnSearch.svelte - Column search input for selector popup (Svelte 5 runes mode)
  Port from Positron's columnSearch.tsx
-->
<script lang="ts">
    import { localize } from "../../nls";

    interface Props {
        initialSearchText?: string;
        focus?: boolean;
        onSearchTextChanged: (searchText: string) => void;
        onNavigateOut?: (searchText: string) => void;
        onConfirmSearch?: (searchText: string) => void;
    }

    let {
        initialSearchText,
        focus = false,
        onSearchTextChanged,
        onNavigateOut,
        onConfirmSearch,
    }: Props = $props();

    let inputRef = $state<HTMLInputElement | null>(null);
    let focused = $state(false);
    let searchText = $state("");

    $effect(() => {
        searchText = initialSearchText ?? "";
    });

    $effect(() => {
        if (!focus || !inputRef) {
            return;
        }

        inputRef.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
        switch (event.code) {
            case "ArrowDown":
            case "Tab":
                if (!onNavigateOut) break;
                event.stopPropagation();
                event.preventDefault();
                onNavigateOut(searchText);
                break;
            case "Enter":
                if (!onConfirmSearch) break;
                event.stopPropagation();
                event.preventDefault();
                onConfirmSearch(searchText);
                break;
        }
    }

    function handleInput(event: Event) {
        const target = event.target as HTMLInputElement;
        searchText = target.value;
        onSearchTextChanged(target.value);
    }

    function handleClear() {
        searchText = "";
        onSearchTextChanged("");
        inputRef?.focus();
    }
</script>

<div class="column-search-container">
    <div class="column-search-input" class:focused>
        <input
            bind:this={inputRef}
            class="text-input"
            placeholder={localize("positron.searchPlacehold", "search")}
            type="text"
            value={searchText}
            onblur={() => (focused = false)}
            oninput={handleInput}
            onfocus={() => (focused = true)}
            onkeydown={handleKeyDown}
        />
        {#if searchText !== ""}
            <button
                class="clear-button"
                onclick={handleClear}
                aria-label={localize(
                    "positron.clearSearch",
                    "Clear search",
                )}
                type="button"
            >
                <div class="codicon codicon-positron-search-cancel"></div>
            </button>
        {/if}
    </div>
</div>

<style>
    @keyframes positron-data-explorer-column-search-fade-in {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    .column-search-container {
        height: 100%;
        display: flex;
        padding: 0 4px;
        align-items: center;
    }

    .column-search-input {
        width: 100%;
        display: flex;
        font-size: 12px;
        line-height: 16px;
        border-radius: 4px;
        align-items: center;
        background: var(--vscode-positronActionBar-textInputBackground);
        border: 1px solid var(--vscode-positronDataExplorer-border);
    }

    .column-search-input.focused {
        border: 1px solid var(--vscode-focusBorder);
    }

    .column-search-input .text-input {
        width: 100%;
        padding: 4px 8px;
        font: inherit;
        border-radius: 4px;
        box-sizing: border-box;
        border: none !important;
        color: inherit;
        background: transparent;
        outline: none !important;
    }

    .column-search-input .text-input::placeholder {
        opacity: 0.5;
        color: var(--vscode-positronActionBar-foreground);
    }

    .column-search-input .text-input::selection {
        color: var(--vscode-positronActionBar-textInputSelectionForeground);
        background: var(
            --vscode-positronActionBar-textInputSelectionBackground
        );
    }

    .column-search-input .clear-button {
        padding: 0;
        width: 16px;
        height: 16px;
        border: none;
        display: flex;
        font: inherit;
        cursor: pointer;
        margin: 0 4px 0 0;
        background: transparent;
        animation: positron-data-explorer-column-search-fade-in 150ms ease-out;
    }

    .column-search-input .clear-button:focus-visible {
        border-radius: 3px;
        outline: 1px solid var(--vscode-focusBorder);
    }
</style>
