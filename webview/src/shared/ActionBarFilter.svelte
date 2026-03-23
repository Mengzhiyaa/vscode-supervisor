<!--
  ActionBarFilter.svelte
  Shared action bar text filter modeled after Positron's ActionBarFilter.
-->
<script lang="ts">
    interface Props {
        width?: number;
        disabled?: boolean;
        filterText?: string;
        placeholder?: string;
        onfilterTextChanged?: (filterText: string) => void;
    }

    let {
        width = 150,
        disabled = false,
        filterText = "",
        placeholder = "Filter",
        onfilterTextChanged,
    }: Props = $props();

    let focused = $state(false);
    let inputEl = $state<HTMLInputElement | null>(null);

    function updateFilterText(nextFilterText: string) {
        onfilterTextChanged?.(nextFilterText);
    }

    function clearFilterText() {
        updateFilterText("");
        inputEl?.focus();
    }

    function handleInput(event: Event) {
        updateFilterText((event.target as HTMLInputElement).value);
    }

    function handleInputKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape" && filterText !== "") {
            event.preventDefault();
            event.stopPropagation();
            clearFilterText();
        }
    }

    function handleClearButtonKeyDown(event: KeyboardEvent) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            clearFilterText();
        }
    }
</script>

<div class="action-bar-filter-container" style={`width: ${width}px;`}>
    <div class="action-bar-filter-input" class:focused>
        <input
            bind:this={inputEl}
            class="text-input"
            type="text"
            {disabled}
            {placeholder}
            value={filterText}
            onblur={() => (focused = false)}
            onfocus={() => (focused = true)}
            oninput={handleInput}
            onkeydown={handleInputKeyDown}
        />
        {#if filterText !== ""}
            <button
                class="clear-button"
                aria-label="Clear filter"
                {disabled}
                onclick={clearFilterText}
                onkeydown={handleClearButtonKeyDown}
            >
                <span class="codicon codicon-positron-search-cancel"></span>
            </button>
        {/if}
    </div>
</div>

<style>
    @keyframes positron-action-bar-filter-fade-in {
        from {
            opacity: 0;
        }

        to {
            opacity: 1;
        }
    }

    .action-bar-filter-container {
        display: flex;
        align-items: center;
    }

    .action-bar-filter-input {
        width: 100%;
        display: flex;
        align-items: center;
        margin-right: 2px;
        border-radius: 4px;
        font-size: 12px;
        background: var(--vscode-positronActionBar-textInputBackground);
        border: 1px solid var(--vscode-positronActionBar-textInputBorder);
    }

    .action-bar-filter-input.focused {
        border: 1px solid var(--vscode-focusBorder);
    }

    .text-input {
        width: 100%;
        padding: 4px 8px;
        border: none;
        border-radius: 4px;
        box-sizing: border-box;
        background: transparent;
        border: none !important;
        outline: none !important;
    }

    .text-input::placeholder {
        opacity: 0.5;
        color: var(--vscode-positronActionBar-foreground);
    }

    .text-input::selection {
        color: var(--vscode-positronActionBar-textInputSelectionForeground);
        background: var(--vscode-positronActionBar-textInputSelectionBackground);
    }

    .clear-button {
        width: 16px;
        height: 16px;
        padding: 0;
        margin: 0 4px 0 0;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        color: inherit;
        background: transparent;
        cursor: pointer;
        animation: positron-action-bar-filter-fade-in 150ms ease-out;
    }

    .clear-button:focus {
        outline: none;
    }

    .clear-button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        border-radius: 3px;
    }

    .clear-button:disabled {
        cursor: default;
        opacity: 0.5;
    }
</style>
