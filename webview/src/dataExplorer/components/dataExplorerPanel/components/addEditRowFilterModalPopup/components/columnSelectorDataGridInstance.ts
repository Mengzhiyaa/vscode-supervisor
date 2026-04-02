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
import { matchesColumnSchemaSearch } from "../../../../../columnSchemaUtils";
import ColumnSelectorCell from "./columnSelectorCell.svelte";

const DEFAULT_ROW_HEIGHT = 26;

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
    private readonly _columnsByIndex = new Map<number, SchemaColumn>();
    private _columns: SchemaColumn[] = [];
    private _filteredColumnIndices: number[] = [];
    private _rows = 0;
    private _searchText = "";

    constructor(
        columns: SchemaColumn[],
        private readonly _onSelect: (columnSchema: SchemaColumn) => void,
    ) {
        super(OPTIONS);
        this._columnLayoutManager.setEntries(1);
        this.setColumns(columns);
    }

    get columns(): number {
        return 1;
    }

    get rows(): number {
        return this._rows;
    }

    get totalRows(): number {
        return this._columns.length;
    }

    override get scrollWidth(): number {
        return 0;
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

        const columnSchema = this._columnsByIndex.get(rowIndex);
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

    protected async fetchData(): Promise<void> {
        // Column selector works entirely with local schema data.
    }

    protected async doSortData(): Promise<void> {
        // Sorting is not supported in the selector.
    }

    setColumns(columns: SchemaColumn[]): void {
        this._columns = [...columns].sort(
            (left, right) => left.column_index - right.column_index,
        );
        this._columnsByIndex.clear();
        for (const column of this._columns) {
            this._columnsByIndex.set(column.column_index, column);
        }
        this._applyFilter();
    }

    setSelectedColumn(columnIndex: number | undefined): void {
        if (columnIndex === undefined || !this._columnsByIndex.has(columnIndex)) {
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
        return this._columnsByIndex.get(columnIndex);
    }

    selectItem(columnIndex: number): SchemaColumn | undefined {
        return this._columnsByIndex.get(columnIndex);
    }

    async setSearchText(searchText: string): Promise<void> {
        if (searchText === this._searchText) {
            return;
        }

        this._searchText = searchText;
        this.setVerticalScrollOffset(0);
        this._applyFilter(true);
    }

    private _applyFilter(forceFirstVisibleRow = false): void {
        this._filteredColumnIndices = this._columns
            .filter((column) => matchesColumnSchemaSearch(column, this._searchText))
            .map((column) => column.column_index);
        this._rows = this._filteredColumnIndices.length;
        this._rowLayoutManager.setEntries(
            this._rows,
            undefined,
            this._filteredColumnIndices,
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

        this.setCursorPosition(0, this._filteredColumnIndices[0]);
    }
}
