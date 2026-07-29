/*---------------------------------------------------------------------------------------------
 *  ColumnSelectorDataGridInstance - Local column selector grid for row filter popup
 *  Mirrors Positron's selector behavior using the Ark Svelte data grid
 *--------------------------------------------------------------------------------------------*/

import {
    DataGridInstance,
    type DataGridCellContent,
    type DataGridOptions,
    type IDataColumn,
} from "../../../../../../dataGrid/classes/dataGridInstance";
import type { SchemaColumn } from "../../../../../../dataGrid/types";
import { ColumnSchemaCache } from "../../../../../common/columnSchemaCache";
import type { DataExplorerSchemaClient } from "../../../../../common/dataExplorerSchemaClient";
import ColumnSelectorCell from "./columnSelectorCell.svelte";

const DEFAULT_ROW_HEIGHT = 26;
const OVERSCAN_FACTOR = 3;

const OPTIONS: DataGridOptions = {
    columnHeaders: false,
    rowHeaders: false,
    defaultColumnWidth: 0,
    defaultRowHeight: DEFAULT_ROW_HEIGHT,
    columnResize: false,
    rowResize: false,
    columnPinning: false,
    rowPinning: false,
    horizontalScrollbar: false,
    verticalScrollbar: true,
    scrollbarThickness: 8,
    scrollbarOverscroll: 0,
    useEditorFont: false,
    automaticLayout: true,
    rowsMargin: 4,
    cellBorders: false,
    horizontalCellPadding: 0,
    cursorInitiallyHidden: true,
    internalCursor: false,
    selection: false,
};

export class ColumnSelectorDataGridInstance extends DataGridInstance {
    private readonly _columnSchemaCache: ColumnSchemaCache;
    private readonly _schemaCacheDisposable: { dispose(): void };
    private _rows: number;
    private _searchText = "";
    private _searchRequestId = 0;

    constructor(
        private readonly _totalColumns: number,
        initialSchema: SchemaColumn[],
        private readonly _schemaClient: DataExplorerSchemaClient,
        private readonly _onSelect: (columnSchema: SchemaColumn) => void,
    ) {
        super(OPTIONS);
        this._rows = _totalColumns;
        this._columnSchemaCache = new ColumnSchemaCache(_schemaClient);
        this._columnSchemaCache.setColumnSchema(initialSchema);
        this._schemaCacheDisposable =
            this._columnSchemaCache.onDidUpdateCache(() =>
                this.fireOnDidUpdateEvent(),
            );
        this._columnLayoutManager.setEntries(1);
        this._rowLayoutManager.setEntries(_totalColumns);
    }

    get columns(): number {
        return 1;
    }

    get rows(): number {
        return this._rows;
    }

    override get scrollWidth(): number {
        return 0;
    }

    override get firstColumn() {
        return {
            columnIndex: 0,
            left: 0,
            width: 0,
        };
    }

    override getCustomColumnWidth(columnIndex: number): number | undefined {
        return columnIndex === 0 ? Math.max(this.layoutWidth - 8, 0) : undefined;
    }

    getCellData(_rowIndex: number, _columnIndex: number): string | undefined {
        return "";
    }

    column(_columnIndex: number): IDataColumn | undefined {
        return undefined;
    }

    cell(columnIndex: number, rowIndex: number): DataGridCellContent | undefined {
        if (columnIndex !== 0) {
            return undefined;
        }

        const columnSchema = this._columnSchemaCache.getColumnSchema(rowIndex);
        if (!columnSchema) {
            return undefined;
        }

        return {
            kind: "component",
            component: ColumnSelectorCell,
            props: {
                columnSchema,
                isSelected: this.cursorRowIndex === rowIndex,
                onPressed: () => {
                    this.setCursorPosition(0, rowIndex);
                    const selectedColumn = this.selectItem(rowIndex);
                    if (selectedColumn) {
                        this._onSelect(selectedColumn);
                    }
                },
            },
        };
    }

    protected async fetchData(invalidateCache = false): Promise<void> {
        const rowDescriptor = this.firstRow;
        if (!rowDescriptor && !invalidateCache) {
            return;
        }
        const columnIndices = rowDescriptor
            ? this._rowLayoutManager.getLayoutIndexes(
                  this.verticalScrollOffset,
                  this.layoutHeight,
                  OVERSCAN_FACTOR,
              )
            : [];
        await this._columnSchemaCache.update({
            columnIndices,
            invalidateCache,
        });
    }

    protected async doSortData(): Promise<void> {
        // Sorting is not supported in the selector.
    }

    setSchema(columns: SchemaColumn[]): void {
        this._columnSchemaCache.setColumnSchema(columns);
    }

    setSelectedColumn(columnIndex: number | undefined): void {
        if (columnIndex === undefined) {
            this.ensureCursorVisible();
            return;
        }

        const position = this._rowLayoutManager.mapIndexToPosition(columnIndex);
        if (position === undefined) {
            this.ensureCursorVisible();
            return;
        }

        this.setCursorPosition(0, columnIndex);
        this.scrollToCursor();
        this.fireOnDidUpdateEvent();
    }

    ensureCursorVisible(): void {
        this._ensureCursorIsVisible();
        this.fireOnDidUpdateEvent();
    }

    getColumnSchema(columnIndex: number): SchemaColumn | undefined {
        return this._columnSchemaCache.getColumnSchema(columnIndex);
    }

    selectItem(columnIndex: number): SchemaColumn | undefined {
        return this._columnSchemaCache.getColumnSchema(columnIndex);
    }

    async setSearchText(searchText: string): Promise<void> {
        if (searchText === this._searchText) {
            return;
        }

        this._searchText = searchText;
        this.setVerticalScrollOffset(0);
        const requestId = ++this._searchRequestId;
        let columnIndices: number[] | undefined;
        if (searchText.trim()) {
            columnIndices = await this._schemaClient.searchSchema({
                searchText,
            });
        }
        if (requestId !== this._searchRequestId) {
            return;
        }
        this._applyFilter(columnIndices, true);
        await this.fetchData(true);
    }

    override dispose(): void {
        this._schemaCacheDisposable.dispose();
        this._columnSchemaCache.dispose();
        super.dispose();
    }

    private _applyFilter(
        columnIndices: number[] | undefined,
        forceFirstVisibleRow = false,
    ): void {
        this._rows = columnIndices?.length ?? this._totalColumns;
        this._rowLayoutManager.setEntries(
            this._rows,
            undefined,
            columnIndices,
        );
        this._resetScrollOffset(forceFirstVisibleRow);
        this._ensureCursorIsVisible(forceFirstVisibleRow);
        this.fireOnDidUpdateEvent();
    }

    private _resetScrollOffset(forceTop = false): void {
        if (forceTop || !this.firstRow) {
            this.setVerticalScrollOffset(0);
            return;
        }

        if (this.verticalScrollOffset > this.maximumVerticalScrollOffset) {
            this.setVerticalScrollOffset(this.maximumVerticalScrollOffset);
        }
    }

    private _ensureCursorIsVisible(forceFirstVisibleRow = false): void {
        if (this._rows === 0) {
            this.setCursorPosition(0, -1);
            return;
        }

        if (
            !forceFirstVisibleRow &&
            this._rowLayoutManager.mapIndexToPosition(this.cursorRowIndex) !==
                undefined
        ) {
            return;
        }

        this.setCursorPosition(
            0,
            this._rowLayoutManager.mapPositionToIndex(0) ?? -1,
        );
    }
}
