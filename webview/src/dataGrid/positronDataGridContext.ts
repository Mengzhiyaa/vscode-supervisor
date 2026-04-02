/*---------------------------------------------------------------------------------------------
 *  Positron Data Grid Context - Svelte context for DataGridInstance
 *--------------------------------------------------------------------------------------------*/

import { getContext, setContext } from 'svelte';
import type { DataGridInstance } from './classes/dataGridInstance';

export const POSITRON_DATA_GRID_CONTEXT_KEY = Symbol('positronDataGrid');
export const DATA_GRID_CONTEXT_KEY = POSITRON_DATA_GRID_CONTEXT_KEY;

/**
 * Data Grid context value
 */
export interface PositronDataGridContext {
    instance: DataGridInstance;
}

/**
 * Set the PositronDataGrid context.
 */
export function setPositronDataGridContext(
    instanceOrGetter: DataGridInstance | (() => DataGridInstance),
): void {
    const getInstance =
        typeof instanceOrGetter === 'function'
            ? (instanceOrGetter as () => DataGridInstance)
            : () => instanceOrGetter;

    const contextValue: PositronDataGridContext = {
        get instance() {
            return getInstance();
        },
    };

    setContext<PositronDataGridContext>(
        POSITRON_DATA_GRID_CONTEXT_KEY,
        contextValue,
    );
}

/**
 * Get the PositronDataGrid context.
 */
export function getPositronDataGridContext(): PositronDataGridContext {
    const context = getContext<PositronDataGridContext>(
        POSITRON_DATA_GRID_CONTEXT_KEY,
    );
    if (!context) {
        throw new Error(
            'PositronDataGrid context not found. Ensure component is wrapped in PositronDataGrid.',
        );
    }
    return context;
}

export type DataGridContext = PositronDataGridContext;
export const setDataGridContext = setPositronDataGridContext;
export const getDataGridContext = getPositronDataGridContext;
