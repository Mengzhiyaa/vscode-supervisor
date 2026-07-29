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
    ArraySelection,
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
    DataExplorerCancelColumnProfilesNotification,
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
    DataExplorerOpenAsSpreadsheetNotification,
    DataExplorerApplyFileOptionsNotification,
    DataExplorerRequestConvertToCodePreviewNotification,
    DataExplorerSetLayoutNotification,
    DataExplorerSetSummaryCollapsedNotification,
    DataExplorerSetSummaryWidthNotification,
    DataExplorerSetSelectionNotification,
    DataExplorerFocusChangedNotification,
    DataExplorerLayoutChangedNotification,
    DataExplorerInitializeNotification,
    DataExplorerConvertToCodePreviewNotification,
    DataExplorerMetadataNotification,
    DataExplorerSchemaNotification,
    DataExplorerSummarySchemaNotification,
    DataExplorerSummaryCollapsedChangedNotification,
    DataExplorerSummaryWidthChangedNotification,
    DataExplorerSelectionChangedNotification,
    DataExplorerColumnProfilesNotification,
    DataExplorerDataInvalidatedNotification,
    DataExplorerDataNotification,
    DataExplorerBackendStateNotification,
    DataExplorerLoadingNotification,
    DataExplorerErrorNotification,
} from '../../rpc/webview/dataExplorer';
import {
    isSpreadsheetDataExplorerIdentifier,
    supportsDataExplorerFileOptions,
} from './dataExplorerUri';
import {
    DATA_EXPLORER_DISCONNECTED_STATE,
    DataExplorerClientStatus,
} from './languageRuntimeDataExplorerClient';
import type {
    IPositronDataExplorerInstance,
    PositronDataExplorerDataRequest,
    PositronDataExplorerLayout,
} from './interfaces/positronDataExplorerInstance';

const MAX_CLIPBOARD_CELLS = 10_000;
const SMALL_HISTOGRAM_NUM_BINS = 80;
const LARGE_HISTOGRAM_NUM_BINS = 200;
const SMALL_FREQUENCY_TABLE_LIMIT = 8;
const LARGE_FREQUENCY_TABLE_LIMIT = 16;
const BOOLEAN_FREQUENCY_TABLE_LIMIT = 2;

export type DataExplorerLayoutState = PositronDataExplorerLayout;
export type DataExplorerDataRequest = PositronDataExplorerDataRequest;

export interface DataExplorerWebviewBridgeOptions {
    connection: MessageConnection;
    panel: vscode.WebviewPanel;
    instance: IPositronDataExplorerInstance;
    logChannel: vscode.LogOutputChannel;
    isInstanceActive: () => boolean;
    isInstanceInNewWindow: () => boolean;
    onSyncActiveContexts: () => void;
    onMoveToNewWindow: () => Promise<void>;
    openAsPlaintext: () => Promise<void>;
    openAsSpreadsheet: () => Promise<void>;
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string'
    ) {
        const name =
            'name' in error && typeof error.name === 'string'
                ? `${error.name}: `
                : '';
        return `${name}${error.message}`;
    }
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
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
    private readonly _disposables: vscode.Disposable[] = [];
    private _surfaceVisible: boolean;
    private _pendingInvalidation: { generation: number; schemaChanged: boolean } | undefined;
    private readonly _profileRequestTokens = new Map<
        number,
        vscode.CancellationTokenSource
    >();

    constructor(private readonly _options: DataExplorerWebviewBridgeOptions) {
        const { instance } = _options;
        this._surfaceVisible = _options.panel.visible;
        this._disposables.push(
            instance.onDidChangeUiState(state => {
                this._notifyLayoutChanged(state.layout);
                this._notifySummaryCollapsedChanged(state.summaryCollapsed);
                this._notifySummaryWidthChanged(state.summaryWidth);
            }),
            instance.onDidChangeForegroundLoading(isLoading => {
                _options.connection.sendNotification(
                    DataExplorerLoadingNotification.type,
                    { isLoading },
                );
            }),
            instance.onDidInvalidateData(event => {
                if (this._surfaceVisible) {
                    _options.connection.sendNotification(
                        DataExplorerDataInvalidatedNotification.type,
                        event,
                    );
                } else {
                    this._pendingInvalidation = {
                        generation: event.generation,
                        schemaChanged:
                            event.schemaChanged ||
                            this._pendingInvalidation?.schemaChanged === true,
                    };
                }
            }),
            instance.onDidUpdateBackendState(() => {
                this.sendBackendStateUpdate();
                if (_options.isInstanceActive()) {
                    _options.onSyncActiveContexts();
                }
            }),
            instance.onDidClose(() => this.sendBackendStateUpdate()),
            instance.onDidChangeSelection(selection => {
                if (selection) {
                    _options.connection.sendNotification(
                        DataExplorerSelectionChangedNotification.type,
                        selection,
                    );
                }
            }),
        );
    }

    registerNotificationHandlers(): void {
        const { connection, panel, instance, logChannel } = this._options;

        connection.onNotification(DataExplorerReadyNotification.type, async () => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/ready');
            await instance.runWithForegroundLoading(async () => {
                await this._refreshInitialBackendState();
                await this.sendInitialize();
            });
        });

        connection.onNotification(DataExplorerCloseNotification.type, () => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/close');
            panel.dispose();
        });

        connection.onNotification(DataExplorerFocusChangedNotification.type, (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/focusChanged');
            instance.setFocused(params.focused === true);
            if (panel.active) {
                this._options.onSyncActiveContexts();
            }
        });

        connection.onNotification(DataExplorerSetLayoutNotification.type, (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/setLayout');
            const layout = this._isLayoutState(params.layout)
                ? params.layout
                : 'SummaryOnLeft';
            instance.setLayout(layout);
            if (panel.active) {
                this._options.onSyncActiveContexts();
            }
        });

        connection.onNotification(DataExplorerSetSummaryCollapsedNotification.type, (params) => {
            logChannel.debug(
                '[DataExplorerEditor] Received: dataExplorer/setSummaryCollapsed',
            );
            instance.setSummaryCollapsed(!!params.collapsed);
            if (panel.active) {
                this._options.onSyncActiveContexts();
            }
        });

        connection.onNotification(DataExplorerSetSummaryWidthNotification.type, (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/setSummaryWidth');
            instance.setSummaryWidth(params.summaryWidth);
        });

        connection.onNotification(DataExplorerSetSelectionNotification.type, (params) => {
            instance.setSelection(params);
        });

        connection.onNotification(DataExplorerRequestDataNotification.type, async (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/requestData');
            if (!this._surfaceVisible || params.columns?.length === 0) {
                return;
            }
            await instance.runWithForegroundLoading(async () => {
                if (params.generation !== instance.dataGeneration) {
                    return;
                }
                const request: DataExplorerDataRequest = {
                    startRow: params.startRow,
                    endRow: params.endRow,
                    rowIndices: params.rowIndices,
                    columns: params.columns ?? [],
                    requestId: params.requestId,
                    generation: params.generation,
                };
                instance.setLastDataRequest(request);
                await this.sendData(request);
            });
        });

        connection.onNotification(DataExplorerRequestSchemaNotification.type, async (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/requestSchema');
            try {
                const schema = await instance.getSchema(params.columns);
                connection.sendNotification(DataExplorerSchemaNotification.type, {
                    columns: schema.columns,
                    requestId: params.requestId,
                });
            } catch (error) {
                connection.sendNotification(DataExplorerSchemaNotification.type, {
                    columns: [],
                    requestId: params.requestId,
                });
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
                connection.sendNotification(DataExplorerSummarySchemaNotification.type, {
                    // Positron's search_schema returns matching indices. Column
                    // schema is paged separately by each visible grid cache.
                    columns: [],
                    columnIndices,
                    requestId: params.requestId,
                });
            } catch (error) {
                connection.sendNotification(
                    DataExplorerSummarySchemaNotification.type,
                    {
                        columns: [],
                        columnIndices: [],
                        requestId: params.requestId,
                    },
                );
                this._sendError(String(error));
            }
        });

        connection.onNotification(
            DataExplorerCancelColumnProfilesNotification.type,
            (params) => {
                for (const requestId of params.requestIds) {
                    const tokenSource = this._profileRequestTokens.get(requestId);
                    tokenSource?.cancel();
                    tokenSource?.dispose();
                    this._profileRequestTokens.delete(requestId);
                }
            },
        );

        connection.onNotification(
            DataExplorerRequestColumnProfilesNotification.type,
            async (params) => {
                logChannel.debug(
                    '[DataExplorerEditor] Received: dataExplorer/requestColumnProfiles',
                );
                const tokenSource = new vscode.CancellationTokenSource();
                this._profileRequestTokens.get(params.requestId)?.cancel();
                this._profileRequestTokens.get(params.requestId)?.dispose();
                this._profileRequestTokens.set(params.requestId, tokenSource);
                try {
                    if (!this._surfaceVisible) {
                        return;
                    }
                    const backendState =
                        await instance.clientInstance.getBackendState();
                    if (tokenSource.token.isCancellationRequested) {
                        return;
                    }
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
                                generation: params.generation,
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
                    const isProfileTypeSupported = (
                        profileType: ColumnProfileType,
                    ) =>
                        supportedProfileTypes.has(profileType);
                    const expandedColumnIndices = new Set(
                        params.expandedColumnIndices ?? [],
                    );

                    const schema = await instance.getSchema(params.columnIndices);
                    if (tokenSource.token.isCancellationRequested) {
                        return;
                    }
                    const schemaByIndex = new Map(
                        schema.columns.map((column) => [
                            column.column_index,
                            column,
                        ]),
                    );

                    const requests: ColumnProfileRequest[] =
                        params.columnIndices.map((columnIndex) => {
                            const columnSchema = schemaByIndex.get(columnIndex);
                            // Positron always requests the null count whenever
                            // column profiles are globally supported.
                            const profiles: ColumnProfileSpec[] = [{
                                profile_type: ColumnProfileType.NullCount,
                            }];

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
                                        ColumnProfileType.SmallHistogram,
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
                                        ColumnProfileType.SmallFrequencyTable,
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
                                generation: params.generation,
                            },
                        );
                        return;
                    }

                    if (tokenSource.token.isCancellationRequested) {
                        return;
                    }
                    const results = await instance.requestColumnProfiles(
                        requestsWithProfiles,
                        params.generation,
                        tokenSource.token,
                    );
                    if (
                        tokenSource.token.isCancellationRequested ||
                        this._profileRequestTokens.get(params.requestId) !== tokenSource
                    ) {
                        return;
                    }
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
                            generation: params.generation,
                        },
                    );
                } catch (error) {
                    if (!this._profileRequestTokens.has(params.requestId)) {
                        return;
                    }
                    connection.sendNotification(
                        DataExplorerColumnProfilesNotification.type,
                        {
                            profiles: params.columnIndices.map((columnIndex) => ({
                                columnIndex,
                                profile: undefined,
                            })),
                            error: String(error),
                            requestId: params.requestId,
                            generation: params.generation,
                        },
                    );
                } finally {
                    if (
                        this._profileRequestTokens.get(params.requestId) ===
                        tokenSource
                    ) {
                        tokenSource.dispose();
                        this._profileRequestTokens.delete(params.requestId);
                    }
                }
            },
        );

        connection.onNotification(DataExplorerRefreshNotification.type, async () => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/refresh');
            await instance.runWithForegroundLoading(async () => {
                await instance.runDataMutation(async () => {
                    await instance.clientInstance.updateBackendState();
                    await this.sendInitialize();
                }, true);
            });
        });

        connection.onNotification(DataExplorerSortNotification.type, async (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/sort');
            try {
                await instance.runWithForegroundLoading(async () => {
                    await instance.setSortColumns(
                        params.sortKeys.map((sortKey) => ({
                            column_index: sortKey.columnIndex,
                            ascending: sortKey.ascending,
                        })),
                    );
                });
            } catch (error) {
                this._sendError(String(error));
            }
        });

        connection.onNotification(DataExplorerClearSortNotification.type, async () => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/clearSort');
            try {
                await instance.runWithForegroundLoading(async () => {
                    await instance.setSortColumns([]);
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
                    await this._mutateRowFilters(() => []);
                } catch (error) {
                    this._sendError(String(error));
                }
            },
        );

        connection.onNotification(DataExplorerAddFilterNotification.type, async (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/addFilter');
            try {
                await this._mutateRowFilters((currentFilters) => [
                    ...currentFilters,
                    params.filter as RowFilter,
                ]);
            } catch (error) {
                this._sendError(String(error));
            }
        });

        connection.onNotification(DataExplorerUpdateFilterNotification.type, async (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/updateFilter');
            try {
                await this._mutateRowFilters((currentFilters) =>
                    currentFilters.map((filter) =>
                        filter.filter_id ===
                        (params.filter as RowFilter).filter_id
                            ? (params.filter as RowFilter)
                            : filter,
                    ),
                );
            } catch (error) {
                this._sendError(String(error));
            }
        });

        connection.onNotification(DataExplorerRemoveFilterNotification.type, async (params) => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/removeFilter');
            try {
                await this._mutateRowFilters((currentFilters) =>
                    currentFilters.filter(
                        (filter) => filter.filter_id !== params.filterId,
                    ),
                );
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
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Preparing table data',
                        cancellable: true,
                    },
                    async (progress, token) => {
                        let tableData: string;
                        if (supportStatus === SupportStatus.Supported) {
                            const exported = await instance.clientInstance.exportDataSelection(
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
                            tableData = exported.data;
                        } else {
                            let reportedProgress = 0;
                            tableData = await instance.getTableDataTsv(
                                token,
                                (completedRows, totalRows) => {
                                    const nextProgress = totalRows > 0
                                        ? (completedRows / totalRows) * 100
                                        : 100;
                                    progress.report({
                                        increment: nextProgress - reportedProgress,
                                        message: `${completedRows} / ${totalRows} rows`,
                                    });
                                    reportedProgress = nextProgress;
                                },
                            );
                        }
                        progress.report({
                            message: 'Copying table data to the clipboard',
                        });
                        await vscode.env.clipboard.writeText(tableData);
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

        connection.onNotification(DataExplorerOpenAsSpreadsheetNotification.type, async () => {
            logChannel.debug('[DataExplorerEditor] Received: dataExplorer/openAsSpreadsheet');
            try {
                await this._options.openAsSpreadsheet();
            } catch (error) {
                this._sendError(`Open as spreadsheet failed: ${String(error)}`);
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
                        sheet_name: params.sheetName,
                    };
                    await instance.runWithForegroundLoading(async () => {
                        const result = await instance.setDatasetImportOptions(options);
                        if (result.error_message) {
                            throw new Error(result.error_message);
                        }
                        await instance.clientInstance.updateBackendState();
                        await this.sendInitialize();
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

    setSurfaceVisible(visible: boolean): void {
        if (this._surfaceVisible === visible) {
            return;
        }
        this._surfaceVisible = visible;
        if (!visible) {
            for (const tokenSource of this._profileRequestTokens.values()) {
                tokenSource.cancel();
            }
            return;
        }
        if (this._pendingInvalidation) {
            this._options.connection.sendNotification(
                DataExplorerDataInvalidatedNotification.type,
                this._pendingInvalidation,
            );
            this._pendingInvalidation = undefined;
        }
        this.sendBackendStateUpdate();
    }

    async sendInitialize(): Promise<void> {
        const { connection, instance } = this._options;
        const uiState = instance.uiState;

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
        connection.sendNotification(DataExplorerSummaryWidthChangedNotification.type, {
            summaryWidth: uiState.summaryWidth,
        });
        if (instance.selection) {
            connection.sendNotification(
                DataExplorerSelectionChangedNotification.type,
                instance.selection,
            );
        }
        connection.sendNotification(DataExplorerDataInvalidatedNotification.type, {
            generation: instance.dataGeneration,
            schemaChanged: true,
        });

        const backendState = instance.backendState ??
            (this._isBackendDisconnected()
                ? DATA_EXPLORER_DISCONNECTED_STATE
                : undefined);
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
        request: DataExplorerDataRequest,
        shouldPublish: () => boolean = () => true,
    ): Promise<void> {
        const { connection, instance, logChannel } = this._options;
        const canPublish = () =>
            this._surfaceVisible &&
            shouldPublish() &&
            request.generation === instance.dataGeneration;
        try {
            const backendState = instance.backendState;
            if (!backendState || !canPublish()) {
                return;
            }

            const numColumns = backendState.table_shape.num_columns;
            const numRows = backendState.table_shape.num_rows;
            const columns = [...new Set(request.columns)].filter(
                (columnIndex) =>
                    Number.isInteger(columnIndex) &&
                    columnIndex >= 0 &&
                    columnIndex < numColumns,
            );
            const rowIndices =
                request.rowIndices === undefined
                    ? undefined
                    : [...new Set(request.rowIndices)]
                          .filter(
                              (rowIndex) =>
                                  Number.isInteger(rowIndex) &&
                                  rowIndex >= 0 &&
                                  rowIndex < numRows,
                          )
                          .sort((left, right) => left - right);
            const displayStartRow =
                rowIndices !== undefined
                    ? (rowIndices[0] ?? 0)
                    : Math.max(0, Math.min(request.startRow, numRows));
            const displayEndRow =
                rowIndices !== undefined
                    ? rowIndices.length > 0
                        ? rowIndices[rowIndices.length - 1] + 1
                        : displayStartRow
                    : Math.max(
                          displayStartRow,
                          Math.min(request.endRow, numRows),
                      );

            if (columns.length === 0) {
                connection.sendNotification(DataExplorerDataNotification.type, {
                    columns: [],
                    schema: [],
                    startRow: displayStartRow,
                    endRow: displayEndRow,
                    rowIndices,
                    columnIndices: [],
                    totalRows: numRows,
                    totalColumns: numColumns,
                    requestId: request.requestId,
                    generation: request.generation,
                });
                return;
            }

            const schema = await instance.getSchema(columns);
            if (!canPublish()) {
                return;
            }
            connection.sendNotification(DataExplorerSchemaNotification.type, {
                columns: schema.columns,
            });

            let dataColumns = columns.map(() => [] as Array<number | string>);
            const rowSelection: ArraySelection | undefined =
                rowIndices !== undefined
                    ? rowIndices.length > 0
                        ? { indices: rowIndices }
                        : undefined
                    : displayEndRow > displayStartRow
                      ? {
                            first_index: displayStartRow,
                            last_index: displayEndRow - 1,
                        }
                      : undefined;
            if (rowSelection) {
                const columnSelections = columns.map((columnIndex) => ({
                    column_index: columnIndex,
                    spec: rowSelection,
                }));
                const tableData =
                    await instance.getDataValues(columnSelections, request.generation);
                if (!canPublish()) {
                    return;
                }
                dataColumns = tableData.columns;
            }

            let rowLabels: string[] | undefined;
            if (
                backendState.has_row_labels &&
                rowSelection
            ) {
                const rowLabelResult =
                    await instance.clientInstance.getRowLabels(rowSelection);
                if (!canPublish()) {
                    return;
                }
                rowLabels = rowLabelResult.row_labels?.[0] ?? [];
            }

            connection.sendNotification(DataExplorerDataNotification.type, {
                columns: dataColumns,
                schema: schema.columns,
                startRow: displayStartRow,
                endRow: displayEndRow,
                rowIndices,
                columnIndices: columns,
                rowLabels,
                totalRows: numRows,
                totalColumns: numColumns,
                requestId: request.requestId,
                generation: request.generation,
            });
        } catch (error) {
            logChannel.error(`[DataExplorerEditor] Error fetching data: ${error}`);
            this._sendError(String(error));
        }
    }

    async sendDataFromLastRequest(shouldPublish: () => boolean = () => true): Promise<void> {
        const lastRequest = this._options.instance.lastDataRequest;
        if (
            !lastRequest ||
            lastRequest.generation !== this._options.instance.dataGeneration
        ) {
            return;
        }

        await this.sendData(lastRequest, shouldPublish);
    }

    invalidateData(
        schemaChanged: boolean,
        shouldPublish: () => boolean = () => true,
    ): number {
        if (!shouldPublish()) {
            return this._options.instance.dataGeneration;
        }
        return this._options.instance.invalidateData(schemaChanged);
    }

    dispose(): void {
        for (const tokenSource of this._profileRequestTokens.values()) {
            tokenSource.cancel();
            tokenSource.dispose();
        }
        this._profileRequestTokens.clear();
        this._disposables.forEach(disposable => disposable.dispose());
    }

    private _buildAugmentedBackendState() {
        const { instance } = this._options;
        const disconnected = this._isBackendDisconnected();
        const backendState = instance.backendState ??
            (disconnected ? DATA_EXPLORER_DISCONNECTED_STATE : undefined);
        if (!backendState) {
            return null;
        }

        return {
            ...backendState,
            connected: !disconnected,
            // Match Positron's distinction between a normal backend closure and
            // a backend-reported error. A disconnected client without an
            // explicit error is presented as unavailable, not as an error.
            error_message: backendState.error_message,
            __ark_file_options: {
                supportsFileOptions:
                    instance.supportsFileOptions &&
                    supportsDataExplorerFileOptions(instance.identifier),
                fileHasHeaderRow: instance.fileHasHeaderRow,
                availableSheets: instance.fileAvailableSheets,
                selectedSheet: instance.fileSelectedSheet,
                supportsOpenAsSpreadsheet:
                    isSpreadsheetDataExplorerIdentifier(instance.identifier) &&
                    vscode.env.uiKind === vscode.UIKind.Desktop &&
                    !vscode.env.remoteName,
            },
            __ark_window_state: {
                inNewWindow: this._options.isInstanceInNewWindow(),
            },
        };
    }

    private _isBackendDisconnected(): boolean {
        return this._options.instance.clientInstance.status ===
            DataExplorerClientStatus.Disconnected;
    }

    private async _refreshInitialBackendState(): Promise<void> {
        const { instance, logChannel } = this._options;
        try {
            await instance.clientInstance.updateBackendState();
        } catch (error) {
            logChannel.error(
                `[DataExplorerEditor] Backend state update failed: ${formatError(error)}`,
            );
        }
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

    private _notifySummaryWidthChanged(summaryWidth: number): void {
        this._options.connection.sendNotification(
            DataExplorerSummaryWidthChangedNotification.type,
            { summaryWidth },
        );
    }

    private async _mutateRowFilters(
        mutate: (currentFilters: RowFilter[]) => RowFilter[],
    ): Promise<void> {
        const { instance, logChannel } = this._options;
        await instance.runWithForegroundLoading(async () => {
            await instance.runDataMutation(async () => {
                // Read inside the serialized mutation. Reading before entering
                // the queue lets rapid add/update/remove requests all derive
                // from the same stale Ark state and overwrite one another.
                const currentFilters = instance.backendState?.row_filters ?? [];
                const result = await instance.clientInstance.setRowFilters(
                    mutate([...currentFilters]),
                );
                await instance.clientInstance.updateBackendState();
                if (result.had_errors) {
                    logChannel.warn(
                        '[DataExplorerEditor] Ark accepted row filters with evaluation errors.',
                    );
                }
            });
        });
    }

    private _sendError(message: string): void {
        void vscode.window.showErrorMessage(message);
        this._options.connection.sendNotification(DataExplorerErrorNotification.type, {
            message,
        });
    }

    private _isLayoutState(value: string): value is DataExplorerLayoutState {
        return value === 'SummaryOnLeft' || value === 'SummaryOnRight';
    }
}
