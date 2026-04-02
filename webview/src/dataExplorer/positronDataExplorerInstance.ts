/*---------------------------------------------------------------------------------------------
 *  Positron data explorer instance
 *--------------------------------------------------------------------------------------------*/

import { get } from 'svelte/store';
import { createDataExplorerStores, type DataExplorerStores } from './stores';
import { TableSummaryDataGridInstance } from './tableSummaryDataGridInstance';
import { TableDataDataGridInstance } from './tableDataDataGridInstance';
import { TableDataCache } from './common/tableDataCache';
import type { BackendState, SchemaColumn } from '../dataGrid/types';
import { PositronDataExplorerLayout, type WebviewMessage } from './types';

type AugmentedBackendState = BackendState & {
    __ark_file_options?: {
        supportsFileOptions?: boolean;
        fileHasHeaderRow?: boolean;
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
    readonly tableDataDataGridInstance: TableDataDataGridInstance;
    readonly tableSchemaDataGridInstance: TableSummaryDataGridInstance;

    constructor(
        private readonly _postMessage: (message: WebviewMessage) => void,
    ) {
        this.stores = createDataExplorerStores();
        this.tableDataCache = new TableDataCache();
        this.tableDataDataGridInstance = new TableDataDataGridInstance(
            this.stores,
            this._postMessage,
            this.tableDataCache,
        );
        this.tableSchemaDataGridInstance = new TableSummaryDataGridInstance(
            this.stores,
            this._postMessage,
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
    }

    dispose(): void {
        this.tableSchemaDataGridInstance.dispose();
        this.tableDataDataGridInstance.dispose();
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

    handleInitialize(params: {
        identifier: string;
        displayName: string;
        languageName?: string;
        backendState: AugmentedBackendState | null;
    }): void {
        this._applyBackendState(params.backendState, {
            identifier: params.identifier,
            displayName: params.displayName,
            languageName: params.languageName,
        });
    }

    handleMetadata(params: {
        displayName: string;
        numRows: number;
        numColumns: number;
        hasRowLabels?: boolean;
    }): void {
        this.stores.state.update((state) => ({
            ...state,
            displayName: params.displayName,
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

    handleSchema(params: { columns: SchemaColumn[] }): void {
        this.tableDataDataGridInstance.handleSchemaUpdate(params.columns);
        this.stores.state.update((state) => ({
            ...state,
            schema: mergeSchemaColumns(state.schema ?? [], params.columns),
        }));
    }

    handleSummarySchema(params: {
        columns: SchemaColumn[];
        columnIndices: number[];
        requestId?: number;
    }): void {
        this.tableSchemaDataGridInstance.handleSummarySchema(params);
    }

    handleColumnProfiles(params: {
        profiles: Array<{ columnIndex: number; profile: unknown }>;
        error?: string;
        requestId?: number;
    }): void {
        this.tableSchemaDataGridInstance.handleColumnProfiles(
            params.profiles,
            params.error,
            params.requestId,
        );
        if (params.error) {
            this.stores.state.update((state) => ({
                ...state,
                error: params.error ?? state.error,
            }));
        }
    }

    handleData(params: {
        columns: string[][];
        startRow: number;
        endRow: number;
        columnIndices?: number[];
        rowLabels?: string[];
        schema?: SchemaColumn[];
    }): void {
        this.tableDataDataGridInstance.handleDataUpdate(params);
        if (params.schema && params.schema.length > 0) {
            this.stores.state.update((state) => ({
                ...state,
                schema: mergeSchemaColumns(state.schema ?? [], params.schema ?? []),
            }));
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

    handleError(params: { message: string }): void {
        this.stores.state.update((state) => ({
            ...state,
            error: params.message,
            isLoading: false,
        }));
    }

    private _applyBackendState(
        backendState: AugmentedBackendState | null,
        metadata?: {
            identifier?: string;
            displayName?: string;
            languageName?: string;
        },
    ): void {
        const previousState = this._currentBackendState();
        const previousFileHasHeaderRow = this._currentFileHasHeaderRow();
        const fileOptions = backendState?.__ark_file_options;
        const windowState = backendState?.__ark_window_state;
        const schemaInvalidated =
            previousState?.table_shape.num_columns !==
                backendState?.table_shape.num_columns ||
            (fileOptions?.fileHasHeaderRow !== undefined &&
                fileOptions.fileHasHeaderRow !== previousFileHasHeaderRow);
        const convertToCodeSupport =
            backendState?.supported_features?.convert_to_code?.support_status ===
            'supported';
        const codeSyntaxes =
            backendState?.supported_features?.convert_to_code?.code_syntaxes?.map(
                (entry) => entry.code_syntax_name,
            ) ?? [];

        this.stores.state.update((state) => ({
            ...state,
            identifier: metadata?.identifier ?? state.identifier,
            displayName:
                metadata?.displayName ?? backendState?.display_name ?? state.displayName,
            languageName: metadata?.languageName ?? state.languageName,
            backendState,
            schema: schemaInvalidated ? [] : state.schema,
            error: backendState?.error_message ?? null,
            supportsFileOptions:
                fileOptions?.supportsFileOptions ?? state.supportsFileOptions,
            fileHasHeaderRow:
                fileOptions?.fileHasHeaderRow ?? state.fileHasHeaderRow,
            supportsConvertToCode: convertToCodeSupport,
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
