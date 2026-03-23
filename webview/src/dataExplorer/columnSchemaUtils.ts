/*---------------------------------------------------------------------------------------------
 *  Column schema utilities shared across Data Explorer surfaces
 *--------------------------------------------------------------------------------------------*/

import type { SchemaColumn } from '../dataGrid/types';
import {
    getEffectiveColumnDisplayType,
    getSummaryDataTypeIcon,
} from './columnDisplayTypeUtils';

function normalizeSearchValue(value: string | undefined): string {
    return value?.trim().toLowerCase() ?? '';
}

export function getColumnSchemaTypeIcon(columnSchema?: SchemaColumn): string {
    if (!columnSchema) {
        return 'codicon-question';
    }

    return getSummaryDataTypeIcon(
        getEffectiveColumnDisplayType(
            columnSchema.type_display,
            columnSchema.type_name,
        ),
    );
}

export function matchesColumnSchemaSearch(
    columnSchema: SchemaColumn,
    searchText: string | undefined,
): boolean {
    const normalizedSearchText = normalizeSearchValue(searchText);
    if (!normalizedSearchText) {
        return true;
    }

    const normalizedTypeDisplay = getEffectiveColumnDisplayType(
        columnSchema.type_display,
        columnSchema.type_name,
    );

    const haystacks = [
        columnSchema.column_name,
        columnSchema.type_display,
        columnSchema.type_name,
        normalizedTypeDisplay,
        columnSchema.description,
    ];

    return haystacks.some((value) =>
        normalizeSearchValue(value).includes(normalizedSearchText),
    );
}
