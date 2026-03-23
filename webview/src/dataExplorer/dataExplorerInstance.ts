/*---------------------------------------------------------------------------------------------
 *  Data Explorer Instance - Concrete implementation of DataGridInstance
 *  Manages data caching, schema, and communication with backend
 *--------------------------------------------------------------------------------------------*/

import {
    derived,
    get,
    writable,
    type Readable,
    type Writable,
} from 'svelte/store';
import {
    ClipboardCell,
    ClipboardCellIndexes,
    ClipboardColumnIndexes,
    ClipboardRowIndexes,
    ColumnSelectionState,
    DataGridInstance,
    MouseSelectionType,
    RowSelectionState,
    type ClipboardData,
    type DataGridOptions,
    type ColumnDescriptor,
    type DataGridContextMenuItem,
    type RowDescriptor,
    type ViewportState,
    type IColumnSortKey,
    type IDataColumn,
    DataColumnAlignment,
    ColumnSortKeyDescriptor,
} from '../dataGrid/dataGridInstance';
import { MAX_ADVANCED_LAYOUT_ENTRY_COUNT } from '../dataGrid/classes/layoutManager';
import { WidthCalculator } from '../dataGrid/classes/widthCalculator';
import { SimpleHoverManager } from '../dataGrid/classes/simpleHoverManager';
import type { SchemaColumn } from '../dataGrid/types';
import type { DataExplorerStores } from './stores';
import type { WebviewMessage } from './types';
import { localize } from './nls';
import {
    getEffectiveColumnDisplayType,
    shouldRightAlignDisplayType,
} from './columnDisplayTypeUtils';

/**
 * Default options for DataExplorerInstance
 */
export const DEFAULT_DATA_EXPLORER_OPTIONS: DataGridOptions = {
    columnHeaders: true,
    columnHeadersHeight: 34,
    rowHeaders: true,
    rowHeadersWidth: 55,
    rowHeadersResize: true,
    defaultColumnWidth: 120,
    defaultRowHeight: 24,
    columnResize: true,
    minimumColumnWidth: 50,
    maximumColumnWidth: 500,
    rowResize: false,
    columnPinning: true,
    maximumPinnedColumns: 10,
    rowPinning: true,
    maximumPinnedRows: 10,
    horizontalScrollbar: true,
    verticalScrollbar: true,
    scrollbarThickness: 14,
    scrollbarOverscroll: 50,
    useEditorFont: true,
    automaticLayout: true,
    rowsMargin: 0,
    cellBorders: true,
    horizontalCellPadding: 8,
    cursorInitiallyHidden: false,
    internalCursor: true,
    cursorOffset: 1,
    selection: true,
};

/**
 * DataColumn implementation for schema columns
 */
class DataExplorerColumn implements IDataColumn {
    constructor(
        readonly name: string,
        readonly description: string = '',
        readonly alignment: DataColumnAlignment = DataColumnAlignment.Left
    ) { }
}

/**
 * DataExplorerInstance - Concrete implementation of DataGridInstance for Data Explorer
 */
export class DataExplorerInstance extends DataGridInstance {
    //#region Private Properties

    private _columns: number = 0;
    private _rows: number = 0;
    private readonly _schema = new Map<number, SchemaColumn>();
    private _dataCache = new Map<number, string[]>();
    private _columnData = new Map<number, DataExplorerColumn>();
    private _rowLabelCache = new Map<number, string>();
    private _widthCalculator: WidthCalculator | undefined;
    private _autoSizingEnabled = true;
    private readonly _hoverManager = new SimpleHoverManager();

    //#endregion Private Properties

    //#region Svelte Stores (for backwards compatibility)

    readonly viewport: Writable<ViewportState>;
    readonly columnsStore: Writable<number>;
    readonly rowsStore: Writable<number>;
    readonly schemaStore: Writable<SchemaColumn[]>;
    readonly sortKeysStore: Writable<Map<number, IColumnSortKey>>;
    readonly pinnedColumnsStore: Writable<number[]>;
    readonly visibleColumns: Readable<ColumnDescriptor[]>;
    readonly visibleRows: Readable<RowDescriptor[]>;

    // Alias for backwards compatibility
    get sortKeys() {
        return this.sortKeysStore;
    }

    get pinnedColumns() {
        return this.pinnedColumnsStore;
    }

    //#endregion Svelte Stores

    //#region Constructor

    constructor(
        private readonly _stores: DataExplorerStores,
        private readonly _postMessage: (message: WebviewMessage) => void,
        options: Partial<DataGridOptions> = {},
    ) {
        // Merge with defaults
        const fullOptions = Object.assign(
            {},
            DEFAULT_DATA_EXPLORER_OPTIONS as Record<string, unknown>,
            options as Record<string, unknown>
        ) as DataGridOptions;
        super(fullOptions);

        // Initialize Svelte stores for backwards compatibility
        this.viewport = writable<ViewportState>({
            width: 0,
            height: 0,
            scrollTop: 0,
            scrollLeft: 0,
            firstRowIndex: 0,
            visibleRowCount: 0,
            firstColumnIndex: 0,
            visibleColumnCount: 0,
        });

        this.columnsStore = writable(0);
        this.rowsStore = writable(0);
        this.schemaStore = writable<SchemaColumn[]>([]);
        this.sortKeysStore = writable(new Map());
        this.pinnedColumnsStore = writable([]);

        // Derived store for visible columns
        this.visibleColumns = derived(
            [this.viewport, this.columnsStore],
            ([$viewport, $columns]) => this._calculateVisibleColumns($viewport, $columns)
        );

        // Derived store for visible rows
        this.visibleRows = derived(
            [this.viewport, this.rowsStore],
            ([$viewport, $rows]) => this._calculateVisibleRows($viewport, $rows)
        );

        // Subscribe to update triggers to sync viewport
        this.onDidUpdate(() => {
            this.viewport.update(v => ({
                ...v,
                scrollTop: this.verticalScrollOffset,
                scrollLeft: this.horizontalScrollOffset,
            }));
        });

        this.onDidChangePinnedColumns(pinnedColumns => {
            this.pinnedColumnsStore.set(pinnedColumns);
        });
    }

    //#endregion Constructor

    //#region DataGridInstance Abstract Implementation

    get columns(): number {
        return this._columns;
    }

    get rows(): number {
        return this._rows;
    }

    override get hoverManager() {
        return this._hoverManager;
    }

    column(columnIndex: number): IDataColumn | undefined {
        // Return cached column data or create from schema
        if (this._columnData.has(columnIndex)) {
            return this._columnData.get(columnIndex);
        }

        const schemaColumn = this._schema.get(columnIndex);
        if (!schemaColumn) {
            return undefined;
        }

        const column = new DataExplorerColumn(
            schemaColumn.column_name,
            schemaColumn.type_name,
            this._getAlignmentForType(schemaColumn.type_name)
        );
        this._columnData.set(columnIndex, column);
        return column;
    }

    cell(columnIndex: number, rowIndex: number): string | undefined {
        return this.getCellData(rowIndex, columnIndex);
    }

    override rowHeader(rowIndex: number): string {
        return this.getRowLabel(rowIndex) ?? super.rowHeader(rowIndex);
    }

    protected async fetchData(): Promise<void> {
        // Data fetching is handled by DataExplorer.svelte via RPC
        // This is a no-op in the instance itself
    }

    protected async doSortData(): Promise<void> {
        // Sorting is handled by the backend via RPC
        // Clear local cache when sort changes
        this.clearCache();
    }

    //#endregion DataGridInstance Abstract Implementation

    //#region Public Methods (backwards compatibility)

    /**
     * Set grid dimensions
     */
    setDimensions(columns: number, rows: number): void {
        const columnsChanged = this._columns !== columns;
        const rowsChanged = this._rows !== rows;
        if (!columnsChanged && !rowsChanged) {
            return;
        }

        this._columns = columns;
        this._rows = rows;
        if (columnsChanged) {
            this.columnsStore.set(columns);
        }
        if (rowsChanged) {
            this.rowsStore.set(rows);
        }

        // Update layout managers
        if (columnsChanged) {
            this._columnLayoutManager.setEntries(columns);
            this.clearSchema();
        }
        if (rowsChanged) {
            this._rowLayoutManager.setEntries(rows);
        }
        this._dataCache.clear();
        this._rowLabelCache.clear();

        this.fireOnDidUpdateEvent();
    }

    /**
     * Set schema
     */
    setSchema(schema: SchemaColumn[]): void {
        let didChange = false;
        for (const column of schema) {
            const previous = this._schema.get(column.column_index);
            if (
                !previous ||
                previous.column_name !== column.column_name ||
                previous.type_name !== column.type_name ||
                previous.type_display !== column.type_display ||
                previous.description !== column.description
            ) {
                this._schema.set(column.column_index, column);
                didChange = true;
            }
        }

        if (!didChange) {
            return;
        }

        this._syncSchemaStore();
        this._columnData.clear(); // Clear cached column data
        this._applyAutoColumnWidths();
        this.fireOnDidUpdateEvent();
    }

    clearSchema(): void {
        this._schema.clear();
        this._columnData.clear();
        this.schemaStore.set([]);
    }

    /**
     * Get schema column
     */
    getSchemaColumn(columnIndex: number): SchemaColumn | undefined {
        return this._schema.get(columnIndex);
    }

    /**
     * Update viewport size (store-compatible method)
     */
    override async setSize(width: number, height: number): Promise<void> {
        await super.setSize(width, height);
        this.viewport.update(v => ({
            ...v,
            width,
            height,
            visibleRowCount: this._calculateVisibleRowCount(height),
            visibleColumnCount: this._calculateVisibleColumnCount(width),
        }));
    }

    /**
     * Update scroll position (store-compatible method)
     */
    setScroll(scrollTop: number, scrollLeft: number): void {
        const firstRowIndex = Math.floor(scrollTop / this.defaultRowHeight);
        const firstColumnIndex = this._calculateFirstColumnIndex(scrollLeft);

        // Update internal scroll offsets
        this._horizontalScrollOffset = scrollLeft;
        this._verticalScrollOffset = scrollTop;

        this.viewport.update(v => ({
            ...v,
            scrollTop,
            scrollLeft,
            firstRowIndex,
            firstColumnIndex,
        }));

        this.fetchData();
        this.fireOnDidUpdateEvent();
    }

    /**
     * Get cached cell data
     */
    getCellData(rowIndex: number, columnIndex: number): string | undefined {
        const rowData = this._dataCache.get(rowIndex);
        return rowData?.[columnIndex];
    }

    /**
     * Set row data in cache
     */
    setRowData(rowIndex: number, values: string[]): void {
        this._dataCache.set(rowIndex, values);
        this.fireOnDidUpdateEvent();
    }

    /**
     * Set row data in cache for specified column indices
     */
    setRowDataForColumns(rowIndex: number, values: string[], columnIndices: number[]): void {
        if (!columnIndices.length) {
            return;
        }
        const rowData = this._dataCache.get(rowIndex) ?? new Array(this._columns);
        for (let i = 0; i < columnIndices.length; i++) {
            const columnIndex = columnIndices[i];
            rowData[columnIndex] = values[i] ?? '';
        }
        this._dataCache.set(rowIndex, rowData);
        this.fireOnDidUpdateEvent();
    }

    /**
     * Apply a block of table data and row labels with a single repaint.
     */
    applyDataUpdate(params: {
        startRow: number;
        columns: string[][];
        columnIndices?: number[];
        rowLabels?: string[];
    }): void {
        const { startRow, columns, columnIndices, rowLabels } = params;
        let didChange = false;

        if (columns.length > 0) {
            const numRows = columns[0]?.length ?? 0;
            const targetColumns =
                columnIndices ??
                Array.from({ length: columns.length }, (_, i) => i);
            for (let rowOffset = 0; rowOffset < numRows; rowOffset++) {
                const rowIndex = startRow + rowOffset;
                const rowData = this._dataCache.get(rowIndex) ?? new Array(this._columns);
                for (let i = 0; i < targetColumns.length; i++) {
                    rowData[targetColumns[i]] = columns[i]?.[rowOffset] ?? '';
                }
                this._dataCache.set(rowIndex, rowData);
            }
            didChange = didChange || numRows > 0;
        }

        if (rowLabels && rowLabels.length > 0) {
            for (let i = 0; i < rowLabels.length; i++) {
                this._rowLabelCache.set(startRow + i, rowLabels[i]);
            }
            didChange = true;
        }

        if (didChange) {
            this.fireOnDidUpdateEvent();
        }
    }

    /**
     * Clear data cache
     */
    clearCache(): void {
        this._dataCache.clear();
        this._rowLabelCache.clear();
    }

    /**
     * Set row labels in cache
     */
    setRowLabels(startRow: number, labels: string[]): void {
        for (let i = 0; i < labels.length; i++) {
            this._rowLabelCache.set(startRow + i, labels[i]);
        }
        this.fireOnDidUpdateEvent();
    }

    /**
     * Get cached row label
     */
    getRowLabel(rowIndex: number): string | undefined {
        return this._rowLabelCache.get(rowIndex);
    }

    /**
     * Get column width (with custom sizes)
     */
    getColumnWidth(columnIndex: number): number {
        const entry = this._columnLayoutManager.getLayoutEntry(columnIndex);
        return entry?.size ?? this.defaultColumnWidth;
    }

    /**
     * Get total content width
     */
    getTotalWidth(): number {
        let width = 0;
        for (let i = 0; i < this._columns; i++) {
            width += this.getColumnWidth(i);
        }
        return width;
    }

    /**
     * Get total content height
     */
    getTotalHeight(): number {
        return this._rows * this.defaultRowHeight;
    }

    /**
     * Set sort key (backwards compatible - wraps setColumnSortKey)
     */
    setSortKey(columnIndex: number, ascending: boolean): void {
        void this.setColumnSortKey(columnIndex, ascending);
    }

    /**
     * Clear all sort keys (backwards compatible)
     */
    clearSortKeys(): void {
        void this.clearColumnSortKeys();
    }

    override async setColumnSortKey(
        columnIndex: number,
        ascending: boolean,
    ): Promise<void> {
        await super.setColumnSortKey(columnIndex, ascending);
        this._syncSortKeysStore();
    }

    override async removeColumnSortKey(columnIndex: number): Promise<void> {
        await super.removeColumnSortKey(columnIndex);
        this._syncSortKeysStore();
    }

    override async clearColumnSortKeys(): Promise<void> {
        await super.clearColumnSortKeys();
        this._syncSortKeysStore();
    }

    applyBackendSortKeys(
        sortKeys: Array<{ columnIndex: number; ascending: boolean }>,
    ): void {
        const normalized = sortKeys.map((sortKey, sortIndex) => ({
            sortIndex,
            columnIndex: sortKey.columnIndex,
            ascending: sortKey.ascending,
        }));

        if (this._sameSortKeys(normalized)) {
            return;
        }

        this._columnSortKeys.clear();
        for (const sortKey of normalized) {
            this._columnSortKeys.set(
                sortKey.columnIndex,
                new ColumnSortKeyDescriptor(
                    sortKey.sortIndex,
                    sortKey.columnIndex,
                    sortKey.ascending,
                ),
            );
        }

        this._syncSortKeysStore();
        this.fireOnDidUpdateEvent();
    }

    /**
     * Provide a width calculator for auto-sizing columns.
     */
    setWidthCalculator(calculator: WidthCalculator | undefined): void {
        this._widthCalculator = calculator;
        this._applyAutoColumnWidths();
    }

    override async setColumnWidth(columnIndex: number, columnWidth: number): Promise<void> {
        this._autoSizingEnabled = false;
        await super.setColumnWidth(columnIndex, columnWidth);
    }

    copyClipboardData(clipboardData: ClipboardData): void {
        if (!this._supportsCopy()) {
            return;
        }

        if (clipboardData instanceof ClipboardCell) {
            this._postMessage({
                type: 'copyToClipboard',
                selectionType: 'cell',
                columnIndex: clipboardData.columnIndex,
                rowIndex: clipboardData.rowIndex,
            });
            return;
        }

        if (clipboardData instanceof ClipboardCellIndexes) {
            this._postMessage({
                type: 'copyToClipboard',
                selectionType: 'cells',
                columnIndexes: clipboardData.columnIndexes,
                rowIndexes: clipboardData.rowIndexes,
            });
            return;
        }

        if (clipboardData instanceof ClipboardColumnIndexes) {
            this._postMessage({
                type: 'copyToClipboard',
                selectionType: 'columns',
                columnIndexes: clipboardData.indexes,
            });
            return;
        }

        if (clipboardData instanceof ClipboardRowIndexes) {
            this._postMessage({
                type: 'copyToClipboard',
                selectionType: 'rows',
                rowIndexes: clipboardData.indexes,
            });
        }
    }

    copyCurrentSelection(): void {
        const clipboardData = this.getClipboardData();
        if (clipboardData) {
            this.copyClipboardData(clipboardData);
        }
    }

    protected override async buildColumnContextMenuItems(
        columnIndex: number,
    ): Promise<DataGridContextMenuItem[]> {
        if (this.selection) {
            await this.mouseSelectColumn(columnIndex, MouseSelectionType.Single);
        }

        const sortKey = this.getSortKey(columnIndex);
        const isSorted = !!sortKey;
        const isAscending = sortKey?.ascending ?? true;
        const supportsCopy = this._supportsCopy();
        const supportsSort = this._supportsSort();
        const supportsFilter = this._supportsFilter();
        const items: DataGridContextMenuItem[] = [
            {
                id: 'copyColumn',
                label: localize('positron.dataExplorer.copyColumn', 'Copy Column'),
                icon: 'copy',
                disabled: !supportsCopy,
                onClick: () => {
                    this.copyCurrentSelection();
                },
            },
            { id: 'sep1', label: '', separator: true },
            {
                id: 'selectColumn',
                label: localize('positron.dataExplorer.selectColumn', 'Select Column'),
                icon: 'positron-select-column',
                disabled:
                    this.columnSelectionState(columnIndex) !==
                    ColumnSelectionState.None,
                onClick: () => {
                    this.selectColumn(columnIndex);
                },
            },
        ];

        if (this.columnPinning) {
            items.push({ id: 'sep2', label: '', separator: true });
            items.push(
                this.isColumnPinned(columnIndex)
                    ? {
                          id: 'unpinColumn',
                          label: localize(
                              'positron.dataExplorer.unpinColumn',
                              'Unpin Column',
                          ),
                          icon: 'positron-unpin',
                          onClick: () => {
                              this.unpinColumn(columnIndex);
                          },
                      }
                    : {
                          id: 'pinColumn',
                          label: localize(
                              'positron.dataExplorer.pinColumn',
                              'Pin Column',
                          ),
                          icon: 'positron-pin',
                          onClick: () => {
                              this.pinColumn(columnIndex);
                          },
                      },
            );
        }

        items.push(
            { id: 'sep3', label: '', separator: true },
            {
                id: 'sortAsc',
                label: localize('positron.sortAscending', 'Sort Ascending'),
                icon: 'arrow-up',
                checked: isSorted && isAscending,
                disabled: !supportsSort,
                onClick: () => {
                    void this.setColumnSortKey(columnIndex, true);
                },
            },
            {
                id: 'sortDesc',
                label: localize('positron.sortDescending', 'Sort Descending'),
                icon: 'arrow-down',
                checked: isSorted && !isAscending,
                disabled: !supportsSort,
                onClick: () => {
                    void this.setColumnSortKey(columnIndex, false);
                },
            },
            { id: 'sep4', label: '', separator: true },
            {
                id: 'clearSort',
                label: localize('positron.clearSorting', 'Clear Sorting'),
                icon: 'positron-clear-sorting',
                disabled: !isSorted || !supportsSort,
                onClick: () => {
                    void this.removeColumnSortKey(columnIndex);
                },
            },
            { id: 'sep5', label: '', separator: true },
            {
                id: 'addFilter',
                label: localize('positron.addFilter', 'Add Filter'),
                icon: 'positron-add-filter',
                disabled: !supportsFilter,
                onClick: () => {
                    this._requestAddFilter(columnIndex);
                },
            },
        );

        return items;
    }

    protected override async buildRowContextMenuItems(
        rowIndex: number,
    ): Promise<DataGridContextMenuItem[]> {
        if (this.selection) {
            await this.mouseSelectRow(rowIndex, MouseSelectionType.Single);
        }

        const supportsCopy = this._supportsCopy();
        const items: DataGridContextMenuItem[] = [
            {
                id: 'copyRow',
                label: localize('positron.dataExplorer.copyRow', 'Copy Row'),
                icon: 'copy',
                disabled: !supportsCopy,
                onClick: () => {
                    this.copyCurrentSelection();
                },
            },
            { id: 'sep1', label: '', separator: true },
            {
                id: 'selectRow',
                label: localize('positron.dataExplorer.selectRow', 'Select Row'),
                icon: 'positron-select-row',
                disabled: this.rowSelectionState(rowIndex) !== RowSelectionState.None,
                onClick: () => {
                    this.selectRow(rowIndex);
                },
            },
        ];

        if (this.rowPinning) {
            items.push({ id: 'sep2', label: '', separator: true });
            items.push(
                this.isRowPinned(rowIndex)
                    ? {
                          id: 'unpinRow',
                          label: localize(
                              'positron.dataExplorer.unpinRow',
                              'Unpin Row',
                          ),
                          icon: 'positron-unpin',
                          onClick: () => {
                              this.unpinRow(rowIndex);
                          },
                      }
                    : {
                          id: 'pinRow',
                          label: localize(
                              'positron.dataExplorer.pinRow',
                              'Pin Row',
                          ),
                          icon: 'positron-pin',
                          onClick: () => {
                              this.pinRow(rowIndex);
                          },
                      },
            );
        }

        return items;
    }

    protected override async buildCellContextMenuItems(
        columnIndex: number,
        rowIndex: number,
    ): Promise<DataGridContextMenuItem[]> {
        const sortKey = this.getSortKey(columnIndex);
        const isSorted = !!sortKey;
        const isAscending = sortKey?.ascending ?? true;
        const supportsCopy = this._supportsCopy();
        const supportsSort = this._supportsSort();
        const supportsFilter = this._supportsFilter();
        const items: DataGridContextMenuItem[] = [
            {
                id: 'copy',
                label: localize('positron.dataExplorer.copy', 'Copy'),
                icon: 'copy',
                disabled: !supportsCopy,
                onClick: () => {
                    this.setCursorPosition(columnIndex, rowIndex);
                    this.copyCurrentSelection();
                },
            },
            { id: 'sep1', label: '', separator: true },
            {
                id: 'selectColumn',
                label: localize('positron.dataExplorer.selectColumn', 'Select Column'),
                icon: 'positron-select-column',
                disabled:
                    this.columnSelectionState(columnIndex) !==
                    ColumnSelectionState.None,
                onClick: () => {
                    this.selectColumn(columnIndex);
                },
            },
            {
                id: 'selectRow',
                label: localize('positron.dataExplorer.selectRow', 'Select Row'),
                icon: 'positron-select-row',
                disabled: this.rowSelectionState(rowIndex) !== RowSelectionState.None,
                onClick: () => {
                    this.selectRow(rowIndex);
                },
            },
        ];

        if (this.columnPinning || this.rowPinning) {
            items.push({ id: 'sep2', label: '', separator: true });

            if (this.columnPinning) {
                items.push(
                    this.isColumnPinned(columnIndex)
                        ? {
                              id: 'unpinColumn',
                              label: localize(
                                  'positron.dataExplorer.unpinColumn',
                                  'Unpin Column',
                              ),
                              icon: 'positron-unpin',
                              onClick: () => {
                                  this.unpinColumn(columnIndex);
                              },
                          }
                        : {
                              id: 'pinColumn',
                              label: localize(
                                  'positron.dataExplorer.pinColumn',
                                  'Pin Column',
                              ),
                              icon: 'positron-pin',
                              onClick: () => {
                                  this.pinColumn(columnIndex);
                              },
                          },
                );
            }

            if (this.rowPinning) {
                items.push(
                    this.isRowPinned(rowIndex)
                        ? {
                              id: 'unpinRow',
                              label: localize(
                                  'positron.dataExplorer.unpinRow',
                                  'Unpin Row',
                              ),
                              icon: 'positron-unpin',
                              onClick: () => {
                                  this.unpinRow(rowIndex);
                              },
                          }
                        : {
                              id: 'pinRow',
                              label: localize(
                                  'positron.dataExplorer.pinRow',
                                  'Pin Row',
                              ),
                              icon: 'positron-pin',
                              onClick: () => {
                                  this.pinRow(rowIndex);
                              },
                          },
                );
            }
        }

        items.push(
            { id: 'sep3', label: '', separator: true },
            {
                id: 'sortAsc',
                label: localize('positron.sortAscending', 'Sort Ascending'),
                icon: 'arrow-up',
                checked: isSorted && isAscending,
                disabled: !supportsSort,
                onClick: () => {
                    void this.setColumnSortKey(columnIndex, true);
                },
            },
            {
                id: 'sortDesc',
                label: localize('positron.sortDescending', 'Sort Descending'),
                icon: 'arrow-down',
                checked: isSorted && !isAscending,
                disabled: !supportsSort,
                onClick: () => {
                    void this.setColumnSortKey(columnIndex, false);
                },
            },
            { id: 'sep4', label: '', separator: true },
            {
                id: 'clearSort',
                label: localize('positron.clearSorting', 'Clear Sorting'),
                icon: 'positron-clear-sorting',
                disabled: !isSorted || !supportsSort,
                onClick: () => {
                    void this.removeColumnSortKey(columnIndex);
                },
            },
            { id: 'sep5', label: '', separator: true },
            {
                id: 'addFilter',
                label: localize('positron.addFilter', 'Add Filter'),
                icon: 'positron-add-filter',
                disabled: !supportsFilter,
                onClick: () => {
                    this._requestAddFilter(columnIndex);
                },
            },
        );

        return items;
    }

    //#endregion Public Methods

    //#region Private Methods

    private _isFeatureSupported(
        supportStatus: string | undefined,
    ): boolean {
        return (supportStatus ?? 'unsupported').toLowerCase() === 'supported';
    }

    private _supportsCopy(): boolean {
        const backendState = get(this._stores.state).backendState;
        return this._isFeatureSupported(
            backendState?.supported_features?.export_data_selection
                ?.support_status,
        );
    }

    private _supportsSort(): boolean {
        const backendState = get(this._stores.state).backendState;
        return (
            this._isFeatureSupported(
                backendState?.supported_features?.set_sort_columns
                    ?.support_status,
            ) &&
            (backendState?.table_shape.num_columns ?? 0) <
                MAX_ADVANCED_LAYOUT_ENTRY_COUNT
        );
    }

    private _supportsFilter(): boolean {
        const backendState = get(this._stores.state).backendState;
        return (
            this._isFeatureSupported(
                backendState?.supported_features?.set_row_filters
                    ?.support_status,
            ) &&
            (backendState?.table_shape.num_columns ?? 0) <
                MAX_ADVANCED_LAYOUT_ENTRY_COUNT
        );
    }

    private _requestAddFilter(columnIndex: number): void {
        this._stores.pendingAddFilterRequest.update((request) => ({
            columnIndex,
            columnSchema: this.getSchemaColumn(columnIndex) ?? null,
            requestId: request.requestId + 1,
        }));
    }

    private _syncSchemaStore(): void {
        this.schemaStore.set(
            Array.from(this._schema.values()).sort(
                (left, right) => left.column_index - right.column_index,
            ),
        );
    }

    private _sortedInternalSortKeys(): IColumnSortKey[] {
        return Array.from(this._columnSortKeys.values()).sort(
            (left, right) => left.sortIndex - right.sortIndex,
        );
    }

    private _syncSortKeysStore(): void {
        const sortKeys = new Map<number, IColumnSortKey>();
        for (const sortKey of this._sortedInternalSortKeys()) {
            sortKeys.set(sortKey.columnIndex, {
                sortIndex: sortKey.sortIndex,
                columnIndex: sortKey.columnIndex,
                ascending: sortKey.ascending,
            });
        }
        this.sortKeysStore.set(sortKeys);
    }

    private _sameSortKeys(sortKeys: IColumnSortKey[]): boolean {
        const current = this._sortedInternalSortKeys();
        if (current.length !== sortKeys.length) {
            return false;
        }

        return current.every((sortKey, index) => {
            const nextSortKey = sortKeys[index];
            return (
                sortKey.sortIndex === nextSortKey.sortIndex &&
                sortKey.columnIndex === nextSortKey.columnIndex &&
                sortKey.ascending === nextSortKey.ascending
            );
        });
    }

    private _calculateVisibleRowCount(height: number): number {
        const availableHeight = height - this.columnHeadersHeight - this.scrollbarThickness;
        return Math.ceil(availableHeight / this.defaultRowHeight) + 1;
    }

    private _calculateVisibleColumnCount(width: number): number {
        const availableWidth = width - this.rowHeadersWidth - this.scrollbarThickness;
        return Math.ceil(availableWidth / this.defaultColumnWidth) + 1;
    }

    private _calculateFirstColumnIndex(scrollLeft: number): number {
        let accumulatedWidth = 0;
        for (let i = 0; i < this._columns; i++) {
            accumulatedWidth += this.getColumnWidth(i);
            if (accumulatedWidth > scrollLeft) {
                return i;
            }
        }
        return 0;
    }

    private _calculateVisibleColumns(viewport: ViewportState, columns: number): ColumnDescriptor[] {
        const result: ColumnDescriptor[] = [];
        let left = 0;

        for (let i = 0; i < columns; i++) {
            const width = this.getColumnWidth(i);

            // Check if column is visible
            if (left + width > viewport.scrollLeft &&
                left < viewport.scrollLeft + viewport.width) {
                result.push({
                    columnIndex: i,
                    left: left - viewport.scrollLeft,
                    width,
                });
            }

            left += width;

            // Stop if we've gone past the visible area
            if (left > viewport.scrollLeft + viewport.width) {
                break;
            }
        }

        return result;
    }

    private _calculateVisibleRows(viewport: ViewportState, rows: number): RowDescriptor[] {
        const result: RowDescriptor[] = [];
        const rowHeight = this.defaultRowHeight;
        const startRow = Math.max(0, Math.floor(viewport.scrollTop / rowHeight));
        const endRow = Math.min(
            rows,
            Math.ceil((viewport.scrollTop + viewport.height) / rowHeight) + 1
        );

        for (let i = startRow; i < endRow; i++) {
            result.push({
                rowIndex: i,
                top: i * rowHeight - viewport.scrollTop,
                height: rowHeight,
            });
        }

        return result;
    }

    private _getAlignmentForType(typeName: string): DataColumnAlignment {
        if (
            shouldRightAlignDisplayType(
                getEffectiveColumnDisplayType(typeName),
            )
        ) {
            return DataColumnAlignment.Right;
        }

        return DataColumnAlignment.Left;
    }

    private _applyAutoColumnWidths(): void {
        if (
            !this._autoSizingEnabled ||
            !this._widthCalculator ||
            this._schema.size === 0
        ) {
            return;
        }

        for (const schemaColumn of this._schema.values()) {
            const columnName = schemaColumn.column_name ?? '';
            const typeName = schemaColumn.type_display ?? schemaColumn.type_name ?? '';
            const calculated = this._widthCalculator.calculateColumnHeaderWidth(
                columnName,
                typeName,
            );
            const clamped = Math.max(
                this.minimumColumnWidth,
                Math.min(this.maximumColumnWidth, calculated),
            );
            this._columnLayoutManager.setSizeOverride(
                schemaColumn.column_index,
                clamped,
            );
        }

        this.fireOnDidUpdateEvent();
    }

    override dispose(): void {
        this._hoverManager.dispose();
        super.dispose();
    }

    //#endregion Private Methods
}
