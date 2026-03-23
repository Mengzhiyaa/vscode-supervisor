<!--
  SummaryRowActionBar.svelte - Summary row filter/sort bar
  Port from Positron's summaryRowActionBar.tsx
-->
<script lang="ts">
    import "../../../../../shared/actionBar.css";
    import ActionBarFilter from "../../../../../shared/ActionBarFilter.svelte";
    import { getDataExplorerContext } from "../../../../context";
    import SummaryRowSortDropdown from "./SummaryRowSortDropdown.svelte";
    import { MAX_ADVANCED_LAYOUT_ENTRY_COUNT } from "../../../../../dataGrid/classes/layoutManager";
    import type { SearchSchemaSortOrder } from "../../../../types";

    const SEARCH_DEBOUNCE_TIMEOUT = 500;

    const context = getDataExplorerContext();
    const { stores } = context;
    const { summarySearchText, summarySortOrder, state: explorerState } = stores;
    const summaryInstance = $derived(context.summaryInstance);

    let searchText = $state("");
    let debouncedSearchText = $state("");
    let sortOption = $state<SearchSchemaSortOrder>("original");

    const disabled = $derived.by(() => {
        const backendState = $explorerState.backendState;
        if (!backendState) return false;
        return backendState.table_shape.num_columns >= MAX_ADVANCED_LAYOUT_ENTRY_COUNT;
    });

    $effect(() => {
        $summarySearchText;
        $summarySortOrder;

        if (!summaryInstance) {
            return;
        }

        searchText = summaryInstance.searchText || "";
        debouncedSearchText = summaryInstance.searchText || "";
        sortOption = summaryInstance.sortOption || "original";
    });

    $effect(() => {
        if (!summaryInstance) {
            return;
        }

        const debounce = setTimeout(() => {
            debouncedSearchText = searchText;
        }, SEARCH_DEBOUNCE_TIMEOUT);
        return () => clearTimeout(debounce);
    });

    $effect(() => {
        if (!summaryInstance) {
            return;
        }

        void summaryInstance.setSearchText(debouncedSearchText);
    });

    $effect(() => {
        if (!summaryInstance) {
            return;
        }

        void summaryInstance.setSortOption(sortOption);
    });

    function handleSortChanged(newSortOption: SearchSchemaSortOrder) {
        sortOption = newSortOption;
    }
</script>

<div class="summary-row-filter-bar">
    <div class="positron-action-bar summary-row-action-bar">
        <div class="action-bar-region left">
            <SummaryRowSortDropdown
                currentSort={sortOption}
                disabled={disabled || !summaryInstance}
                onSortChanged={handleSortChanged}
            />
        </div>
        <div class="action-bar-region right">
            <ActionBarFilter
                width={140}
                filterText={searchText}
                disabled={disabled || !summaryInstance}
                onfilterTextChanged={(filterText) => (searchText = filterText)}
            />
        </div>
    </div>
</div>

<style>
    .summary-row-filter-bar {
        height: 36px;
        min-width: 0;
        min-height: 0;
        display: flex;
        overflow: hidden;
        align-items: center;
        box-sizing: border-box;
        justify-content: space-between;
        grid-row: summary-row-action-bar / data-grid;
        border-bottom: 1px solid var(--vscode-positronDataGrid-border, var(--vscode-editorGroup-border));
    }

    .summary-row-filter-bar .positron-action-bar {
        width: 100%;
        align-items: center;
        justify-content: space-between;
        background: var(--vscode-positronDataExplorer-contrastBackground, var(--vscode-editor-background));
    }

    .summary-row-action-bar {
        padding-left: 8px;
        padding-right: 14px;
    }
</style>
