/*---------------------------------------------------------------------------------------------
 *  Data Explorer Types - Port from Positron's data explorer interfaces
 *--------------------------------------------------------------------------------------------*/

import type { SearchSchemaSortOrder } from '@shared/dataExplorer';
import type { BackendState, RowFilter, SchemaColumn } from '../dataGrid/types';

export type { SearchSchemaSortOrder };

/**
 * Data Explorer instance state
 */
export interface DataExplorerState {
    identifier: string;
    displayName: string;
    backendState: BackendState | null;
    schema: SchemaColumn[];
    isLoading: boolean;
    error: string | null;
    supportsFileOptions?: boolean;
    fileHasHeaderRow?: boolean;
    supportsConvertToCode?: boolean;
    codeSyntaxes?: string[];
    layout?: PositronDataExplorerLayout;
    summaryCollapsed?: boolean;
    inNewWindow?: boolean;
}

/**
 * Data request for fetching rows
 */
export interface DataRequest {
    startRow: number;
    endRow: number;
    columns: number[];
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
    | { type: 'requestData'; startRow: number; endRow: number; columns?: number[] }
    | { type: 'requestSchema'; columns: number[] }
    | { type: 'searchSchema'; text: string; sortOrder: SearchSchemaSortOrder; pinnedColumns?: number[]; requestId?: number }
    | { type: 'requestColumnProfiles'; columnIndices: number[]; expandedColumnIndices?: number[]; requestId?: number }
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
    | { type: 'runConvertToCode'; desiredSyntax: string }
    | { type: 'applyFileOptions'; hasHeaderRow: boolean }
    | { type: 'requestConvertToCodePreview'; desiredSyntax: string; requestId: number }
    | { type: 'setLayout'; layout: PositronDataExplorerLayout }
    | { type: 'setSummaryCollapsed'; collapsed: boolean }
    | { type: 'focusChanged'; focused: boolean };

/**
 * Message types from extension to webview
 */
export type ExtensionMessage =
    | { type: 'copy' }
    | { type: 'showColumnContextMenu' }
    | { type: 'showRowContextMenu' }
    | { type: 'showCellContextMenu' }
    | { type: 'layoutChanged'; layout: PositronDataExplorerLayout }
    | { type: 'summaryCollapsedChanged'; collapsed: boolean }
    | { type: 'convertToCodePreview'; desiredSyntax: string; requestId: number; code: string; error?: string }
    | { type: 'initialize'; state: DataExplorerState }
    | { type: 'metadata'; displayName: string; numRows: number; numColumns: number }
    | { type: 'schema'; columns: SchemaColumn[] }
    | { type: 'data'; startRow: number; endRow: number; columns: string[][]; columnIndices?: number[]; rowLabels?: string[]; schema?: SchemaColumn[]; totalRows?: number; totalColumns?: number }
    | { type: 'summarySchema'; columns: SchemaColumn[]; columnIndices: number[]; requestId?: number }
    | { type: 'columnProfiles'; profiles: Array<{ columnIndex: number; profile: unknown }>; error?: string; requestId?: number }
    | { type: 'backendState'; state: BackendState }
    | { type: 'error'; message: string }
    | { type: 'loading'; isLoading: boolean };
