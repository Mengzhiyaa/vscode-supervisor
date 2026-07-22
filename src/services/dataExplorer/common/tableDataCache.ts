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
    private _generation = 0;

    constructor(private _clientInstance: DataExplorerClientInstance) {}

    rebindClientInstance(clientInstance: DataExplorerClientInstance): void {
        this._clientInstance = clientInstance;
        this.invalidate(this._generation + 1);
    }

    invalidate(generation: number): void {
        this._generation = generation;
        this._values.clear();
    }

    async getDataValues(columns: ColumnSelection[], generation: number): Promise<TableData> {
        if (generation !== this._generation) {
            return { columns: [] };
        }
        const missingSelections = columns.filter(selection => {
            const column = this._values.get(selection.column_index);
            return selectionIndices(selection).some(rowIndex => !column?.has(rowIndex));
        });
        if (missingSelections.length > 0) {
            const result = await this._clientInstance.getDataValues(missingSelections);
            if (generation !== this._generation) {
                return { columns: [] };
            }
            missingSelections.forEach((selection, columnOffset) => {
                const column = this._values.get(selection.column_index) ?? new Map<number, ColumnValue>();
                const rows = selectionIndices(selection);
                rows.forEach((rowIndex, rowOffset) => {
                    const value = result.columns[columnOffset]?.[rowOffset];
                    if (value !== undefined) {
                        column.set(rowIndex, value);
                    }
                });
                this._values.set(selection.column_index, column);
            });
        }
        return {
            columns: columns.map(selection => {
                const column = this._values.get(selection.column_index);
                return selectionIndices(selection).map(
                    rowIndex => column?.get(rowIndex) ?? '',
                );
            }),
        };
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
            for (let startColumn = 0; startColumn < numColumns; startColumn += TABLE_DATA_CHUNK_SIZE) {
                if (token?.isCancellationRequested) {
                    throw new vscode.CancellationError();
                }
                const endColumn = Math.min(numColumns, startColumn + TABLE_DATA_CHUNK_SIZE);
                const selections = Array.from({ length: endColumn - startColumn }, (_, offset) => ({
                    column_index: startColumn + offset,
                    spec: { first_index: startRow, last_index: endRow - 1 },
                }));
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
        }
        return chunks.join('\n');
    }
}
