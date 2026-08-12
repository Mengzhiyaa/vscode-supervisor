/*---------------------------------------------------------------------------------------------
 *  Data Explorer Types - Port from Positron's data explorer interfaces
 *--------------------------------------------------------------------------------------------*/

import type { SearchSchemaSortOrder } from '@shared/dataExplorer';
import type { BackendState, RowFilter, SchemaColumn } from '../dataGrid/types';

export type { SearchSchemaSortOrder };

/** A formatted backend value or a numeric special-value sentinel. */
export type ColumnValue = number | string;

export interface DataExplorerErrorState {
    message: string;
    operation: string;
    severity: 'error' | 'warning';
    recoverable: boolean;
    requestId?: number;
}

/**
 * Data Explorer instance state
 */
export interface DataExplorerState {
    backendState: BackendState | null;
    schema: SchemaColumn[];
    isLoading: boolean;
    error: DataExplorerErrorState | null;
    supportsFileOptions?: boolean;
    supportsOpenAsSpreadsheet?: boolean;
    fileHasHeaderRow?: boolean;
    fileAvailableSheets?: string[];
    fileSelectedSheet?: string;
    codeSyntaxes?: string[];
    layout?: PositronDataExplorerLayout;
    summaryCollapsed?: boolean;
    summaryWidth?: number;
    inNewWindow?: boolean;
}

/**
 * PositronDataExplorerLayout enumeration.
 */
export enum PositronDataExplorerLayout {
    SummaryOnLeft = 'SummaryOnLeft',
    SummaryOnRight = 'SummaryOnRight'
}

/**
 * Message types for webview communication
 */
export type WebviewMessage =
    | { type: 'ready' }
    | { type: 'close' }
    | { type: 'requestData'; startRow: number; endRow: number; rowIndices?: number[]; columns: number[]; requestId: number; generation: number }
    | { type: 'requestSchema'; columns: number[]; requestId: number }
    | { type: 'searchSchema'; text: string; sortOrder: SearchSchemaSortOrder; pinnedColumns?: number[]; requestId?: number }
    | { type: 'requestColumnProfiles'; columnIndices: number[]; expandedColumnIndices?: number[]; requestId: number; generation: number }
    | { type: 'cancelColumnProfiles'; requestIds: number[] }
    | { type: 'refresh' }
    | { type: 'sort'; sortKeys: Array<{ columnIndex: number; ascending: boolean }> }
    | { type: 'clearSort' }
    | { type: 'addFilter'; filter: RowFilter }
    | { type: 'updateFilter'; filter: RowFilter }
    | { type: 'removeFilter'; filterId: string }
    | { type: 'clearFilters' }
    | { type: 'copyToClipboard'; selectionType: 'cell' | 'cells' | 'columns' | 'rows'; columnIndex?: number; rowIndex?: number; columnIndexes?: number[]; rowIndexes?: number[] }
    | { type: 'copyTableData' }
    | { type: 'exportData'; format: 'tsv' | 'csv' }
    | { type: 'moveToNewWindow' }
    | { type: 'openAsPlaintext' }
    | { type: 'openAsSpreadsheet' }
    | { type: 'runConvertToCode'; desiredSyntax: string }
    | { type: 'applyFileOptions'; hasHeaderRow: boolean; sheetName?: string }
    | { type: 'requestConvertToCodePreview'; desiredSyntax: string; requestId: number }
    | { type: 'setLayout'; layout: PositronDataExplorerLayout }
    | { type: 'setSummaryCollapsed'; collapsed: boolean }
    | { type: 'setSummaryWidth'; summaryWidth: number }
    | { type: 'setSelection'; selectionType: 'cell' | 'cells' | 'columns' | 'rows'; columnIndex?: number; rowIndex?: number; columnIndexes?: number[]; rowIndexes?: number[] }
    | { type: 'focusChanged'; focused: boolean };
