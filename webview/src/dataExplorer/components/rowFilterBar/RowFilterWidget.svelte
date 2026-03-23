<!--
  RowFilterWidget.svelte - Individual row filter chip (Svelte 5 runes mode)
  Port from Positron's row filter widget
-->
<script lang="ts">
    import { getDataExplorerContext } from "../../context";
    import type { RowFilterDescriptor } from "./rowFilterDescriptor";
    import {
        RowFilterDescriptorComparison,
        RowFilterDescriptorIsBetween,
        RowFilterDescriptorIsEmpty,
        RowFilterDescriptorIsFalse,
        RowFilterDescriptorIsNotBetween,
        RowFilterDescriptorIsNotEmpty,
        RowFilterDescriptorIsNotNull,
        RowFilterDescriptorIsNull,
        RowFilterDescriptorIsTrue,
        RowFilterDescriptorSearch,
    } from "./rowFilterDescriptor";
    import { localize } from "../../nls";

    interface Props {
        filterId: string;
        rowFilter: RowFilterDescriptor;
        onClear?: (options?: { restoreFocus?: boolean }) => void;
        onEdit?: (anchorElement: HTMLElement) => void;
    }

    let { filterId, rowFilter, onClear, onEdit }: Props = $props();

    const { gridInstance } = getDataExplorerContext();

    let widgetRef = $state<HTMLDivElement | null>(null);
    let clearButtonRef = $state<HTMLButtonElement | null>(null);

    const isValid = $derived(rowFilter.props.isValid !== false);
    const columnName = $derived(rowFilter.schema.column_name);
    const widgetTooltip = localize("positron.editFilter", "Edit Filter");
    const clearTooltip = localize("positron.clearFilter", "Clear Filter");

    function showHover(anchorElement: HTMLElement, content: string) {
        if (!gridInstance?.hoverManager) {
            return;
        }

        gridInstance.hoverManager.showHover(anchorElement, content);
    }

    function hideHover() {
        gridInstance?.hoverManager?.hideHover();
    }

    function handleClear(event: MouseEvent) {
        event.stopPropagation();
        onClear?.({
            restoreFocus: document.activeElement === clearButtonRef,
        });
    }

    function handleClearMouseDown(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
    }

    function handleClick() {
        if (widgetRef) {
            onEdit?.(widgetRef);
        }
    }

    function handleMouseDown(event: MouseEvent) {
        event.stopPropagation();
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }

        event.preventDefault();

        if (widgetRef) {
            onEdit?.(widgetRef);
        }
    }
</script>

<div
    class="row-filter-widget"
    class:invalid-row-filter-widget={!isValid}
    bind:this={widgetRef}
    data-filter-id={filterId}
    onclick={handleClick}
    onkeydown={handleKeydown}
    onmousedown={handleMouseDown}
    onmouseenter={(event) =>
        showHover(event.currentTarget as HTMLElement, widgetTooltip)}
    onmouseleave={hideHover}
    onfocus={(event) => showHover(event.currentTarget as HTMLElement, widgetTooltip)}
    onblur={hideHover}
    role="button"
    aria-haspopup="dialog"
    tabindex={onEdit ? 0 : -1}
    title={gridInstance?.hoverManager ? undefined : widgetTooltip}
>
    <div class="title">
        {#if rowFilter instanceof RowFilterDescriptorIsEmpty}
            <span class="column-name">{columnName}</span>
            <span class="space-before"
                >{localize("positron.isEmpty", "is empty")}</span
            >
        {:else if rowFilter instanceof RowFilterDescriptorIsNotEmpty}
            <span class="column-name">{columnName}</span>
            <span class="space-before"
                >{localize("positron.isNotEmpty", "is not empty")}</span
            >
        {:else if rowFilter instanceof RowFilterDescriptorIsNull}
            <span class="column-name">{columnName}</span>
            <span class="space-before"
                >{localize("positron.isMissing", "is missing")}</span
            >
        {:else if rowFilter instanceof RowFilterDescriptorIsNotNull}
            <span class="column-name">{columnName}</span>
            <span class="space-before"
                >{localize("positron.isNotMissing", "is not missing")}</span
            >
        {:else if rowFilter instanceof RowFilterDescriptorIsTrue}
            <span class="column-name">{columnName}</span>
            <span class="space-before"
                >{localize("positron.isTrue", "is true")}</span
            >
        {:else if rowFilter instanceof RowFilterDescriptorIsFalse}
            <span class="column-name">{columnName}</span>
            <span class="space-before"
                >{localize("positron.isFalse", "is false")}</span
            >
        {:else if rowFilter instanceof RowFilterDescriptorComparison}
            <span class="column-name">{columnName}</span>
            <span class="space-before space-after">
                {rowFilter.operatorText}
            </span>
            <span class="column-value">{rowFilter.value}</span>
        {:else if rowFilter instanceof RowFilterDescriptorSearch}
            <span class="column-name">{columnName}</span>
            <span class="space-before space-after">
                {rowFilter.operatorText}
            </span>
            <span class="column-value">"{rowFilter.value}"</span>
        {:else if rowFilter instanceof RowFilterDescriptorIsBetween}
            <span class="column-name">{columnName}</span>
            <span class="space-before space-after">&gt;=</span>
            <span class="column-value">{rowFilter.lowerLimit}</span>
            <span class="space-before space-after"
                >{localize("positron.and", "and")}</span
            >
            <span class="column-name">{columnName}</span>
            <span class="space-before space-after">&lt;=</span>
            <span class="column-value">{rowFilter.upperLimit}</span>
        {:else if rowFilter instanceof RowFilterDescriptorIsNotBetween}
            <span class="column-name">{columnName}</span>
            <span class="space-before space-after">&lt;</span>
            <span class="column-value">{rowFilter.lowerLimit}</span>
            <span class="space-before space-after"
                >{localize("positron.and", "and")}</span
            >
            <span class="column-name">{columnName}</span>
            <span class="space-before space-after">&gt;</span>
            <span class="column-value">{rowFilter.upperLimit}</span>
        {/if}
    </div>

    <button
        class="clear-filter-button"
        bind:this={clearButtonRef}
        onclick={handleClear}
        onmousedown={handleClearMouseDown}
        onmouseenter={(event) =>
            showHover(event.currentTarget as HTMLElement, clearTooltip)}
        onmouseleave={hideHover}
        onfocus={(event) => showHover(event.currentTarget as HTMLElement, clearTooltip)}
        onblur={hideHover}
        aria-label={clearTooltip}
        title={gridInstance?.hoverManager ? undefined : clearTooltip}
        type="button"
    >
        <span class="codicon codicon-positron-clear-filter"></span>
    </button>
</div>

<style>
    .row-filter-widget {
        padding: 0;
        height: 24px;
        display: flex;
        cursor: pointer;
        border-radius: 3px;
        align-items: center;
        box-sizing: border-box;
        justify-content: center;
        color: var(--vscode-positronDataExplorer-foreground);
        border: 1px solid var(--vscode-positronDataExplorer-border);
        background-color: var(--vscode-positronDataExplorer-background);
    }

    .invalid-row-filter-widget {
        color: var(--vscode-positronDataExplorer-background) !important;
        background-color: var(
            --vscode-positronDataExplorer-invalidFilterBackground
        ) !important;
    }

    .row-filter-widget:hover {
        background-color: var(--vscode-positronActionBar-hoverBackground);
    }

    .row-filter-widget:has(.clear-filter-button:hover) {
        background-color: var(--vscode-positronDataExplorer-background);
    }

    .row-filter-widget:focus {
        outline: none;
    }

    .row-filter-widget:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
    }

    .row-filter-widget .title {
        margin: 0 2px 0 6px;
    }

    .row-filter-widget .title .column-name {
        font-weight: 600;
    }

    .row-filter-widget .title .column-value {
        font-family: var(--monaco-monospace-font), monospace;
    }

    .row-filter-widget .title .space-before::before {
        content: " ";
        white-space: pre;
    }

    .row-filter-widget .title .space-after::after {
        content: " ";
        white-space: pre;
    }

    .row-filter-widget .clear-filter-button {
        width: 18px;
        height: 18px;
        display: flex;
        opacity: 80%;
        cursor: pointer;
        margin-right: 3px;
        border-radius: 3px;
        align-items: center;
        box-sizing: border-box;
        justify-content: center;
        border: 1px solid transparent;
        background: transparent;
    }

    .row-filter-widget .clear-filter-button:hover {
        filter: brightness(90%);
        border: 1px solid var(--vscode-positronActionBar-selectBorder);
        background-color: var(--vscode-positronActionBar-hoverBackground);
    }

    .row-filter-widget .clear-filter-button:focus {
        outline: none !important;
    }

    .row-filter-widget .clear-filter-button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
    }
</style>
