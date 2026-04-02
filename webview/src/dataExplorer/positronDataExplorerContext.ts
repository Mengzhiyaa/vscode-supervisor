/*---------------------------------------------------------------------------------------------
 *  Positron data explorer context
 *--------------------------------------------------------------------------------------------*/

import { getContext } from 'svelte';
import type { DataExplorerStores } from './stores';
import type { TableSummaryDataGridInstance } from './tableSummaryDataGridInstance';
import type { TableDataDataGridInstance } from './tableDataDataGridInstance';
import type { PositronDataExplorerInstance } from './positronDataExplorerInstance';
import type { WebviewMessage } from './types';

export const DATA_EXPLORER_CONTEXT_KEY = 'dataExplorer';

export interface PositronDataExplorerContext {
    stores: DataExplorerStores;
    readonly instance: PositronDataExplorerInstance;
    readonly positronDataExplorerInstance: PositronDataExplorerInstance;
    readonly tableDataDataGridInstance: TableDataDataGridInstance;
    readonly tableSchemaDataGridInstance: TableSummaryDataGridInstance;
    readonly gridInstance: TableDataDataGridInstance;
    readonly summaryInstance: TableSummaryDataGridInstance;
    postMessage: (message: WebviewMessage) => void;
    invalidateTableData: () => void;
    notifyFocusChanged?: (focused: boolean) => void;
}

export type DataExplorerContext = PositronDataExplorerContext;

export function getPositronDataExplorerContext(): PositronDataExplorerContext {
    const context = getContext<PositronDataExplorerContext>(
        DATA_EXPLORER_CONTEXT_KEY,
    );
    if (!context) {
        throw new Error(
            'DataExplorer context not found. Ensure component is wrapped in PositronDataExplorer.',
        );
    }
    return context;
}

export function getDataExplorerContext(): DataExplorerContext {
    return getPositronDataExplorerContext();
}
