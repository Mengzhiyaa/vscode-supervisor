<!--
  ActionBarFilter.svelte
  Shared action bar text filter modeled after Positron's ActionBarFilter.
-->
<script lang="ts">
    type ActionBarFilterSize = "sm" | "md";

    interface Props {
        width?: number | string;
        disabled?: boolean;
        initialFilterText?: string;
        placeholder?: string;
        size?: ActionBarFilterSize;
        onFilterTextChanged?: (filterText: string) => void;
    }

    let {
        width = 150,
        disabled = false,
        initialFilterText = "",
        placeholder = "Filter",
        size = "sm",
        onFilterTextChanged,
    }: Props = $props();

    let focused = $state(false);
    let filterText = $state("");
    let inputRef = $state<HTMLInputElement | null>(null);

    $effect(() => {
        filterText = initialFilterText;
    });

    const widthStyle = $derived(
        typeof width === "number" ? `${width}px` : width,
    );
    const sizeClassName = $derived(
        size === "md"
            ? "action-bar-filter-input-md"
            : "action-bar-filter-input-sm",
    );

    function changeHandler(event: Event) {
        const nextFilterText = (event.target as HTMLInputElement).value;
        filterText = nextFilterText;
        onFilterTextChanged?.(nextFilterText);
    }

    function buttonClearClickHandler() {
        filterText = "";
        onFilterTextChanged?.("");
        inputRef?.focus();
    }

    function inputKeyDownHandler(event: KeyboardEvent) {
        if (event.key === "Escape" && filterText !== "") {
            event.preventDefault();
            event.stopPropagation();
            buttonClearClickHandler();
        }
    }

    function buttonClearKeyDownHandler(event: KeyboardEvent) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            buttonClearClickHandler();
        }
    }
</script>

<div class="action-bar-filter-container" style:width={widthStyle}>
    <div class="action-bar-filter-input {sizeClassName}" class:focused>
        <input
            bind:this={inputRef}
            class="text-input"
            type="text"
            {disabled}
            {placeholder}
            value={filterText}
            onblur={() => (focused = false)}
            onfocus={() => (focused = true)}
            oninput={changeHandler}
            onkeydown={inputKeyDownHandler}
        />
        {#if filterText !== ""}
            <button
                class="clear-button"
                aria-label="Clear filter"
                {disabled}
                onclick={buttonClearClickHandler}
                onkeydown={buttonClearKeyDownHandler}
            >
                <span class="codicon codicon-clear-all"></span>
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
        border-radius: 4px;
        margin-right: 2px;
        align-items: center;
        font-size: 12px;
        box-sizing: border-box;
        background: var(
            --vscode-positronActionBar-textInputBackground,
            var(--vscode-input-background)
        );
        border: 1px solid
            var(--vscode-positronActionBar-textInputBorder, var(--vscode-input-border));
    }

    .action-bar-filter-input.action-bar-filter-input-md {
        height: 26px;
    }

    .action-bar-filter-input.focused {
        border: 1px solid var(--vscode-focusBorder);
    }

    .text-input {
        width: 100%;
        padding: 4px 8px;
        border-radius: 4px;
        border: none !important;
        box-sizing: border-box;
        background: transparent;
        outline: none !important;
    }

    .text-input::placeholder {
        opacity: 0.5;
        color: var(--vscode-positronActionBar-foreground, var(--vscode-foreground));
    }

    .text-input::selection {
        color: var(
            --vscode-positronActionBar-textInputSelectionForeground,
            var(--vscode-editor-selectionForeground, inherit)
        );
        background: var(
            --vscode-positronActionBar-textInputSelectionBackground,
            var(--vscode-editor-selectionBackground)
        );
    }

    .clear-button {
        padding: 3px;
        border: none;
        display: flex;
        cursor: pointer;
        margin: 0 2px 0 0;
        border-radius: 5px;
        align-items: center;
        justify-content: center;
        background: transparent;
        animation: positron-action-bar-filter-fade-in 150ms ease-out;
    }

    .clear-button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
    }

    .clear-button:disabled {
        cursor: default;
        opacity: 0.5;
    }

    .clear-button:hover:not(:disabled) {
        background: var(--vscode-toolbar-hoverBackground);
    }
</style>
