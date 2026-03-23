/*---------------------------------------------------------------------------------------------
 *  Data Grid Instance - Port from Positron's dataGridInstance
 *  Manages grid state and virtual scrolling
 *--------------------------------------------------------------------------------------------*/

import { writable, type Writable, type Readable } from 'svelte/store';
import type { Component } from 'svelte';
import { LayoutManager, type ILayoutEntry } from './classes/layoutManager';
import { type IColumnSortKey, type IDataColumn, DataColumnAlignment } from './interfaces';

//#region Option Types

/**
 * ColumnHeaderOptions type.
 */
type ColumnHeaderOptions = | {
    readonly columnHeaders: false;
    readonly columnHeadersHeight?: never;
} | {
    readonly columnHeaders: true;
    readonly columnHeadersHeight: number;
};

/**
 * RowHeaderOptions type.
 */
type RowHeaderOptions = | {
    readonly rowHeaders: false;
    readonly rowHeadersWidth?: never;
    readonly rowHeadersResize?: never;
} | {
    readonly rowHeaders: true;
    readonly rowHeadersWidth: number;
    readonly rowHeadersResize: boolean;
};

/**
 * DefaultSizeOptions type.
 */
type DefaultSizeOptions = | {
    readonly defaultColumnWidth: number;
    readonly defaultRowHeight: number;
};

/**
 * ColumnResizeOptions type.
 */
type ColumnResizeOptions = | {
    readonly columnResize: false;
    readonly minimumColumnWidth?: never;
    readonly maximumColumnWidth?: never;
} | {
    readonly columnResize: true;
    readonly minimumColumnWidth: number;
    readonly maximumColumnWidth: number;
};

/**
 * RowResizeOptions type.
 */
type RowResizeOptions = | {
    readonly rowResize: false;
    readonly minimumRowHeight?: never;
    readonly maximumRowHeight?: never;
} | {
    readonly rowResize: true;
    readonly minimumRowHeight: number;
    readonly maximumRowHeight: number;
};

/**
 * ColumnPinningOptions type.
 */
type ColumnPinningOptions = | {
    readonly columnPinning: false;
    readonly maximumPinnedColumns?: never;
} | {
    readonly columnPinning: true;
    readonly maximumPinnedColumns: number;
};

/**
 * RowPinningOptions type.
 */
type RowPinningOptions = | {
    readonly rowPinning: false;
    readonly maximumPinnedRows?: never;
} | {
    readonly rowPinning: true;
    readonly maximumPinnedRows: number;
};

/**
 * ScrollbarOptions type.
 */
type ScrollbarOptions = | {
    readonly horizontalScrollbar: false;
    readonly verticalScrollbar: false;
    readonly scrollbarThickness?: never;
    readonly scrollbarOverscroll?: never;
} | {
    readonly horizontalScrollbar: true;
    readonly verticalScrollbar: false;
    readonly scrollbarThickness: number;
    readonly scrollbarOverscroll: number;
} | {
    readonly horizontalScrollbar: false;
    readonly verticalScrollbar: true;
    readonly scrollbarThickness: number;
    readonly scrollbarOverscroll: number;
} | {
    readonly horizontalScrollbar: true;
    readonly verticalScrollbar: true;
    readonly scrollbarThickness: number;
    readonly scrollbarOverscroll: number;
};

/**
 * DisplayOptions type.
 */
type DisplayOptions = | {
    useEditorFont: boolean;
    automaticLayout: boolean;
    rowsMargin?: number;
    cellBorders?: boolean;
    horizontalCellPadding?: number;
};

/**
 * CursorOptions type.
 */
type CursorOptions = | {
    cursorInitiallyHidden?: boolean;
};

/**
 * DefaultCursorOptions type.
 */
type DefaultCursorOptions = | {
    internalCursor: false;
    cursorOffset?: never;
} | {
    internalCursor: true;
    cursorOffset: number;
};

/**
 * SelectionOptions type.
 */
type SelectionOptions = | {
    selection?: boolean;
};

/**
 * DataGridOptions type.
 */
export type DataGridOptions =
    ColumnHeaderOptions &
    RowHeaderOptions &
    DefaultSizeOptions &
    ColumnResizeOptions &
    RowResizeOptions &
    ColumnPinningOptions &
    RowPinningOptions &
    ScrollbarOptions &
    DisplayOptions &
    CursorOptions &
    DefaultCursorOptions &
    SelectionOptions;

//#endregion Option Types

//#region Descriptor Interfaces

/**
 * ColumnDescriptor interface.
 */
export interface ColumnDescriptor {
    readonly columnIndex: number;
    readonly left: number;
    readonly width: number;
}

/**
 * ColumnDescriptors interface.
 */
export interface ColumnDescriptors {
    pinnedColumnDescriptors: ColumnDescriptor[];
    unpinnedColumnDescriptors: ColumnDescriptor[];
}

/**
 * RowDescriptor interface.
 */
export interface RowDescriptor {
    readonly rowIndex: number;
    readonly top: number;
    readonly height: number;
}

/**
 * RowDescriptors interface.
 */
export interface RowDescriptors {
    pinnedRowDescriptors: RowDescriptor[];
    unpinnedRowDescriptors: RowDescriptor[];
}

//#region Cell Rendering Types

/**
 * DataGridCellComponent interface.
 */
export interface DataGridCellComponent {
    readonly kind: 'component';
    readonly component: Component<any>;
    readonly props?: Record<string, unknown>;
}

/**
 * DataGridCellContent type.
 */
export type DataGridCellContent = string | DataGridCellComponent;

//#endregion Cell Rendering Types

//#endregion Descriptor Interfaces

//#region Selection Enumerations

/**
 * ExtendColumnSelectionBy enumeration.
 */
export enum ExtendColumnSelectionBy {
    Column = 'column',
    Page = 'page',
    Screen = 'screen'
}

/**
 * ExtendRowSelectionBy enumeration.
 */
export enum ExtendRowSelectionBy {
    Row = 'row',
    Page = 'page',
    Screen = 'screen'
}

/**
 * CellSelectionState enumeration.
 */
export enum CellSelectionState {
    None = 0,
    Selected = 1,
    SelectedLeft = 2,
    SelectedRight = 4,
    SelectedTop = 8,
    SelectedBottom = 16
}

/**
 * ColumnSelectionState enumeration.
 */
export enum ColumnSelectionState {
    None = 0,
    Selected = 1,
    SelectedLeft = 2,
    SelectedRight = 4,
}

/**
 * RowSelectionState enumeration.
 */
export enum RowSelectionState {
    None = 0,
    Selected = 1,
    SelectedTop = 8,
    SelectedBottom = 16,
}

/**
 * MouseSelectionType enumeration.
 */
export enum MouseSelectionType {
    Single = 'single',
    Range = 'range',
    Multi = 'multi'
}

//#endregion Selection Enumerations

//#region Selection Classes

/**
 * CellSelectionIndexes class.
 */
class CellSelectionIndexes {
    private readonly _columnIndexesSet: Set<number>;
    private readonly _rowIndexesSet: Set<number>;

    get firstColumnIndex() {
        return this.columnIndexes[0];
    }

    get lastColumnIndex() {
        return this.columnIndexes[this.columnIndexes.length - 1];
    }

    get firstRowIndex() {
        return this.rowIndexes[0];
    }

    get lastRowIndex() {
        return this.rowIndexes[this.rowIndexes.length - 1];
    }

    constructor(public readonly columnIndexes: number[], public readonly rowIndexes: number[]) {
        this._columnIndexesSet = new Set(columnIndexes);
        this._rowIndexesSet = new Set(rowIndexes);
    }

    contains(columnIndex: number, rowIndex: number) {
        return this._columnIndexesSet.has(columnIndex) && this._rowIndexesSet.has(rowIndex);
    }
}

/**
 * SelectionIndexes class.
 */
class SelectionIndexes {
    private readonly _indexesSet = new Set<number>();

    get firstIndex() {
        return this.indexes[0];
    }

    get lastIndex() {
        return this.indexes[this.indexes.length - 1];
    }

    constructor(public readonly indexes: number[]) {
        this._indexesSet = new Set(indexes);
    }

    contains(index: number) {
        return this._indexesSet.has(index);
    }
}

//#endregion Selection Classes

//#region Clipboard Classes

/**
 * ClipboardCell class.
 */
export class ClipboardCell {
    constructor(readonly columnIndex: number, readonly rowIndex: number) { }
}

/**
 * ClipboardCellIndexes class.
 */
export class ClipboardCellIndexes {
    constructor(readonly columnIndexes: number[], readonly rowIndexes: number[]) { }
}

/**
 * ClipboardColumnIndexes class.
 */
export class ClipboardColumnIndexes {
    constructor(readonly indexes: number[]) { }
}

/**
 * ClipboardRowIndexes class.
 */
export class ClipboardRowIndexes {
    constructor(readonly indexes: number[]) { }
}

/**
 * ClipboardData type.
 */
export type ClipboardData =
    ClipboardCell |
    ClipboardCellIndexes |
    ClipboardColumnIndexes |
    ClipboardRowIndexes;

//#endregion Clipboard Classes

//#region ColumnSortKeyDescriptor

/**
 * ColumnSortKeyDescriptor class.
 */
export class ColumnSortKeyDescriptor implements IColumnSortKey {
    private _sortIndex: number;
    private _columnIndex: number;
    private _ascending: boolean;

    constructor(sortIndex: number, columnIndex: number, ascending: boolean) {
        this._sortIndex = sortIndex;
        this._columnIndex = columnIndex;
        this._ascending = ascending;
    }

    get sortIndex() {
        return this._sortIndex;
    }

    get columnIndex() {
        return this._columnIndex;
    }

    get ascending() {
        return this._ascending;
    }

    set sortIndex(sortIndex: number) {
        this._sortIndex = sortIndex;
    }

    set ascending(ascending: boolean) {
        this._ascending = ascending;
    }
}

//#endregion ColumnSortKeyDescriptor

//#region ViewportState

/**
 * ViewportState interface.
 */
export interface ViewportState {
    width: number;
    height: number;
    scrollTop: number;
    scrollLeft: number;
    firstRowIndex: number;
    visibleRowCount: number;
    firstColumnIndex: number;
    visibleColumnCount: number;
}

//#endregion ViewportState

//#region SchemaColumn

/**
 * SchemaColumn interface.
 */
export interface SchemaColumn {
    column_name: string;
    column_index: number;
    type_name: string;
    type_display?: string;
    description?: string;
    children?: SchemaColumn[];
    precision?: number;
    scale?: number;
    timezone?: string;
    type_size?: number;
}

/**
 * Hover manager interface used by grid cells/headers.
 */
export interface DataGridHoverManager {
    showHover(anchorElement: HTMLElement, content: string): void;
    hideHover(): void;
}

export interface DataGridContextMenuAnchorPoint {
    clientX: number;
    clientY: number;
}

export interface DataGridContextMenuItem {
    id: string;
    label: string;
    icon?: string;
    shortcut?: string;
    disabled?: boolean;
    checked?: boolean;
    separator?: boolean;
    onClick?: () => void;
}

export interface DataGridContextMenuRequest {
    anchorElement: HTMLElement;
    anchorPoint?: DataGridContextMenuAnchorPoint;
    items: DataGridContextMenuItem[];
}

//#endregion SchemaColumn

/**
 * SimpleEventEmitter class for Svelte-compatible events.
 */
class SimpleEventEmitter<T> {
    private _listeners: Set<(value: T) => void> = new Set();

    fire(value: T): void {
        this._listeners.forEach(listener => listener(value));
    }

    get event(): (listener: (value: T) => void) => { dispose: () => void } {
        return (listener: (value: T) => void) => {
            this._listeners.add(listener);
            return {
                dispose: () => this._listeners.delete(listener)
            };
        };
    }

    dispose(): void {
        this._listeners.clear();
    }
}

/**
 * DataGridInstance class.
 * Port from Positron's dataGridInstance, adapted for Svelte 5.
 */
export abstract class DataGridInstance {
    //#region Private Properties - Settings

    private readonly _columnHeaders: boolean;
    private readonly _columnHeadersHeight: number;
    private readonly _rowHeaders: boolean;
    private _rowHeadersWidth: number;
    private readonly _rowHeadersResize: boolean;
    private readonly _columnResize: boolean;
    private readonly _minimumColumnWidth: number;
    private readonly _maximumColumnWidth: number;
    private readonly _defaultColumnWidth: number;
    private readonly _rowResize: boolean;
    private readonly _minimumRowHeight: number;
    private readonly _maximumRowHeight: number;
    private readonly _defaultRowHeight: number;
    private readonly _columnPinning: boolean;
    private readonly _maximumPinnedColumns: number;
    private readonly _rowPinning: boolean;
    private readonly _maximumPinnedRows: number;
    private readonly _horizontalScrollbar: boolean;
    private readonly _verticalScrollbar: boolean;
    private readonly _scrollbarThickness: number;
    private readonly _scrollbarOverscroll: number;
    private readonly _useEditorFont: boolean;
    private readonly _automaticLayout: boolean;
    private readonly _rowsMargin: number;
    private readonly _cellBorders: boolean;
    private readonly _horizontalCellPadding: number;
    private readonly _cursorInitiallyHidden: boolean;
    private readonly _internalCursor: boolean;
    private readonly _cursorOffset: number;
    private readonly _selection: boolean;

    //#endregion Private Properties - Settings

    //#region Private Properties

    private _focused = false;
    private _width = 0;
    private _height = 0;
    private _cursorColumnIndex = 0;
    private _cursorRowIndex = 0;
    private _cellSelectionIndexes?: CellSelectionIndexes;
    private _columnSelectionIndexes?: SelectionIndexes;
    private _rowSelectionIndexes?: SelectionIndexes;
    private _pendingOnDidUpdateEvent = false;

    //#endregion Private Properties

    //#region Private Events

    private readonly _onDidUpdateEmitter = new SimpleEventEmitter<void>();
    private readonly _onDidChangeColumnSortingEmitter = new SimpleEventEmitter<boolean>();
    private readonly _onDidChangePinnedColumnsEmitter = new SimpleEventEmitter<number[]>();
    private readonly _onDidRequestContextMenuEmitter =
        new SimpleEventEmitter<DataGridContextMenuRequest>();

    //#endregion Private Events

    //#region Protected Properties

    protected _horizontalScrollOffset = 0;
    protected _verticalScrollOffset = 0;
    protected readonly _columnLayoutManager: LayoutManager;
    protected readonly _rowLayoutManager: LayoutManager;
    protected readonly _columnSortKeys = new Map<number, ColumnSortKeyDescriptor>();

    //#endregion Protected Properties

    //#region Svelte Stores

    readonly updateTrigger: Writable<number> = writable(0);

    // Viewport store for reactive viewport state
    readonly viewport: Writable<{
        width: number;
        height: number;
        scrollTop: number;
        scrollLeft: number;
    }> = writable({ width: 0, height: 0, scrollTop: 0, scrollLeft: 0 });

    // Visible columns/rows as stores with descriptor types
    // Using Readable to match subclass implementations that use derived stores
    readonly visibleColumns: Readable<ColumnDescriptor[]> = writable([]);
    readonly visibleRows: Readable<RowDescriptor[]> = writable([]);

    //#endregion Svelte Stores

    //#region Convenience Methods for Components

    /**
     * Get total width for horizontal scrollbar
     */
    getTotalWidth(): number {
        return this.scrollWidth;
    }

    /**
     * Get total height for vertical scrollbar
     */
    getTotalHeight(): number {
        return this.scrollHeight;
    }

    /**
     * Set scroll position (convenience method used by scrollbars)
     */
    setScroll(scrollTop: number, scrollLeft: number): void {
        this._verticalScrollOffset = scrollTop;
        this._horizontalScrollOffset = scrollLeft;
        this.viewport.set({
            width: this._width,
            height: this._height,
            scrollTop,
            scrollLeft
        });
        this.fireOnDidUpdateEvent();
    }

    /**
     * Get cell data - abstract, must be implemented by subclass
     */
    abstract getCellData(rowIndex: number, columnIndex: number): string | undefined;

    //#endregion Convenience Methods for Components

    //#region Constructor

    constructor(options: DataGridOptions) {
        // ColumnHeaderOptions.
        this._columnHeaders = options.columnHeaders || false;
        this._columnHeadersHeight = this._columnHeaders ? options.columnHeadersHeight ?? 0 : 0;

        // RowHeaderOptions.
        this._rowHeaders = options.rowHeaders || false;
        this._rowHeadersWidth = this._rowHeaders ? options.rowHeadersWidth ?? 0 : 0;
        this._rowHeadersResize = this._rowHeaders ? options.rowHeadersResize ?? false : false;

        // DefaultSizeOptions.
        this._defaultColumnWidth = options.defaultColumnWidth;
        this._defaultRowHeight = options.defaultRowHeight;

        // ColumnResizeOptions.
        this._columnResize = options.columnResize || false;
        this._minimumColumnWidth = options.minimumColumnWidth ?? this._defaultColumnWidth;
        this._maximumColumnWidth = options.maximumColumnWidth ?? this._defaultColumnWidth;

        // RowResizeOptions.
        this._rowResize = options.rowResize || false;
        this._minimumRowHeight = options.minimumRowHeight ?? options.defaultRowHeight;
        this._maximumRowHeight = options.maximumRowHeight ?? options.defaultRowHeight;

        // ColumnPinningOptions.
        this._columnPinning = options.columnPinning || false;
        this._maximumPinnedColumns = this._columnPinning ? options.maximumPinnedColumns ?? 0 : 0;

        // RowPinningOptions.
        this._rowPinning = options.rowPinning || false;
        this._maximumPinnedRows = this._rowPinning ? options.maximumPinnedRows ?? 0 : 0;

        // ScrollbarOptions.
        this._horizontalScrollbar = options.horizontalScrollbar || false;
        this._verticalScrollbar = options.verticalScrollbar || false;
        this._scrollbarThickness = options.scrollbarThickness ?? 0;
        this._scrollbarOverscroll = options.scrollbarOverscroll ?? 0;

        // DisplayOptions.
        this._useEditorFont = options.useEditorFont;
        this._automaticLayout = options.automaticLayout;
        this._rowsMargin = options.rowsMargin ?? 0;
        this._cellBorders = options.cellBorders ?? true;
        this._horizontalCellPadding = options.horizontalCellPadding ?? 0;

        // CursorOptions.
        this._cursorInitiallyHidden = options.cursorInitiallyHidden ?? false;
        if (options.cursorInitiallyHidden) {
            this._cursorColumnIndex = -1;
            this._cursorRowIndex = -1;
        }

        // DefaultCursorOptions.
        this._internalCursor = options.internalCursor ?? true;
        this._cursorOffset = this._internalCursor ? options.cursorOffset ?? 0 : 0;

        // SelectionOptions.
        this._selection = options.selection ?? true;

        // Allocate and initialize the layout managers.
        this._columnLayoutManager = new LayoutManager(this._defaultColumnWidth);
        this._rowLayoutManager = new LayoutManager(this._defaultRowHeight);
    }

    //#endregion Constructor

    //#region Public Properties - Settings

    get columnHeaders() { return this._columnHeaders; }
    get columnHeadersHeight() { return this._columnHeadersHeight; }
    get rowHeaders() { return this._rowHeaders; }
    get rowHeadersWidth() { return this._rowHeadersWidth; }
    get rowHeadersResize() { return this._rowHeadersResize; }
    get columnResize() { return this._columnResize; }
    get minimumColumnWidth() { return this._minimumColumnWidth; }
    get maximumColumnWidth() { return this._maximumColumnWidth; }
    get defaultColumnWidth() { return this._defaultColumnWidth; }
    get rowResize() { return this._rowResize; }
    get minimumRowHeight() { return this._minimumRowHeight; }
    get maximumRowHeight() { return this._maximumRowHeight; }
    get defaultRowHeight() { return this._defaultRowHeight; }
    get columnPinning() { return this._columnPinning; }
    get maximumPinnedColumns() { return this._maximumPinnedColumns; }
    get rowPinning() { return this._rowPinning; }
    get maximumPinnedRows() { return this._maximumPinnedRows; }
    get horizontalScrollbar() { return this._horizontalScrollbar; }
    get verticalScrollbar() { return this._verticalScrollbar; }
    get scrollbarThickness() { return this._scrollbarThickness; }
    get scrollbarOverscroll() { return this._scrollbarOverscroll; }
    get useEditorFont() { return this._useEditorFont; }
    get automaticLayout() { return this._automaticLayout; }
    get rowsMargin() { return this._rowsMargin; }
    get cellBorders() { return this._cellBorders; }
    get horizontalCellPadding() { return this._horizontalCellPadding; }
    get internalCursor() { return this._internalCursor; }
    get cursorOffset() { return this._cursorOffset; }
    get selection() { return this._selection; }

    /**
     * Optional hover manager. Concrete instances can override.
     */
    get hoverManager(): DataGridHoverManager | undefined {
        return undefined;
    }

    //#endregion Public Properties - Settings

    //#region Public Properties

    get focused() { return this._focused; }
    abstract get columns(): number;
    abstract get rows(): number;

    get scrollWidth() {
        return this._columnLayoutManager.unpinnedLayoutEntriesSize + this._scrollbarOverscroll;
    }

    get scrollHeight() {
        return (this._rowsMargin * 2) + this._rowLayoutManager.unpinnedLayoutEntriesSize + this._scrollbarOverscroll;
    }

    get pageWidth() { return this.layoutWidth; }
    get pageHeight() { return this.layoutHeight; }

    get layoutWidth() {
        let layoutWidth = this._width;
        if (this.rowHeaders) {
            layoutWidth -= this._rowHeadersWidth;
        }
        if (this.columnPinning) {
            layoutWidth -= this._columnLayoutManager.pinnedLayoutEntriesSize;
        }
        if (this._verticalScrollbar) {
            layoutWidth -= this._scrollbarThickness;
        }
        return layoutWidth;
    }

    get layoutRight() {
        return this.horizontalScrollOffset + this.layoutWidth;
    }

    get layoutHeight() {
        let layoutHeight = this._height;
        if (this.columnHeaders) {
            layoutHeight -= this._columnHeadersHeight;
        }
        if (this.rowPinning) {
            layoutHeight -= this._rowLayoutManager.pinnedLayoutEntriesSize;
        }
        if (this._horizontalScrollbar) {
            layoutHeight -= this._scrollbarThickness;
        }
        return layoutHeight;
    }

    get layoutBottom() {
        return this.verticalScrollOffset + this.layoutHeight;
    }

    get screenColumns() {
        return Math.ceil(this._width / this._minimumColumnWidth);
    }

    get screenRows() {
        return Math.ceil(this._height / this._minimumRowHeight);
    }

    get maximumHorizontalScrollOffset() {
        return this.scrollWidth <= this.layoutWidth ? 0 : this.scrollWidth - this.layoutWidth;
    }

    get maximumVerticalScrollOffset() {
        return this.scrollHeight <= this.layoutHeight ? 0 : this.scrollHeight - this.layoutHeight;
    }

    get firstColumn(): ColumnDescriptor | undefined {
        const layoutEntry = this._columnLayoutManager.findFirstUnpinnedLayoutEntry(this.horizontalScrollOffset);
        if (!layoutEntry) {
            return undefined;
        }
        return {
            columnIndex: layoutEntry.index,
            left: layoutEntry.start,
            width: layoutEntry.size,
        };
    }

    get firstRow(): RowDescriptor | undefined {
        const layoutEntry = this._rowLayoutManager.findFirstUnpinnedLayoutEntry(this.verticalScrollOffset);
        if (!layoutEntry) {
            return undefined;
        }
        return {
            rowIndex: layoutEntry.index,
            top: layoutEntry.start,
            height: layoutEntry.size,
        };
    }

    get horizontalScrollOffset() { return this._horizontalScrollOffset; }
    get verticalScrollOffset() { return this._verticalScrollOffset; }
    get cursorColumnIndex() { return this._cursorColumnIndex; }
    get cursorRowIndex() { return this._cursorRowIndex; }
    get isColumnSorting() { return this._columnSortKeys.size > 0; }

    get firstColumnIndex() { return this._columnLayoutManager.firstIndex; }
    get lastColumnIndex() { return this._columnLayoutManager.lastIndex; }
    get lastColummIndex() { return this.lastColumnIndex; }
    get firstRowIndex() { return this._rowLayoutManager.firstIndex; }
    get lastRowIndex() { return this._rowLayoutManager.lastIndex; }

    rowHeader(rowIndex: number): string {
        return `${rowIndex + 1}`;
    }

    getPinnedColumnIndexes(): number[] {
        return this._columnLayoutManager.pinnedIndexes;
    }

    //#endregion Public Properties

    //#region Public Events

    readonly onDidUpdate = this._onDidUpdateEmitter.event;
    readonly onDidChangeColumnSorting = this._onDidChangeColumnSortingEmitter.event;
    readonly onDidChangePinnedColumns = this._onDidChangePinnedColumnsEmitter.event;
    readonly onDidRequestContextMenu = this._onDidRequestContextMenuEmitter.event;

    //#endregion Public Events

    //#region Public Methods

    dispose(): void {
        this._onDidUpdateEmitter.dispose();
        this._onDidChangeColumnSortingEmitter.dispose();
        this._onDidChangePinnedColumnsEmitter.dispose();
        this._onDidRequestContextMenuEmitter.dispose();
    }

    protected requestContextMenu(request: DataGridContextMenuRequest): void {
        if (request.items.length === 0) {
            return;
        }

        this._onDidRequestContextMenuEmitter.fire(request);
    }

    setFocused(focused: boolean) {
        if (this._focused !== focused) {
            this._focused = focused;
            this.fireOnDidUpdateEvent();
        }
    }

    showCursor() {
        if (this._cursorInitiallyHidden &&
            this._cursorColumnIndex === -1 &&
            this._cursorRowIndex === -1) {
            this.setCursorPosition(0, 0);
            return true;
        }
        return false;
    }

    getColumnDescriptors(horizontalOffset: number, width: number): ColumnDescriptors {
        const pinnedLayoutEntries = this._columnLayoutManager.pinnedLayoutEntries(width);
        const pinnedColumnDescriptors = pinnedLayoutEntries.map((pinnedLayoutEntry): ColumnDescriptor => ({
            columnIndex: pinnedLayoutEntry.index,
            left: pinnedLayoutEntry.start,
            width: pinnedLayoutEntry.size,
        }));

        const pinnedColumnDescriptorsWidth = (() => {
            if (!pinnedColumnDescriptors.length) {
                return 0;
            } else {
                const lastPinnedColumnDescriptor = pinnedColumnDescriptors[pinnedColumnDescriptors.length - 1];
                return lastPinnedColumnDescriptor.left + lastPinnedColumnDescriptor.width;
            }
        })();

        const unpinnedLayoutEntries = this._columnLayoutManager.unpinnedLayoutEntries(horizontalOffset, width - pinnedColumnDescriptorsWidth);
        const unpinnedColumnDescriptors = unpinnedLayoutEntries.map((pinnedLayoutEntry): ColumnDescriptor => ({
            columnIndex: pinnedLayoutEntry.index,
            left: pinnedColumnDescriptorsWidth + pinnedLayoutEntry.start,
            width: pinnedLayoutEntry.size,
        }));

        return {
            pinnedColumnDescriptors,
            unpinnedColumnDescriptors,
        };
    }

    getRowDescriptors(verticalOffset: number, layoutHeight: number): RowDescriptors {
        const pinnedLayoutEntries = this._rowLayoutManager.pinnedLayoutEntries(layoutHeight);
        const pinnedRowDescriptors = pinnedLayoutEntries.map((pinnedLayoutEntry): RowDescriptor => ({
            rowIndex: pinnedLayoutEntry.index,
            top: pinnedLayoutEntry.start,
            height: pinnedLayoutEntry.size,
        }));

        const pinnedRowDescriptorsHeight = (() => {
            if (!pinnedRowDescriptors.length) {
                return 0;
            } else {
                const lastPinnedRowDescriptor = pinnedRowDescriptors[pinnedRowDescriptors.length - 1];
                return lastPinnedRowDescriptor.top + lastPinnedRowDescriptor.height;
            }
        })();

        const unpinnedLayoutEntries = this._rowLayoutManager.unpinnedLayoutEntries(verticalOffset, layoutHeight - pinnedRowDescriptorsHeight);
        const unpinnedRowDescriptors = unpinnedLayoutEntries.map((pinnedLayoutEntry): RowDescriptor => ({
            rowIndex: pinnedLayoutEntry.index,
            top: pinnedRowDescriptorsHeight + pinnedLayoutEntry.start,
            height: pinnedLayoutEntry.size,
        }));

        return {
            pinnedRowDescriptors,
            unpinnedRowDescriptors,
        };
    }

    getCustomColumnWidth(_columnIndex: number): number | undefined {
        return undefined;
    }

    async setColumnWidth(columnIndex: number, columnWidth: number): Promise<void> {
        if (!this._columnResize) {
            return;
        }
        this._columnLayoutManager.setSizeOverride(columnIndex, columnWidth);
        await this.fetchData();
        this.fireOnDidUpdateEvent();
    }

    async setRowHeight(rowIndex: number, rowHeight: number): Promise<void> {
        if (!this._rowResize) {
            return;
        }
        this._rowLayoutManager.setSizeOverride(rowIndex, rowHeight);
        await this.fetchData();
        this.fireOnDidUpdateEvent();
    }

    async scrollPageUp(): Promise<void> {
        const firstUnpinnedLayoutEntry = this._rowLayoutManager.findFirstUnpinnedLayoutEntry(this.verticalScrollOffset);
        if (firstUnpinnedLayoutEntry === undefined) {
            return;
        }

        const firstUnpinnedLayoutEntryPosition = this._rowLayoutManager.mapIndexToPosition(firstUnpinnedLayoutEntry.index);
        if (firstUnpinnedLayoutEntryPosition === undefined) {
            return;
        }

        let lastFullyVisibleLayoutEntry: ILayoutEntry | undefined = undefined;
        for (let position = firstUnpinnedLayoutEntryPosition - 1; position >= 0; position--) {
            const index = this._rowLayoutManager.mapPositionToIndex(position);
            if (index === undefined) {
                return;
            }

            const layoutEntry = this._rowLayoutManager.getLayoutEntry(index);
            if (layoutEntry === undefined) {
                return;
            }

            if (layoutEntry.start >= this.verticalScrollOffset - this.layoutHeight) {
                lastFullyVisibleLayoutEntry = layoutEntry;
            } else {
                this.setVerticalScrollOffset(lastFullyVisibleLayoutEntry?.start ?? layoutEntry.start);
                await this.fetchData();
                this.fireOnDidUpdateEvent();
                return;
            }
        }

        this.setVerticalScrollOffset(0);
        await this.fetchData();
        this.fireOnDidUpdateEvent();
    }

    async scrollPageDown(): Promise<void> {
        const firstUnpinnedLayoutEntry = this._rowLayoutManager.findFirstUnpinnedLayoutEntry(this.verticalScrollOffset);
        if (firstUnpinnedLayoutEntry === undefined) {
            return;
        }

        const firstUnpinnedLayoutEntryPosition = this._rowLayoutManager.mapIndexToPosition(firstUnpinnedLayoutEntry.index);
        if (firstUnpinnedLayoutEntryPosition === undefined) {
            return;
        }

        for (let position = firstUnpinnedLayoutEntryPosition + 1; position < this._rowLayoutManager.entryCount; position++) {
            const index = this._rowLayoutManager.mapPositionToIndex(position);
            if (index === undefined) {
                return;
            }

            const layoutEntry = this._rowLayoutManager.getLayoutEntry(index);
            if (layoutEntry === undefined) {
                return;
            }

            if (layoutEntry.end >= this.verticalScrollOffset + this.layoutHeight) {
                this.setVerticalScrollOffset(Math.min(layoutEntry.start, this.maximumVerticalScrollOffset));
                await this.fetchData();
                this.fireOnDidUpdateEvent();
                return;
            }
        }

        this.setVerticalScrollOffset(this.maximumVerticalScrollOffset);
        await this.fetchData();
        this.fireOnDidUpdateEvent();
    }

    async setColumnSortKey(columnIndex: number, ascending: boolean): Promise<void> {
        this.clearPinnedRows();

        const columnSortKey = this._columnSortKeys.get(columnIndex);

        if (!columnSortKey) {
            this._columnSortKeys.set(
                columnIndex,
                new ColumnSortKeyDescriptor(this._columnSortKeys.size, columnIndex, ascending)
            );
        } else if (ascending !== columnSortKey.ascending) {
            columnSortKey.ascending = ascending;
        } else {
            return;
        }

        this.clearSelection();
        this._onDidChangeColumnSortingEmitter.fire(true);
        this.fireOnDidUpdateEvent();
        await this.doSortData();
    }

    async removeColumnSortKey(columnIndex: number): Promise<void> {
        const columnSortKey = this._columnSortKeys.get(columnIndex);

        if (columnSortKey) {
            this.clearPinnedRows();
            this._columnSortKeys.delete(columnIndex);

            this._columnSortKeys.forEach(columnSortToUpdate => {
                if (columnSortToUpdate.sortIndex > columnSortKey.sortIndex) {
                    columnSortToUpdate.sortIndex -= 1;
                }
            });

            this.clearSelection();
            this._onDidChangeColumnSortingEmitter.fire(this._columnSortKeys.size > 0);
            this.fireOnDidUpdateEvent();
            await this.doSortData();
        }
    }

    async clearColumnSortKeys(): Promise<void> {
        this.clearPinnedRows();
        this._columnSortKeys.clear();
        this.clearSelection();
        this._onDidChangeColumnSortingEmitter.fire(false);
        this.fireOnDidUpdateEvent();
        await this.doSortData();
    }

    getSortKey(columnIndex: number): ColumnSortKeyDescriptor | undefined {
        return this._columnSortKeys.get(columnIndex);
    }

    async setRowHeadersWidth(rowHeadersWidth: number): Promise<void> {
        if (rowHeadersWidth !== this._rowHeadersWidth) {
            this._rowHeadersWidth = rowHeadersWidth;
            await this.fetchData();
            this.fireOnDidUpdateEvent();
        }
    }

    async setSize(width: number, height: number): Promise<void> {
        if (width !== this._width || height !== this._height) {
            this._width = width;
            this._height = height;

            if (this._verticalScrollOffset > this.maximumVerticalScrollOffset) {
                this._verticalScrollOffset = this.maximumVerticalScrollOffset;
            }

            await this.fetchData();
            this.fireOnDidUpdateEvent();
        }
    }

    async setScrollOffsets(horizontalScrollOffset: number, verticalScrollOffset: number): Promise<void> {
        if (horizontalScrollOffset !== this._horizontalScrollOffset ||
            verticalScrollOffset !== this._verticalScrollOffset) {
            this._horizontalScrollOffset = horizontalScrollOffset;
            this._verticalScrollOffset = verticalScrollOffset;
            await this.fetchData();
            this.fireOnDidUpdateEvent();
        }
    }

    async setHorizontalScrollOffset(horizontalScrollOffset: number): Promise<void> {
        if (horizontalScrollOffset !== this._horizontalScrollOffset) {
            this._horizontalScrollOffset = horizontalScrollOffset;
            await this.fetchData();
            this.fireOnDidUpdateEvent();
        }
    }

    async scrollToCell(columnIndex: number, rowIndex: number): Promise<void> {
        const columnLayoutEntry = this._columnLayoutManager.getLayoutEntry(columnIndex);
        if (!columnLayoutEntry) {
            return;
        }

        const rowLayoutEntry = this._rowLayoutManager.getLayoutEntry(rowIndex);
        if (!rowLayoutEntry) {
            return;
        }

        let scrollOffsetUpdated = false;

        if (columnLayoutEntry.start < this._horizontalScrollOffset) {
            this._horizontalScrollOffset = columnLayoutEntry.start;
            scrollOffsetUpdated = true;
        } else if (columnLayoutEntry.end > this._horizontalScrollOffset + this.layoutWidth) {
            this._horizontalScrollOffset = columnIndex === this.columns - 1
                ? this.maximumHorizontalScrollOffset
                : columnLayoutEntry.end - this.layoutWidth;
            scrollOffsetUpdated = true;
        }

        if (rowLayoutEntry.start < this._verticalScrollOffset) {
            this._verticalScrollOffset = rowLayoutEntry.start;
            scrollOffsetUpdated = true;
        } else if (rowLayoutEntry.end > this._verticalScrollOffset + this.layoutHeight) {
            this._verticalScrollOffset = rowIndex === this._rowLayoutManager.lastIndex
                ? this.maximumVerticalScrollOffset
                : rowLayoutEntry.end - this.layoutHeight;
            scrollOffsetUpdated = true;
        }

        if (scrollOffsetUpdated) {
            await this.fetchData();
            this.fireOnDidUpdateEvent();
        }
    }

    async scrollToColumn(columnIndex: number): Promise<void> {
        if (this._columnLayoutManager.isPinnedIndex(columnIndex)) {
            return;
        }

        const columnLayoutEntry = this._columnLayoutManager.getLayoutEntry(columnIndex);
        if (!columnLayoutEntry) {
            return;
        }

        if (columnLayoutEntry.start < this._horizontalScrollOffset) {
            await this.setHorizontalScrollOffset(columnLayoutEntry.start);
        } else if (columnLayoutEntry.end > this._horizontalScrollOffset + this.layoutWidth) {
            await this.setHorizontalScrollOffset(columnLayoutEntry.end - this.layoutWidth);
        }
    }

    async scrollToRow(rowIndex: number): Promise<void> {
        if (this._rowLayoutManager.isPinnedIndex(rowIndex)) {
            return;
        }

        const rowLayoutEntry = this._rowLayoutManager.getLayoutEntry(rowIndex);
        if (!rowLayoutEntry) {
            return;
        }

        if (rowLayoutEntry.start < this._verticalScrollOffset) {
            await this.updateVerticalScrollOffset(rowLayoutEntry.start);
        } else if (rowLayoutEntry.end > this._verticalScrollOffset + this.layoutHeight) {
            await this.updateVerticalScrollOffset(rowLayoutEntry.end - this.layoutHeight);
        }
    }

    setVerticalScrollOffset(verticalScrollOffset: number): void {
        this._verticalScrollOffset = verticalScrollOffset;
    }

    async updateVerticalScrollOffset(verticalScrollOffset: number): Promise<void> {
        if (verticalScrollOffset !== this._verticalScrollOffset) {
            this._verticalScrollOffset = verticalScrollOffset;
            await this.fetchData();
            this.fireOnDidUpdateEvent();
        }
    }

    setCursorPosition(cursorColumnIndex: number, cursorRowIndex: number): void {
        if (cursorColumnIndex !== this._cursorColumnIndex || cursorRowIndex !== this._cursorRowIndex) {
            this._cursorColumnIndex = cursorColumnIndex;
            this._cursorRowIndex = cursorRowIndex;
            this.fireOnDidUpdateEvent();
        }
    }

    setCursorColumn(cursorColumnIndex: number): void {
        if (cursorColumnIndex !== this._cursorColumnIndex) {
            this._cursorColumnIndex = cursorColumnIndex;
            this.fireOnDidUpdateEvent();
        }
    }

    setCursorRow(cursorRowIndex: number): void {
        if (cursorRowIndex !== this._cursorRowIndex) {
            this._cursorRowIndex = cursorRowIndex;
            this.fireOnDidUpdateEvent();
        }
    }

    selectCell(columnIndex: number, rowIndex: number): void {
        if (!this._selection) {
            return;
        }
        if (columnIndex < 0 || rowIndex < 0) {
            return;
        }
        this._cursorColumnIndex = columnIndex;
        this._cursorRowIndex = rowIndex;
        this._cellSelectionIndexes = new CellSelectionIndexes([columnIndex], [rowIndex]);
        this._columnSelectionIndexes = undefined;
        this._rowSelectionIndexes = undefined;
        this.fireOnDidUpdateEvent();
    }

    selectCellRange(
        firstColumnIndex: number,
        firstRowIndex: number,
        lastColumnIndex: number,
        lastRowIndex: number
    ): void {
        if (!this._selection) {
            return;
        }
        const columnCount = this.columns;
        const rowCount = this.rows;
        if (!columnCount || !rowCount) {
            return;
        }

        const startColumn = Math.max(0, Math.min(firstColumnIndex, lastColumnIndex));
        const endColumn = Math.min(columnCount - 1, Math.max(firstColumnIndex, lastColumnIndex));
        const startRow = Math.max(0, Math.min(firstRowIndex, lastRowIndex));
        const endRow = Math.min(rowCount - 1, Math.max(firstRowIndex, lastRowIndex));

        const columnIndexes = this._buildRange(startColumn, endColumn);
        const rowIndexes = this._buildRange(startRow, endRow);

        this._cursorColumnIndex = endColumn;
        this._cursorRowIndex = endRow;
        this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, rowIndexes);
        this._columnSelectionIndexes = undefined;
        this._rowSelectionIndexes = undefined;
        this.fireOnDidUpdateEvent();
    }

    selectColumn(columnIndex: number): void {
        if (!this._selection) {
            return;
        }
        if (columnIndex < 0) {
            return;
        }
        this._cursorColumnIndex = columnIndex;
        this._columnSelectionIndexes = new SelectionIndexes([columnIndex]);
        this._cellSelectionIndexes = undefined;
        this._rowSelectionIndexes = undefined;
        this.fireOnDidUpdateEvent();
    }

    selectRow(rowIndex: number): void {
        if (!this._selection) {
            return;
        }
        if (rowIndex < 0) {
            return;
        }
        this._cursorRowIndex = rowIndex;
        this._rowSelectionIndexes = new SelectionIndexes([rowIndex]);
        this._cellSelectionIndexes = undefined;
        this._columnSelectionIndexes = undefined;
        this.fireOnDidUpdateEvent();
    }

    selectAll(): void {
        if (!this._selection) {
            return;
        }
        const columnCount = this.columns;
        const rowCount = this.rows;
        if (!columnCount || !rowCount) {
            return;
        }
        const columnIndexes = this._buildRange(0, columnCount - 1);
        const rowIndexes = this._buildRange(0, rowCount - 1);
        this._cursorColumnIndex = 0;
        this._cursorRowIndex = 0;
        this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, rowIndexes);
        this._columnSelectionIndexes = undefined;
        this._rowSelectionIndexes = undefined;
        this.fireOnDidUpdateEvent();
    }

    async mouseSelectCell(
        columnIndex: number,
        rowIndex: number,
        pinned: boolean,
        mouseSelectionType: MouseSelectionType,
    ): Promise<void> {
        this._columnSelectionIndexes = undefined;
        this._rowSelectionIndexes = undefined;

        switch (mouseSelectionType) {
            case MouseSelectionType.Single: {
                this._cellSelectionIndexes = undefined;
                this.setCursorPosition(columnIndex, rowIndex);

                if (!pinned) {
                    await this.scrollToCell(columnIndex, rowIndex);
                }

                this.fireOnDidUpdateEvent();
                break;
            }

            case MouseSelectionType.Range: {
                const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
                if (cursorColumnPosition === undefined) {
                    return;
                }

                const columnPosition = this._columnLayoutManager.mapIndexToPosition(columnIndex);
                if (columnPosition === undefined) {
                    return;
                }

                const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
                if (cursorRowPosition === undefined) {
                    return;
                }

                const rowPosition = this._rowLayoutManager.mapIndexToPosition(rowIndex);
                if (rowPosition === undefined) {
                    return;
                }

                const firstColumnPosition = Math.min(cursorColumnPosition, columnPosition);
                const lastColumnPosition = Math.max(cursorColumnPosition, columnPosition);
                const firstRowPosition = Math.min(cursorRowPosition, rowPosition);
                const lastRowPosition = Math.max(cursorRowPosition, rowPosition);

                const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(firstColumnPosition, lastColumnPosition);
                if (columnIndexes === undefined) {
                    return;
                }

                const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(firstRowPosition, lastRowPosition);
                if (rowIndexes === undefined) {
                    return;
                }

                this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, rowIndexes);
                await this.scrollToCell(columnIndex, rowIndex);
                this.fireOnDidUpdateEvent();
                break;
            }

            case MouseSelectionType.Multi:
                return;
        }
    }

    async mouseSelectColumn(columnIndex: number, mouseSelectionType: MouseSelectionType): Promise<void> {
        this._cellSelectionIndexes = undefined;
        this._rowSelectionIndexes = undefined;

        const adjustCursor = async (nextColumnIndex: number) => {
            this._cursorColumnIndex = nextColumnIndex;
            this._cursorRowIndex = this.firstRow?.rowIndex ?? 0;
        };

        switch (mouseSelectionType) {
            case MouseSelectionType.Single: {
                this._columnSelectionIndexes = new SelectionIndexes([columnIndex]);

                await adjustCursor(columnIndex);
                await this.scrollToColumn(columnIndex);
                await this.fetchData();
                this.fireOnDidUpdateEvent();
                break;
            }

            case MouseSelectionType.Range: {
                const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
                if (cursorColumnPosition === undefined) {
                    return;
                }

                const columnPosition = this._columnLayoutManager.mapIndexToPosition(columnIndex);
                if (columnPosition === undefined) {
                    return;
                }

                const firstColumnPosition = Math.min(cursorColumnPosition, columnPosition);
                const lastColumnPosition = Math.max(cursorColumnPosition, columnPosition);

                const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(firstColumnPosition, lastColumnPosition);
                if (columnIndexes === undefined) {
                    return;
                }

                this._columnSelectionIndexes = new SelectionIndexes(columnIndexes);

                await this.scrollToColumn(columnIndex);
                await this.fetchData();
                this.fireOnDidUpdateEvent();
                break;
            }

            case MouseSelectionType.Multi: {
                let indexes: number[] = [];

                if (this._columnSelectionIndexes === undefined) {
                    indexes.push(columnIndex);
                } else if (this._columnSelectionIndexes.contains(columnIndex)) {
                    indexes = this._columnSelectionIndexes.indexes.filter(index => index !== columnIndex);
                } else {
                    indexes = [...this._columnSelectionIndexes.indexes, columnIndex];
                }

                this._columnSelectionIndexes = indexes.length === 0
                    ? undefined
                    : new SelectionIndexes(indexes);

                await adjustCursor(columnIndex);
                await this.scrollToColumn(columnIndex);
                await this.fetchData();
                this.fireOnDidUpdateEvent();
                break;
            }
        }
    }

    async mouseSelectRow(rowIndex: number, mouseSelectionType: MouseSelectionType): Promise<void> {
        this._cellSelectionIndexes = undefined;
        this._columnSelectionIndexes = undefined;

        const adjustCursor = async (nextRowIndex: number) => {
            this._cursorColumnIndex = this.firstColumn?.columnIndex ?? 0;
            this._cursorRowIndex = nextRowIndex;
        };

        switch (mouseSelectionType) {
            case MouseSelectionType.Single: {
                this._rowSelectionIndexes = new SelectionIndexes([rowIndex]);

                await adjustCursor(rowIndex);
                await this.scrollToRow(rowIndex);
                await this.fetchData();
                this.fireOnDidUpdateEvent();
                break;
            }

            case MouseSelectionType.Range: {
                const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
                if (cursorRowPosition === undefined) {
                    return;
                }

                const rowPosition = this._rowLayoutManager.mapIndexToPosition(rowIndex);
                if (rowPosition === undefined) {
                    return;
                }

                const firstRowPosition = Math.min(cursorRowPosition, rowPosition);
                const lastRowPosition = Math.max(cursorRowPosition, rowPosition);

                const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(firstRowPosition, lastRowPosition);
                if (rowIndexes === undefined) {
                    return;
                }

                this._rowSelectionIndexes = new SelectionIndexes(rowIndexes);

                await this.scrollToRow(rowIndex);
                await this.fetchData();
                this.fireOnDidUpdateEvent();
                break;
            }

            case MouseSelectionType.Multi: {
                let indexes: number[] = [];

                if (this._rowSelectionIndexes === undefined) {
                    indexes.push(rowIndex);
                } else if (this._rowSelectionIndexes.contains(rowIndex)) {
                    indexes = this._rowSelectionIndexes.indexes.filter(index => index !== rowIndex);
                } else {
                    indexes = [...this._rowSelectionIndexes.indexes, rowIndex];
                }

                this._rowSelectionIndexes = indexes.length === 0
                    ? undefined
                    : new SelectionIndexes(indexes);

                await adjustCursor(rowIndex);
                await this.scrollToRow(rowIndex);
                await this.fetchData();
                this.fireOnDidUpdateEvent();
                break;
            }
        }
    }

    protected async buildColumnContextMenuItems(
        _columnIndex: number,
    ): Promise<DataGridContextMenuItem[] | undefined> {
        return undefined;
    }

    protected async buildRowContextMenuItems(
        _rowIndex: number,
    ): Promise<DataGridContextMenuItem[] | undefined> {
        return undefined;
    }

    protected async buildCellContextMenuItems(
        _columnIndex: number,
        _rowIndex: number,
    ): Promise<DataGridContextMenuItem[] | undefined> {
        return undefined;
    }

    async showColumnContextMenu(
        columnIndex: number,
        anchorElement: HTMLElement,
        anchorPoint?: DataGridContextMenuAnchorPoint,
    ): Promise<void> {
        const items = await this.buildColumnContextMenuItems(columnIndex);
        if (!items?.length) {
            return;
        }

        this.requestContextMenu({
            anchorElement,
            anchorPoint,
            items,
        });
    }

    async showRowContextMenu(
        rowIndex: number,
        anchorElement: HTMLElement,
        anchorPoint?: DataGridContextMenuAnchorPoint,
    ): Promise<void> {
        const items = await this.buildRowContextMenuItems(rowIndex);
        if (!items?.length) {
            return;
        }

        this.requestContextMenu({
            anchorElement,
            anchorPoint,
            items,
        });
    }

    async showCellContextMenu(
        columnIndex: number,
        rowIndex: number,
        anchorElement: HTMLElement,
        anchorPoint?: DataGridContextMenuAnchorPoint,
    ): Promise<void> {
        const items = await this.buildCellContextMenuItems(
            columnIndex,
            rowIndex,
        );
        if (!items?.length) {
            return;
        }

        this.requestContextMenu({
            anchorElement,
            anchorPoint,
            items,
        });
    }

    isColumnPinned(columnIndex: number): boolean {
        return this._columnLayoutManager.isPinnedIndex(columnIndex);
    }

    pinColumn(columnIndex: number): void {
        if (this._columnPinning && this._columnLayoutManager.pinnedIndexesCount < this._maximumPinnedColumns && this._columnLayoutManager.pinIndex(columnIndex)) {
            this.clearSelection();
            this._onDidChangePinnedColumnsEmitter.fire(this.getPinnedColumnIndexes());
            this.fireOnDidUpdateEvent();
        }
    }

    unpinColumn(columnIndex: number): void {
        if (this._columnPinning && this._columnLayoutManager.unpinIndex(columnIndex)) {
            this.clearSelection();
            this._onDidChangePinnedColumnsEmitter.fire(this.getPinnedColumnIndexes());
            this.fireOnDidUpdateEvent();
        }
    }

    isRowPinned(rowIndex: number): boolean {
        return this._rowLayoutManager.isPinnedIndex(rowIndex);
    }

    pinRow(rowIndex: number): void {
        if (this._rowPinning && this._rowLayoutManager.pinnedIndexesCount < this._maximumPinnedRows && this._rowLayoutManager.pinIndex(rowIndex)) {
            this.clearSelection();
            this.fireOnDidUpdateEvent();
        }
    }

    unpinRow(rowIndex: number): void {
        if (this._rowPinning && this._rowLayoutManager.unpinIndex(rowIndex)) {
            this.clearSelection();
            this.fireOnDidUpdateEvent();
        }
    }

    clearPinnedRows(): void {
        if (this._rowPinning && this._rowLayoutManager.pinnedIndexesCount > 0) {
            this._rowLayoutManager.setPinnedIndexes([]);
            this.clearSelection();
            this.fireOnDidUpdateEvent();
        }
    }

    moveCursorUp(): void {
        const previousRowIndex = this._rowLayoutManager.previousIndex(this._cursorRowIndex);
        if (previousRowIndex === undefined) {
            return;
        }
        this._cursorRowIndex = previousRowIndex;
        this.scrollToCursor();
        this.fireOnDidUpdateEvent();
    }

    moveCursorDown(): void {
        const nextRowIndex = this._rowLayoutManager.nextIndex(this._cursorRowIndex);
        if (nextRowIndex === undefined) {
            return;
        }
        this._cursorRowIndex = nextRowIndex;
        this.scrollToCursor();
        this.fireOnDidUpdateEvent();
    }

    moveCursorLeft(): void {
        const previousColumnIndex = this._columnLayoutManager.previousIndex(this._cursorColumnIndex);
        if (previousColumnIndex === undefined) {
            return;
        }
        this._cursorColumnIndex = previousColumnIndex;
        this.scrollToCursor();
        this.fireOnDidUpdateEvent();
    }

    moveCursorRight(): void {
        const nextColumnIndex = this._columnLayoutManager.nextIndex(this._cursorColumnIndex);
        if (nextColumnIndex === undefined) {
            return;
        }
        this._cursorColumnIndex = nextColumnIndex;
        this.scrollToCursor();
        this.fireOnDidUpdateEvent();
    }

    extendColumnSelectionLeft(_extendColumnSelectionBy: ExtendColumnSelectionBy): void {
        if (this._rowSelectionIndexes) {
            return;
        }

        if (this._columnSelectionIndexes) {
            if (this._columnSelectionIndexes.contains(this._cursorColumnIndex)) {
                const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
                if (cursorColumnPosition === undefined || cursorColumnPosition === 0) {
                    return;
                }

                const previousColumnIndex = this._columnLayoutManager.mapPositionToIndex(cursorColumnPosition - 1);
                if (previousColumnIndex === undefined) {
                    return;
                }

                this.setCursorColumn(previousColumnIndex);

                if (!this._columnSelectionIndexes.contains(previousColumnIndex)) {
                    this._columnSelectionIndexes = new SelectionIndexes([
                        previousColumnIndex,
                        ...this._columnSelectionIndexes.indexes,
                    ]);
                }

                void this.scrollToColumn(previousColumnIndex);
                this.fireOnDidUpdateEvent();
            }

            return;
        }

        if (this._cellSelectionIndexes) {
            if (this._cursorColumnIndex === this._cellSelectionIndexes.lastColumnIndex) {
                const firstColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstColumnIndex);
                if (!firstColumnPosition) {
                    return;
                }

                if (!(firstColumnPosition > 0)) {
                    return;
                }

                const lastColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastColumnIndex);
                if (lastColumnPosition === undefined) {
                    return;
                }

                const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(firstColumnPosition - 1, lastColumnPosition);
                if (columnIndexes === undefined) {
                    return;
                }

                this._cellSelectionIndexes = new CellSelectionIndexes(
                    columnIndexes,
                    this._cellSelectionIndexes.rowIndexes,
                );

                void this.scrollToColumn(columnIndexes[0]);
                this.fireOnDidUpdateEvent();
                return;
            }

            if (this._cursorColumnIndex === this._cellSelectionIndexes.firstColumnIndex) {
                const firstColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstColumnIndex);
                if (firstColumnPosition === undefined) {
                    return;
                }

                const lastColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastColumnIndex);
                if (lastColumnPosition === undefined) {
                    return;
                }

                const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(firstColumnPosition, lastColumnPosition - 1);
                if (columnIndexes === undefined) {
                    return;
                }

                this._cellSelectionIndexes = new CellSelectionIndexes(
                    columnIndexes,
                    this._cellSelectionIndexes.rowIndexes,
                );

                void this.scrollToColumn(columnIndexes[columnIndexes.length - 1]);
                this.fireOnDidUpdateEvent();
            }

            return;
        }

        const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
        if (cursorColumnPosition === undefined) {
            return;
        }

        if (!(cursorColumnPosition > 0)) {
            return;
        }

        const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
        if (cursorRowPosition === undefined) {
            return;
        }

        const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(cursorColumnPosition - 1, cursorColumnPosition);
        if (columnIndexes === undefined) {
            return;
        }

        const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(cursorRowPosition, cursorRowPosition);
        if (rowIndexes === undefined) {
            return;
        }

        this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, rowIndexes);

        void this.scrollToCell(columnIndexes[columnIndexes.length - 1], this._cursorRowIndex);
        this.fireOnDidUpdateEvent();
    }

    extendColumnSelectionRight(_extendColumnSelectionBy: ExtendColumnSelectionBy): void {
        if (this._rowSelectionIndexes) {
            return;
        }

        if (this._columnSelectionIndexes) {
            if (this._columnSelectionIndexes.contains(this._cursorColumnIndex)) {
                const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
                if (cursorColumnPosition === undefined || cursorColumnPosition === this._columnLayoutManager.entryCount - 1) {
                    return;
                }

                const nextColumnIndex = this._columnLayoutManager.mapPositionToIndex(cursorColumnPosition + 1);
                if (nextColumnIndex === undefined) {
                    return;
                }

                this.setCursorColumn(nextColumnIndex);

                if (!this._columnSelectionIndexes.contains(nextColumnIndex)) {
                    this._columnSelectionIndexes = new SelectionIndexes([
                        ...this._columnSelectionIndexes.indexes,
                        nextColumnIndex,
                    ]);
                }

                void this.scrollToColumn(nextColumnIndex);
                this.fireOnDidUpdateEvent();
            }

            return;
        }

        if (this._cellSelectionIndexes) {
            if (this._cursorColumnIndex === this._cellSelectionIndexes.firstColumnIndex) {
                const lastColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastColumnIndex);
                if (!lastColumnPosition) {
                    return;
                }

                if (!(lastColumnPosition < this._columnLayoutManager.entryCount - 1)) {
                    return;
                }

                const firstColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstColumnIndex);
                if (firstColumnPosition === undefined) {
                    return;
                }

                const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(firstColumnPosition, lastColumnPosition + 1);
                if (columnIndexes === undefined) {
                    return;
                }

                this._cellSelectionIndexes = new CellSelectionIndexes(
                    columnIndexes,
                    this._cellSelectionIndexes.rowIndexes,
                );

                void this.scrollToColumn(columnIndexes[columnIndexes.length - 1]);
                this.fireOnDidUpdateEvent();
                return;
            }

            if (this._cursorColumnIndex === this._cellSelectionIndexes.lastColumnIndex) {
                const firstColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstColumnIndex);
                if (firstColumnPosition === undefined) {
                    return;
                }

                const lastColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastColumnIndex);
                if (lastColumnPosition === undefined) {
                    return;
                }

                const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(firstColumnPosition + 1, lastColumnPosition);
                if (columnIndexes === undefined) {
                    return;
                }

                this._cellSelectionIndexes = new CellSelectionIndexes(
                    columnIndexes,
                    this._cellSelectionIndexes.rowIndexes,
                );

                void this.scrollToColumn(columnIndexes[columnIndexes.length - 1]);
                this.fireOnDidUpdateEvent();
            }

            return;
        }

        const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
        if (cursorColumnPosition === undefined) {
            return;
        }

        if (!(cursorColumnPosition < this._columnLayoutManager.entryCount - 1)) {
            return;
        }

        const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
        if (cursorRowPosition === undefined) {
            return;
        }

        const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(cursorColumnPosition, cursorColumnPosition + 1);
        if (columnIndexes === undefined) {
            return;
        }

        const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(cursorRowPosition, cursorRowPosition);
        if (rowIndexes === undefined) {
            return;
        }

        this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, rowIndexes);

        void this.scrollToCell(columnIndexes[columnIndexes.length - 1], this._cursorRowIndex);
        this.fireOnDidUpdateEvent();
    }

    extendRowSelectionUp(_extendRowSelectionBy: ExtendRowSelectionBy): void {
        if (this._columnSelectionIndexes) {
            return;
        }

        if (this._rowSelectionIndexes) {
            if (this._rowSelectionIndexes.contains(this._cursorRowIndex)) {
                const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
                if (cursorRowPosition === undefined || cursorRowPosition === 0) {
                    return;
                }

                const previousRowIndex = this._rowLayoutManager.mapPositionToIndex(cursorRowPosition - 1);
                if (previousRowIndex === undefined) {
                    return;
                }

                this.setCursorRow(previousRowIndex);

                if (!this._rowSelectionIndexes.contains(previousRowIndex)) {
                    this._rowSelectionIndexes = new SelectionIndexes([
                        previousRowIndex,
                        ...this._rowSelectionIndexes.indexes,
                    ]);
                }

                void this.scrollToRow(previousRowIndex);
                this.fireOnDidUpdateEvent();
            }

            return;
        }

        if (this._cellSelectionIndexes) {
            if (this._cursorRowIndex === this._cellSelectionIndexes.lastRowIndex) {
                const firstRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstRowIndex);
                if (!firstRowPosition) {
                    return;
                }

                if (!(firstRowPosition > 0)) {
                    return;
                }

                const lastRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastRowIndex);
                if (lastRowPosition === undefined) {
                    return;
                }

                const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(firstRowPosition - 1, lastRowPosition);
                if (rowIndexes === undefined) {
                    return;
                }

                this._cellSelectionIndexes = new CellSelectionIndexes(
                    this._cellSelectionIndexes.columnIndexes,
                    rowIndexes,
                );

                void this.scrollToRow(rowIndexes[0]);
                this.fireOnDidUpdateEvent();
                return;
            }

            if (this._cursorRowIndex === this._cellSelectionIndexes.firstRowIndex) {
                const firstRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstRowIndex);
                if (firstRowPosition === undefined) {
                    return;
                }

                const lastRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastRowIndex);
                if (lastRowPosition === undefined) {
                    return;
                }

                const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(firstRowPosition, lastRowPosition - 1);
                if (rowIndexes === undefined) {
                    return;
                }

                this._cellSelectionIndexes = new CellSelectionIndexes(
                    this._cellSelectionIndexes.columnIndexes,
                    rowIndexes,
                );

                void this.scrollToRow(rowIndexes[rowIndexes.length - 1]);
                this.fireOnDidUpdateEvent();
            }

            return;
        }

        const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
        if (!cursorRowPosition) {
            return;
        }

        if (!(cursorRowPosition > 0)) {
            return;
        }

        const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
        if (cursorColumnPosition === undefined) {
            return;
        }

        const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(cursorColumnPosition, cursorColumnPosition);
        if (columnIndexes === undefined) {
            return;
        }

        const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(cursorRowPosition - 1, cursorRowPosition);
        if (rowIndexes === undefined) {
            return;
        }

        this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, rowIndexes);

        void this.scrollToCell(this._cursorColumnIndex, this._cellSelectionIndexes.firstRowIndex);
        this.fireOnDidUpdateEvent();
    }

    extendRowSelectionDown(_extendRowSelectionBy: ExtendRowSelectionBy): void {
        if (this._columnSelectionIndexes) {
            return;
        }

        if (this._rowSelectionIndexes) {
            if (this._rowSelectionIndexes.contains(this._cursorRowIndex)) {
                const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
                if (cursorRowPosition === undefined || cursorRowPosition === this._rowLayoutManager.entryCount - 1) {
                    return;
                }

                const nextRowIndex = this._rowLayoutManager.mapPositionToIndex(cursorRowPosition + 1);
                if (nextRowIndex === undefined) {
                    return;
                }

                this.setCursorRow(nextRowIndex);

                if (!this._rowSelectionIndexes.contains(nextRowIndex)) {
                    this._rowSelectionIndexes = new SelectionIndexes([
                        ...this._rowSelectionIndexes.indexes,
                        nextRowIndex,
                    ]);
                }

                void this.scrollToRow(nextRowIndex);
                this.fireOnDidUpdateEvent();
            }

            return;
        }

        if (this._cellSelectionIndexes) {
            if (this._cursorRowIndex === this._cellSelectionIndexes.firstRowIndex) {
                const lastRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastRowIndex);
                if (!lastRowPosition) {
                    return;
                }

                if (!(lastRowPosition < this._rowLayoutManager.entryCount - 1)) {
                    return;
                }

                const firstRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstRowIndex);
                if (firstRowPosition === undefined) {
                    return;
                }

                const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(firstRowPosition, lastRowPosition + 1);
                if (rowIndexes === undefined) {
                    return;
                }

                this._cellSelectionIndexes = new CellSelectionIndexes(
                    this._cellSelectionIndexes.columnIndexes,
                    rowIndexes,
                );

                void this.scrollToRow(rowIndexes[rowIndexes.length - 1]);
                this.fireOnDidUpdateEvent();
                return;
            }

            if (this._cursorRowIndex === this._cellSelectionIndexes.lastRowIndex) {
                const firstRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.firstRowIndex);
                if (firstRowPosition === undefined) {
                    return;
                }

                const lastRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cellSelectionIndexes.lastRowIndex);
                if (lastRowPosition === undefined) {
                    return;
                }

                const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(firstRowPosition + 1, lastRowPosition);
                if (rowIndexes === undefined) {
                    return;
                }

                this._cellSelectionIndexes = new CellSelectionIndexes(
                    this._cellSelectionIndexes.columnIndexes,
                    rowIndexes,
                );

                void this.scrollToRow(rowIndexes[0]);
                this.fireOnDidUpdateEvent();
            }

            return;
        }

        const cursorRowPosition = this._rowLayoutManager.mapIndexToPosition(this._cursorRowIndex);
        if (cursorRowPosition === undefined) {
            return;
        }

        if (!(cursorRowPosition < this._rowLayoutManager.entryCount - 1)) {
            return;
        }

        const cursorColumnPosition = this._columnLayoutManager.mapIndexToPosition(this._cursorColumnIndex);
        if (cursorColumnPosition === undefined) {
            return;
        }

        const columnIndexes = this._columnLayoutManager.mapPositionsToIndexes(cursorColumnPosition, cursorColumnPosition);
        if (columnIndexes === undefined) {
            return;
        }

        const rowIndexes = this._rowLayoutManager.mapPositionsToIndexes(cursorRowPosition, cursorRowPosition + 1);
        if (rowIndexes === undefined) {
            return;
        }

        this._cellSelectionIndexes = new CellSelectionIndexes(columnIndexes, rowIndexes);

        void this.scrollToCell(this._cursorColumnIndex, rowIndexes[rowIndexes.length - 1]);
        this.fireOnDidUpdateEvent();
    }

    clearSelection(): void {
        this._cellSelectionIndexes = undefined;
        this._columnSelectionIndexes = undefined;
        this._rowSelectionIndexes = undefined;
    }

    /**
     * Gets the clipboard data based on current selection.
     * @returns The clipboard data, or undefined if nothing is selected.
     */
    getClipboardData(): ClipboardData | undefined {
        // Cell selection range
        if (this._cellSelectionIndexes) {
            return new ClipboardCellIndexes(
                this._cellSelectionIndexes.columnIndexes,
                this._cellSelectionIndexes.rowIndexes
            );
        }

        // Column selection
        if (this._columnSelectionIndexes) {
            const columnIndexes = this._columnSelectionIndexes.indexes;
            if (columnIndexes.length === 0) {
                return undefined;
            }
            return new ClipboardColumnIndexes(columnIndexes);
        }

        // Row selection
        if (this._rowSelectionIndexes) {
            const rowIndexes = this._rowSelectionIndexes.indexes;
            if (rowIndexes.length === 0) {
                return undefined;
            }
            return new ClipboardRowIndexes(rowIndexes);
        }

        // Cursor cell (fallback when no selection)
        if (this._cursorColumnIndex >= 0 && this._cursorRowIndex >= 0) {
            return new ClipboardCell(this._cursorColumnIndex, this._cursorRowIndex);
        }

        // No clipboard data available
        return undefined;
    }

    cellSelectionState(columnIndex: number, rowIndex: number): CellSelectionState {
        if (this._cellSelectionIndexes && this._cellSelectionIndexes.contains(columnIndex, rowIndex)) {
            let cellSelectionState = CellSelectionState.Selected;

            if (columnIndex === this._cellSelectionIndexes.firstColumnIndex) {
                cellSelectionState |= CellSelectionState.SelectedLeft;
            }

            if (columnIndex === this._cellSelectionIndexes.lastColumnIndex) {
                cellSelectionState |= CellSelectionState.SelectedRight;
            }

            if (rowIndex === this._cellSelectionIndexes.firstRowIndex) {
                cellSelectionState |= CellSelectionState.SelectedTop;
            }

            if (rowIndex === this._cellSelectionIndexes.lastRowIndex) {
                cellSelectionState |= CellSelectionState.SelectedBottom;
            }

            return cellSelectionState;
        }

        if (this._rowSelectionIndexes && this._rowSelectionIndexes.contains(rowIndex)) {
            return CellSelectionState.Selected;
        }

        if (this._columnSelectionIndexes && this._columnSelectionIndexes.contains(columnIndex)) {
            return CellSelectionState.Selected;
        }

        return CellSelectionState.None;
    }

    columnSelectionState(columnIndex: number): ColumnSelectionState {
        if (!this._columnSelectionIndexes || !this._columnSelectionIndexes.contains(columnIndex)) {
            return ColumnSelectionState.None;
        }

        let columnSelectionState = ColumnSelectionState.Selected;

        if (columnIndex === this._columnSelectionIndexes.firstIndex) {
            columnSelectionState |= ColumnSelectionState.SelectedLeft;
        }

        if (columnIndex === this._columnSelectionIndexes.lastIndex) {
            columnSelectionState |= ColumnSelectionState.SelectedRight;
        }

        return columnSelectionState;
    }

    rowSelectionState(rowIndex: number): RowSelectionState {
        if (!this._rowSelectionIndexes || !this._rowSelectionIndexes.contains(rowIndex)) {
            return RowSelectionState.None;
        }

        let rowSelectionState = RowSelectionState.Selected;

        if (rowIndex === this._rowSelectionIndexes.firstIndex) {
            rowSelectionState |= RowSelectionState.SelectedTop;
        }

        if (rowIndex === this._rowSelectionIndexes.lastIndex) {
            rowSelectionState |= RowSelectionState.SelectedBottom;
        }

        return rowSelectionState;
    }

    //#endregion Public Methods

    //#region Abstract Methods

    abstract column(columnIndex: number): IDataColumn | undefined;
    abstract cell(columnIndex: number, rowIndex: number): DataGridCellContent | undefined;

    //#endregion Abstract Methods

    //#region Protected Methods

    protected scrollToCursor(): void {
        // Get the cursor column layout entry.
        const cursorColumnLayoutEntry = this._columnLayoutManager.getLayoutEntry(this._cursorColumnIndex);
        if (cursorColumnLayoutEntry) {
            // If the cursor is to the left of the layout, scroll left.
            if (cursorColumnLayoutEntry.start < this._horizontalScrollOffset) {
                this._horizontalScrollOffset = cursorColumnLayoutEntry.start;
            }
            // If the cursor is to the right of the layout, scroll right.
            else if (cursorColumnLayoutEntry.end > this.layoutRight) {
                this._horizontalScrollOffset = cursorColumnLayoutEntry.end - this.layoutWidth;
            }
        }

        // Get the cursor row layout entry.
        const cursorRowLayoutEntry = this._rowLayoutManager.getLayoutEntry(this._cursorRowIndex);
        if (cursorRowLayoutEntry) {
            // If the cursor is above the layout, scroll up.
            if (cursorRowLayoutEntry.start < this._verticalScrollOffset) {
                this._verticalScrollOffset = cursorRowLayoutEntry.start;
            }
            // If the cursor is below the layout, scroll down.
            else if (cursorRowLayoutEntry.end > this.layoutBottom) {
                this._verticalScrollOffset = cursorRowLayoutEntry.end - this.layoutHeight;
            }
        }
    }

    private _buildRange(start: number, end: number): number[] {
        if (end < start) {
            return [];
        }
        const length = end - start + 1;
        const range = new Array(length);
        for (let i = 0; i < length; i++) {
            range[i] = start + i;
        }
        return range;
    }

    protected fireOnDidUpdateEvent(): void {
        if (!this._pendingOnDidUpdateEvent) {
            this._pendingOnDidUpdateEvent = true;
            queueMicrotask(() => {
                this._pendingOnDidUpdateEvent = false;
                this._onDidUpdateEmitter.fire();
                // Also update the Svelte store trigger
                this.updateTrigger.update(n => n + 1);
            });
        }
    }

    protected abstract fetchData(): Promise<void>;
    protected abstract doSortData(): Promise<void>;

    //#endregion Protected Methods
}

//#region Re-exports

export type { IColumnSortKey, IDataColumn, ILayoutEntry };
export { DataColumnAlignment };

//#endregion Re-exports
