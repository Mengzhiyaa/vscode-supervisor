/*---------------------------------------------------------------------------------------------
 *  Table data cache
 *--------------------------------------------------------------------------------------------*/

import type { SchemaColumn } from '../../dataGrid/types';
import { WidthCalculator } from '../../dataGrid/classes/widthCalculator';

/**
 * WidthCalculators interface.
 */
export interface WidthCalculators {
    columnHeaderWidthCalculator: (
        columnName: string,
        typeName: string,
    ) => number;
    columnValueWidthCalculator: (length: number) => number;
}

/**
 * InvalidateCacheFlags enum.
 */
export enum InvalidateCacheFlags {
    None = 0,
    ColumnSchema = 1 << 0,
    Data = 1 << 1,
    All = ColumnSchema | Data,
}

/**
 * DataCellKind enum.
 */
export enum DataCellKind {
    NON_NULL = '',
    NULL = 'null',
    NA = 'na',
    NaN = 'NaN',
    NotATime = 'NaT',
    None = 'None',
    INFINITY = 'inf',
    NEG_INFINITY = 'neginf',
    UNKNOWN = 'unknown',
}

/**
 * DataCell interface.
 */
export interface DataCell {
    formatted: string;
    kind: DataCellKind;
}

type UpdateListener = () => void;

const SPECIAL_VALUE_MAP = new Map<string, DataCellKind>([
    ['', DataCellKind.NULL],
    ['NULL', DataCellKind.NULL],
    ['NA', DataCellKind.NA],
    ['<NA>', DataCellKind.NA],
    ['NaN', DataCellKind.NaN],
    ['NaT', DataCellKind.NotATime],
    ['None', DataCellKind.None],
    ['INF', DataCellKind.INFINITY],
    ['-INF', DataCellKind.NEG_INFINITY],
]);

function inferDataCellKind(formatted: string): DataCellKind {
    return SPECIAL_VALUE_MAP.get(formatted) ?? DataCellKind.NON_NULL;
}

function createDataCell(formatted: string): DataCell {
    return {
        formatted,
        kind: inferDataCellKind(formatted),
    };
}

function defaultEditorFont(): string {
    if (typeof document === 'undefined') {
        return '400 13px monospace';
    }

    const rootStyle = getComputedStyle(document.documentElement);
    const fontFamily =
        rootStyle.getPropertyValue('--vscode-editor-font-family').trim() ||
        'monospace';
    const fontSize =
        rootStyle.getPropertyValue('--vscode-editor-font-size').trim() || '13px';

    return `400 ${fontSize} ${fontFamily}`;
}

/**
 * TableDataCache class.
 */
export class TableDataCache {
    private _columns = 0;
    private _rows = 0;
    private _hasRowLabels = false;
    private _widthCalculators: WidthCalculators | undefined;
    private readonly _listeners = new Set<UpdateListener>();
    private readonly _columnSchemaCache = new Map<number, SchemaColumn>();
    private readonly _rowLabelCache = new Map<number, string>();
    private readonly _dataColumnCache = new Map<number, Map<number, DataCell>>();
    private readonly _columnValueLengths = new Map<number, number>();

    get columns(): number {
        return this._columns;
    }

    get rows(): number {
        return this._rows;
    }

    get hasRowLabels(): boolean {
        return this._hasRowLabels;
    }

    readonly onDidUpdate = (listener: UpdateListener) => {
        this._listeners.add(listener);
        return {
            dispose: () => {
                this._listeners.delete(listener);
            },
        };
    };

    setWidthCalculators(widthCalculators?: WidthCalculators): void {
        this._widthCalculators = widthCalculators;
    }

    setWidthCalculator(
        widthCalculator?: WidthCalculator,
        editorFont: string = defaultEditorFont(),
    ): void {
        if (!widthCalculator) {
            this.setWidthCalculators(undefined);
            return;
        }

        const spaceWidth = widthCalculator.measureSpaceWidth(editorFont);
        this.setWidthCalculators({
            columnHeaderWidthCalculator: (columnName: string, typeName: string) =>
                widthCalculator.calculateColumnHeaderWidth(columnName, typeName),
            columnValueWidthCalculator: (length: number) =>
                widthCalculator.calculateCellValueWidth(length, spaceWidth),
        });
    }

    setDimensions(columns: number, rows: number, hasRowLabels = false): boolean {
        const dimensionsChanged =
            this._columns !== columns ||
            this._rows !== rows ||
            this._hasRowLabels !== hasRowLabels;
        if (!dimensionsChanged) {
            return false;
        }

        const columnsChanged = this._columns !== columns;
        this._columns = columns;
        this._rows = rows;
        this._hasRowLabels = hasRowLabels;

        if (columnsChanged) {
            this.clear(InvalidateCacheFlags.All);
        } else {
            this.clear(InvalidateCacheFlags.Data);
        }

        this._emitDidUpdate();
        return true;
    }

    setSchema(columns: SchemaColumn[]): boolean {
        let didChange = false;

        for (const column of columns) {
            const previous = this._columnSchemaCache.get(column.column_index);
            if (
                !previous ||
                previous.column_name !== column.column_name ||
                previous.type_name !== column.type_name ||
                previous.type_display !== column.type_display ||
                previous.description !== column.description
            ) {
                this._columnSchemaCache.set(column.column_index, column);
                didChange = true;
            }
        }

        if (didChange) {
            this._emitDidUpdate();
        }

        return didChange;
    }

    getSchemaColumn(columnIndex: number): SchemaColumn | undefined {
        return this._columnSchemaCache.get(columnIndex);
    }

    getSchemaColumns(): SchemaColumn[] {
        return Array.from(this._columnSchemaCache.values()).sort(
            (left, right) => left.column_index - right.column_index,
        );
    }

    getDataCell(rowIndex: number, columnIndex: number): DataCell | undefined {
        return this._dataColumnCache.get(columnIndex)?.get(rowIndex);
    }

    getCellFormatted(rowIndex: number, columnIndex: number): string | undefined {
        return this.getDataCell(rowIndex, columnIndex)?.formatted;
    }

    hasDataCell(rowIndex: number, columnIndex: number): boolean {
        return this._dataColumnCache.get(columnIndex)?.has(rowIndex) ?? false;
    }

    getRowLabel(rowIndex: number): string | undefined {
        return this._rowLabelCache.get(rowIndex);
    }

    hasRowLabel(rowIndex: number): boolean {
        return this._rowLabelCache.has(rowIndex);
    }

    hasRowLabelsInRange(startRow: number, endRow: number): boolean {
        if (!this._hasRowLabels) {
            return true;
        }

        const clampedStartRow = Math.max(0, startRow);
        const clampedEndRow = Math.max(clampedStartRow, endRow);
        for (let rowIndex = clampedStartRow; rowIndex < clampedEndRow; rowIndex++) {
            if (!this._rowLabelCache.has(rowIndex)) {
                return false;
            }
        }

        return true;
    }

    setRowLabels(startRow: number, rowLabels: string[]): boolean {
        if (rowLabels.length === 0) {
            return false;
        }

        for (let rowOffset = 0; rowOffset < rowLabels.length; rowOffset++) {
            this._rowLabelCache.set(startRow + rowOffset, rowLabels[rowOffset] ?? '');
        }

        this._emitDidUpdate();
        return true;
    }

    applyDataUpdate(params: {
        startRow: number;
        columns: string[][];
        columnIndices?: number[];
        rowLabels?: string[];
    }): boolean {
        const { startRow, columns, columnIndices, rowLabels } = params;
        let didChange = false;

        if (columns.length > 0) {
            const targetColumns =
                columnIndices ??
                Array.from({ length: columns.length }, (_, index) => index);

            for (let columnOffset = 0; columnOffset < targetColumns.length; columnOffset++) {
                const columnIndex = targetColumns[columnOffset];
                const values = columns[columnOffset] ?? [];
                let columnCache = this._dataColumnCache.get(columnIndex);
                if (!columnCache) {
                    columnCache = new Map<number, DataCell>();
                    this._dataColumnCache.set(columnIndex, columnCache);
                }

                let maxValueLength = this._columnValueLengths.get(columnIndex) ?? 0;
                for (let rowOffset = 0; rowOffset < values.length; rowOffset++) {
                    const formatted = values[rowOffset] ?? '';
                    columnCache.set(startRow + rowOffset, createDataCell(formatted));
                    maxValueLength = Math.max(maxValueLength, formatted.length);
                }

                this._columnValueLengths.set(columnIndex, maxValueLength);
                didChange = didChange || values.length > 0;
            }
        }

        if (rowLabels && rowLabels.length > 0) {
            for (let rowOffset = 0; rowOffset < rowLabels.length; rowOffset++) {
                this._rowLabelCache.set(startRow + rowOffset, rowLabels[rowOffset] ?? '');
            }
            didChange = true;
        }

        if (didChange) {
            this._emitDidUpdate();
        }

        return didChange;
    }

    getAutoColumnWidth(
        columnIndex: number,
        minimumColumnWidth: number,
        maximumColumnWidth: number,
    ): number | undefined {
        const schemaColumn = this._columnSchemaCache.get(columnIndex);
        if (!schemaColumn || !this._widthCalculators) {
            return undefined;
        }

        const headerWidth = this._widthCalculators.columnHeaderWidthCalculator(
            schemaColumn.column_name ?? '',
            schemaColumn.type_display ?? schemaColumn.type_name ?? '',
        );
        const valueLength = this._columnValueLengths.get(columnIndex) ?? 0;
        const valueWidth =
            valueLength > 0
                ? this._widthCalculators.columnValueWidthCalculator(valueLength)
                : 0;

        return Math.max(
            minimumColumnWidth,
            Math.min(maximumColumnWidth, Math.max(headerWidth, valueWidth)),
        );
    }

    trimData(
        columnIndices: Iterable<number>,
        startRow: number,
        endRow: number,
    ): void {
        const keepColumns = new Set(columnIndices);
        const clampedStartRow = Math.max(0, startRow);
        const clampedEndRow = Math.max(clampedStartRow, endRow);

        for (const [columnIndex, columnCache] of this._dataColumnCache) {
            if (!keepColumns.has(columnIndex)) {
                this._dataColumnCache.delete(columnIndex);
                this._columnValueLengths.delete(columnIndex);
                continue;
            }

            for (const rowIndex of [...columnCache.keys()]) {
                if (rowIndex < clampedStartRow || rowIndex >= clampedEndRow) {
                    columnCache.delete(rowIndex);
                }
            }

            if (columnCache.size === 0) {
                this._dataColumnCache.delete(columnIndex);
                this._columnValueLengths.delete(columnIndex);
            }
        }

        for (const rowIndex of [...this._rowLabelCache.keys()]) {
            if (rowIndex < clampedStartRow || rowIndex >= clampedEndRow) {
                this._rowLabelCache.delete(rowIndex);
            }
        }
    }

    clear(invalidateCache: InvalidateCacheFlags): void {
        if (invalidateCache & InvalidateCacheFlags.ColumnSchema) {
            this._columnSchemaCache.clear();
        }

        if (invalidateCache & InvalidateCacheFlags.Data) {
            this._rowLabelCache.clear();
            this._dataColumnCache.clear();
            this._columnValueLengths.clear();
        }
    }

    dispose(): void {
        this._listeners.clear();
    }

    private _emitDidUpdate(): void {
        for (const listener of this._listeners) {
            listener();
        }
    }
}
