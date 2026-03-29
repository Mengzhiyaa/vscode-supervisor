/*---------------------------------------------------------------------------------------------
 *  Data Grid Types - Compatibility bridge for consumers that should not
 *  depend directly on every internal data-grid module.
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

export type {
    ColumnDescriptor,
    DataGridOptions,
    RowDescriptor,
    ViewportState,
} from './dataGridInstance';
export { CellSelectionState } from './dataGridInstance';
export type { IColumnSortKey } from './interfaces/columnSortKey';
export type { IDataColumn } from './interfaces/dataColumn';

/**
 * Cell data for rendering.
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
