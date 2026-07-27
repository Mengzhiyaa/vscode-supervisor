/*---------------------------------------------------------------------------------------------
 *  Host-owned table data cache shared by every Data Explorer surface.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type {
    ColumnSelection,
    ColumnValue,
    TableData,
} from '../../../runtime/comms/positronDataExplorerComm';
import type { DataExplorerClientInstance } from '../languageRuntimeDataExplorerClient';

const TABLE_DATA_CHUNK_SIZE = 100;
const TABLE_DATA_PAGE_SIZE = 250;
const TABLE_DATA_TRIM_DELAY_MS = 3_000;
const TABLE_DATA_RETAIN_PAGES = 1;

function selectionIndices(selection: ColumnSelection): number[] {
    if ('indices' in selection.spec) {
        return selection.spec.indices;
    }
    const indices: number[] = [];
    for (let index = selection.spec.first_index; index <= selection.spec.last_index; index++) {
        indices.push(index);
    }
    return indices;
}

function formatColumnValue(value: ColumnValue): string {
    if (typeof value === 'string') {
        return value;
    }
    switch (value) {
        case 0: return 'NULL';
        case 1: return 'NA';
        case 2: return 'NaN';
        case 3: return 'NaT';
        case 4: return 'None';
        case 10: return 'INF';
        case 11: return '-INF';
        default: return 'UNKNOWN';
    }
}

function escapeTsv(value: string): string {
    return /[\t\r\n"]/.test(value)
        ? `"${value.replace(/"/g, '""')}"`
        : value;
}

export class TableDataCache {
    private readonly _values = new Map<number, Map<number, ColumnValue>>();
    private readonly _loadedRows = new Map<number, Set<number>>();
    private readonly _pendingRows = new Map<string, Promise<void>>();
    private readonly _retainedRanges = new Map<number, { first: number; last: number }>();
    private _trimTimer: ReturnType<typeof setTimeout> | undefined;
    private _generation = 0;

    constructor(private _clientInstance: DataExplorerClientInstance) {}

    rebindClientInstance(clientInstance: DataExplorerClientInstance): void {
        this._clientInstance = clientInstance;
        this.invalidate(this._generation + 1);
    }

    invalidate(generation: number): void {
        this._generation = generation;
        this._values.clear();
        this._loadedRows.clear();
        this._pendingRows.clear();
        this._retainedRanges.clear();
        if (this._trimTimer) {
            clearTimeout(this._trimTimer);
            this._trimTimer = undefined;
        }
    }

    dispose(): void {
        this.invalidate(this._generation + 1);
    }

    async getDataValues(columns: ColumnSelection[], generation: number): Promise<TableData> {
        if (generation !== this._generation) {
            return { columns: [] };
        }

        this._recordRetainedRanges(columns);

        // Wait for overlapping viewport requests already in flight. A second surface
        // asking for the same cells then consumes the first request instead of
        // issuing a duplicate backend RPC.
        const overlapping = new Set<Promise<void>>();
        for (const selection of columns) {
            for (const rowIndex of selectionIndices(selection)) {
                const pending = this._pendingRows.get(this._rowKey(selection.column_index, rowIndex));
                if (pending) {
                    overlapping.add(pending);
                }
            }
        }
        if (overlapping.size > 0) {
            await Promise.all(overlapping);
        }
        if (generation !== this._generation) {
            return { columns: [] };
        }

        const missingSelections = this._createMissingSelections(columns);
        if (missingSelections.length > 0) {
            const rowsBySelection = missingSelections.map(selection => selectionIndices(selection));
            const request = this._clientInstance.getDataValues(missingSelections).then(result => {
                if (generation !== this._generation) {
                    return;
                }
                missingSelections.forEach((selection, columnOffset) => {
                    const column = this._values.get(selection.column_index) ??
                        new Map<number, ColumnValue>();
                    const loaded = this._loadedRows.get(selection.column_index) ?? new Set<number>();
                    rowsBySelection[columnOffset].forEach((rowIndex, rowOffset) => {
                        // Mark even a short backend response as loaded. Empty and
                        // out-of-range cells are represented by an empty string and
                        // must not cause a permanent refetch loop.
                        column.set(rowIndex, result.columns[columnOffset]?.[rowOffset] ?? '');
                        loaded.add(rowIndex);
                    });
                    this._values.set(selection.column_index, column);
                    this._loadedRows.set(selection.column_index, loaded);
                });
            });

            for (let index = 0; index < missingSelections.length; index++) {
                const selection = missingSelections[index];
                for (const rowIndex of rowsBySelection[index]) {
                    this._pendingRows.set(this._rowKey(selection.column_index, rowIndex), request);
                }
            }
            try {
                await request;
            } finally {
                for (let index = 0; index < missingSelections.length; index++) {
                    const selection = missingSelections[index];
                    for (const rowIndex of rowsBySelection[index]) {
                        const key = this._rowKey(selection.column_index, rowIndex);
                        if (this._pendingRows.get(key) === request) {
                            this._pendingRows.delete(key);
                        }
                    }
                }
            }
        }

        this._scheduleTrim();
        return {
            columns: columns.map(selection => {
                const column = this._values.get(selection.column_index);
                return selectionIndices(selection).map(
                    rowIndex => column?.get(rowIndex) ?? '',
                );
            }),
        };
    }

    /**
     * Invalidates only the supplied rows while retaining unrelated viewport pages.
     * Full data/schema changes continue to use generation based invalidation.
     */
    invalidateRange(columns: ColumnSelection[]): void {
        for (const selection of columns) {
            const values = this._values.get(selection.column_index);
            const loaded = this._loadedRows.get(selection.column_index);
            for (const rowIndex of selectionIndices(selection)) {
                values?.delete(rowIndex);
                loaded?.delete(rowIndex);
            }
        }
    }

    async getTableDataTsv(
        numRows: number,
        numColumns: number,
        generation: number,
        token?: vscode.CancellationToken,
        onProgress?: (completedRows: number, totalRows: number) => void,
    ): Promise<string> {
        if (numRows === 0 || numColumns === 0) {
            return '';
        }
        const chunks: string[] = [];
        for (let startRow = 0; startRow < numRows; startRow += TABLE_DATA_CHUNK_SIZE) {
            if (token?.isCancellationRequested) {
                throw new vscode.CancellationError();
            }
            const endRow = Math.min(numRows, startRow + TABLE_DATA_CHUNK_SIZE);
            const rows = Array.from({ length: endRow - startRow }, () => [] as string[]);
            const rowChunkSelections: ColumnSelection[] = [];
            for (let startColumn = 0; startColumn < numColumns; startColumn += TABLE_DATA_CHUNK_SIZE) {
                if (token?.isCancellationRequested) {
                    throw new vscode.CancellationError();
                }
                const endColumn = Math.min(numColumns, startColumn + TABLE_DATA_CHUNK_SIZE);
                const selections = Array.from({ length: endColumn - startColumn }, (_, offset) => ({
                    column_index: startColumn + offset,
                    spec: { first_index: startRow, last_index: endRow - 1 },
                }));
                rowChunkSelections.push(...selections);
                const data = await this.getDataValues(selections, generation);
                if (generation !== this._generation) {
                    throw new Error('Table data changed while preparing clipboard data.');
                }
                data.columns.forEach((column, columnOffset) => {
                    for (let rowOffset = 0; rowOffset < rows.length; rowOffset++) {
                        rows[rowOffset][startColumn + columnOffset] = escapeTsv(
                            formatColumnValue(column[rowOffset] ?? ''),
                        );
                    }
                });
            }
            chunks.push(rows.map(row => row.join('\t')).join('\n'));
            onProgress?.(endRow, numRows);
            if (numRows > TABLE_DATA_PAGE_SIZE * ((TABLE_DATA_RETAIN_PAGES * 2) + 1)) {
                // A full-table clipboard operation must not turn the viewport
                // cache into a second full copy of a large dataset.
                this.invalidateRange(rowChunkSelections);
            }
        }
        return chunks.join('\n');
    }

    private _createMissingSelections(columns: ColumnSelection[]): ColumnSelection[] {
        const selections: ColumnSelection[] = [];
        for (const selection of columns) {
            const loaded = this._loadedRows.get(selection.column_index);
            const missingRows = selectionIndices(selection).filter(row => !loaded?.has(row));
            if (missingRows.length === 0) {
                continue;
            }

            // Convert sparse misses into contiguous runs. This preserves the wire
            // protocol while allowing partially cached viewport pages.
            let first = missingRows[0];
            let last = first;
            for (let index = 1; index <= missingRows.length; index++) {
                const row = missingRows[index];
                if (row === last + 1) {
                    last = row;
                    continue;
                }
                selections.push({
                    column_index: selection.column_index,
                    spec: { first_index: first, last_index: last },
                });
                first = row;
                last = row;
            }
        }
        return selections;
    }

    private _recordRetainedRanges(columns: ColumnSelection[]): void {
        for (const selection of columns) {
            const rows = selectionIndices(selection);
            if (rows.length === 0) {
                continue;
            }
            const firstPage = Math.floor(rows[0] / TABLE_DATA_PAGE_SIZE);
            const lastPage = Math.floor(rows[rows.length - 1] / TABLE_DATA_PAGE_SIZE);
            this._retainedRanges.set(selection.column_index, {
                first: Math.max(0, (firstPage - TABLE_DATA_RETAIN_PAGES) * TABLE_DATA_PAGE_SIZE),
                last: ((lastPage + TABLE_DATA_RETAIN_PAGES + 1) * TABLE_DATA_PAGE_SIZE) - 1,
            });
        }
    }

    private _scheduleTrim(): void {
        if (this._trimTimer) {
            clearTimeout(this._trimTimer);
        }
        this._trimTimer = setTimeout(() => {
            this._trimTimer = undefined;
            for (const [columnIndex, values] of this._values) {
                const retained = this._retainedRanges.get(columnIndex);
                if (!retained) {
                    this._values.delete(columnIndex);
                    this._loadedRows.delete(columnIndex);
                    continue;
                }
                const loaded = this._loadedRows.get(columnIndex);
                for (const rowIndex of values.keys()) {
                    if (rowIndex < retained.first || rowIndex > retained.last) {
                        values.delete(rowIndex);
                        loaded?.delete(rowIndex);
                    }
                }
                if (values.size === 0) {
                    this._values.delete(columnIndex);
                    this._loadedRows.delete(columnIndex);
                }
            }
            this._retainedRanges.clear();
        }, TABLE_DATA_TRIM_DELAY_MS);
    }

    private _rowKey(columnIndex: number, rowIndex: number): string {
        return `${this._generation}:${columnIndex}:${rowIndex}`;
    }
}
