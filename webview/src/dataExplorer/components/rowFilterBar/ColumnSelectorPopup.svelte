<!--
  ColumnSelectorPopup.svelte - Column selector popup with search (Svelte 5 runes mode)
  Port from Positron's columnSelectorModalPopup.tsx
-->
<script lang="ts">
    import { onDestroy } from "svelte";
    import { DataGrid } from "../../../dataGrid";
    import type { SchemaColumn } from "../../../dataGrid/types";
    import ModalPopup from "../../../shared/ModalPopup.svelte";
    import ColumnSearch from "./ColumnSearch.svelte";
    import { ColumnSelectorDataGridInstance } from "./ColumnSelectorDataGridInstance";

    const SEARCH_AREA_HEIGHT = 34;
    const DEFAULT_ROW_HEIGHT = 26;
    const DEFAULT_ROWS_MARGIN = 4;
    const FOCUSABLE_ELEMENT_SELECTORS =
        'input[type="text"], .column-selector-data-grid .data-grid';

    interface Props {
        anchorElement: HTMLElement;
        columns: SchemaColumn[];
        selectedColumnSchema?: SchemaColumn;
        focusInput?: boolean;
        initialSearchText?: string;
        onItemSelected: (columnSchema: SchemaColumn) => void;
        onClose: () => void;
    }

    let {
        anchorElement,
        columns,
        selectedColumnSchema,
        focusInput = false,
        initialSearchText,
        onItemSelected,
        onClose,
    }: Props = $props();

    let searchText = $state("");
    let gridContainerRef = $state<HTMLDivElement | null>(null);
    let selectorInstance = $state<ColumnSelectorDataGridInstance | undefined>(
        undefined,
    );
    let totalRows = $state(0);
    let rowHeight = $state(DEFAULT_ROW_HEIGHT);
    let rowsMargin = $state(DEFAULT_ROWS_MARGIN);

    const enableSearch = $derived(columns.length > 10);

    const minPopupHeight = $derived.by(() => {
        const baseHeight =
            (enableSearch ? SEARCH_AREA_HEIGHT : 0) +
            2 * rowsMargin +
            2;
        return baseHeight + 2 * rowHeight;
    });

    const maxPopupHeight = $derived.by(() => {
        const baseHeight =
            (enableSearch ? SEARCH_AREA_HEIGHT : 0) +
            2 * rowsMargin +
            2;
        return baseHeight + totalRows * rowHeight;
    });

    $effect(() => {
        searchText = initialSearchText ?? "";
    });

    $effect(() => {
        if (!selectorInstance) {
            selectorInstance = new ColumnSelectorDataGridInstance(
                columns,
                onItemSelected,
            );
        } else {
            selectorInstance.setColumns(columns);
        }

        rowHeight = selectorInstance.defaultRowHeight;
        rowsMargin = selectorInstance.rowsMargin;
        totalRows = selectorInstance.totalRows;
        selectorInstance.setSelectedColumn(selectedColumnSchema?.column_index);
        void selectorInstance.setSearchText(searchText);
    });

    $effect(() => {
        if (!selectorInstance) {
            return;
        }

        selectorInstance.setSelectedColumn(selectedColumnSchema?.column_index);
    });

    $effect(() => {
        if (!selectorInstance) {
            return;
        }

        void selectorInstance.setSearchText(searchText);
    });

    $effect(() => {
        if (focusInput || !gridContainerRef || !selectorInstance) {
            return;
        }

        requestAnimationFrame(() => {
            const gridContainer = gridContainerRef;
            if (!gridContainer) {
                return;
            }

            const gridElement = gridContainer.querySelector<HTMLElement>(
                ".data-grid",
            );
            selectorInstance?.ensureCursorVisible();
            gridElement?.focus();
        });
    });

    $effect(() => {
        const gridElement =
            gridContainerRef?.querySelector<HTMLElement>(".data-grid");
        if (!gridElement) {
            return;
        }

        const listener = (event: KeyboardEvent) => {
            handleGridKeyDown(event);
        };

        gridElement.addEventListener("keydown", listener);

        return () => {
            gridElement.removeEventListener("keydown", listener);
        };
    });

    onDestroy(() => {
        selectorInstance?.dispose();
    });

    function selectCurrentItem() {
        if (!selectorInstance) {
            return;
        }

        const columnSchema = selectorInstance.selectItem(
            selectorInstance.cursorRowIndex,
        );
        if (columnSchema) {
            onItemSelected(columnSchema);
        }
    }

    function focusGrid() {
        const gridElement = gridContainerRef?.querySelector<HTMLElement>(
            ".data-grid",
        );
        selectorInstance?.ensureCursorVisible();
        gridElement?.focus();
    }

    function handleSearchTextChanged(text: string) {
        searchText = text;
    }

    function handleNavigateOut() {
        focusGrid();
    }

    function handleConfirmSearch() {
        selectCurrentItem();
    }

    function handleGridKeyDown(event: KeyboardEvent) {
        if (event.code === "Enter" || event.code === "Space") {
            event.preventDefault();
            event.stopPropagation();
            selectCurrentItem();
        }
    }
</script>

<ModalPopup
    {anchorElement}
    width={anchorElement.offsetWidth}
    height={maxPopupHeight}
    minHeight={minPopupHeight}
    maxHeight={maxPopupHeight}
    keyboardNavigationStyle="dialog"
    popupAlignment="auto"
    popupPosition="auto"
    focusableElementSelectors={FOCUSABLE_ELEMENT_SELECTORS}
    {onClose}
>
    <div class="column-selector">
        {#if enableSearch}
            <div class="column-selector-search">
                <ColumnSearch
                    focus={focusInput}
                    initialSearchText={initialSearchText}
                    onSearchTextChanged={handleSearchTextChanged}
                    onNavigateOut={handleNavigateOut}
                    onConfirmSearch={handleConfirmSearch}
                />
            </div>
        {/if}

        <div
            class="column-selector-data-grid"
            bind:this={gridContainerRef}
        >
            {#if selectorInstance}
                <DataGrid instance={selectorInstance} gridRole="column-selector" />
            {/if}
        </div>
    </div>
</ModalPopup>

<style>
    .column-selector {
        width: 100%;
        height: 100%;
        display: grid;
        overflow: hidden;
        grid-template-rows:
            [column-selector-search] min-content
            [column-selector-data-grid] 1fr
            [end-column-selector-data-grid];
    }

    .column-selector .column-selector-search {
        height: 34px;
        box-sizing: border-box;
        grid-row: column-selector-search / column-selector-data-grid;
        border-bottom: 1px solid var(--vscode-positronDataExplorer-border);
    }

    .column-selector .column-selector-data-grid {
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        outline: none !important;
        position: relative;
        grid-row: column-selector-data-grid / end-column-selector-data-grid;
    }

    .column-selector .column-selector-data-grid :global(.data-grid) {
        background: transparent;
    }

    .column-selector .column-selector-data-grid :global(.data-grid-row),
    .column-selector .column-selector-data-grid :global(.data-grid-row-cell) {
        background: transparent;
        border: none;
    }

    .column-selector .column-selector-data-grid :global(.data-grid-row-cell .content) {
        padding: 0 !important;
    }

    .column-selector .column-selector-data-grid :global(.data-grid-row-cell .border-overlay),
    .column-selector .column-selector-data-grid :global(.data-grid-row-cell .selection-overlay),
    .column-selector .column-selector-data-grid :global(.data-grid-row-cell .cursor-border),
    .column-selector .column-selector-data-grid :global(.data-grid-scrollbar),
    .column-selector .column-selector-data-grid :global(.data-grid-scrollbar-corner) {
        border: none;
    }

    .column-selector .column-selector-data-grid :global(.data-grid-row-cell .cursor-border) {
        display: none;
    }
</style>
