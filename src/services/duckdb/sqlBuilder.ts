/*---------------------------------------------------------------------------------------------
 *  SQL Builder Utilities for DuckDB Data Explorer
 *  Generates SQL queries from Data Explorer filter, sort, and profile specifications
 *--------------------------------------------------------------------------------------------*/

import {
    RowFilter,
    RowFilterType,
    ColumnSortKey,
    ColumnSchema,
    ColumnSelection,
    ColumnFilter,
    ColumnFilterType,
    FilterComparison,
    FilterBetween,
    FilterTextSearch,
    FilterSetMembership,
    FilterMatchDataTypes,
    TextSearchType,
    FormatOptions,
    ArraySelection,
    DataSelectionRange,
    DataSelectionIndices,
    ExportFormat,
    TableSelection,
    TableSelectionKind,
    DataSelectionSingleCell,
    DataSelectionCellRange,
    DataSelectionCellIndices,
    DataSelectionRange as DataSelectionColumnRange,
} from '../../runtime/comms/positronDataExplorerComm';

// ============================================================================
// SQL escaping utilities
// ============================================================================

/**
 * Escape a SQL identifier (column name, table name) by double-quoting it.
 */
export function escapeIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Escape a SQL string value by single-quoting it.
 */
export function escapeValue(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

// ============================================================================
// WHERE clause generation
// ============================================================================

/**
 * Build a WHERE clause from an array of RowFilters.
 * Returns empty string if no filters.
 */
export function buildWhereClause(filters: RowFilter[]): string {
    const activeFilters = filters.filter(f => f.is_valid !== false);
    if (activeFilters.length === 0) {
        return '';
    }

    const conditions = activeFilters.map(f => filterToSql(f));
    const validConditions = conditions.filter(c => c !== '');
    if (validConditions.length === 0) {
        return '';
    }

    return `WHERE ${validConditions.join(' AND ')}`;
}

/**
 * Convert a single RowFilter to a SQL condition.
 */
function filterToSql(filter: RowFilter): string {
    const col = escapeIdentifier(filter.column_schema.column_name);

    switch (filter.filter_type) {
        case RowFilterType.IsNull:
            return `${col} IS NULL`;
        case RowFilterType.NotNull:
            return `${col} IS NOT NULL`;
        case RowFilterType.IsTrue:
            return `${col} = TRUE`;
        case RowFilterType.IsFalse:
            return `${col} = FALSE`;
        case RowFilterType.IsEmpty:
            return `${col} = ''`;
        case RowFilterType.NotEmpty:
            return `${col} != ''`;
        case RowFilterType.Compare: {
            const params = filter.params as FilterComparison;
            if (!params) { return ''; }
            return `${col} ${params.op} ${escapeValue(params.value)}`;
        }
        case RowFilterType.Between: {
            const params = filter.params as FilterBetween;
            if (!params) { return ''; }
            return `${col} BETWEEN ${escapeValue(params.left_value)} AND ${escapeValue(params.right_value)}`;
        }
        case RowFilterType.NotBetween: {
            const params = filter.params as FilterBetween;
            if (!params) { return ''; }
            return `${col} NOT BETWEEN ${escapeValue(params.left_value)} AND ${escapeValue(params.right_value)}`;
        }
        case RowFilterType.Search: {
            const params = filter.params as FilterTextSearch;
            if (!params) { return ''; }
            return textSearchToSql(col, params);
        }
        case RowFilterType.SetMembership: {
            const params = filter.params as FilterSetMembership;
            if (!params) { return ''; }
            const valueList = params.values.map(v => escapeValue(v)).join(', ');
            const op = params.inclusive ? 'IN' : 'NOT IN';
            return `${col} ${op} (${valueList})`;
        }
        default:
            return '';
    }
}

/**
 * Convert a text search filter to SQL.
 */
function textSearchToSql(col: string, params: FilterTextSearch): string {
    const term = params.term;
    const caseFn = params.case_sensitive ? '' : 'LOWER';
    const colExpr = params.case_sensitive ? col : `LOWER(${col})`;
    const termLower = params.case_sensitive ? term : term.toLowerCase();

    switch (params.search_type) {
        case TextSearchType.Contains:
            return `${colExpr} LIKE ${escapeValue(`%${escapeLike(termLower)}%`)}`;
        case TextSearchType.NotContains:
            return `${colExpr} NOT LIKE ${escapeValue(`%${escapeLike(termLower)}%`)}`;
        case TextSearchType.StartsWith:
            return `${colExpr} LIKE ${escapeValue(`${escapeLike(termLower)}%`)}`;
        case TextSearchType.EndsWith:
            return `${colExpr} LIKE ${escapeValue(`%${escapeLike(termLower)}`)}`;
        case TextSearchType.RegexMatch:
            return `regexp_matches(${col}, ${escapeValue(term)})`;
        default:
            return '';
    }
}

/**
 * Escape LIKE pattern special characters.
 */
function escapeLike(value: string): string {
    return value.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ============================================================================
// ORDER BY clause generation
// ============================================================================

/**
 * Build an ORDER BY clause from sort keys.
 */
export function buildOrderByClause(
    sortKeys: ColumnSortKey[],
    schema: ColumnSchema[]
): string {
    if (sortKeys.length === 0) {
        return '';
    }

    const clauses = sortKeys.map(key => {
        const col = schema[key.column_index];
        if (!col) { return ''; }
        const dir = key.ascending ? 'ASC' : 'DESC';
        return `${escapeIdentifier(col.column_name)} ${dir}`;
    }).filter(c => c !== '');

    if (clauses.length === 0) {
        return '';
    }

    return `ORDER BY ${clauses.join(', ')}`;
}

// ============================================================================
// Full query builders
// ============================================================================

/**
 * Build a complete SELECT query for data retrieval.
 */
export function buildSelectQuery(
    tableName: string,
    columns: ColumnSelection[],
    schema: ColumnSchema[],
    filters: RowFilter[],
    sortKeys: ColumnSortKey[],
    formatOptions?: FormatOptions
): string {
    // Build column list
    const colExprs = columns.map(col => {
        const colSchema = schema[col.column_index];
        if (!colSchema) { return '*'; }
        const colName = escapeIdentifier(colSchema.column_name);

        // Build row range extraction
        const sel = col.spec as DataSelectionRange;
        return colName;
    });

    const selectCols = colExprs.length > 0 ? colExprs.join(', ') : '*';
    const where = buildWhereClause(filters);
    const orderBy = buildOrderByClause(sortKeys, schema);

    // Get the row range from the first column selection
    let limitOffset = '';
    if (columns.length > 0) {
        const sel = columns[0].spec;
        if ('first_index' in sel && 'last_index' in sel) {
            const range = sel as DataSelectionRange;
            const count = range.last_index - range.first_index + 1;
            limitOffset = `LIMIT ${count} OFFSET ${range.first_index}`;
        }
    }

    const parts = [
        `SELECT ${selectCols}`,
        `FROM ${escapeIdentifier(tableName)}`,
        where,
        orderBy,
        limitOffset,
    ].filter(p => p !== '');

    return parts.join(' ');
}

/**
 * Build a COUNT query with optional filters.
 */
export function buildCountQuery(
    tableName: string,
    filters: RowFilter[]
): string {
    const where = buildWhereClause(filters);
    const parts = [
        `SELECT COUNT(*) AS cnt`,
        `FROM ${escapeIdentifier(tableName)}`,
        where,
    ].filter(p => p !== '');

    return parts.join(' ');
}

/**
 * Build a query for exporting a data selection.
 */
export function buildExportQuery(
    tableName: string,
    selection: TableSelection,
    schema: ColumnSchema[],
    filters: RowFilter[],
    sortKeys: ColumnSortKey[]
): string {
    const where = buildWhereClause(filters);
    const orderBy = buildOrderByClause(sortKeys, schema);

    switch (selection.kind) {
        case TableSelectionKind.SingleCell: {
            const cell = selection.selection as DataSelectionSingleCell;
            const col = schema[cell.column_index];
            if (!col) { return `SELECT * FROM ${escapeIdentifier(tableName)} LIMIT 0`; }
            return `SELECT ${escapeIdentifier(col.column_name)} FROM ${escapeIdentifier(tableName)} ${where} ${orderBy} LIMIT 1 OFFSET ${cell.row_index}`;
        }
        case TableSelectionKind.CellRange: {
            const range = selection.selection as DataSelectionCellRange;
            const cols = [];
            for (let i = range.first_column_index; i <= range.last_column_index; i++) {
                if (schema[i]) { cols.push(escapeIdentifier(schema[i].column_name)); }
            }
            const colList = cols.length > 0 ? cols.join(', ') : '*';
            const rowCount = range.last_row_index - range.first_row_index + 1;
            return `SELECT ${colList} FROM ${escapeIdentifier(tableName)} ${where} ${orderBy} LIMIT ${rowCount} OFFSET ${range.first_row_index}`;
        }
        case TableSelectionKind.ColumnRange: {
            const range = selection.selection as DataSelectionColumnRange;
            const cols = [];
            for (let i = range.first_index; i <= range.last_index; i++) {
                if (schema[i]) { cols.push(escapeIdentifier(schema[i].column_name)); }
            }
            const colList = cols.length > 0 ? cols.join(', ') : '*';
            return `SELECT ${colList} FROM ${escapeIdentifier(tableName)} ${where} ${orderBy}`;
        }
        case TableSelectionKind.RowRange: {
            const range = selection.selection as DataSelectionColumnRange;
            const rowCount = range.last_index - range.first_index + 1;
            return `SELECT * FROM ${escapeIdentifier(tableName)} ${where} ${orderBy} LIMIT ${rowCount} OFFSET ${range.first_index}`;
        }
        default:
            return `SELECT * FROM ${escapeIdentifier(tableName)} ${where} ${orderBy}`;
    }
}

/**
 * Format an Arrow result row/value as a string, applying FormatOptions.
 */
export function formatValue(value: unknown, _formatOptions?: FormatOptions): string {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            return value > 0 ? 'Inf' : value < 0 ? '-Inf' : 'NaN';
        }
        return String(value);
    }
    if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE';
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    return String(value);
}
