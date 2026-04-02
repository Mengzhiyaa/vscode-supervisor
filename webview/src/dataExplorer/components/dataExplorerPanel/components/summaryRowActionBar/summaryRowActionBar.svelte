<!--
  SummaryRowActionBar.svelte - Summary row filter/sort bar
  Port from Positron's summaryRowActionBar.tsx
-->
<script lang="ts">
    import "../../../../../shared/actionBar.css";
    import ActionBarFilter from "../../../../../shared/ActionBarFilter.svelte";
    import { getDataExplorerContext } from "../../../../positronDataExplorerContext";
    import SummaryRowSortDropdown from "./summaryRowSortDropdown.svelte";
    import { MAX_ADVANCED_LAYOUT_ENTRY_COUNT } from "../../../../../dataGrid/classes/layoutManager";
    import type { SearchSchemaSortOrder } from "../../../../types";
    import type { TableSummaryDataGridInstance } from "../../../../tableSummaryDataGridInstance";

    const SEARCH_DEBOUNCE_TIMEOUT = 500;

    interface Props {
        instance?: TableSummaryDataGridInstance;
    }

    let { instance }: Props = $props();

    const context = getDataExplorerContext();
    const { stores } = context;
    const { summarySearchText, summarySortOrder, state: explorerState } = stores;

    let searchText = $state("");
    let sortOption = $state<SearchSchemaSortOrder>("original");
    let searchDebounceHandle: ReturnType<typeof setTimeout> | undefined;

    const disabled = $derived.by(() => {
        const backendState = $explorerState.backendState;
        if (!backendState) return false;
        return backendState.table_shape.num_columns >= MAX_ADVANCED_LAYOUT_ENTRY_COUNT;
    });

    $effect(() => {
        $summarySearchText;
        $summarySortOrder;

        if (!instance) {
            return;
        }

        searchText = instance.searchText || "";
        sortOption = instance.sortOption || "original";
        if (searchDebounceHandle) {
            clearTimeout(searchDebounceHandle);
            searchDebounceHandle = undefined;
        }
    });

    $effect(() => {
        if (!instance) {
            return;
        }

        void instance.setSortOption(sortOption);
    });

    function handleSortChanged(newSortOption: SearchSchemaSortOrder) {
        sortOption = newSortOption;
    }

    function handleFilterTextChanged(filterText: string) {
        searchText = filterText;

        if (searchDebounceHandle) {
            clearTimeout(searchDebounceHandle);
        }

        searchDebounceHandle = setTimeout(() => {
            searchDebounceHandle = undefined;
            if (instance) {
                void instance.setSearchText(filterText);
            }
        }, SEARCH_DEBOUNCE_TIMEOUT);
    }
</script>

<div class="summary-row-filter-bar">
    <div class="positron-action-bar summary-row-action-bar">
        <div class="action-bar-region left">
            <SummaryRowSortDropdown
                currentSort={sortOption}
                disabled={disabled || !instance}
                onSortChanged={handleSortChanged}
            />
        </div>
        <div class="action-bar-region right">
            <ActionBarFilter
                width={140}
                filterText={searchText}
                disabled={disabled || !instance}
                onfilterTextChanged={handleFilterTextChanged}
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
