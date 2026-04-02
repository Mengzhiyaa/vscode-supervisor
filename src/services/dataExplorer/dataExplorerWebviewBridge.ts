/*---------------------------------------------------------------------------------------------
 *  Data Explorer webview bridge
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { MessageConnection } from 'vscode-jsonrpc';
import type {
    RowFilter,
    ColumnFilter,
    ColumnSchema,
    ColumnProfileRequest,
    ColumnProfileSpec,
    SearchSchemaSortOrder,
    CodeSyntaxName,
    DatasetImportOptions,
} from '../../runtime/comms/positronDataExplorerComm';
import {
    ColumnFilterType,
    ColumnDisplayType,
    TextSearchType,
    SupportStatus,
    ColumnProfileType,
    ColumnHistogramParamsMethod,
    ExportFormat,
    TableSelectionKind,
} from '../../runtime/comms/positronDataExplorerComm';
import {
    DataExplorerReadyNotification,
    DataExplorerCloseNotification,
    DataExplorerRequestDataNotification,
    DataExplorerRequestSchemaNotification,
    DataExplorerSearchSchemaNotification,
    DataExplorerRequestColumnProfilesNotification,
    DataExplorerRefreshNotification,
    DataExplorerSortNotification,
    DataExplorerClearSortNotification,
    DataExplorerClearFiltersNotification,
    DataExplorerAddFilterNotification,
    DataExplorerUpdateFilterNotification,
    DataExplorerRemoveFilterNotification,
    DataExplorerCopyToClipboardNotification,
    DataExplorerCopyTableDataNotification,
    DataExplorerExportDataNotification,
    DataExplorerMoveToNewWindowNotification,
    DataExplorerRunConvertToCodeNotification,
    DataExplorerOpenAsPlaintextNotification,
    DataExplorerApplyFileOptionsNotification,
    DataExplorerRequestConvertToCodePreviewNotification,
    DataExplorerSetLayoutNotification,
    DataExplorerSetSummaryCollapsedNotification,
    DataExplorerFocusChangedNotification,
    DataExplorerLayoutChangedNotification,
    DataExplorerInitializeNotification,
    DataExplorerConvertToCodePreviewNotification,
    DataExplorerMetadataNotification,
    DataExplorerSchemaNotification,
    DataExplorerSummarySchemaNotification,
    DataExplorerSummaryCollapsedChangedNotification,
    DataExplorerColumnProfilesNotification,
    DataExplorerDataNotification,
    DataExplorerBackendStateNotification,
    DataExplorerErrorNotification,
} from '../../rpc/webview/dataExplorer';
import { isPlaintextDataExplorerIdentifier } from './dataExplorerUri';
import type { IPositronDataExplorerInstance } from './positronDataExplorerService';

const MAX_CLIPBOARD_CELLS = 10_000;
const SMALL_HISTOGRAM_NUM_BINS = 80;
const LARGE_HISTOGRAM_NUM_BINS = 100;
const SMALL_FREQUENCY_TABLE_LIMIT = 8;
const LARGE_FREQUENCY_TABLE_LIMIT = 16;
const BOOLEAN_FREQUENCY_TABLE_LIMIT = 2;

export type DataExplorerLayoutState = 'SummaryOnLeft' | 'SummaryOnRight';

export interface DataExplorerUiState {
    layout: DataExplorerLayoutState;
    summaryCollapsed: boolean;
}

export interface DataExplorerDataRequest {
    startRow: number;
    endRow?: number;
    columns?: number[];
}

export interface DataExplorerWebviewBridgeOptions {
    connection: MessageConnection;
    panel: vscode.WebviewPanel;
    instance: IPositronDataExplorerInstance;
    logChannel: vscode.LogOutputChannel;
    getUiState: () => DataExplorerUiState;
    isInstanceActive: () => boolean;
    isInstanceInNewWindow: () => boolean;
    getLastRequest: () => DataExplorerDataRequest | undefined;
    setLastRequest: (request: DataExplorerDataRequest) => void;
    runWithForegroundLoading: <T>(task: () => Promise<T>) => Promise<T>;
    onFocusChanged: (focused: boolean) => void;
    onSetLayout: (layout: DataExplorerLayoutState) => DataExplorerUiState;
    onSetSummaryCollapsed: (collapsed: boolean) => DataExplorerUiState;
    onSyncActiveContexts: () => void;
    onMoveToNewWindow: () => Promise<void>;
    openAsPlaintext: () => Promise<void>;
}

function normalizeColumnDisplayType(
    typeDisplay: string | undefined,
    typeName?: string,
): string {
    return (typeDisplay ?? typeName ?? '').trim().toLowerCase();
}

function isNumericColumnDisplayType(typeDisplay: string): boolean {
    return (
        typeDisplay === ColumnDisplayType.Floating ||
        typeDisplay === ColumnDisplayType.Integer ||
        typeDisplay === ColumnDisplayType.Decimal ||
        typeDisplay === 'dbl' ||
        typeDisplay.includes('float') ||
        typeDisplay.includes('double') ||
        typeDisplay.includes('decimal') ||
        typeDisplay.includes('int') ||
        typeDisplay.includes('integer') ||
        typeDisplay.includes('numeric') ||
        typeDisplay.includes('number') ||
        typeDisplay.includes('real')
    );
}

function isBooleanColumnDisplayType(typeDisplay: string): boolean {
    return (
        typeDisplay === ColumnDisplayType.Boolean ||
        typeDisplay.includes('bool') ||
        typeDisplay.includes('logical')
    );
}

function isStringColumnDisplayType(typeDisplay: string): boolean {
    return (
        typeDisplay === ColumnDisplayType.String ||
        typeDisplay.includes('string') ||
        typeDisplay.includes('character') ||
        typeDisplay.includes('char') ||
        typeDisplay.includes('text') ||
        typeDisplay.includes('varchar') ||
        typeDisplay.includes('str')
    );
}

function normalizeSearchValue(value: string | undefined): string {
    return value?.trim().toLowerCase() ?? '';
}

function matchesColumnSchemaSearch(
    columnSchema: ColumnSchema,
    searchText: string | undefined,
): boolean {
    const normalizedSearchText = normalizeSearchValue(searchText);
    if (!normalizedSearchText) {
        return true;
    }

    const normalizedTypeDisplay = normalizeColumnDisplayType(
        columnSchema.type_display,
        columnSchema.type_name,
    );
    const haystacks = [
        columnSchema.column_name,
        columnSchema.type_display,
        columnSchema.type_name,
        normalizedTypeDisplay,
        columnSchema.description,
    ];

    return haystacks.some((value) =>
        normalizeSearchValue(value).includes(normalizedSearchText),
    );
}

function sortSchemaColumns(
    columns: ColumnSchema[],
    sortOrder: SearchSchemaSortOrder,
): ColumnSchema[] {
    const sorted = [...columns];
    const sortByName = (a: ColumnSchema, b: ColumnSchema) =>
        a.column_name.localeCompare(b.column_name, undefined, {
            sensitivity: 'base',
        });
    const sortByType = (a: ColumnSchema, b: ColumnSchema) =>
        normalizeColumnDisplayType(a.type_display, a.type_name).localeCompare(
            normalizeColumnDisplayType(b.type_display, b.type_name),
            undefined,
            { sensitivity: 'base' },
        );

    switch (sortOrder) {
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
        case 'original':
        default:
            break;
    }

    return sorted;
}

export class DataExplorerWebviewBridge {
    constructor(private readonly _options: DataExplorerWebviewBridgeOptions) {}

    registerNotificationHandlers(): void {
        const { connection, panel, instance, logChannel } = this._options;

        connection.onNotification(DataExplorerReadyNotification.type, async () => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/ready');
            await this._options.runWithForegroundLoading(async () => {
                try {
                    await instance.clientInstance.updateBackendState();
                } catch (error) {
                    logChannel.warn(
                        `[DataExplorerEditor] Backend state update failed: ${error}`,
                    );
                }
                await this.sendInitialize();
                await this.sendData();
            });
        });

        connection.onNotification(DataExplorerCloseNotification.type, () => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/close');
            panel.dispose();
        });

        connection.onNotification(DataExplorerFocusChangedNotification.type, (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/focusChanged');
            this._options.onFocusChanged(params.focused === true);
        });

        connection.onNotification(DataExplorerSetLayoutNotification.type, (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/setLayout');
            const layout = this._isLayoutState(params.layout)
                ? params.layout
                : 'SummaryOnLeft';
            const uiState = this._options.onSetLayout(layout);
            this._notifyLayoutChanged(uiState.layout);
            if (panel.active) {
                this._options.onSyncActiveContexts();
            }
        });

        connection.onNotification(DataExplorerSetSummaryCollapsedNotification.type, (params) => {
            logChannel.debug(
                '[DataExplorerEditor] Received: dataExplorer/setSummaryCollapsed',
            );
            const uiState = this._options.onSetSummaryCollapsed(!!params.collapsed);
            this._notifySummaryCollapsedChanged(uiState.summaryCollapsed);
            if (panel.active) {
                this._options.onSyncActiveContexts();
            }
        });

        connection.onNotification(DataExplorerRequestDataNotification.type, async (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/requestData');
            this._options.setLastRequest({
                startRow: params.startRow,
                endRow: params.endRow,
                columns: params.columns,
            });
            await this._options.runWithForegroundLoading(async () => {
                await this.sendData(params.startRow, params.endRow, params.columns);
            });
        });

        connection.onNotification(DataExplorerRequestSchemaNotification.type, async (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/requestSchema');
            try {
                const schema = await instance.getSchema(params.columns);
                connection.sendNotification(DataExplorerSchemaNotification.type, {
                    columns: schema.columns,
                });
            } catch (error) {
                this._sendError(String(error));
            }
        });

        connection.onNotification(DataExplorerSearchSchemaNotification.type, async (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/searchSchema');
            try {
                const backendState = await instance.clientInstance.getBackendState();
                const supportsSearch =
                    backendState.supported_features.search_schema.support_status ===
                    SupportStatus.Supported;
                let columnIndices: number[] = [];
                let schemaColumns: ColumnSchema[] = [];

                if (supportsSearch) {
                    const filters: ColumnFilter[] = [];
                    if (params.text && params.text.trim().length > 0) {
                        filters.push({
                            filter_type: ColumnFilterType.TextSearch,
                            params: {
                                search_type: TextSearchType.Contains,
                                term: params.text.trim(),
                                case_sensitive: false,
                            },
                        });
                    }
                    const result = await instance.clientInstance.searchSchema(
                        filters,
                        params.sortOrder as SearchSchemaSortOrder,
                    );
                    columnIndices = result.matches ?? [];
                    const schema = await instance.getSchema(columnIndices);
                    const schemaByColumnIndex = new Map(
                        schema.columns.map((column) => [column.column_index, column]),
                    );
                    schemaColumns = columnIndices
                        .map((columnIndex) => schemaByColumnIndex.get(columnIndex))
                        .filter((column): column is ColumnSchema => Boolean(column));
                } else {
                    const allColumnIndices = Array.from(
                        { length: backendState.table_shape.num_columns },
                        (_, index) => index,
                    );
                    const schema = await instance.getSchema(allColumnIndices);
                    schemaColumns = sortSchemaColumns(
                        schema.columns.filter((column) =>
                            matchesColumnSchemaSearch(column, params.text),
                        ),
                        params.sortOrder as SearchSchemaSortOrder,
                    );
                    columnIndices = schemaColumns.map((column) => column.column_index);
                }

                if (params.pinnedColumns && params.pinnedColumns.length > 0) {
                    const pinned = params.pinnedColumns.filter(
                        (index) =>
                            index >= 0 &&
                            index < backendState.table_shape.num_columns,
                    );
                    const pinnedSet = new Set(pinned);
                    const rest = columnIndices.filter(
                        (index) => !pinnedSet.has(index),
                    );
                    columnIndices = [...pinned, ...rest];
                }
                const schemaByColumnIndex = new Map(
                    schemaColumns.map((column) => [column.column_index, column]),
                );
                const missingColumnIndices = columnIndices.filter(
                    (columnIndex) => !schemaByColumnIndex.has(columnIndex),
                );
                if (missingColumnIndices.length > 0) {
                    const missingSchema = await instance.getSchema(missingColumnIndices);
                    for (const column of missingSchema.columns) {
                        schemaByColumnIndex.set(column.column_index, column);
                    }
                }
                schemaColumns = columnIndices
                    .map((columnIndex) => schemaByColumnIndex.get(columnIndex))
                    .filter((column): column is ColumnSchema => Boolean(column));
                connection.sendNotification(DataExplorerSummarySchemaNotification.type, {
                    columns: schemaColumns,
                    columnIndices,
                    requestId: params.requestId,
                });
            } catch (error) {
                this._sendError(String(error));
            }
        });

        connection.onNotification(
            DataExplorerRequestColumnProfilesNotification.type,
            async (params) => {
                logChannel.debug(
                    '[DataExplorerEditor] Received: dataExplorer/requestColumnProfiles',
                );
                try {
                    const backendState =
                        await instance.clientInstance.getBackendState();
                    const supportsProfiles =
                        backendState.supported_features.get_column_profiles
                            .support_status === SupportStatus.Supported;
                    if (!supportsProfiles) {
                        connection.sendNotification(
                            DataExplorerColumnProfilesNotification.type,
                            {
                                profiles: params.columnIndices.map((columnIndex) => ({
                                    columnIndex,
                                    profile: undefined,
                                })),
                                error:
                                    'Column profiles are not supported by this backend.',
                                requestId: params.requestId,
                            },
                        );
                        return;
                    }

                    const supportedTypes =
                        backendState.supported_features.get_column_profiles
                            .supported_types ?? [];
                    const supportedProfileTypes = new Set(
                        supportedTypes
                            .filter(
                                (typeSupport) =>
                                    typeSupport.support_status ===
                                    SupportStatus.Supported,
                            )
                            .map((typeSupport) => typeSupport.profile_type),
                    );
                    const hasDeclaredSupportedTypes =
                        supportedTypes.length > 0;
                    const isProfileTypeSupported = (
                        profileType: ColumnProfileType,
                    ) =>
                        !hasDeclaredSupportedTypes ||
                        supportedProfileTypes.has(profileType);
                    const expandedColumnIndices = new Set(
                        params.expandedColumnIndices ?? [],
                    );

                    const schema = await instance.getSchema(params.columnIndices);
                    const schemaByIndex = new Map(
                        schema.columns.map((column) => [
                            column.column_index,
                            column,
                        ]),
                    );

                    const requests: ColumnProfileRequest[] =
                        params.columnIndices.map((columnIndex) => {
                            const columnSchema = schemaByIndex.get(columnIndex);
                            const profiles: ColumnProfileSpec[] = [];

                            if (
                                isProfileTypeSupported(
                                    ColumnProfileType.NullCount,
                                )
                            ) {
                                profiles.push({
                                    profile_type: ColumnProfileType.NullCount,
                                });
                            }

                            const expanded =
                                expandedColumnIndices.has(columnIndex);
                            if (
                                expanded &&
                                isProfileTypeSupported(
                                    ColumnProfileType.SummaryStats,
                                )
                            ) {
                                profiles.push({
                                    profile_type:
                                        ColumnProfileType.SummaryStats,
                                });
                            }

                            const columnType = normalizeColumnDisplayType(
                                columnSchema?.type_display,
                                columnSchema?.type_name,
                            );
                            const isNumericColumn =
                                isNumericColumnDisplayType(columnType);
                            const isBooleanColumn =
                                isBooleanColumnDisplayType(columnType);
                            const isStringColumn =
                                isStringColumnDisplayType(columnType);

                            if (
                                isNumericColumn &&
                                isProfileTypeSupported(
                                    ColumnProfileType.SmallHistogram,
                                )
                            ) {
                                profiles.push({
                                    profile_type:
                                        ColumnProfileType.SmallHistogram,
                                    params: {
                                        method:
                                            ColumnHistogramParamsMethod.FreedmanDiaconis,
                                        num_bins: SMALL_HISTOGRAM_NUM_BINS,
                                    },
                                });
                                if (
                                    expanded &&
                                    isProfileTypeSupported(
                                        ColumnProfileType.LargeHistogram,
                                    )
                                ) {
                                    profiles.push({
                                        profile_type:
                                            ColumnProfileType.LargeHistogram,
                                        params: {
                                            method:
                                                ColumnHistogramParamsMethod.FreedmanDiaconis,
                                            num_bins: LARGE_HISTOGRAM_NUM_BINS,
                                        },
                                    });
                                }
                            } else if (
                                isBooleanColumn &&
                                isProfileTypeSupported(
                                    ColumnProfileType.SmallFrequencyTable,
                                )
                            ) {
                                profiles.push({
                                    profile_type:
                                        ColumnProfileType.SmallFrequencyTable,
                                    params: {
                                        limit: BOOLEAN_FREQUENCY_TABLE_LIMIT,
                                    },
                                });
                            } else if (
                                isStringColumn &&
                                isProfileTypeSupported(
                                    ColumnProfileType.SmallFrequencyTable,
                                )
                            ) {
                                profiles.push({
                                    profile_type:
                                        ColumnProfileType.SmallFrequencyTable,
                                    params: {
                                        limit: SMALL_FREQUENCY_TABLE_LIMIT,
                                    },
                                });
                                if (
                                    expanded &&
                                    isProfileTypeSupported(
                                        ColumnProfileType.LargeFrequencyTable,
                                    )
                                ) {
                                    profiles.push({
                                        profile_type:
                                            ColumnProfileType.LargeFrequencyTable,
                                        params: {
                                            limit: LARGE_FREQUENCY_TABLE_LIMIT,
                                        },
                                    });
                                }
                            }

                            return {
                                column_index: columnIndex,
                                profiles,
                            };
                        });

                    const requestsWithProfiles = requests.filter(
                        (request) => request.profiles.length > 0,
                    );
                    if (requestsWithProfiles.length === 0) {
                        connection.sendNotification(
                            DataExplorerColumnProfilesNotification.type,
                            {
                                profiles: params.columnIndices.map(
                                    (columnIndex) => ({
                                        columnIndex,
                                        profile: undefined,
                                    }),
                                ),
                                requestId: params.requestId,
                            },
                        );
                        return;
                    }

                    const results =
                        await instance.clientInstance.requestColumnProfiles(
                            requestsWithProfiles,
                        );
                    const resultByIndex = new Map<number, unknown>();
                    requestsWithProfiles.forEach((request, index) => {
                        resultByIndex.set(request.column_index, results[index]);
                    });
                    const profiles = params.columnIndices.map((columnIndex) => ({
                        columnIndex,
                        profile: resultByIndex.get(columnIndex),
                    }));
                    connection.sendNotification(
                        DataExplorerColumnProfilesNotification.type,
                        {
                            profiles,
                            requestId: params.requestId,
                        },
                    );
                } catch (error) {
                    connection.sendNotification(
                        DataExplorerColumnProfilesNotification.type,
                        {
                            profiles: params.columnIndices.map((columnIndex) => ({
                                columnIndex,
                                profile: undefined,
                            })),
                            error: String(error),
                            requestId: params.requestId,
                        },
                    );
                }
            },
        );

        connection.onNotification(DataExplorerRefreshNotification.type, async () => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/refresh');
            await this._options.runWithForegroundLoading(async () => {
                await instance.clientInstance.updateBackendState();
                await this.sendInitialize();
                await this.sendDataFromLastRequest();
            });
        });

        connection.onNotification(DataExplorerSortNotification.type, async (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/sort');
            try {
                await this._options.runWithForegroundLoading(async () => {
                    await instance.clientInstance.setSortColumns(
                        params.sortKeys.map((sortKey) => ({
                            column_index: sortKey.columnIndex,
                            ascending: sortKey.ascending,
                        })),
                    );
                    await instance.clientInstance.updateBackendState();
                    await this.sendDataFromLastRequest();
                });
            } catch (error) {
                this._sendError(String(error));
            }
        });

        connection.onNotification(DataExplorerClearSortNotification.type, async () => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/clearSort');
            try {
                await this._options.runWithForegroundLoading(async () => {
                    await instance.clientInstance.setSortColumns([]);
                    await instance.clientInstance.updateBackendState();
                    await this.sendDataFromLastRequest();
                });
            } catch (error) {
                this._sendError(String(error));
            }
        });

        connection.onNotification(
            DataExplorerClearFiltersNotification.type,
            async () => {
                logChannel.debug(
                    '[DataExplorerEditor] Received: dataExplorer/clearFilters',
                );
                try {
                    await this._options.runWithForegroundLoading(async () => {
                        await instance.clientInstance.setRowFilters([]);
                        await instance.clientInstance.updateBackendState();
                        await this.sendDataFromLastRequest();
                    });
                } catch (error) {
                    this._sendError(String(error));
                }
            },
        );

        connection.onNotification(DataExplorerAddFilterNotification.type, async (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/addFilter');
            try {
                const currentFilters = instance.backendState?.row_filters ?? [];
                await this._options.runWithForegroundLoading(async () => {
                    await instance.clientInstance.setRowFilters([
                        ...currentFilters,
                        params.filter as RowFilter,
                    ]);
                    await instance.clientInstance.updateBackendState();
                    await this.sendDataFromLastRequest();
                });
            } catch (error) {
                this._sendError(String(error));
            }
        });

        connection.onNotification(DataExplorerUpdateFilterNotification.type, async (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/updateFilter');
            try {
                const currentFilters = instance.backendState?.row_filters ?? [];
                const updatedFilters = currentFilters.map((filter) =>
                    filter.filter_id ===
                    (params.filter as RowFilter).filter_id
                        ? (params.filter as RowFilter)
                        : filter,
                );
                await this._options.runWithForegroundLoading(async () => {
                    await instance.clientInstance.setRowFilters(updatedFilters);
                    await instance.clientInstance.updateBackendState();
                    await this.sendDataFromLastRequest();
                });
            } catch (error) {
                this._sendError(String(error));
            }
        });

        connection.onNotification(DataExplorerRemoveFilterNotification.type, async (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/removeFilter');
            try {
                const currentFilters = instance.backendState?.row_filters ?? [];
                const updatedFilters = currentFilters.filter(
                    (filter) => filter.filter_id !== params.filterId,
                );
                await this._options.runWithForegroundLoading(async () => {
                    await instance.clientInstance.setRowFilters(updatedFilters);
                    await instance.clientInstance.updateBackendState();
                    await this.sendDataFromLastRequest();
                });
            } catch (error) {
                this._sendError(String(error));
            }
        });

        connection.onNotification(
            DataExplorerCopyToClipboardNotification.type,
            async (params) => {
                logChannel.debug(
                    '[DataExplorerEditor] Received: dataExplorer/copyToClipboard',
                );
                try {
                    const backendState = instance.backendState;
                    const totalRows = backendState?.table_shape.num_rows ?? 0;
                    const totalColumns =
                        backendState?.table_shape.num_columns ?? 0;

                    let selection: { kind: string; selection: unknown };
                    let selectedCells = 0;

                    if (
                        params.selectionType === 'cell' &&
                        params.columnIndex !== undefined &&
                        params.rowIndex !== undefined
                    ) {
                        selection = {
                            kind: TableSelectionKind.SingleCell,
                            selection: {
                                column_index: params.columnIndex,
                                row_index: params.rowIndex,
                            },
                        };
                        selectedCells = 1;
                    } else if (
                        params.selectionType === 'cells' &&
                        params.columnIndexes &&
                        params.rowIndexes
                    ) {
                        selection = {
                            kind: TableSelectionKind.CellIndices,
                            selection: {
                                column_indices: params.columnIndexes,
                                row_indices: params.rowIndexes,
                            },
                        };
                        selectedCells =
                            params.columnIndexes.length *
                            params.rowIndexes.length;
                    } else if (
                        params.selectionType === 'columns' &&
                        params.columnIndexes
                    ) {
                        selection = {
                            kind: TableSelectionKind.ColumnIndices,
                            selection: {
                                indices: params.columnIndexes,
                            },
                        };
                        selectedCells = params.columnIndexes.length * totalRows;
                    } else if (
                        params.selectionType === 'rows' &&
                        params.rowIndexes
                    ) {
                        selection = {
                            kind: TableSelectionKind.RowIndices,
                            selection: {
                                indices: params.rowIndexes,
                            },
                        };
                        selectedCells = params.rowIndexes.length * totalColumns;
                    } else {
                        logChannel.warn(
                            '[DataExplorerEditor] Invalid clipboard selection',
                        );
                        return;
                    }

                    if (!selectedCells) {
                        vscode.window.showInformationMessage(
                            'There is nothing to copy to the clipboard.',
                        );
                        return;
                    }

                    if (selectedCells > MAX_CLIPBOARD_CELLS) {
                        vscode.window.showErrorMessage(
                            'There is too much data selected to copy to the clipboard.',
                        );
                        return;
                    }

                    const exported =
                        await instance.clientInstance.exportDataSelection(
                            selection as never,
                            ExportFormat.Tsv,
                        );

                    if (exported.data) {
                        await vscode.env.clipboard.writeText(exported.data);
                        logChannel.info('[DataExplorerEditor] Copied to clipboard');
                    }
                } catch (error) {
                    logChannel.error(`[DataExplorerEditor] Copy failed: ${error}`);
                    this._sendError(`Copy failed: ${String(error)}`);
                }
            },
        );

        connection.onNotification(DataExplorerCopyTableDataNotification.type, async () => {
            logChannel.debug(
                '[DataExplorerEditor] Received: dataExplorer/copyTableData',
            );
            try {
                const backendState = await instance.clientInstance.getBackendState();
                const supportStatus =
                    backendState.supported_features.export_data_selection
                        .support_status;
                if (supportStatus !== SupportStatus.Supported) {
                    vscode.window.showErrorMessage(
                        'Copy table data is not supported by this backend.',
                    );
                    return;
                }

                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Preparing table data',
                        cancellable: false,
                    },
                    async (progress) => {
                        const exported =
                            await instance.clientInstance.exportDataSelection(
                                {
                                    kind: TableSelectionKind.CellRange,
                                    selection: {
                                        first_row_index: 0,
                                        last_row_index: Math.max(
                                            0,
                                            backendState.table_shape.num_rows - 1,
                                        ),
                                        first_column_index: 0,
                                        last_column_index: Math.max(
                                            0,
                                            backendState.table_shape.num_columns - 1,
                                        ),
                                    },
                                },
                                ExportFormat.Tsv,
                            );

                        if (!exported.data) {
                            throw new Error('No data returned from export');
                        }

                        progress.report({
                            message: 'Copying table data to the clipboard',
                        });
                        await vscode.env.clipboard.writeText(exported.data);
                    },
                );

                vscode.window.showInformationMessage(
                    'Table data copied to the clipboard.',
                );
                logChannel.info(
                    '[DataExplorerEditor] Copied table data to clipboard',
                );
            } catch (error) {
                logChannel.error(
                    `[DataExplorerEditor] Copy table data failed: ${error}`,
                );
                vscode.window.showErrorMessage(
                    `Copy table data failed: ${String(error)}`,
                );
            }
        });

        connection.onNotification(DataExplorerExportDataNotification.type, async (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/exportData');
            try {
                const format =
                    params.format === 'csv' ? ExportFormat.Csv : ExportFormat.Tsv;
                const extension = params.format === 'csv' ? 'csv' : 'tsv';
                const filterName =
                    params.format === 'csv' ? 'CSV Files' : 'TSV Files';

                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(
                        `${instance.displayName}.${extension}`,
                    ),
                    filters: {
                        [filterName]: [extension],
                        'All Files': ['*'],
                    },
                });

                if (!saveUri) {
                    return;
                }

                const exported = await instance.clientInstance.exportDataSelection(
                    {
                        kind: TableSelectionKind.CellRange,
                        selection: {
                            first_row_index: 0,
                            last_row_index: Math.max(
                                0,
                                (instance.backendState?.table_shape.num_rows ?? 0) - 1,
                            ),
                            first_column_index: 0,
                            last_column_index: Math.max(
                                0,
                                (instance.backendState?.table_shape.num_columns ?? 0) - 1,
                            ),
                        },
                    },
                    format,
                );

                if (!exported.data) {
                    throw new Error('No data returned from export');
                }

                await vscode.workspace.fs.writeFile(
                    saveUri,
                    Buffer.from(exported.data, 'utf-8'),
                );
                vscode.window.showInformationMessage(
                    `Data exported to ${saveUri.fsPath}`,
                );
                logChannel.info(
                    `[DataExplorerEditor] Exported data to ${saveUri.fsPath}`,
                );
            } catch (error) {
                logChannel.error(`[DataExplorerEditor] Export failed: ${error}`);
                vscode.window.showErrorMessage(`Export failed: ${String(error)}`);
            }
        });

        connection.onNotification(
            DataExplorerMoveToNewWindowNotification.type,
            async () => {
                logChannel.debug(
                    '[DataExplorerEditor] Received: dataExplorer/moveToNewWindow',
                );
                if (this._options.isInstanceInNewWindow()) {
                    return;
                }
                try {
                    await this._options.onMoveToNewWindow();
                } catch (error) {
                    this._sendError(
                        `Failed to move editor to new window: ${String(error)}`,
                    );
                }
            },
        );

        connection.onNotification(
            DataExplorerRequestConvertToCodePreviewNotification.type,
            async (params) => {
                logChannel.debug(
                    '[DataExplorerEditor] Received: dataExplorer/requestConvertToCodePreview',
                );
                try {
                    const backendState =
                        await instance.clientInstance.getBackendState(true);
                    const availableSyntaxes =
                        backendState.supported_features.convert_to_code
                            .code_syntaxes ?? [];
                    const desiredSyntax = availableSyntaxes.find(
                        (syntax) =>
                            syntax.code_syntax_name === params.desiredSyntax,
                    );

                    if (!desiredSyntax) {
                        throw new Error(
                            `Unsupported code syntax: ${params.desiredSyntax}`,
                        );
                    }

                    const converted =
                        await instance.clientInstance.convertToCode(desiredSyntax);
                    connection.sendNotification(
                        DataExplorerConvertToCodePreviewNotification.type,
                        {
                            desiredSyntax: params.desiredSyntax,
                            requestId: params.requestId,
                            code: converted.converted_code.join('\n'),
                        },
                    );
                } catch (error) {
                    connection.sendNotification(
                        DataExplorerConvertToCodePreviewNotification.type,
                        {
                            desiredSyntax: params.desiredSyntax,
                            requestId: params.requestId,
                            code: '',
                            error: String(error),
                        },
                    );
                }
            },
        );

        connection.onNotification(DataExplorerRunConvertToCodeNotification.type, async (params) => {
            logChannel.debug(
                '[DataExplorerEditor] Received: dataExplorer/runConvertToCode',
            );
            try {
                if (!params.desiredSyntax?.trim()) {
                    throw new Error('No code syntax was selected.');
                }

                const syntax: CodeSyntaxName = {
                    code_syntax_name: params.desiredSyntax,
                };
                const converted = await instance.clientInstance.convertToCode(
                    syntax,
                );
                const code = converted.converted_code.join('\n').trim();
                if (!code) {
                    throw new Error(
                        'No code was generated for the current view.',
                    );
                }

                await vscode.env.clipboard.writeText(code);
                vscode.window.showInformationMessage(
                    `Converted to ${params.desiredSyntax} code and copied to clipboard.`,
                );
            } catch (error) {
                this._sendError(`Convert to code failed: ${String(error)}`);
            }
        });

        connection.onNotification(DataExplorerOpenAsPlaintextNotification.type, async () => {
            logChannel.debug(
                '[DataExplorerEditor] Received: dataExplorer/openAsPlaintext',
            );
            try {
                await this._options.openAsPlaintext();
            } catch (error) {
                this._sendError(`Open as plain text failed: ${String(error)}`);
            }
        });

        connection.onNotification(
            DataExplorerApplyFileOptionsNotification.type,
            async (params) => {
                logChannel.debug(
                    '[DataExplorerEditor] Received: dataExplorer/applyFileOptions',
                );
                try {
                    if (!instance.supportsFileOptions) {
                        throw new Error(
                            'File options are not supported by this dataset.',
                        );
                    }
                    const options: DatasetImportOptions = {
                        has_header_row: params.hasHeaderRow,
                    };
                    await this._options.runWithForegroundLoading(async () => {
                        const result = await instance.setDatasetImportOptions(
                            options,
                        );
                        if (result.error_message) {
                            throw new Error(result.error_message);
                        }
                        await instance.clientInstance.updateBackendState();
                        await this.sendInitialize();
                        await this.sendDataFromLastRequest();
                    });
                } catch (error) {
                    this._sendError(
                        `File options update failed: ${String(error)}`,
                    );
                }
            },
        );
    }

    sendBackendStateUpdate(): void {
        const state = this._buildAugmentedBackendState();
        if (!state) {
            return;
        }

        this._options.connection.sendNotification(
            DataExplorerBackendStateNotification.type,
            { state },
        );
    }

    async sendInitialize(): Promise<void> {
        const { connection, instance } = this._options;
        const uiState = this._options.getUiState();

        connection.sendNotification(DataExplorerInitializeNotification.type, {
            identifier: instance.identifier,
            displayName: instance.displayName,
            languageName: instance.languageName,
            backendState: this._buildAugmentedBackendState(),
        });
        connection.sendNotification(DataExplorerLayoutChangedNotification.type, {
            layout: uiState.layout,
        });
        connection.sendNotification(
            DataExplorerSummaryCollapsedChangedNotification.type,
            {
                collapsed: uiState.summaryCollapsed,
            },
        );

        const backendState = instance.backendState;
        if (backendState) {
            connection.sendNotification(DataExplorerMetadataNotification.type, {
                displayName: backendState.display_name,
                numRows: backendState.table_shape.num_rows,
                numColumns: backendState.table_shape.num_columns,
                hasRowLabels: backendState.has_row_labels,
            });
        }

        if (this._options.isInstanceActive()) {
            this._options.onSyncActiveContexts();
        }
    }

    async sendData(
        startRow: number = 0,
        endRow?: number,
        columnIndices?: number[],
    ): Promise<void> {
        const { connection, instance, logChannel } = this._options;
        try {
            const backendState = instance.backendState;
            if (!backendState) {
                return;
            }

            const numColumns = backendState.table_shape.num_columns;
            const numRows = backendState.table_shape.num_rows;
            const columns =
                columnIndices && columnIndices.length > 0
                    ? columnIndices
                    : Array.from({ length: numColumns }, (_, index) => index);
            const displayEndRow = Math.min(endRow ?? numRows, numRows);

            if (columns.length === 0 || numRows === 0) {
                connection.sendNotification(DataExplorerDataNotification.type, {
                    columns: [],
                    schema: [],
                    startRow: 0,
                    endRow: 0,
                    columnIndices: [],
                });
                return;
            }

            const schema = await instance.getSchema(columns);
            connection.sendNotification(DataExplorerSchemaNotification.type, {
                columns: schema.columns,
            });

            const columnSelections = columns.map((columnIndex) => ({
                column_index: columnIndex,
                spec: {
                    first_index: startRow,
                    last_index: displayEndRow - 1,
                },
            }));
            const tableData =
                await instance.clientInstance.getDataValues(columnSelections);

            let rowLabels: string[] | undefined;
            if (backendState.has_row_labels && displayEndRow > startRow) {
                const rowLabelResult = await instance.clientInstance.getRowLabels({
                    first_index: startRow,
                    last_index: displayEndRow - 1,
                });
                rowLabels = rowLabelResult.row_labels?.[0] ?? [];
            }

            connection.sendNotification(DataExplorerDataNotification.type, {
                columns: tableData.columns,
                schema: schema.columns,
                startRow,
                endRow: displayEndRow,
                columnIndices: columns,
                rowLabels,
                totalRows: numRows,
                totalColumns: numColumns,
            });
        } catch (error) {
            logChannel.error(`[DataExplorerEditor] Error fetching data: ${error}`);
            this._sendError(String(error));
        }
    }

    async sendDataFromLastRequest(): Promise<void> {
        const lastRequest = this._options.getLastRequest();
        if (lastRequest) {
            await this.sendData(
                lastRequest.startRow,
                lastRequest.endRow,
                lastRequest.columns,
            );
            return;
        }

        await this.sendData();
    }

    private _buildAugmentedBackendState() {
        const { instance } = this._options;
        const backendState = instance.backendState;
        if (!backendState) {
            return null;
        }

        return {
            ...backendState,
            __ark_file_options: {
                supportsFileOptions:
                    instance.supportsFileOptions &&
                    isPlaintextDataExplorerIdentifier(instance.identifier),
                fileHasHeaderRow: instance.fileHasHeaderRow,
            },
            __ark_window_state: {
                inNewWindow: this._options.isInstanceInNewWindow(),
            },
        };
    }

    private _notifyLayoutChanged(layout: DataExplorerLayoutState): void {
        this._options.connection.sendNotification(
            DataExplorerLayoutChangedNotification.type,
            { layout },
        );
    }

    private _notifySummaryCollapsedChanged(collapsed: boolean): void {
        this._options.connection.sendNotification(
            DataExplorerSummaryCollapsedChangedNotification.type,
            { collapsed },
        );
    }

    private _sendError(message: string): void {
        this._options.connection.sendNotification(DataExplorerErrorNotification.type, {
            message,
        });
    }

    private _isLayoutState(value: string): value is DataExplorerLayoutState {
        return value === 'SummaryOnLeft' || value === 'SummaryOnRight';
    }
}
