/*---------------------------------------------------------------------------------------------
 *  Data Explorer Context - Svelte context for Data Explorer
 *--------------------------------------------------------------------------------------------*/

import { getContext } from 'svelte';
import type { DataExplorerStores } from './stores';
import type { DataGridInstance } from '../dataGrid/dataGridInstance';
import type { TableSummaryDataGridInstance } from './tableSummaryDataGridInstance';
import type { WebviewMessage } from './types';

const DATA_EXPLORER_CONTEXT_KEY = 'dataExplorer';

/**
 * Data Explorer context value
 */
export interface DataExplorerContext {
    stores: DataExplorerStores;
    readonly gridInstance: DataGridInstance | undefined;
    readonly summaryInstance: TableSummaryDataGridInstance | undefined;
    postMessage: (message: WebviewMessage) => void;
    invalidateTableData?: () => void;
    notifyFocusChanged?: (focused: boolean) => void;
}

/**
 * Get the Data Explorer context
 */
export function getDataExplorerContext(): DataExplorerContext {
    const context = getContext<DataExplorerContext>(DATA_EXPLORER_CONTEXT_KEY);
    if (!context) {
        throw new Error('DataExplorer context not found. Ensure component is wrapped in DataExplorer.');
    }
    return context;
}
