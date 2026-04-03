/*---------------------------------------------------------------------------------------------
 *  Table data data grid instance
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
    ColumnSortKeyDescriptor,
    DataGridInstance,
    MouseSelectionType,
    RowSelectionState,
    type ClipboardData,
    type ColumnDescriptor,
    type DataGridContextMenuItem,
    type DataGridOptions,
    type IDataColumn,
    type IColumnSortKey,
    type RowDescriptor,
    type ViewportState,
} from '../dataGrid/classes/dataGridInstance';
import { MAX_ADVANCED_LAYOUT_ENTRY_COUNT } from '../dataGrid/classes/layoutManager';
import { SimpleHoverManager } from '../dataGrid/classes/simpleHoverManager';
import { WidthCalculator } from '../dataGrid/classes/widthCalculator';
import type { SchemaColumn } from '../dataGrid/types';
import type { DataExplorerStores } from './stores';
import type { WebviewMessage } from './types';
import { localize } from './nls';
import { PositronDataExplorerColumn } from './positronDataExplorerColumn';
import {
    InvalidateCacheFlags,
    TableDataCache,
    type DataCell,
    type WidthCalculators,
} from './common/tableDataCache';

/**
 * Default options for TableDataDataGridInstance.
 */
export const DEFAULT_TABLE_DATA_DATA_GRID_OPTIONS: DataGridOptions = {
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

const VISIBLE_DATA_PAGE_SIZE = 50;
const CACHE_TRIM_TIMEOUT = 3_000;
const CACHE_TRIM_ROW_BUFFER = VISIBLE_DATA_PAGE_SIZE;

function normalizeSortKeys(
    sortKeys: Iterable<{
        columnIndex: number;
        ascending: boolean;
        sortIndex?: number;
    }>,
) {
    return Array.from(sortKeys)
        .sort((left, right) => (left.sortIndex ?? 0) - (right.sortIndex ?? 0))
        .map((sortKey) => ({
            columnIndex: sortKey.columnIndex,
            ascending: sortKey.ascending,
        }));
}

function sortKeysSignature(
    sortKeys: Array<{ columnIndex: number; ascending: boolean }>,
) {
    return sortKeys
        .map((sortKey) =>
            `${sortKey.columnIndex}:${sortKey.ascending ? 'asc' : 'desc'}`,
        )
        .join('|');
}

/**
 * TableDataDataGridInstance class.
 */
export class TableDataDataGridInstance extends DataGridInstance {
    private readonly _tableDataCache: TableDataCache;
    private readonly _hoverManager = new SimpleHoverManager();
    private readonly _pendingRequests = new Map<string, boolean>();
    private readonly _disposables: Array<{ dispose: () => void }> = [];
    private _widthCalculators: WidthCalculators | undefined;
    private _autoSizingEnabled = true;
    private _visible = true;
    private _lastSortKeysSignature = '';
    private _requestVisibleDataHandle: ReturnType<typeof setTimeout> | undefined;
    private _trimCacheHandle: ReturnType<typeof setTimeout> | undefined;

    readonly viewport: Writable<ViewportState>;
    readonly columnsStore: Writable<number>;
    readonly rowsStore: Writable<number>;
    readonly schemaStore: Writable<SchemaColumn[]>;
    readonly sortKeysStore: Writable<Map<number, IColumnSortKey>>;
    readonly pinnedColumnsStore: Writable<number[]>;
    readonly visibleColumns: Readable<ColumnDescriptor[]>;
    readonly visibleRows: Readable<RowDescriptor[]>;

    get sortKeys() {
        return this.sortKeysStore;
    }

    get pinnedColumns() {
        return this.pinnedColumnsStore;
    }

    constructor(
        private readonly _stores: DataExplorerStores,
        private readonly _postMessage: (message: WebviewMessage) => void,
        tableDataCache: TableDataCache = new TableDataCache(),
        options: Partial<DataGridOptions> = {},
    ) {
        const fullOptions = Object.assign(
            {},
            DEFAULT_TABLE_DATA_DATA_GRID_OPTIONS as Record<string, unknown>,
            options as Record<string, unknown>,
        ) as DataGridOptions;
        super(fullOptions);

        this._tableDataCache = tableDataCache;
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

        this.visibleColumns = derived(
            [this.viewport, this.columnsStore],
            ([$viewport, $columns]) =>
                this._calculateVisibleColumns($viewport, $columns),
        );
        this.visibleRows = derived(
            [this.viewport, this.rowsStore],
            ([$viewport, $rows]) => this._calculateVisibleRows($viewport, $rows),
        );

        this._disposables.push(
            this._tableDataCache.onDidUpdate(() => {
                this.fireOnDidUpdateEvent();
            }),
        );
        this._disposables.push(
            this.onDidUpdate(() => {
                this.viewport.update((viewport) => ({
                    ...viewport,
                    scrollTop: this.verticalScrollOffset,
                    scrollLeft: this.horizontalScrollOffset,
                }));
            }),
        );
        this._disposables.push(
            this.onDidChangePinnedColumns((pinnedColumns) => {
                this.pinnedColumnsStore.set(pinnedColumns);
            }),
        );
        this._disposables.push(
            {
                dispose: this.viewport.subscribe(() => {
                    this._scheduleVisibleDataRequest();
                }),
            },
        );
    }

    get columns(): number {
        return this._tableDataCache.columns;
    }

    get rows(): number {
        return this._tableDataCache.rows;
    }

    override get hoverManager() {
        return this._hoverManager;
    }

    column(columnIndex: number): IDataColumn | undefined {
        const schemaColumn = this._tableDataCache.getSchemaColumn(columnIndex);
        if (!schemaColumn) {
            return undefined;
        }

        return new PositronDataExplorerColumn(schemaColumn);
    }

    cell(columnIndex: number, rowIndex: number): string | undefined {
        return this.getCellData(rowIndex, columnIndex);
    }

    override rowHeader(rowIndex: number): string {
        if (!this._tableDataCache.hasRowLabels) {
            return super.rowHeader(rowIndex);
        }

        return this._tableDataCache.getRowLabel(rowIndex) ?? '...';
    }

    override async setSize(width: number, height: number): Promise<void> {
        await super.setSize(width, height);
        this.viewport.update((viewport) => ({
            ...viewport,
            width,
            height,
            visibleRowCount: this._calculateVisibleRowCount(height),
            visibleColumnCount: this._calculateVisibleColumnCount(width),
        }));
    }

    setScroll(scrollTop: number, scrollLeft: number): void {
        this._horizontalScrollOffset = scrollLeft;
        this._verticalScrollOffset = scrollTop;
        this.viewport.update((viewport) => ({
            ...viewport,
            scrollTop,
            scrollLeft,
            firstRowIndex: Math.floor(scrollTop / this.defaultRowHeight),
            firstColumnIndex: this._calculateFirstColumnIndex(scrollLeft),
        }));
        this.fireOnDidUpdateEvent();
    }

    getCellData(rowIndex: number, columnIndex: number): string | undefined {
        return this._tableDataCache.getCellFormatted(rowIndex, columnIndex);
    }

    getDataCell(rowIndex: number, columnIndex: number): DataCell | undefined {
        return this._tableDataCache.getDataCell(rowIndex, columnIndex);
    }

    getColumnWidth(columnIndex: number): number {
        return (
            this._columnLayoutManager.getLayoutEntry(columnIndex)?.size ??
            this.defaultColumnWidth
        );
    }

    setDimensions(columns: number, rows: number, hasRowLabels = false): void {
        const previousColumns = this.columns;
        const previousRows = this.rows;
        const dimensionsChanged = this._tableDataCache.setDimensions(
            columns,
            rows,
            hasRowLabels,
        );
        if (!dimensionsChanged) {
            return;
        }

        this.columnsStore.set(columns);
        this.rowsStore.set(rows);
        this._columnLayoutManager.setEntries(columns);
        this._rowLayoutManager.setEntries(rows);

        if (previousColumns !== columns) {
            this.clearSchema();
        } else if (previousRows !== rows) {
            this.invalidateCache(InvalidateCacheFlags.Data);
        }

        this.fireOnDidUpdateEvent();
    }

    handleSchemaUpdate(schema: SchemaColumn[]): void {
        if (!this._tableDataCache.setSchema(schema)) {
            return;
        }

        this.schemaStore.set(this._tableDataCache.getSchemaColumns());
        this._applyAutoColumnWidths();
        this.fireOnDidUpdateEvent();
    }

    handleDataUpdate(params: {
        startRow: number;
        columns: string[][];
        columnIndices?: number[];
        rowLabels?: string[];
        schema?: SchemaColumn[];
    }): void {
        if (params.schema && params.schema.length > 0) {
            this.handleSchemaUpdate(params.schema);
        }

        this._tableDataCache.applyDataUpdate({
            startRow: params.startRow,
            columns: params.columns,
            columnIndices: params.columnIndices,
            rowLabels: params.rowLabels,
        });

        const requestKey = this._getRequestKey(params.startRow, params.columnIndices);
        this._pendingRequests.delete(requestKey);
        this._applyAutoColumnWidths(params.columnIndices);
    }

    handleBackendStateChanged(
        nextState:
            | {
                  table_shape: { num_columns: number; num_rows: number };
                  has_row_labels?: boolean;
                  sort_keys: Array<{
                      column_index: number;
                      ascending: boolean;
                  }>;
              }
            | null
            | undefined,
        options?: {
            schemaInvalidated?: boolean;
        },
    ): void {
        if (!nextState) {
            return;
        }

        this.setDimensions(
            nextState.table_shape.num_columns,
            nextState.table_shape.num_rows,
            nextState.has_row_labels ?? false,
        );

        if (options?.schemaInvalidated) {
            this.clearSchema();
        }

        const backendSortKeys = normalizeSortKeys(
            nextState.sort_keys.map((sortKey, sortIndex) => ({
                sortIndex,
                columnIndex: sortKey.column_index,
                ascending: sortKey.ascending,
            })),
        );
        this._lastSortKeysSignature = sortKeysSignature(backendSortKeys);
        this.applyBackendSortKeys(backendSortKeys);
    }

    clearSchema(): void {
        this._tableDataCache.clear(InvalidateCacheFlags.ColumnSchema);
        this.schemaStore.set([]);
    }

    clearCache(): void {
        this.invalidateCache(InvalidateCacheFlags.Data);
    }

    clearSortKeys(): void {
        void this.clearColumnSortKeys();
    }

    invalidateCache(invalidateCache: InvalidateCacheFlags): void {
        this._clearTrimCacheTimeout();
        this._tableDataCache.clear(invalidateCache);
        if (invalidateCache & InvalidateCacheFlags.ColumnSchema) {
            this.schemaStore.set([]);
        }
        this._pendingRequests.clear();
        this.fireOnDidUpdateEvent();
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

    setWidthCalculators(widthCalculators?: WidthCalculators): void {
        this._widthCalculators = widthCalculators;
        this._tableDataCache.setWidthCalculators(widthCalculators);
        this._applyAutoColumnWidths();
    }

    setWidthCalculator(calculator: WidthCalculator | undefined): void {
        if (!calculator) {
            this.setWidthCalculators(undefined);
            return;
        }

        const editorFont =
            typeof document === 'undefined'
                ? '400 13px monospace'
                : (() => {
                      const rootStyle = getComputedStyle(
                          document.documentElement,
                      );
                      const fontFamily =
                          rootStyle
                              .getPropertyValue('--vscode-editor-font-family')
                              .trim() || 'monospace';
                      const fontSize =
                          rootStyle
                              .getPropertyValue('--vscode-editor-font-size')
                              .trim() || '13px';
                      return `400 ${fontSize} ${fontFamily}`;
                  })();
        const spaceWidth = calculator.measureSpaceWidth(editorFont);
        this.setWidthCalculators({
            columnHeaderWidthCalculator: (columnName: string, typeName: string) =>
                calculator.calculateColumnHeaderWidth(columnName, typeName),
            columnValueWidthCalculator: (length: number) =>
                calculator.calculateCellValueWidth(length, spaceWidth),
        });
    }

    setVisible(visible: boolean): void {
        this._visible = visible;
        if (!visible) {
            this._clearTrimCacheTimeout();
            return;
        }

        this._scheduleVisibleDataRequest();
    }

    override async setColumnWidth(
        columnIndex: number,
        columnWidth: number,
    ): Promise<void> {
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

    protected async fetchData(): Promise<void> {
        this._scheduleVisibleDataRequest();
    }

    protected async doSortData(): Promise<void> {
        this._syncSortKeysStore();

        const sortKeysToSend = this._sortedInternalSortKeys().map((sortKey) => ({
            columnIndex: sortKey.columnIndex,
            ascending: sortKey.ascending,
        }));
        const nextSignature = sortKeysSignature(sortKeysToSend);
        if (nextSignature === this._lastSortKeysSignature) {
            return;
        }

        this._lastSortKeysSignature = nextSignature;

        if (sortKeysToSend.length === 0) {
            this._postMessage({ type: 'clearSort' });
        } else {
            this._postMessage({
                type: 'sort',
                sortKeys: sortKeysToSend,
            });
        }

        this.invalidateCache(InvalidateCacheFlags.Data);
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
                disabled:
                    this.rowSelectionState(rowIndex) !== RowSelectionState.None,
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
                disabled:
                    this.rowSelectionState(rowIndex) !== RowSelectionState.None,
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

    override dispose(): void {
        if (this._requestVisibleDataHandle) {
            clearTimeout(this._requestVisibleDataHandle);
        }
        this._clearTrimCacheTimeout();
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
        this._hoverManager.dispose();
        this._tableDataCache.dispose();
        super.dispose();
    }

    private _scheduleVisibleDataRequest(): void {
        if (!this._visible) {
            return;
        }

        if (this._requestVisibleDataHandle) {
            clearTimeout(this._requestVisibleDataHandle);
        }

        this._requestVisibleDataHandle = setTimeout(() => {
            this._requestVisibleDataHandle = undefined;
            this._requestVisibleData();
            this._scheduleCacheTrim();
        }, 50);
    }

    private _requestVisibleData(): void {
        if (this.columns === 0 || this.rows === 0) {
            return;
        }

        const viewport = get(this.viewport);
        const visibleColumns = get(this.visibleColumns);
        const startRow =
            Math.floor(viewport.firstRowIndex / VISIBLE_DATA_PAGE_SIZE) *
            VISIBLE_DATA_PAGE_SIZE;
        const endRow = Math.min(startRow + VISIBLE_DATA_PAGE_SIZE, this.rows);
        const columnIndices = visibleColumns.map((column) => column.columnIndex);
        const requestKey = this._getRequestKey(startRow, columnIndices);

        if (this._pendingRequests.has(requestKey)) {
            return;
        }

        const hasCachedData = columnIndices.length
            ? columnIndices.every((columnIndex) =>
                  this._tableDataCache.hasDataCell(startRow, columnIndex),
              )
            : this._tableDataCache.hasDataCell(startRow, 0);
        const hasCachedRowLabels = this._tableDataCache.hasRowLabelsInRange(
            startRow,
            endRow,
        );
        if (hasCachedData && hasCachedRowLabels) {
            return;
        }

        this._pendingRequests.set(requestKey, true);
        this._postMessage({
            type: 'requestData',
            startRow,
            endRow,
            columns: columnIndices,
        });
    }

    private _scheduleCacheTrim(): void {
        this._clearTrimCacheTimeout();

        if (!this._visible) {
            return;
        }

        this._trimCacheHandle = setTimeout(() => {
            this._trimCacheHandle = undefined;
            this._trimCache();
        }, CACHE_TRIM_TIMEOUT);
    }

    private _clearTrimCacheTimeout(): void {
        if (this._trimCacheHandle) {
            clearTimeout(this._trimCacheHandle);
            this._trimCacheHandle = undefined;
        }
    }

    private _trimCache(): void {
        if (!this._visible || this.rows === 0) {
            return;
        }

        const visibleColumns = get(this.visibleColumns).map(
            (column) => column.columnIndex,
        );
        if (visibleColumns.length === 0) {
            return;
        }

        const viewport = get(this.viewport);
        const firstVisibleRow = Math.max(0, viewport.firstRowIndex);
        const lastVisibleRow = Math.min(
            this.rows,
            firstVisibleRow + Math.max(viewport.visibleRowCount, 1),
        );
        const keepStartRow = Math.max(
            0,
            Math.floor(firstVisibleRow / VISIBLE_DATA_PAGE_SIZE) *
                VISIBLE_DATA_PAGE_SIZE -
                CACHE_TRIM_ROW_BUFFER,
        );
        const keepEndRow = Math.min(
            this.rows,
            Math.ceil(lastVisibleRow / VISIBLE_DATA_PAGE_SIZE) *
                VISIBLE_DATA_PAGE_SIZE +
                CACHE_TRIM_ROW_BUFFER,
        );

        this._tableDataCache.trimData(visibleColumns, keepStartRow, keepEndRow);
    }

    private _getRequestKey(startRow: number, columnIndices?: number[]): string {
        const columnKey = columnIndices?.length ? columnIndices.join(',') : 'all';
        return `${startRow}:${columnKey}`;
    }

    private _requestAddFilter(columnIndex: number): void {
        this._stores.pendingAddFilterRequest.update((request) => ({
            columnIndex,
            columnSchema: this._tableDataCache.getSchemaColumn(columnIndex) ?? null,
            requestId: request.requestId + 1,
        }));
    }

    private _supportsCopy(): boolean {
        const backendState = get(this._stores.state).backendState;
        return (
            backendState?.supported_features?.export_data_selection
                ?.support_status === 'supported'
        );
    }

    private _supportsSort(): boolean {
        const backendState = get(this._stores.state).backendState;
        return (
            backendState?.supported_features?.set_sort_columns?.support_status ===
                'supported' &&
            (backendState?.table_shape.num_columns ?? 0) <
                MAX_ADVANCED_LAYOUT_ENTRY_COUNT
        );
    }

    private _supportsFilter(): boolean {
        const backendState = get(this._stores.state).backendState;
        return (
            backendState?.supported_features?.set_row_filters?.support_status ===
                'supported' &&
            (backendState?.table_shape.num_columns ?? 0) <
                MAX_ADVANCED_LAYOUT_ENTRY_COUNT
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

    private _sortedInternalSortKeys(): IColumnSortKey[] {
        return Array.from(this._columnSortKeys.values()).sort(
            (left, right) => left.sortIndex - right.sortIndex,
        );
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

    private _calculateVisibleColumns(
        viewport: ViewportState,
        columns: number,
    ): ColumnDescriptor[] {
        const result: ColumnDescriptor[] = [];
        let left = 0;

        for (let columnIndex = 0; columnIndex < columns; columnIndex++) {
            const width = this.getColumnWidth(columnIndex);
            if (
                left + width > viewport.scrollLeft &&
                left < viewport.scrollLeft + viewport.width
            ) {
                result.push({
                    columnIndex,
                    left: left - viewport.scrollLeft,
                    width,
                });
            }

            left += width;
            if (left > viewport.scrollLeft + viewport.width) {
                break;
            }
        }

        return result;
    }

    private _calculateVisibleRows(
        viewport: ViewportState,
        rows: number,
    ): RowDescriptor[] {
        const result: RowDescriptor[] = [];
        const rowHeight = this.defaultRowHeight;
        const startRow = Math.max(0, Math.floor(viewport.scrollTop / rowHeight));
        const endRow = Math.min(
            rows,
            Math.ceil((viewport.scrollTop + viewport.height) / rowHeight) + 1,
        );

        for (let rowIndex = startRow; rowIndex < endRow; rowIndex++) {
            result.push({
                rowIndex,
                top: rowIndex * rowHeight - viewport.scrollTop,
                height: rowHeight,
            });
        }

        return result;
    }

    private _calculateVisibleRowCount(height: number): number {
        const availableHeight =
            height - this.columnHeadersHeight - this.scrollbarThickness;
        return Math.ceil(availableHeight / this.defaultRowHeight) + 1;
    }

    private _calculateVisibleColumnCount(width: number): number {
        const availableWidth =
            width - this.rowHeadersWidth - this.scrollbarThickness;
        return Math.ceil(availableWidth / this.defaultColumnWidth) + 1;
    }

    private _calculateFirstColumnIndex(scrollLeft: number): number {
        let accumulatedWidth = 0;
        for (let columnIndex = 0; columnIndex < this.columns; columnIndex++) {
            accumulatedWidth += this.getColumnWidth(columnIndex);
            if (accumulatedWidth > scrollLeft) {
                return columnIndex;
            }
        }
        return 0;
    }

    private _applyAutoColumnWidths(columnIndices?: number[]): void {
        if (
            !this._autoSizingEnabled ||
            !this._widthCalculators
        ) {
            return;
        }

        const targetColumns =
            columnIndices ??
            this._tableDataCache
                .getSchemaColumns()
                .map((schemaColumn) => schemaColumn.column_index);

        if (targetColumns.length === 0) {
            return;
        }

        for (const columnIndex of targetColumns) {
            const calculated = this._tableDataCache.getAutoColumnWidth(
                columnIndex,
                this.minimumColumnWidth,
                this.maximumColumnWidth,
            );
            if (calculated === undefined) {
                continue;
            }
            this._columnLayoutManager.setSizeOverride(columnIndex, calculated);
        }

        this.fireOnDidUpdateEvent();
    }
}
