/*---------------------------------------------------------------------------------------------
 *  Data Grid Context - Svelte context for DataGridInstance
 *--------------------------------------------------------------------------------------------*/

import { getContext, setContext } from 'svelte';
import type { DataGridInstance } from './dataGridInstance';

const DATA_GRID_CONTEXT_KEY = Symbol('dataGrid');

/**
 * Data Grid context value
 */
export interface DataGridContext {
    instance: DataGridInstance;
}

/**
 * Set the DataGrid context
 */
export function setDataGridContext(
    instanceOrGetter: DataGridInstance | (() => DataGridInstance),
): void {
    const getInstance =
        typeof instanceOrGetter === 'function'
            ? (instanceOrGetter as () => DataGridInstance)
            : () => instanceOrGetter;

    const contextValue: DataGridContext = {
        get instance() {
            return getInstance();
        },
    };

    setContext<DataGridContext>(DATA_GRID_CONTEXT_KEY, contextValue);
}

/**
 * Get the DataGrid context
 */
export function getDataGridContext(): DataGridContext {
    const context = getContext<DataGridContext>(DATA_GRID_CONTEXT_KEY);
    if (!context) {
        throw new Error('DataGrid context not found. Ensure component is wrapped in DataGrid.');
    }
    return context;
}
