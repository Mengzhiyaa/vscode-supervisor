/*---------------------------------------------------------------------------------------------
 *  DataColumn interface - Port from Positron
 *--------------------------------------------------------------------------------------------*/

/**
 * DataColumnAlignment enum.
 */
export enum DataColumnAlignment {
    Left = 'left',
    Center = 'center',
    Right = 'right'
}

/**
 * IDataColumn interface.
 */
export interface IDataColumn {
    /**
     * Gets the column name.
     */
    readonly name?: string;

    /**
     * Gets the column description.
     */
    readonly description?: string;

    /**
     * Gets the cell alignment for this column.
     */
    readonly alignment?: DataColumnAlignment;
}
