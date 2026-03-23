/*---------------------------------------------------------------------------------------------
 *  Table Summary Data Grid Instance - Port from Positron's tableSummaryDataGridInstance
 *  Renders the summary rows for each column in the data explorer
 *--------------------------------------------------------------------------------------------*/

import { get, writable, type Readable } from 'svelte/store';
import {
    DataGridInstance,
    type DataGridOptions,
    type ColumnDescriptor,
    type RowDescriptor,
    type IDataColumn,
    type DataGridCellContent,
} from '../dataGrid/dataGridInstance';
import { SimpleHoverManager } from '../dataGrid/classes/simpleHoverManager';
import type { SchemaColumn, BackendState } from '../dataGrid/types';
import type { DataExplorerStores } from './stores';
import type { SearchSchemaSortOrder, WebviewMessage } from './types';
import {
    canExpandSummaryForDisplayType,
    getEffectiveColumnDisplayType,
    isBooleanDisplayType,
    isDateDisplayType,
    isDatetimeDisplayType,
    isNumericDisplayType,
    isObjectDisplayType,
    isStringDisplayType,
} from './columnDisplayTypeUtils';
import { matchesColumnSchemaSearch } from './columnSchemaUtils';
import ColumnSummaryCell from './components/ColumnSummaryCell.svelte';
import { TableSummaryCache } from './tableSummaryCache';

/**
 * Constants.
 */
const SUMMARY_HEIGHT = 34;
const PROFILE_LINE_HEIGHT = 20;
const OVERSCAN_FACTOR = 3;

const COLUMN_PROFILE_NUMBER_LINE_COUNT = 6;
const COLUMN_PROFILE_BOOLEAN_LINE_COUNT = 3;
const COLUMN_PROFILE_STRING_LINE_COUNT = 3;
const COLUMN_PROFILE_DATE_LINE_COUNT = 4;
const COLUMN_PROFILE_DATE_TIME_LINE_COUNT = 5;
const COLUMN_PROFILE_OBJECT_LINE_COUNT = 3;

/**
 * TableSummaryDataGridInstance class.
 */
export class TableSummaryDataGridInstance extends DataGridInstance {
    //#region Private Properties

    private _sourceColumns: SchemaColumn[] = [];
    private _visibleColumns: SchemaColumn[] = [];
    private _schemaByIndex = new Map<number, SchemaColumn>();
    private _rows = 0;
    private _searchText = '';
    private _sortOption: SearchSchemaSortOrder = 'original';
    private _supportsSearchSchema = false;
    private _supportsColumnProfiles = false;
    private _supportsSummaryStats = false;
    private _pinnedColumns: number[] = [];
    private _expandedColumns = new Set<number>();
    private _visible = false;
    private _initialSummaryLoaded = false;
    private _pendingSearchRefresh = false;
    private _pendingProfileRefresh = false;
    private _activeSearchRequestId = 0;
    private readonly _summaryCache: TableSummaryCache;
    private readonly _disposables: Array<() => void> = [];
    private readonly _hoverManager = new SimpleHoverManager(0);

    //#endregion Private Properties

    //#region Svelte Stores

    readonly visibleColumns = writable<ColumnDescriptor[]>([]);
    readonly visibleRows = writable<RowDescriptor[]>([]);

    //#endregion Svelte Stores

    //#region Constructor

    constructor(
        private readonly _stores: DataExplorerStores,
        private readonly _postMessage: (message: WebviewMessage) => void,
        pinnedColumnsStore?: Readable<number[]>,
    ) {
        const options: DataGridOptions = {
            columnHeaders: false,
            rowHeaders: false,
            defaultColumnWidth: 0,
            defaultRowHeight: SUMMARY_HEIGHT,
            columnResize: false,
            rowResize: false,
            columnPinning: false,
            rowPinning: true,
            maximumPinnedRows: 10,
            horizontalScrollbar: false,
            verticalScrollbar: true,
            scrollbarThickness: 14,
            scrollbarOverscroll: 0,
            useEditorFont: false,
            automaticLayout: true,
            cellBorders: false,
            horizontalCellPadding: 0,
            cursorInitiallyHidden: true,
            internalCursor: true,
            cursorOffset: 0,
            selection: false,
        };
        super(options);

        this._summaryCache = new TableSummaryCache(_stores, _postMessage);

        // Always a single column.
        this._columnLayoutManager.setEntries(1);

        const initialState = get(this._stores.state).backendState;
        this._updateSupportedFeatures(initialState);
        this._searchText = get(this._stores.summarySearchText);
        this._sortOption = get(this._stores.summarySortOrder);

        this._disposables.push(
            this._stores.summaryExpandedColumns.subscribe((expanded) => {
                this._syncExpandedRows(expanded);
                if (this._visible) {
                    void this.fetchData();
                } else {
                    this._pendingProfileRefresh = true;
                }
            }),
        );

        if (pinnedColumnsStore) {
            this._disposables.push(
                pinnedColumnsStore.subscribe((columns) => {
                    void this._handlePinnedColumnsChanged(columns);
                }),
            );
        }

        this.onDidUpdate(() => {
            this.viewport.update((v) => ({
                ...v,
                scrollTop: this.verticalScrollOffset,
                scrollLeft: this.horizontalScrollOffset,
            }));
            this._updateVisibleDescriptors();
        });

        this._updateLayoutEntries();
    }

    //#endregion Constructor

    //#region DataGridInstance Properties

    get columns(): number {
        return 1;
    }

    get rows(): number {
        return this._rows;
    }

    override get hoverManager() {
        return this._hoverManager;
    }

    get searchText(): string {
        return this._searchText;
    }

    get sortOption(): SearchSchemaSortOrder {
        return this._sortOption;
    }

    get profileFormatOptions() {
        return {
            large_num_digits: 2,
            small_num_digits: 4,
            max_integral_digits: 7,
            max_value_length: 1000,
            thousands_sep: ',',
        };
    }

    //#endregion DataGridInstance Properties

    //#region DataGridInstance Methods

    override async setSize(width: number, height: number): Promise<void> {
        await super.setSize(width, height);
        this.viewport.set({
            width,
            height,
            scrollTop: this.verticalScrollOffset,
            scrollLeft: this.horizontalScrollOffset,
        });
        this._updateVisibleDescriptors();
    }

    override getCustomColumnWidth(columnIndex: number): number | undefined {
        return columnIndex === 0 ? this.layoutWidth : undefined;
    }

    getCellData(_rowIndex: number, _columnIndex: number): string | undefined {
        return '';
    }

    column(_columnIndex: number): IDataColumn | undefined {
        return undefined;
    }

    cell(columnIndex: number, rowIndex: number): DataGridCellContent | undefined {
        if (columnIndex !== 0) {
            return undefined;
        }

        const columnSchema = this._schemaByIndex.get(rowIndex);
        if (!columnSchema) {
            return undefined;
        }

        return {
            kind: 'component',
            component: ColumnSummaryCell,
            props: {
                columnIndex: rowIndex,
                columnSchema,
                instance: this,
            },
        };
    }

    protected async fetchData(): Promise<void> {
        if (!this._supportsColumnProfiles || !this._visible) {
            return;
        }

        const columnIndices = this._rowLayoutManager.getLayoutIndexes(
            this.verticalScrollOffset,
            this.layoutHeight,
            OVERSCAN_FACTOR,
        );
        this._summaryCache.requestColumnProfiles(
            columnIndices,
            this._expandedColumns,
            (columnIndex) => this._schemaByIndex.get(columnIndex),
            this._supportsColumnProfiles,
        );
    }

    protected async doSortData(): Promise<void> {
        // Sorting is handled by the backend or by the summary instance itself.
    }

    //#endregion DataGridInstance Methods

    //#region Public Methods

    async setVisible(visible: boolean): Promise<void> {
        this._visible = visible;

        if (!visible) {
            return;
        }

        if (!this._initialSummaryLoaded || this._pendingSearchRefresh) {
            await this._requestSummarySchema(true);
            return;
        }

        if (this._pendingProfileRefresh) {
            this._pendingProfileRefresh = false;
            await this.fetchData();
            return;
        }

        await this.fetchData();
    }

    handleBackendStateChanged(
        previousState: BackendState | null | undefined,
        nextState: BackendState | null | undefined,
    ): void {
        const previousSupportsSearch = this._isSupported(
            previousState?.supported_features?.search_schema?.support_status,
        );
        const previousSupportsProfiles = this._isSupported(
            previousState?.supported_features?.get_column_profiles?.support_status,
        );

        this._updateSupportedFeatures(nextState);

        if (!nextState || !previousState) {
            return;
        }

        const columnsChanged =
            previousState.table_shape.num_columns !==
            nextState.table_shape.num_columns;
        const rowsChanged =
            previousState.table_shape.num_rows !== nextState.table_shape.num_rows;
        const rowFiltersChanged =
            JSON.stringify(previousState.row_filters ?? []) !==
            JSON.stringify(nextState.row_filters ?? []);
        const searchSupportChanged =
            previousSupportsSearch !== this._supportsSearchSchema;
        const profileSupportChanged =
            previousSupportsProfiles !== this._supportsColumnProfiles;

        if (columnsChanged || searchSupportChanged) {
            this._summaryCache.invalidateProfiles();
            this._sourceColumns = [];
            this._applyVisibleColumns([]);
            this._initialSummaryLoaded = false;
            this._queueSearchRefresh();
            return;
        }

        if (rowsChanged || rowFiltersChanged) {
            this._summaryCache.invalidateProfiles();
            this._queueProfileRefresh();
            return;
        }

        if (profileSupportChanged) {
            if (!this._supportsColumnProfiles) {
                this._summaryCache.invalidateProfiles();
            } else {
                this._queueProfileRefresh();
            }
        }
    }

    handleSchemaUpdated(): void {
        this._summaryCache.invalidateProfiles();
        this._sourceColumns = [];
        this._applyVisibleColumns([]);
        this._initialSummaryLoaded = false;
        this._queueSearchRefresh();
    }

    handleDataUpdated(): void {
        this._summaryCache.invalidateProfiles();
        this._queueProfileRefresh();
    }

    handleSummarySchema(
        params: {
            columns: SchemaColumn[];
            columnIndices: number[];
            requestId?: number;
        },
    ): void {
        if (
            params.requestId !== undefined &&
            params.requestId !== this._activeSearchRequestId
        ) {
            return;
        }

        const columnMap = new Map(
            params.columns.map((column) => [column.column_index, column]),
        );
        const ordered = params.columnIndices
            .map((columnIndex) => columnMap.get(columnIndex))
            .filter((column): column is SchemaColumn => Boolean(column));

        this._sourceColumns = ordered;
        this._initialSummaryLoaded = true;
        this._pendingSearchRefresh = false;

        if (this._supportsSearchSchema) {
            this._applyVisibleColumns(ordered);
        } else {
            this._applyVisibleColumns(this._computeLocalVisibleColumns());
        }
    }

    handleColumnProfiles(
        profiles: Array<{ columnIndex: number; profile: unknown }>,
        error?: string,
        requestId?: number,
    ): void {
        this._summaryCache.handleColumnProfiles(profiles, error, requestId);
        if (this._expandedColumns.size > 0) {
            this._applyExpandedRowHeights();
        }
        this.fireOnDidUpdateEvent();
    }

    isColumnExpanded(columnIndex: number): boolean {
        return this._expandedColumns.has(columnIndex);
    }

    canToggleColumnExpansion(columnIndex: number): boolean {
        if (!this._supportsColumnProfiles) {
            return false;
        }

        if (!this._supportsSummaryStats) {
            return false;
        }

        const schema = this._schemaByIndex.get(columnIndex);
        if (!schema) {
            return false;
        }

        return canExpandSummaryForDisplayType(
            getEffectiveColumnDisplayType(
                this._summaryCache.getColumnProfile(columnIndex)?.summary_stats
                    ?.type_display,
                getEffectiveColumnDisplayType(
                    schema.type_display,
                    schema.type_name,
                ),
            ),
        );
    }

    toggleExpandColumn(columnIndex: number): void {
        this._stores.summaryExpandedColumns.update((set) => {
            const next = new Set(set);
            if (next.has(columnIndex)) {
                next.delete(columnIndex);
            } else {
                next.add(columnIndex);
            }
            return next;
        });
    }

    getColumnSchema(columnIndex: number): SchemaColumn | undefined {
        return this._schemaByIndex.get(columnIndex);
    }

    getColumnProfile(columnIndex: number) {
        return this._summaryCache.getColumnProfile(columnIndex);
    }

    getColumnProfileNullCount(columnIndex: number) {
        return this._summaryCache.getColumnProfile(columnIndex)?.null_count;
    }

    getColumnProfileNullPercent(columnIndex: number) {
        const rows = get(this._stores.numRows);
        if (!rows) {
            return 0;
        }

        const nullCount = this.getColumnProfileNullCount(columnIndex);
        if (nullCount === undefined) {
            return undefined;
        }

        return (nullCount * 100) / rows;
    }

    getColumnProfileSummaryStats(columnIndex: number) {
        return this._summaryCache.getColumnProfile(columnIndex)?.summary_stats;
    }

    getColumnProfileSmallHistogram(columnIndex: number) {
        return this._summaryCache.getColumnProfile(columnIndex)?.small_histogram;
    }

    getColumnProfileLargeHistogram(columnIndex: number) {
        return this._summaryCache.getColumnProfile(columnIndex)?.large_histogram;
    }

    getColumnProfileSmallFrequencyTable(columnIndex: number) {
        return this._summaryCache.getColumnProfile(columnIndex)?.small_frequency_table;
    }

    getColumnProfileLargeFrequencyTable(columnIndex: number) {
        return this._summaryCache.getColumnProfile(columnIndex)?.large_frequency_table;
    }

    async setSearchText(searchText: string): Promise<void> {
        if (this._searchText === searchText) {
            return;
        }

        this._searchText = searchText;
        this._stores.summarySearchText.set(searchText);

        if (this._supportsSearchSchema) {
            await this._requestSummarySchema();
            return;
        }

        this._applyVisibleColumns(this._computeLocalVisibleColumns());
    }

    async setSortOption(sortOption: SearchSchemaSortOrder): Promise<void> {
        if (this._sortOption === sortOption) {
            return;
        }

        this._sortOption = sortOption;
        this._stores.summarySortOrder.set(sortOption);

        if (this._supportsSearchSchema) {
            await this._requestSummarySchema();
            return;
        }

        this._applyVisibleColumns(this._computeLocalVisibleColumns());
    }

    //#endregion Public Methods

    //#region Private Methods

    private _isSupported(supportStatus: string | undefined): boolean {
        return (supportStatus ?? 'unsupported').toLowerCase() === 'supported';
    }

    private _updateSupportedFeatures(state: BackendState | null | undefined): void {
        this._supportsSearchSchema = this._isSupported(
            state?.supported_features?.search_schema?.support_status,
        );
        this._supportsColumnProfiles = this._isSupported(
            state?.supported_features?.get_column_profiles?.support_status,
        );

        const supportedTypes = (
            state?.supported_features?.get_column_profiles?.supported_types ?? []
        ) as unknown[];
        if (!this._supportsColumnProfiles) {
            this._supportsSummaryStats = false;
            return;
        }

        if (supportedTypes.length === 0) {
            this._supportsSummaryStats = true;
            return;
        }

        this._supportsSummaryStats = supportedTypes.some((typeSupport) => {
            if (typeof typeSupport === 'string') {
                return typeSupport === 'summary_stats';
            }

            if (
                typeSupport &&
                typeof typeSupport === 'object' &&
                'profile_type' in typeSupport
            ) {
                const profileType = String(typeSupport.profile_type);
                const supportStatus =
                    'support_status' in typeSupport
                        ? String(typeSupport.support_status)
                        : undefined;
                return (
                    profileType === 'summary_stats' &&
                    this._isSupported(
                        typeof supportStatus === 'string'
                            ? supportStatus
                            : undefined,
                    )
                );
            }

            return false;
        });
    }

    private async _handlePinnedColumnsChanged(columns: number[]): Promise<void> {
        const changed =
            columns.length !== this._pinnedColumns.length ||
            columns.some((column, index) => column !== this._pinnedColumns[index]);
        if (!changed) {
            return;
        }

        this._pinnedColumns = columns;

        if (this._supportsSearchSchema) {
            await this._requestSummarySchema();
            return;
        }

        this._applyVisibleColumns(this._computeLocalVisibleColumns());
    }

    private async _requestSummarySchema(force = false): Promise<void> {
        if (!this._visible) {
            this._pendingSearchRefresh = true;
            return;
        }

        if (!this._supportsSearchSchema && !force && this._initialSummaryLoaded) {
            this._pendingSearchRefresh = false;
            this._applyVisibleColumns(this._computeLocalVisibleColumns());
            return;
        }

        this._pendingSearchRefresh = true;
        this._activeSearchRequestId += 1;
        this._postMessage({
            type: 'searchSchema',
            text: this._supportsSearchSchema ? this._searchText : '',
            sortOrder: this._supportsSearchSchema ? this._sortOption : 'original',
            pinnedColumns: [...this._pinnedColumns],
            requestId: this._activeSearchRequestId,
        });
    }

    private _queueSearchRefresh(): void {
        this._pendingSearchRefresh = true;
        if (this._visible) {
            void this._requestSummarySchema(true);
        }
    }

    private _queueProfileRefresh(): void {
        if (!this._visible) {
            this._pendingProfileRefresh = true;
            return;
        }

        void this.fetchData();
    }

    private _applyVisibleColumns(columns: SchemaColumn[]): void {
        this._visibleColumns = columns;
        this._schemaByIndex = new Map(
            columns.map((column) => [column.column_index, column]),
        );
        this._stores.summaryColumns.set(columns);
        this._updateLayoutEntries();
        this._resetScrollOffset();
        if (this._visible) {
            void this.fetchData();
        } else {
            this._pendingProfileRefresh = true;
        }
    }

    private _computeLocalVisibleColumns(): SchemaColumn[] {
        let working = this._sourceColumns;

        if (this._searchText.trim()) {
            working = working.filter((column) =>
                matchesColumnSchemaSearch(column, this._searchText),
            );
        }

        if (this._sortOption !== 'original') {
            const sortByName = (a: SchemaColumn, b: SchemaColumn) =>
                a.column_name?.localeCompare(b.column_name ?? '', undefined, {
                    sensitivity: 'base',
                }) ?? 0;
            const sortByType = (a: SchemaColumn, b: SchemaColumn) =>
                getEffectiveColumnDisplayType(
                    a.type_display,
                    a.type_name,
                ).localeCompare(
                    getEffectiveColumnDisplayType(
                        b.type_display,
                        b.type_name,
                    ),
                    undefined,
                    { sensitivity: 'base' },
                ) ?? 0;
            const sorted = [...working];
            switch (this._sortOption) {
                case 'ascending_name':
                    sorted.sort(sortByName);
                    break;
                case 'descending_name':
                    sorted.sort((a, b) => sortByName(b, a));
                    break;
                case 'ascending_type':
                    sorted.sort(sortByType);
                    break;
                case 'descending_type':
                    sorted.sort((a, b) => sortByType(b, a));
                    break;
            }
            working = sorted;
        }

        if (!this._pinnedColumns.length) {
            return working;
        }

        const pinnedSet = new Set(this._pinnedColumns);
        const pinned = this._pinnedColumns
            .map((index) =>
                this._sourceColumns.find((column) => column.column_index === index),
            )
            .filter((column): column is SchemaColumn => Boolean(column));
        const rest = working.filter((column) => !pinnedSet.has(column.column_index));
        return [...pinned, ...rest];
    }

    private _updateLayoutEntries(): void {
        const entryMap = this._visibleColumns.map((column) => column.column_index);

        this._rows = entryMap.length;
        this._rowLayoutManager.setEntries(this._rows, undefined, entryMap);
        this._updatePinnedRows();
        this._applyExpandedRowHeights();
        this.fireOnDidUpdateEvent();
    }

    private _updatePinnedRows(): void {
        this._rowLayoutManager.setPinnedIndexes(this._pinnedColumns);
        this.fireOnDidUpdateEvent();
    }

    private _syncExpandedRows(expanded: Set<number>): void {
        const next = new Set(expanded);
        for (const index of this._expandedColumns) {
            if (!next.has(index)) {
                this._rowLayoutManager.clearSizeOverride(index);
            }
        }
        this._expandedColumns = next;
        this._applyExpandedRowHeights();
        this.fireOnDidUpdateEvent();
    }

    private _applyExpandedRowHeights(): void {
        for (const index of this._expandedColumns) {
            this._rowLayoutManager.setSizeOverride(
                index,
                this._expandedRowHeight(index),
            );
        }
    }

    private _resetScrollOffset(): void {
        if (!this.firstRow) {
            this._verticalScrollOffset = 0;
            return;
        }

        if (this._verticalScrollOffset > this.maximumVerticalScrollOffset) {
            this._verticalScrollOffset = this.maximumVerticalScrollOffset;
        }
    }

    private _expandedRowHeight(rowIndex: number): number {
        const columnSchema = this._schemaByIndex.get(rowIndex);
        if (!columnSchema) {
            return SUMMARY_HEIGHT;
        }

        const typeDisplay = getEffectiveColumnDisplayType(
            this._summaryCache.getColumnProfile(rowIndex)?.summary_stats?.type_display,
            getEffectiveColumnDisplayType(
                columnSchema.type_display,
                columnSchema.type_name,
            ),
        );

        const isNumeric = isNumericDisplayType(typeDisplay);
        const isBoolean = isBooleanDisplayType(typeDisplay);
        const isString = isStringDisplayType(typeDisplay);
        const isDateTime = isDatetimeDisplayType(typeDisplay);
        const isDate = isDateDisplayType(typeDisplay);
        const isObject = isObjectDisplayType(typeDisplay);

        const rowHeight = (displaySparkline: boolean, profileLines: number) => {
            let height = SUMMARY_HEIGHT;
            if (displaySparkline) {
                height += 50 + 10;
            }
            if (profileLines) {
                height += profileLines * PROFILE_LINE_HEIGHT + 12;
            }
            return height;
        };

        if (isNumeric) {
            return rowHeight(true, COLUMN_PROFILE_NUMBER_LINE_COUNT);
        }
        if (isBoolean) {
            return rowHeight(true, COLUMN_PROFILE_BOOLEAN_LINE_COUNT);
        }
        if (isString) {
            return rowHeight(true, COLUMN_PROFILE_STRING_LINE_COUNT);
        }
        if (isDateTime) {
            return rowHeight(false, COLUMN_PROFILE_DATE_TIME_LINE_COUNT);
        }
        if (isDate) {
            return rowHeight(false, COLUMN_PROFILE_DATE_LINE_COUNT);
        }
        if (isObject) {
            return rowHeight(true, COLUMN_PROFILE_OBJECT_LINE_COUNT);
        }

        return rowHeight(false, 0);
    }

    private _updateVisibleDescriptors(): void {
        const width = Math.max(0, this.layoutWidth);
        this.visibleColumns.set(
            width > 0
                ? [
                      {
                          columnIndex: 0,
                          left: 0,
                          width,
                      },
                  ]
                : [],
        );

        const { pinnedRowDescriptors, unpinnedRowDescriptors } =
            this.getRowDescriptors(this.verticalScrollOffset, this.layoutHeight);
        const adjustedUnpinned = unpinnedRowDescriptors.map((row) => ({
            ...row,
            top: row.top - this.verticalScrollOffset,
        }));
        this.visibleRows.set([...pinnedRowDescriptors, ...adjustedUnpinned]);
    }

    //#endregion Private Methods

    //#region Disposal

    override dispose(): void {
        for (const dispose of this._disposables) {
            dispose();
        }
        this._disposables.length = 0;
        this._hoverManager.dispose();
        super.dispose();
    }

    //#endregion Disposal
}
