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
import type { ColumnValue, WebviewMessage } from './types';
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
    defaultColumnWidth: 200,
    defaultRowHeight: 24,
    columnResize: true,
    minimumColumnWidth: 80,
    maximumColumnWidth: 800,
    rowResize: false,
    columnPinning: true,
    maximumPinnedColumns: 10,
    rowPinning: true,
    maximumPinnedRows: 10,
    horizontalScrollbar: true,
    verticalScrollbar: true,
    scrollbarThickness: 14,
    scrollbarOverscroll: 14,
    useEditorFont: true,
    automaticLayout: true,
    cellBorders: true,
    horizontalCellPadding: 7,
    internalCursor: true,
    cursorOffset: 0.5,
};

const OVERSCAN_FACTOR = 3;
const CACHE_TRIM_TIMEOUT = 3_000;
const MAX_AUTO_SIZE_COLUMNS = 1_000;
const AUTO_SIZE_COLUMNS_PAGE_SIZE = 250;
const AUTO_SIZE_SAMPLE_ROWS = 10;

interface UpdateDescriptor {
    columnIndices: number[];
    rowIndices: number[];
}

interface ActiveTableDataRequest {
    requestId: number;
    generation: number;
    updateDescriptor: UpdateDescriptor;
    kind: 'viewport' | 'columnWidths';
}

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
    private readonly _disposables: Array<{ dispose: () => void }> = [];
    private _widthCalculators: WidthCalculators | undefined;
    private _autoSizingEnabled = true;
    private _visible = true;
    private _lastSortKeysSignature = '';
    private _dataGeneration = 0;
    private _nextDataRequestId = 0;
    private _updating = false;
    private _pendingUpdateDescriptor: UpdateDescriptor | undefined;
    private _activeRequest: ActiveTableDataRequest | undefined;
    private _columnWidthCalculationPending = false;
    private _columnWidthCalculationColumnIndex = 0;
    private _columnWidthsCalculatedGeneration = -1;
    private _trimCacheHandle: ReturnType<typeof setTimeout> | undefined;
    private _selectionSyncEnabled = false;
    private _lastSelectionSignature = '';

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
                const firstColumnIndex = this.firstColumn?.columnIndex ?? 0;
                const firstRowIndex = this.firstRow?.rowIndex ?? 0;
                this.viewport.update((viewport) => ({
                    ...viewport,
                    scrollTop: this.verticalScrollOffset,
                    scrollLeft: this.horizontalScrollOffset,
                    firstRowIndex,
                    firstColumnIndex,
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
                    this._updateVisibleDataCache();
                }),
            },
        );
        this._selectionSyncEnabled = true;
    }

    applySelection(selection: {
        selectionType: 'cell' | 'cells' | 'columns' | 'rows';
        columnIndex?: number;
        rowIndex?: number;
        columnIndexes?: number[];
        rowIndexes?: number[];
    }): void {
        let clipboardData: ClipboardData | undefined;
        if (
            selection.selectionType === 'cell' &&
            selection.columnIndex !== undefined &&
            selection.rowIndex !== undefined
        ) {
            clipboardData = new ClipboardCell(selection.columnIndex, selection.rowIndex);
        } else if (
            selection.selectionType === 'cells' &&
            selection.columnIndexes &&
            selection.rowIndexes
        ) {
            clipboardData = new ClipboardCellIndexes(selection.columnIndexes, selection.rowIndexes);
        } else if (selection.selectionType === 'columns' && selection.columnIndexes) {
            clipboardData = new ClipboardColumnIndexes(selection.columnIndexes);
        } else if (selection.selectionType === 'rows' && selection.rowIndexes) {
            clipboardData = new ClipboardRowIndexes(selection.rowIndexes);
        }
        if (!clipboardData) {
            return;
        }
        this._lastSelectionSignature = JSON.stringify(selection);
        this.restoreClipboardDataSelection(clipboardData);
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
            return `${rowIndex}`;
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
            this._columnWidthsCalculatedGeneration = -1;
            this._columnWidthCalculationColumnIndex = 0;
            this.clearSchema();
        } else if (previousRows !== rows) {
            this.invalidateCache(InvalidateCacheFlags.Data);
        }

        this._scheduleColumnWidthCalculation();
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
        rowIndices?: number[];
        columns: ColumnValue[][];
        columnIndices?: number[];
        rowLabels?: string[];
        schema?: SchemaColumn[];
        requestId: number;
        generation: number;
    }): void {
        const activeRequest = this._activeRequest;
        if (
            params.generation !== this._dataGeneration ||
            activeRequest?.requestId !== params.requestId ||
            activeRequest.generation !== params.generation
        ) {
            return;
        }

        if (params.schema && params.schema.length > 0) {
            this.handleSchemaUpdate(params.schema);
        }

        this._tableDataCache.applyDataUpdate({
            startRow: params.startRow,
            rowIndices: params.rowIndices,
            columns: params.columns,
            columnIndices: params.columnIndices,
            rowLabels: params.rowLabels,
        });

        this._applyAutoColumnWidths(params.columnIndices);
        this._activeRequest = undefined;
        this._updating = false;

        if (activeRequest.kind === 'columnWidths') {
            this._columnWidthCalculationColumnIndex +=
                params.columnIndices?.length ?? 0;
            if (this._requestNextColumnWidthPage()) {
                return;
            }
            this._columnWidthCalculationPending = false;
            this._columnWidthCalculationColumnIndex = 0;
            this._columnWidthsCalculatedGeneration = this._dataGeneration;
        } else if (
            this._columnWidthCalculationPending &&
            this._requestNextColumnWidthPage()
        ) {
            return;
        }

        const nextUpdateDescriptor =
            this._pendingUpdateDescriptor ??
            (activeRequest.kind === 'columnWidths'
                ? this._createUpdateDescriptor()
                : activeRequest.updateDescriptor);
        this._pendingUpdateDescriptor = undefined;
        this._updateCache(nextUpdateDescriptor);
    }

    handleDataInvalidated(generation: number, schemaChanged: boolean): void {
        if (generation < this._dataGeneration) {
            return;
        }

        this._dataGeneration = generation;
        this._columnWidthsCalculatedGeneration = -1;
        this.clearPinnedRows();
        this.invalidateCache(
            schemaChanged ? InvalidateCacheFlags.All : InvalidateCacheFlags.Data,
        );
        this._scheduleColumnWidthCalculation();
        this._updateVisibleDataCache();
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
        this._updating = false;
        this._pendingUpdateDescriptor = undefined;
        this._activeRequest = undefined;
        this._columnWidthCalculationPending = false;
        this._columnWidthCalculationColumnIndex = 0;
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
        this._scheduleColumnWidthCalculation();
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

        this._updateVisibleDataCache();
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
        this._updateVisibleDataCache();
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
        this._clearTrimCacheTimeout();
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
        this._hoverManager.dispose();
        this._tableDataCache.dispose();
        super.dispose();
    }

    private _updateVisibleDataCache(): void {
        if (!this._visible) {
            return;
        }

        this._updateCache(this._createUpdateDescriptor());
    }

    private _createUpdateDescriptor(): UpdateDescriptor {
        const columnDescriptor = this.firstColumn;
        const rowDescriptor = this.firstRow;
        return {
            columnIndices: columnDescriptor
                ? this._columnLayoutManager
                      .getLayoutIndexes(
                          this.horizontalScrollOffset,
                          this.layoutWidth,
                          OVERSCAN_FACTOR,
                      )
                      .sort((left, right) => left - right)
                : [],
            rowIndices: rowDescriptor
                ? this._rowLayoutManager
                      .getLayoutIndexes(
                          this.verticalScrollOffset,
                          this.layoutHeight,
                          OVERSCAN_FACTOR,
                      )
                      .sort((left, right) => left - right)
                : [],
        };
    }

    private _updateCache(updateDescriptor: UpdateDescriptor): void {
        if (
            updateDescriptor.columnIndices.length === 0 ||
            (this.rows > 0 && updateDescriptor.rowIndices.length === 0)
        ) {
            return;
        }

        if (this._updating) {
            // Match Positron's cache scheduler: rapid viewport changes overwrite
            // one another so only the latest pending viewport is processed.
            this._pendingUpdateDescriptor = updateDescriptor;
            return;
        }

        this._clearTrimCacheTimeout();

        const { columnIndices, rowIndices } = updateDescriptor;
        const missingRowIndices = rowIndices.filter(
            (rowIndex) =>
                columnIndices.some(
                    (columnIndex) =>
                        !this._tableDataCache.hasDataCell(rowIndex, columnIndex),
                ) ||
                (this._tableDataCache.hasRowLabels &&
                    !this._tableDataCache.hasRowLabel(rowIndex)),
        );
        const hasMissingSchema = columnIndices.some(
            (columnIndex) => !this._tableDataCache.getSchemaColumn(columnIndex),
        );
        if (missingRowIndices.length === 0 && !hasMissingSchema) {
            this._scheduleCacheTrim(updateDescriptor);
            return;
        }

        const startRow = missingRowIndices[0] ?? 0;
        const endRow =
            missingRowIndices.length > 0
                ? missingRowIndices[missingRowIndices.length - 1] + 1
                : startRow;
        const requestId = ++this._nextDataRequestId;
        this._updating = true;
        this._activeRequest = {
            requestId,
            generation: this._dataGeneration,
            updateDescriptor,
            kind: 'viewport',
        };
        this._postMessage({
            type: 'requestData',
            startRow,
            endRow,
            rowIndices: missingRowIndices,
            columns: columnIndices,
            requestId,
            generation: this._dataGeneration,
        });
    }

    private _scheduleCacheTrim(
        updateDescriptor: UpdateDescriptor,
    ): void {
        this._clearTrimCacheTimeout();

        if (!this._visible) {
            return;
        }

        this._trimCacheHandle = setTimeout(() => {
            this._trimCacheHandle = undefined;
            this._trimCache(updateDescriptor);
        }, CACHE_TRIM_TIMEOUT);
    }

    private _scheduleColumnWidthCalculation(): void {
        if (
            !this._autoSizingEnabled ||
            !this._widthCalculators ||
            this.columns === 0 ||
            this.columns > MAX_AUTO_SIZE_COLUMNS ||
            this._columnWidthsCalculatedGeneration === this._dataGeneration
        ) {
            return;
        }
        this._columnWidthCalculationPending = true;
        if (!this._updating) {
            this._columnWidthCalculationColumnIndex = 0;
            this._requestNextColumnWidthPage();
        }
    }

    private _requestNextColumnWidthPage(): boolean {
        if (
            !this._columnWidthCalculationPending ||
            !this._autoSizingEnabled ||
            !this._widthCalculators ||
            this.columns === 0 ||
            this.columns > MAX_AUTO_SIZE_COLUMNS ||
            this._columnWidthCalculationColumnIndex >= this.columns
        ) {
            return false;
        }

        const pageSize = Math.min(
            AUTO_SIZE_COLUMNS_PAGE_SIZE,
            this.columns - this._columnWidthCalculationColumnIndex,
        );
        const columnIndices = Array.from(
            { length: pageSize },
            (_, index) => this._columnWidthCalculationColumnIndex + index,
        );
        const rowIndices = Array.from(
            { length: Math.min(AUTO_SIZE_SAMPLE_ROWS, this.rows) },
            (_, index) => index,
        );
        const requestId = ++this._nextDataRequestId;
        this._updating = true;
        this._activeRequest = {
            requestId,
            generation: this._dataGeneration,
            updateDescriptor: this._createUpdateDescriptor(),
            kind: 'columnWidths',
        };
        this._postMessage({
            type: 'requestData',
            startRow: 0,
            endRow: rowIndices.length,
            rowIndices,
            columns: columnIndices,
            requestId,
            generation: this._dataGeneration,
        });
        return true;
    }

    private _clearTrimCacheTimeout(): void {
        if (this._trimCacheHandle) {
            clearTimeout(this._trimCacheHandle);
            this._trimCacheHandle = undefined;
        }
    }

    private _trimCache(updateDescriptor: UpdateDescriptor): void {
        if (!this._visible) {
            return;
        }

        this._tableDataCache.trimData(
            updateDescriptor.columnIndices,
            updateDescriptor.rowIndices,
        );
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

    protected override fireOnDidUpdateEvent(): void {
        super.fireOnDidUpdateEvent();
        if (!this._selectionSyncEnabled) {
            return;
        }
        const clipboardData = this.getClipboardData();
        let selection: WebviewMessage | undefined;
        if (clipboardData instanceof ClipboardCell) {
            selection = {
                type: 'setSelection',
                selectionType: 'cell',
                columnIndex: clipboardData.columnIndex,
                rowIndex: clipboardData.rowIndex,
            };
        } else if (clipboardData instanceof ClipboardCellIndexes) {
            selection = {
                type: 'setSelection',
                selectionType: 'cells',
                columnIndexes: clipboardData.columnIndexes,
                rowIndexes: clipboardData.rowIndexes,
            };
        } else if (clipboardData instanceof ClipboardColumnIndexes) {
            selection = {
                type: 'setSelection',
                selectionType: 'columns',
                columnIndexes: clipboardData.indexes,
            };
        } else if (clipboardData instanceof ClipboardRowIndexes) {
            selection = {
                type: 'setSelection',
                selectionType: 'rows',
                rowIndexes: clipboardData.indexes,
            };
        }
        if (!selection) {
            return;
        }
        const signature = JSON.stringify(selection);
        if (signature === this._lastSelectionSignature) {
            return;
        }
        this._lastSelectionSignature = signature;
        this._postMessage(selection);
    }
}
