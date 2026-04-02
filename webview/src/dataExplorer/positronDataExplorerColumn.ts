/*---------------------------------------------------------------------------------------------
 *  Positron data explorer column
 *--------------------------------------------------------------------------------------------*/

import { DataColumnAlignment } from '../dataGrid/interfaces';
import type { SchemaColumn } from '../dataGrid/types';
import { getEffectiveColumnDisplayType, shouldRightAlignDisplayType } from './columnDisplayTypeUtils';

/**
 * PositronDataExplorerColumn class.
 */
export class PositronDataExplorerColumn {
    constructor(
        private readonly _columnSchema: SchemaColumn,
    ) {}

    get columnSchema() {
        return this._columnSchema;
    }

    get name() {
        return this._columnSchema.column_name;
    }

    get description() {
        return this._columnSchema.type_name;
    }

    get alignment() {
        return shouldRightAlignDisplayType(
            getEffectiveColumnDisplayType(
                this._columnSchema.type_display ?? this._columnSchema.type_name,
            ),
        )
            ? DataColumnAlignment.Right
            : DataColumnAlignment.Left;
    }
}
