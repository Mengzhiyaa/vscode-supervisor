/*---------------------------------------------------------------------------------------------
 *  Positron data explorer instance
 *--------------------------------------------------------------------------------------------*/

import { get } from 'svelte/store';
import { createDataExplorerStores, type DataExplorerStores } from './stores';
import { TableSummaryDataGridInstance } from './tableSummaryDataGridInstance';
import { TableDataDataGridInstance } from './tableDataDataGridInstance';
import { TableDataCache } from './common/tableDataCache';
import { DataExplorerSchemaClient } from './common/dataExplorerSchemaClient';
import type { BackendState, SchemaColumn } from '../dataGrid/types';
import {
    PositronDataExplorerLayout,
    type ColumnValue,
    type WebviewMessage,
} from './types';

type AugmentedBackendState = BackendState & {
    __ark_file_options?: {
        supportsFileOptions?: boolean;
        fileHasHeaderRow?: boolean;
        availableSheets?: string[];
        selectedSheet?: string;
        supportsOpenAsSpreadsheet?: boolean;
    };
    __ark_window_state?: {
        inNewWindow?: boolean;
    };
};

function mergeSchemaColumns(
    existing: SchemaColumn[],
    incoming: SchemaColumn[],
): SchemaColumn[] {
    const merged = new Map(existing.map((column) => [column.column_index, column]));
    for (const column of incoming) {
        merged.set(column.column_index, column);
    }

    return Array.from(merged.values()).sort(
        (left, right) => left.column_index - right.column_index,
    );
}

/**
 * PositronDataExplorerInstance class.
 */
export class PositronDataExplorerInstance {
    readonly stores: DataExplorerStores;
    readonly tableDataCache: TableDataCache;
    readonly schemaClient: DataExplorerSchemaClient;
    readonly tableDataDataGridInstance: TableDataDataGridInstance;
    readonly tableSchemaDataGridInstance: TableSummaryDataGridInstance;

    constructor(
        private readonly _postMessage: (message: WebviewMessage) => void,
    ) {
        this.stores = createDataExplorerStores();
        this.schemaClient = new DataExplorerSchemaClient(this._postMessage);
        this.tableDataCache = new TableDataCache();
        this.tableDataDataGridInstance = new TableDataDataGridInstance(
            this.stores,
            this._postMessage,
            this.tableDataCache,
        );
        this.tableSchemaDataGridInstance = new TableSummaryDataGridInstance(
            this.stores,
            this._postMessage,
            this.schemaClient,
            this.tableDataDataGridInstance.pinnedColumns,
        );
    }

    get tableSummaryDataGridInstance(): TableSummaryDataGridInstance {
        return this.tableSchemaDataGridInstance;
    }

    get layout(): PositronDataExplorerLayout {
        return (
            get(this.stores.state).layout ??
            PositronDataExplorerLayout.SummaryOnLeft
        );
    }

    set layout(layout: PositronDataExplorerLayout) {
        this._setLayout(layout, true);
    }

    get isSummaryCollapsed(): boolean {
        return get(this.stores.state).summaryCollapsed ?? false;
    }

    get summaryWidth(): number {
        return get(this.stores.state).summaryWidth ?? 350;
    }

    set summaryWidth(summaryWidth: number) {
        if (this.summaryWidth === summaryWidth) {
            return;
        }

        this.stores.state.update((state) => ({
            ...state,
            summaryWidth,
        }));
        this._postMessage({ type: 'setSummaryWidth', summaryWidth });
    }

    dispose(): void {
        this.tableSchemaDataGridInstance.dispose();
        this.tableDataDataGridInstance.dispose();
        this.schemaClient.dispose();
    }

    invalidateTableData(): void {
        this.tableDataDataGridInstance.clearCache();
    }

    collapseSummary(): void {
        this._setSummaryCollapsed(true, true);
    }

    expandSummary(): void {
        this._setSummaryCollapsed(false, true);
    }

    async clearColumnSorting(): Promise<void> {
        await this.tableDataDataGridInstance.clearColumnSortKeys();
    }

    handleLayoutChanged(layout: PositronDataExplorerLayout): void {
        this._setLayout(layout, false);
    }

    handleSummaryCollapsedChanged(collapsed: boolean): void {
        this._setSummaryCollapsed(collapsed, false);
    }

    handleSummaryWidthChanged(summaryWidth: number): void {
        this.stores.state.update(state => ({ ...state, summaryWidth }));
    }

    handleSelectionChanged(selection: {
        selectionType: 'cell' | 'cells' | 'columns' | 'rows';
        columnIndex?: number;
        rowIndex?: number;
        columnIndexes?: number[];
        rowIndexes?: number[];
    }): void {
        this.tableDataDataGridInstance.applySelection(selection);
    }

    handleInitialize(params: {
        identifier: string;
        displayName: string;
        languageName?: string;
        backendState: AugmentedBackendState | null;
    }): void {
        this._applyBackendState(params.backendState);
    }

    handleMetadata(params: {
        displayName: string;
        numRows: number;
        numColumns: number;
        hasRowLabels?: boolean;
    }): void {
        this.stores.state.update((state) => ({
            ...state,
            schema:
                state.backendState?.table_shape.num_columns !== params.numColumns
                    ? []
                    : state.schema,
            backendState: state.backendState
                ? {
                      ...state.backendState,
                      display_name: params.displayName,
                      table_shape: {
                          num_rows: params.numRows,
                          num_columns: params.numColumns,
                      },
                      has_row_labels: params.hasRowLabels ?? state.backendState.has_row_labels,
                  }
                : null,
        }));
        this.tableDataDataGridInstance.setDimensions(
            params.numColumns,
            params.numRows,
            params.hasRowLabels ?? false,
        );
    }

    handleSchema(params: {
        columns: SchemaColumn[];
        requestId?: number;
    }): void {
        this.schemaClient.handleSchema(params);
        this.tableDataDataGridInstance.handleSchemaUpdate(params.columns);
        this.tableSchemaDataGridInstance.handleSchema(params.columns);
        this.stores.state.update((state) => ({
            ...state,
            schema: mergeSchemaColumns(state.schema, params.columns),
        }));
    }

    handleSummarySchema(params: {
        columns: SchemaColumn[];
        columnIndices: number[];
        requestId?: number;
    }): void {
        this.schemaClient.handleSearchSchema(params);
    }

    handleColumnProfiles(params: {
        profiles: Array<{ columnIndex: number; profile: unknown }>;
        error?: string;
        requestId: number;
        generation: number;
    }): void {
        this.tableSchemaDataGridInstance.handleColumnProfiles(
            params.profiles,
            params.error,
            params.requestId,
            params.generation,
        );
        if (params.error) {
            this.stores.state.update((state) => ({
                ...state,
                error: {
                    message: params.error ?? '',
                    operation: 'requestColumnProfiles',
                    severity: 'error',
                    recoverable: true,
                    requestId: params.requestId,
                },
            }));
        }
    }

    handleData(params: {
        columns: ColumnValue[][];
        startRow: number;
        endRow: number;
        rowIndices?: number[];
        columnIndices?: number[];
        rowLabels?: string[];
        schema?: SchemaColumn[];
        requestId: number;
        generation: number;
    }): void {
        this.tableDataDataGridInstance.handleDataUpdate(params);
        if (params.schema && params.schema.length > 0) {
            this.stores.state.update((state) => ({
                ...state,
                schema: mergeSchemaColumns(state.schema, params.schema ?? []),
            }));
        }
    }

    handleDataInvalidated(params: {
        generation: number;
        schemaChanged: boolean;
    }): void {
        this.tableDataDataGridInstance.handleDataInvalidated(
            params.generation,
            params.schemaChanged,
        );
        if (params.schemaChanged) {
            this.tableSchemaDataGridInstance.handleSchemaUpdated(
                params.generation,
            );
        } else {
            this.tableSchemaDataGridInstance.handleDataUpdated(
                params.generation,
            );
        }
    }

    handleBackendState(params: { state: AugmentedBackendState }): void {
        this._applyBackendState(params.state);
    }

    handleLoading(params: { isLoading: boolean }): void {
        this.stores.state.update((state) => ({
            ...state,
            isLoading: params.isLoading,
        }));
    }

    handleError(params: {
        message: string;
        operation: string;
        severity: 'error' | 'warning';
        recoverable: boolean;
        requestId?: number;
    }): void {
        this.stores.state.update((state) => ({
            ...state,
            error: params,
            isLoading: false,
        }));
    }

    dismissError(): void {
        this.stores.state.update((state) => ({
            ...state,
            error: null,
        }));
    }

    private _applyBackendState(backendState: AugmentedBackendState | null): void {
        const previousState = this._currentBackendState();
        const previousFileHasHeaderRow = this._currentFileHasHeaderRow();
        const fileOptions = backendState?.__ark_file_options;
        const windowState = backendState?.__ark_window_state;
        const schemaInvalidated =
            previousState?.table_shape.num_columns !==
                backendState?.table_shape.num_columns ||
            (fileOptions?.fileHasHeaderRow !== undefined &&
                fileOptions.fileHasHeaderRow !== previousFileHasHeaderRow);
        const codeSyntaxes =
            backendState?.supported_features?.convert_to_code?.code_syntaxes?.map(
                (entry) => entry.code_syntax_name,
            ) ?? [];

        this.stores.state.update((state) => ({
            ...state,
            backendState,
            schema: schemaInvalidated ? [] : state.schema,
            error: backendState?.error_message
                ? {
                      message: backendState.error_message,
                      operation: 'backend',
                      severity: 'error',
                      recoverable: false,
                  }
                : null,
            supportsFileOptions:
                fileOptions?.supportsFileOptions ?? state.supportsFileOptions,
            fileHasHeaderRow:
                fileOptions?.fileHasHeaderRow ?? state.fileHasHeaderRow,
            fileAvailableSheets:
                fileOptions?.availableSheets ?? state.fileAvailableSheets,
            fileSelectedSheet:
                fileOptions?.selectedSheet ?? state.fileSelectedSheet,
            supportsOpenAsSpreadsheet:
                fileOptions?.supportsOpenAsSpreadsheet ??
                state.supportsOpenAsSpreadsheet,
            codeSyntaxes,
            inNewWindow: windowState?.inNewWindow ?? false,
        }));

        if (backendState) {
            this.tableDataDataGridInstance.handleBackendStateChanged(backendState, {
                schemaInvalidated,
            });
        }

        this.tableSchemaDataGridInstance.handleBackendStateChanged(
            previousState,
            backendState,
        );

        if (
            previousState &&
            fileOptions?.fileHasHeaderRow !== undefined &&
            fileOptions.fileHasHeaderRow !== previousFileHasHeaderRow
        ) {
            this.tableSchemaDataGridInstance.handleSchemaUpdated();
        }
    }

    private _currentBackendState(): AugmentedBackendState | null {
        return get(this.stores.state).backendState as AugmentedBackendState | null;
    }

    private _currentFileHasHeaderRow(): boolean | undefined {
        return get(this.stores.state).fileHasHeaderRow;
    }

    private _setLayout(
        layout: PositronDataExplorerLayout,
        notify: boolean,
    ): void {
        if (this.layout === layout) {
            return;
        }

        this.stores.state.update((state) => ({
            ...state,
            layout,
        }));

        if (notify) {
            this._postMessage({ type: 'setLayout', layout });
        }
    }

    private _setSummaryCollapsed(collapsed: boolean, notify: boolean): void {
        if (this.isSummaryCollapsed === collapsed) {
            return;
        }

        this.stores.state.update((state) => ({
            ...state,
            summaryCollapsed: collapsed,
        }));

        if (notify) {
            this._postMessage({ type: 'setSummaryCollapsed', collapsed });
        }
    }
}
