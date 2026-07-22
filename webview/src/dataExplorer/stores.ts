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
        backendState: null,
        schema: [],
        isLoading: true,
        error: null,
        layout: PositronDataExplorerLayout.SummaryOnLeft,
        summaryCollapsed: false,
        summaryWidth: 350,
        inNewWindow: false,
    });

    // Summary panel state
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
    const numRows = derived(state, $state => $state.backendState?.table_shape.num_rows ?? 0);
    const numColumns = derived(state, $state => $state.backendState?.table_shape.num_columns ?? 0);
    const numUnfilteredRows = derived(state, $state => $state.backendState?.table_unfiltered_shape.num_rows ?? 0);
    const rowFilters = derived(state, $state => $state.backendState?.row_filters ?? []);
    const columns = derived(state, $state => $state.schema);
    const status = derived(state, $state => {
        if ($state.error) return 'error';
        if ($state.backendState?.connected === false) return 'disconnected';
        return $state.isLoading ? 'computing' : 'idle';
    });
    const isLoading = derived(state, $state => $state.isLoading);
    const errorMessage = derived(state, $state => $state.error);

    return {
        state,
        numRows,
        numColumns,
        numUnfilteredRows,
        rowFilters,
        columns,
        status,
        isLoading,
        errorMessage,
        columnProfiles,
        summarySearchText,
        summarySortOrder,
        summaryExpandedColumns,
        pendingAddFilterRequest,
    };
}

export type DataExplorerStores = ReturnType<typeof createDataExplorerStores>;
