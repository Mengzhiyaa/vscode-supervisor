/*---------------------------------------------------------------------------------------------
 *  Column display type utilities
 *--------------------------------------------------------------------------------------------*/

export const COLUMN_DISPLAY_TYPE_BOOLEAN = 'boolean';
export const COLUMN_DISPLAY_TYPE_STRING = 'string';
export const COLUMN_DISPLAY_TYPE_DATE = 'date';
export const COLUMN_DISPLAY_TYPE_DATETIME = 'datetime';
export const COLUMN_DISPLAY_TYPE_TIME = 'time';
export const COLUMN_DISPLAY_TYPE_INTERVAL = 'interval';
export const COLUMN_DISPLAY_TYPE_OBJECT = 'object';
export const COLUMN_DISPLAY_TYPE_ARRAY = 'array';
export const COLUMN_DISPLAY_TYPE_STRUCT = 'struct';
export const COLUMN_DISPLAY_TYPE_UNKNOWN = 'unknown';
export const COLUMN_DISPLAY_TYPE_FLOATING = 'floating';
export const COLUMN_DISPLAY_TYPE_INTEGER = 'integer';
export const COLUMN_DISPLAY_TYPE_DECIMAL = 'decimal';

function normalize(rawType: string | undefined): string {
    return rawType?.trim().toLowerCase() ?? '';
}

export function getEffectiveColumnDisplayType(
    typeDisplay: string | undefined,
    typeName?: string,
): string {
    return normalize(typeDisplay) || normalize(typeName);
}

export function isNumericDisplayType(typeDisplay: string): boolean {
    return (
        typeDisplay === COLUMN_DISPLAY_TYPE_FLOATING ||
        typeDisplay === COLUMN_DISPLAY_TYPE_INTEGER ||
        typeDisplay === COLUMN_DISPLAY_TYPE_DECIMAL ||
        typeDisplay === 'dbl' ||
        typeDisplay.includes('float') ||
        typeDisplay.includes('double') ||
        typeDisplay.includes('decimal') ||
        typeDisplay.includes('int') ||
        typeDisplay.includes('integer') ||
        typeDisplay.includes('numeric') ||
        typeDisplay.includes('number') ||
        typeDisplay.includes('real')
    );
}

export function isIntegerDisplayType(typeDisplay: string): boolean {
    return (
        typeDisplay === COLUMN_DISPLAY_TYPE_INTEGER ||
        typeDisplay === 'int' ||
        typeDisplay === 'int32' ||
        typeDisplay === 'int64' ||
        (typeDisplay.includes('int') && !typeDisplay.includes('interval'))
    );
}

export function isBooleanDisplayType(typeDisplay: string): boolean {
    return (
        typeDisplay === COLUMN_DISPLAY_TYPE_BOOLEAN ||
        typeDisplay.includes('bool') ||
        typeDisplay.includes('logical')
    );
}

export function isStringDisplayType(typeDisplay: string): boolean {
    return (
        typeDisplay === COLUMN_DISPLAY_TYPE_STRING ||
        typeDisplay.includes('string') ||
        typeDisplay.includes('character') ||
        typeDisplay.includes('char') ||
        typeDisplay.includes('text') ||
        typeDisplay.includes('varchar') ||
        typeDisplay.includes('str')
    );
}

export function isDateDisplayType(typeDisplay: string): boolean {
    return typeDisplay === COLUMN_DISPLAY_TYPE_DATE;
}

export function isDatetimeDisplayType(typeDisplay: string): boolean {
    return (
        typeDisplay === COLUMN_DISPLAY_TYPE_DATETIME ||
        typeDisplay.includes('timestamp')
    );
}

export function isTimeDisplayType(typeDisplay: string): boolean {
    return typeDisplay === COLUMN_DISPLAY_TYPE_TIME;
}

export function isIntervalDisplayType(typeDisplay: string): boolean {
    return typeDisplay === COLUMN_DISPLAY_TYPE_INTERVAL;
}

export function isObjectDisplayType(typeDisplay: string): boolean {
    return (
        typeDisplay === COLUMN_DISPLAY_TYPE_OBJECT ||
        typeDisplay.includes('object')
    );
}

export function isArrayDisplayType(typeDisplay: string): boolean {
    return typeDisplay === COLUMN_DISPLAY_TYPE_ARRAY;
}

export function isStructDisplayType(typeDisplay: string): boolean {
    return typeDisplay === COLUMN_DISPLAY_TYPE_STRUCT;
}

export function canExpandSummaryForDisplayType(typeDisplay: string): boolean {
    return (
        isNumericDisplayType(typeDisplay) ||
        isBooleanDisplayType(typeDisplay) ||
        isStringDisplayType(typeDisplay) ||
        isDateDisplayType(typeDisplay) ||
        isDatetimeDisplayType(typeDisplay) ||
        isObjectDisplayType(typeDisplay)
    );
}

export function getSummaryDataTypeIcon(typeDisplay: string): string {
    if (isNumericDisplayType(typeDisplay)) {
        return 'codicon-positron-data-type-number';
    }

    if (isBooleanDisplayType(typeDisplay)) {
        return 'codicon-positron-data-type-boolean';
    }

    if (isStringDisplayType(typeDisplay)) {
        return 'codicon-positron-data-type-string';
    }

    if (isDateDisplayType(typeDisplay)) {
        return 'codicon-positron-data-type-date';
    }

    if (isDatetimeDisplayType(typeDisplay) || isIntervalDisplayType(typeDisplay)) {
        return 'codicon-positron-data-type-date-time';
    }

    if (isTimeDisplayType(typeDisplay)) {
        return 'codicon-positron-data-type-time';
    }

    if (isObjectDisplayType(typeDisplay)) {
        return 'codicon-positron-data-type-object';
    }

    if (isArrayDisplayType(typeDisplay)) {
        return 'codicon-positron-data-type-array';
    }

    if (isStructDisplayType(typeDisplay)) {
        return 'codicon-positron-data-type-struct';
    }

    return 'codicon-positron-data-type-unknown';
}

export function shouldRightAlignDisplayType(typeDisplay: string): boolean {
    return (
        isNumericDisplayType(typeDisplay) ||
        isDateDisplayType(typeDisplay) ||
        isDatetimeDisplayType(typeDisplay) ||
        isTimeDisplayType(typeDisplay)
    );
}
