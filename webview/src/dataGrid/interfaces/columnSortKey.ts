/*---------------------------------------------------------------------------------------------
 *  IColumnSortKey interface - Port from Positron
 *--------------------------------------------------------------------------------------------*/

/**
 * IColumnSortKey interface.
 */
export interface IColumnSortKey {
    /**
     * Gets the sort index (for multi-column sort priority).
     */
    readonly sortIndex: number;

    /**
     * Gets the column index.
     */
    readonly columnIndex: number;

    /**
     * Gets whether the sort is ascending.
     */
    readonly ascending: boolean;
}
