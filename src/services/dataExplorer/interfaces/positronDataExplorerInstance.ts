/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Positron Data Explorer contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type {
    BackendState,
    ColumnProfileRequest,
    ColumnProfileResult,
    ColumnSelection,
    ColumnSortKey,
    DatasetImportOptions,
    SetDatasetImportOptionsResult,
    TableData,
    TableSchema,
} from '../../../runtime/comms/positronDataExplorerComm';
import type { DataExplorerClientInstance } from '../languageRuntimeDataExplorerClient';

export type PositronDataExplorerLayout = 'SummaryOnLeft' | 'SummaryOnRight';

export interface PositronDataExplorerUiState {
    layout: PositronDataExplorerLayout;
    summaryCollapsed: boolean;
    summaryWidth: number;
}

export interface PositronDataExplorerDataRequest {
    startRow: number;
    endRow: number;
    rowIndices?: number[];
    columns: number[];
    requestId: number;
    generation: number;
}

export interface PositronDataExplorerInvalidationEvent {
    generation: number;
    schemaChanged: boolean;
}

export interface PositronDataExplorerSelection {
    selectionType: 'cell' | 'cells' | 'columns' | 'rows';
    columnIndex?: number;
    rowIndex?: number;
    columnIndexes?: number[];
    rowIndexes?: number[];
}

export interface IPositronDataExplorerInstance extends vscode.Disposable {
    readonly identifier: string;
    readonly displayName: string;
    readonly languageName: string;
    readonly sessionId: string | undefined;
    readonly clientInstance: DataExplorerClientInstance;
    readonly backendState: BackendState | undefined;
    readonly numColumns: number;
    readonly numRows: number;
    readonly supportsFileOptions: boolean;
    readonly fileHasHeaderRow: boolean;
    readonly fileAvailableSheets: readonly string[];
    readonly fileSelectedSheet: string | undefined;
    readonly inlineOnly: boolean;
    readonly uiState: PositronDataExplorerUiState;
    readonly focused: boolean;
    readonly dataGeneration: number;
    readonly lastDataRequest: PositronDataExplorerDataRequest | undefined;
    readonly selection: PositronDataExplorerSelection | undefined;

    readonly onDidClose: vscode.Event<void>;
    readonly onDidDispose: vscode.Event<void>;
    readonly onDidUpdateBackendState: vscode.Event<BackendState>;
    readonly onDidRequestFocus: vscode.Event<void>;
    readonly onDidChangeUiState: vscode.Event<PositronDataExplorerUiState>;
    readonly onDidChangeForegroundLoading: vscode.Event<boolean>;
    readonly onDidInvalidateData: vscode.Event<PositronDataExplorerInvalidationEvent>;
    readonly onDidChangeSelection: vscode.Event<PositronDataExplorerSelection | undefined>;

    requestFocus(): void;
    setLayout(layout: PositronDataExplorerLayout): void;
    setSummaryCollapsed(collapsed: boolean): void;
    setSummaryWidth(width: number): void;
    setFocused(focused: boolean): void;
    acquireVisibility(ownerId: string): vscode.Disposable;
    runWithForegroundLoading<T>(task: () => Promise<T>): Promise<T>;
    runDataMutation(task: () => Promise<void>, schemaChanged?: boolean): Promise<void>;
    invalidateData(schemaChanged: boolean): number;
    setLastDataRequest(request: PositronDataExplorerDataRequest): void;
    setSelection(selection: PositronDataExplorerSelection | undefined): void;
    setSortColumns(sortKeys: ColumnSortKey[]): Promise<void>;
    rebindClientInstance(clientInstance: DataExplorerClientInstance): void;

    getSchema(columnIndices: number[]): Promise<TableSchema>;
    getDataValues(columns: ColumnSelection[], generation: number): Promise<TableData>;
    requestColumnProfiles(
        profiles: ColumnProfileRequest[],
        generation: number,
        token?: vscode.CancellationToken,
    ): Promise<ColumnProfileResult[]>;
    getTableDataTsv(
        token?: vscode.CancellationToken,
        onProgress?: (completedRows: number, totalRows: number) => void,
    ): Promise<string>;
    setDatasetImportOptions(options: DatasetImportOptions): Promise<SetDatasetImportOptionsResult>;
}
