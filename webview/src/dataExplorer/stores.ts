/*---------------------------------------------------------------------------------------------
 *  Data Explorer Stores - Svelte stores for Data Explorer state
 *--------------------------------------------------------------------------------------------*/

import { writable, derived } from 'svelte/store';
import { PositronDataExplorerLayout, type DataExplorerState, type SearchSchemaSortOrder } from './types';
import type { SchemaColumn } from '../dataGrid/types';
import type { ColumnProfileViewResult } from './columnProfileTypes';

/**
 * Create Data Explorer stores
 */
export function createDataExplorerStores() {
    // Main state store
    const state = writable<DataExplorerState>({
        identifier: '',
        displayName: '',
        backendState: null,
        schema: [],
        isLoading: true,
        error: null,
        layout: PositronDataExplorerLayout.SummaryOnLeft,
        summaryCollapsed: false,
        inNewWindow: false,
    });

    // Summary panel state
    const summaryColumns = writable<SchemaColumn[]>([]);
    const columnProfiles = writable(new Map<number, ColumnProfileViewResult>());
    const summarySearchText = writable('');
    const summarySortOrder = writable<SearchSchemaSortOrder>('original');
    const summaryExpandedColumns = writable(new Set<number>());
    const pendingAddFilterRequest = writable({
        columnIndex: null as number | null,
        columnSchema: null as SchemaColumn | null,
        requestId: 0,
    });

    // Derived stores for common properties
    const displayName = derived(state, $state => $state.displayName);
    const numRows = derived(state, $state => $state.backendState?.table_shape.num_rows ?? 0);
    const numColumns = derived(state, $state => $state.backendState?.table_shape.num_columns ?? 0);
    const numUnfilteredRows = derived(state, $state => $state.backendState?.table_unfiltered_shape.num_rows ?? 0);
    const rowFilters = derived(state, $state => $state.backendState?.row_filters ?? []);
    const sortKeys = derived(state, $state => $state.backendState?.sort_keys ?? []);
    const columns = derived(state, $state => $state.schema ?? []);
    const status = derived(state, $state => {
        if ($state.error) return 'error';
        if ($state.backendState?.connected === false) return 'disconnected';
        return $state.isLoading ? 'computing' : 'idle';
    });
    const isLoading = derived(state, $state => $state.isLoading);
    const hasError = derived(state, $state => $state.error !== null);
    const errorMessage = derived(state, $state => $state.error);

    // Filtered row count - from backend state (filtered_row_count if filters applied)
    const filteredNumRows = derived(state, $state => {
        const backendState = $state.backendState;
        if (!backendState) return null;
        if (backendState.row_filters && backendState.row_filters.length > 0) {
            return backendState.table_shape.num_rows;
        }
        return null;
    });

    return {
        state,
        displayName,
        numRows,
        numColumns,
        numUnfilteredRows,
        filteredNumRows,
        rowFilters,
        sortKeys,
        columns,
        status,
        isLoading,
        hasError,
        errorMessage,
        summaryColumns,
        columnProfiles,
        summarySearchText,
        summarySortOrder,
        summaryExpandedColumns,
        pendingAddFilterRequest,
    };
}

export type DataExplorerStores = ReturnType<typeof createDataExplorerStores>;
