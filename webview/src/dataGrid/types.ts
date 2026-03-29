/*---------------------------------------------------------------------------------------------
 *  Data Grid Types - Port from Positron's dataGridInstance
 *  Core interfaces for virtual scrolling data grid
 *--------------------------------------------------------------------------------------------*/

import type {
    BackendState as SharedBackendState,
    ColumnFilter as SharedColumnFilter,
    ColumnFilterType as SharedColumnFilterType,
    ColumnFilterTypeSupportStatus as SharedColumnFilterTypeSupportStatus,
    ColumnProfileType as SharedColumnProfileType,
    ColumnProfileTypeSupportStatus as SharedColumnProfileTypeSupportStatus,
    ColumnSchema,
    ColumnSortKey,
    ExportFormat as SharedExportFormat,
    RowFilter as SharedRowFilter,
    RowFilterType as SharedRowFilterType,
    RowFilterTypeSupportStatus as SharedRowFilterTypeSupportStatus,
    SupportStatus as SharedSupportStatus,
    SupportedFeatures as SharedSupportedFeatures,
} from '@shared/dataExplorer';

/**
 * Column descriptor for layout calculations
 */
export interface ColumnDescriptor {
    readonly columnIndex: number;
    readonly left: number;
    readonly width: number;
}

/**
 * Row descriptor for layout calculations
 */
export interface RowDescriptor {
    readonly rowIndex: number;
    readonly top: number;
    readonly height: number;
}

/**
 * Cell selection state flags
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
 * Column sort key interface
 */
export interface IColumnSortKey {
    readonly sortIndex: number;
    readonly columnIndex: number;
    readonly ascending: boolean;
}

/**
 * Data column interface
 */
export interface IDataColumn {
    readonly name: string;
    readonly type: string;
    readonly description?: string;
}

/**
 * Data grid configuration options
 */
export interface DataGridOptions {
    // Column headers
    columnHeaders: boolean;
    columnHeadersHeight: number;

    // Row headers (row numbers)
    rowHeaders: boolean;
    rowHeadersWidth: number;

    // Default sizes
    defaultColumnWidth: number;
    defaultRowHeight: number;

    // Column resize
    columnResize: boolean;
    minimumColumnWidth: number;
    maximumColumnWidth: number;

    // Scrollbar
    horizontalScrollbar: boolean;
    verticalScrollbar: boolean;
    scrollbarThickness: number;

    // Display options
    cellBorders: boolean;
    horizontalCellPadding: number;
}

/**
 * Viewport state for virtual scrolling
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

/**
 * Cell data for rendering
 */
export interface CellData {
    value: string;
    columnIndex: number;
    rowIndex: number;
}

export type SchemaColumn = ColumnSchema;
export type SupportStatus = SharedSupportStatus;
export type ColumnFilterType = SharedColumnFilterType;
export type RowFilterType = SharedRowFilterType;
export type ColumnProfileType = SharedColumnProfileType;
export type ExportFormat = SharedExportFormat;
export type RowFilterTypeSupportStatus = SharedRowFilterTypeSupportStatus;
export type ColumnFilterTypeSupportStatus = SharedColumnFilterTypeSupportStatus;
export type ColumnProfileTypeSupportStatus = SharedColumnProfileTypeSupportStatus;
export type BackendState = SharedBackendState;
export type ColumnFilter = SharedColumnFilter;
export type RowFilter = SharedRowFilter;
export type SortKey = ColumnSortKey;
export type SupportedFeatures = SharedSupportedFeatures;
