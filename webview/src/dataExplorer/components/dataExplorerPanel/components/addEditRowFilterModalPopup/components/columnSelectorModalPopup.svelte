<!--
  ColumnSelectorPopup.svelte - Column selector popup with search (Svelte 5 runes mode)
  Port from Positron's columnSelectorModalPopup.tsx
-->
<script lang="ts">
    import { onDestroy, tick, untrack } from "svelte";
    import { PositronDataGrid } from "../../../../../../dataGrid";
    import type { SchemaColumn } from "../../../../../../dataGrid/types";
    import ModalPopup from "../../../../../../shared/ModalPopup.svelte";
    import { getDataExplorerContext } from "../../../../../positronDataExplorerContext";
    import ColumnSearch from "./columnSearch.svelte";
    import { ColumnSelectorDataGridInstance } from "./columnSelectorDataGridInstance";

    const SEARCH_AREA_HEIGHT = 34;
    const FOCUSABLE_ELEMENT_SELECTORS =
        'input[type="text"], .column-selector-data-grid .data-grid';

    interface Props {
        anchorElement: HTMLElement;
        columns: SchemaColumn[];
        totalColumns: number;
        selectedColumnSchema?: SchemaColumn;
        focusInput?: boolean;
        initialSearchText?: string;
        onItemSelected: (columnSchema: SchemaColumn) => void;
        onClose: () => void;
    }

    let {
        anchorElement,
        columns,
        totalColumns,
        selectedColumnSchema,
        focusInput = false,
        initialSearchText,
        onItemSelected,
        onClose,
    }: Props = $props();

    let searchText = $state("");
    let gridContainerRef = $state<HTMLDivElement | null>(null);
    const { instance } = getDataExplorerContext();
    const selectorInstance = untrack(
        () =>
            new ColumnSelectorDataGridInstance(
                totalColumns,
                columns,
                instance.schemaClient,
                onItemSelected,
            ),
    );
    let displayedRows = $state(selectorInstance.rows);
    const rowHeight = selectorInstance.defaultRowHeight;
    const rowsMargin = selectorInstance.rowsMargin;

    const enableSearch = $derived(totalColumns > 10);

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
        return baseHeight + Math.max(displayedRows, 2) * rowHeight;
    });

    $effect(() => {
        searchText = initialSearchText ?? "";
    });

    $effect(() => {
        selectorInstance.setSchema(columns);
    });

    $effect(() => {
        selectorInstance.setSelectedColumn(selectedColumnSchema?.column_index);
    });

    $effect(() => {
        void selectorInstance.setSearchText(searchText);
    });

    $effect(() => {
        const updateDisplayedRows = () => {
            displayedRows = selectorInstance.rows;
        };
        const disposable = selectorInstance.onDidUpdate(updateDisplayedRows);
        updateDisplayedRows();

        return () => {
            disposable.dispose();
        };
    });

    $effect(() => {
        if (focusInput || !gridContainerRef) {
            return;
        }

        void tick().then(() => {
            const gridContainer = gridContainerRef;
            if (!gridContainer) {
                return;
            }

            const gridElement = gridContainer.querySelector<HTMLElement>(
                ".data-grid",
            );
            selectorInstance.ensureCursorVisible();
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
        selectorInstance.dispose();
    });

    function selectCurrentItem() {
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
        selectorInstance.ensureCursorVisible();
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
            <PositronDataGrid
                instance={selectorInstance}
                gridRole="column-selector"
            />
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
