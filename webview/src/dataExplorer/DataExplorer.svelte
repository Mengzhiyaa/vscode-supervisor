<!--
  DataExplorer.svelte - Main Data Explorer component (Svelte 5 runes mode)
  Port from Positron's positronDataExplorer.tsx
  Uses JSON-RPC communication like console/plots
-->
<script lang="ts">
    import { onMount, setContext } from "svelte";
    import type { Readable } from "svelte/store";
    import { getRpcConnection } from "$lib/rpc/client";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import { DataExplorerInstance } from "./dataExplorerInstance";
    import { TableSummaryDataGridInstance } from "./tableSummaryDataGridInstance";
    import { createDataExplorerStores } from "./stores";
    import DataExplorerPanel from "./components/DataExplorerPanel.svelte";
    import ConvertToCodeDialog from "./components/ConvertToCodeDialog.svelte";
    import DataExplorerClosed, {
        type DataExplorerClosedStatus,
    } from "./components/dataExplorerClosed/DataExplorerClosed.svelte";
    import FileOptionsDialog from "./components/FileOptionsDialog.svelte";
    import type { BackendState, SchemaColumn } from "../dataGrid/types";
    import {
        WidthCalculator,
        createFontString,
    } from "../dataGrid/classes/widthCalculator";
    import {
        PositronDataExplorerLayout,
        type WebviewMessage,
    } from "./types";
    import { localize } from "./nls";

    type AugmentedBackendState = BackendState & {
        __ark_file_options?: {
            supportsFileOptions?: boolean;
            fileHasHeaderRow?: boolean;
        };
        __ark_window_state?: {
            inNewWindow?: boolean;
        };
    };

    // JSON-RPC connection
    let connection = $state<MessageConnection | undefined>();

    // Create stores (these are simple writables, safe outside onMount)
    const stores = createDataExplorerStores();
    const { state: explorerState } = stores;

    // Grid instance will be created in onMount to avoid effect_orphan
    let gridInstance = $state<DataExplorerInstance | undefined>();
    let summaryInstance = $state<TableSummaryDataGridInstance | undefined>();

    // Pending data requests (keyed by row range + column signature)
    const pendingRequests = new Map<string, boolean>();
    const BATCH_SIZE = 50;
    let showConvertToCodeDialog = $state(false);
    let convertToCodeSyntaxes = $state<string[]>([]);
    let selectedConvertToCodeSyntax = $state("");
    let convertToCodePreview = $state("");
    let convertToCodePreviewError = $state<string | undefined>(undefined);
    let convertToCodePreviewLoading = $state(false);
    let activeConvertToCodePreviewRequestId = $state(0);
    let showFileOptionsDialog = $state(false);
    let pendingHasHeaderRow = $state(true);

    function mergeSchemaColumns(
        existing: SchemaColumn[],
        incoming: SchemaColumn[],
    ): SchemaColumn[] {
        const merged = new Map(
            existing.map((column) => [column.column_index, column]),
        );
        for (const column of incoming) {
            merged.set(column.column_index, column);
        }
        return Array.from(merged.values()).sort(
            (left, right) => left.column_index - right.column_index,
        );
    }

    function normalizeSortKeys(
        sortKeys: Iterable<{
            columnIndex: number;
            ascending: boolean;
            sortIndex?: number;
        }>,
    ) {
        return Array.from(sortKeys)
            .sort((left, right) => {
                const leftIndex = left.sortIndex ?? 0;
                const rightIndex = right.sortIndex ?? 0;
                return leftIndex - rightIndex;
            })
            .map((sortKey) => ({
                columnIndex: sortKey.columnIndex,
                ascending: sortKey.ascending,
            }));
    }

    function sortKeysSignature(
        sortKeys: Array<{ columnIndex: number; ascending: boolean }>,
    ) {
        return sortKeys
            .map((sortKey) =>
                `${sortKey.columnIndex}:${sortKey.ascending ? "asc" : "desc"}`,
            )
            .join("|");
    }

    function getRequestKey(startRow: number, columnIndices?: number[]) {
        const colKey = columnIndices?.length
            ? columnIndices.join(",")
            : "all";
        return `${startRow}:${colKey}`;
    }

    // Helper to post messages
    function postMessage(msg: WebviewMessage) {
        if (connection) {
            connection.sendNotification(`dataExplorer/${msg.type}`, msg);
        }
    }

    function invalidateTableData() {
        gridInstance?.clearCache();
        pendingRequests.clear();
    }

    let rootElement = $state<HTMLDivElement | undefined>(undefined);
    let dataExplorerFocused = $state(false);

    function notifyFocusChanged(focused: boolean) {
        if (dataExplorerFocused === focused) {
            return;
        }

        dataExplorerFocused = focused;
        postMessage({
            type: "focusChanged",
            focused,
        });
    }

    function defer(callback: () => void) {
        if (typeof queueMicrotask === "function") {
            queueMicrotask(callback);
            return;
        }

        setTimeout(callback, 0);
    }

    function handleRootFocusIn() {
        notifyFocusChanged(true);
    }

    function handleRootFocusOut(event: FocusEvent) {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && rootElement?.contains(nextTarget)) {
            return;
        }

        defer(() => {
            const activeElement = document.activeElement;
            if (
                activeElement instanceof Node &&
                rootElement?.contains(activeElement)
            ) {
                return;
            }

            notifyFocusChanged(false);
        });
    }

    function requestConvertToCodePreview(syntax: string) {
        if (!showConvertToCodeDialog || !syntax) {
            return;
        }

        activeConvertToCodePreviewRequestId += 1;
        convertToCodePreviewLoading = true;
        convertToCodePreviewError = undefined;
        postMessage({
            type: "requestConvertToCodePreview",
            desiredSyntax: syntax,
            requestId: activeConvertToCodePreviewRequestId,
        });
    }

    function centeredPoint(element: HTMLElement) {
        const rect = element.getBoundingClientRect();
        return {
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
        };
    }

    function queryDataGridElement(
        selector: string,
    ): HTMLElement | undefined {
        const element = document.querySelector(
            `.data-grid[data-grid-role="table"] ${selector}`,
        );
        return element instanceof HTMLElement ? element : undefined;
    }

    async function showColumnContextMenuAtCursor() {
        if (!gridInstance) {
            return;
        }

        const columnIndex = gridInstance.cursorColumnIndex;
        const headerElement = queryDataGridElement(
            `.data-grid-column-header[data-column-index="${columnIndex}"]`,
        );
        if (!headerElement) {
            return;
        }

        await gridInstance.showColumnContextMenu(
            columnIndex,
            headerElement,
            centeredPoint(headerElement),
        );
    }

    async function showRowContextMenuAtCursor() {
        if (!gridInstance) {
            return;
        }

        const rowIndex = gridInstance.cursorRowIndex;
        const headerElement = queryDataGridElement(
            `.data-grid-row-header[data-row-index="${rowIndex}"]`,
        );
        if (!headerElement) {
            return;
        }

        await gridInstance.showRowContextMenu(
            rowIndex,
            headerElement,
            centeredPoint(headerElement),
        );
    }

    async function showCellContextMenuAtCursor() {
        if (!gridInstance) {
            return;
        }

        const columnIndex = gridInstance.cursorColumnIndex;
        const rowIndex = gridInstance.cursorRowIndex;
        const cellElement = queryDataGridElement(
            `.data-grid-row-cell[data-column-index="${columnIndex}"][data-row-index="${rowIndex}"]`,
        );
        if (!cellElement) {
            return;
        }

        await gridInstance.showCellContextMenu(
            columnIndex,
            rowIndex,
            cellElement,
            centeredPoint(cellElement),
        );
    }

    type ClosedReason = DataExplorerClosedStatus | null;
    const closedReason = $derived.by(() => {
        const backendState = $explorerState.backendState;
        if (backendState?.connected === false) {
            return backendState.error_message ? "error" : "unavailable";
        }
        return null;
    }) as ClosedReason;

    const closedErrorMessage = $derived.by(() => {
        return $explorerState.backendState?.error_message ?? "";
    });

    function handleClose() {
        postMessage({ type: "close" });
    }

    function openConvertToCodeDialog(params?: {
        suggestedSyntax?: string;
        availableSyntaxes?: string[];
    }) {
        const availableSyntaxes =
            params?.availableSyntaxes?.length
                ? params.availableSyntaxes
                : ($explorerState.codeSyntaxes ?? []);

        if (availableSyntaxes.length === 0) {
            stores.state.update((s) => ({
                ...s,
                error: "No code syntax is available for this backend.",
            }));
            return;
        }

        convertToCodeSyntaxes = availableSyntaxes;
        selectedConvertToCodeSyntax =
            params?.suggestedSyntax &&
            availableSyntaxes.includes(params.suggestedSyntax)
                ? params.suggestedSyntax
                : availableSyntaxes[0] ?? "";
        convertToCodePreview = "";
        convertToCodePreviewError = undefined;
        convertToCodePreviewLoading = false;
        activeConvertToCodePreviewRequestId += 1;
        showFileOptionsDialog = false;
        showConvertToCodeDialog = true;
    }

    function closeConvertToCodeDialog() {
        showConvertToCodeDialog = false;
        convertToCodePreviewLoading = false;
        activeConvertToCodePreviewRequestId += 1;
    }

    function applyConvertToCode(syntax: string) {
        showConvertToCodeDialog = false;
        postMessage({
            type: "runConvertToCode",
            desiredSyntax: syntax,
        });
    }

    function openFileOptionsDialog(params?: {
        hasHeaderRow?: boolean;
        supportsFileOptions?: boolean;
    }) {
        const supportsFileOptions =
            params?.supportsFileOptions ??
            $explorerState.supportsFileOptions ??
            false;

        if (!supportsFileOptions) {
            stores.state.update((s) => ({
                ...s,
                error: "File options are not supported by this dataset.",
            }));
            return;
        }

        pendingHasHeaderRow =
            params?.hasHeaderRow ??
            $explorerState.fileHasHeaderRow ??
            true;
        showConvertToCodeDialog = false;
        showFileOptionsDialog = true;
    }

    function closeFileOptionsDialog() {
        showFileOptionsDialog = false;
    }

    function applyFileOptions(hasHeaderRow: boolean) {
        showFileOptionsDialog = false;
        invalidateTableData();
        postMessage({
            type: "applyFileOptions",
            hasHeaderRow,
        });
    }

    // Set context for child components
    setContext("dataExplorer", {
        stores,
        get gridInstance() {
            return gridInstance;
        },
        get summaryInstance() {
            return summaryInstance;
        },
        postMessage,
        invalidateTableData,
        notifyFocusChanged,
    });

    onMount(() => {
        // Create grid instance inside component context
        gridInstance = new DataExplorerInstance(stores, postMessage);
        summaryInstance = new TableSummaryDataGridInstance(
            stores,
            postMessage,
            (gridInstance as unknown as { pinnedColumns?: unknown })
                ?.pinnedColumns as Readable<number[]> | undefined,
        );

        // Initialize width calculator for column auto-sizing
        try {
            const rootStyle = getComputedStyle(document.documentElement);
            const fontFamily =
                rootStyle
                    .getPropertyValue("--vscode-editor-font-family")
                    .trim() || "monospace";
            const fontSizeValue =
                rootStyle
                    .getPropertyValue("--vscode-editor-font-size")
                    .trim() || "13px";
            const baseSize = Number.parseFloat(fontSizeValue) || 13;
            const columnNameFont = createFontString(
                600,
                `${baseSize}px`,
                fontFamily,
            );
            const typeNameFont = createFontString(
                400,
                `${Math.max(10, baseSize - 2)}px`,
                fontFamily,
            );
            const sortIndexFont = createFontString(
                600,
                `${Math.max(9, baseSize - 3)}px`,
                fontFamily,
            );
            const calculator = new WidthCalculator({
                columnNameFont,
                typeNameFont,
                sortIndexFont,
                horizontalCellPadding:
                    gridInstance.horizontalCellPadding ?? 8,
                sortingButtonWidth: 20,
                sortIndicatorWidth: 20,
            });
            gridInstance.setWidthCalculator(calculator);
        } catch {
            // Ignore width calculator failures; fall back to default sizing.
        }

        connection = getRpcConnection();
        let lastSortSignature = "";

        connection.onNotification("dataExplorer/copy", () => {
            gridInstance?.copyCurrentSelection();
        });
        connection.onNotification("dataExplorer/copyTableData", () => {
            postMessage({ type: "copyTableData" });
        });
        connection.onNotification("dataExplorer/clearSort", () => {
            postMessage({ type: "clearSort" });
        });
        connection.onNotification("dataExplorer/moveToNewWindow", () => {
            postMessage({ type: "moveToNewWindow" });
        });
        connection.onNotification("dataExplorer/convertToCode", (params?: {
            suggestedSyntax?: string;
            availableSyntaxes?: string[];
        }) => {
            openConvertToCodeDialog(params);
        });
        connection.onNotification("dataExplorer/openAsPlaintext", () => {
            postMessage({ type: "openAsPlaintext" });
        });
        connection.onNotification("dataExplorer/showColumnContextMenu", () => {
            void showColumnContextMenuAtCursor();
        });
        connection.onNotification("dataExplorer/showRowContextMenu", () => {
            void showRowContextMenuAtCursor();
        });
        connection.onNotification("dataExplorer/showCellContextMenu", () => {
            void showCellContextMenuAtCursor();
        });
        connection.onNotification(
            "dataExplorer/convertToCodePreview",
            (params: {
                desiredSyntax: string;
                requestId: number;
                code: string;
                error?: string;
            }) => {
                if (params.requestId !== activeConvertToCodePreviewRequestId) {
                    return;
                }

                if (params.desiredSyntax !== selectedConvertToCodeSyntax) {
                    return;
                }

                convertToCodePreviewLoading = false;
                convertToCodePreview = params.code;
                convertToCodePreviewError = params.error;
            },
        );
        connection.onNotification("dataExplorer/toggleFileOptions", (params?: {
            hasHeaderRow?: boolean;
            supportsFileOptions?: boolean;
        }) => {
            openFileOptionsDialog(params);
        });
        connection.onNotification(
            "dataExplorer/layoutChanged",
            (params: { layout: PositronDataExplorerLayout }) => {
                stores.state.update((s) => ({
                    ...s,
                    layout: params.layout,
                }));
            },
        );
        connection.onNotification(
            "dataExplorer/summaryCollapsedChanged",
            (params: { collapsed: boolean }) => {
                stores.state.update((s) => ({
                    ...s,
                    summaryCollapsed: params.collapsed,
                }));
            },
        );

        // Listen for initialize notification
        connection.onNotification(
            "dataExplorer/initialize",
            (params: {
                identifier: string;
                displayName: string;
                backendState: AugmentedBackendState | null;
            }) => {
                const previousBackendState = $explorerState.backendState;
                const previousFileHasHeaderRow =
                    $explorerState.fileHasHeaderRow;
                const fileOptions = params.backendState?.__ark_file_options;
                const windowState = params.backendState?.__ark_window_state;
                const schemaInvalidated =
                    previousBackendState?.table_shape.num_columns !==
                        params.backendState?.table_shape.num_columns ||
                    (fileOptions?.fileHasHeaderRow !== undefined &&
                        fileOptions.fileHasHeaderRow !==
                            previousFileHasHeaderRow);
                const convertToCodeSupport =
                    params.backendState?.supported_features?.convert_to_code
                        ?.support_status === "supported";
                const codeSyntaxes =
                    params.backendState?.supported_features?.convert_to_code
                        ?.code_syntaxes?.map((entry) => entry.code_syntax_name) ??
                    [];

                stores.state.update((s) => ({
                    ...s,
                    identifier: params.identifier,
                    displayName: params.displayName,
                    backendState: params.backendState,
                    schema:
                        schemaInvalidated
                            ? []
                            : s.schema,
                    error: params.backendState?.error_message ?? null,
                    supportsFileOptions: fileOptions?.supportsFileOptions ??
                        s.supportsFileOptions,
                    fileHasHeaderRow: fileOptions?.fileHasHeaderRow ??
                        s.fileHasHeaderRow,
                    supportsConvertToCode: convertToCodeSupport,
                    codeSyntaxes,
                    inNewWindow: windowState?.inNewWindow ?? false,
                }));
                if (params.backendState && gridInstance) {
                    const backendSortKeys = normalizeSortKeys(
                        params.backendState.sort_keys.map((sortKey, sortIndex) => ({
                            sortIndex,
                            columnIndex: sortKey.column_index,
                            ascending: sortKey.ascending,
                        })),
                    );
                    lastSortSignature = sortKeysSignature(backendSortKeys);
                    gridInstance.setDimensions(
                        params.backendState.table_shape.num_columns,
                        params.backendState.table_shape.num_rows,
                    );
                    if (schemaInvalidated) {
                        gridInstance.clearSchema();
                    }
                    gridInstance.applyBackendSortKeys(backendSortKeys);
                }
                summaryInstance?.handleBackendStateChanged(
                    previousBackendState,
                    params.backendState,
                );
                if (
                    previousBackendState &&
                    fileOptions?.fileHasHeaderRow !== undefined &&
                    fileOptions.fileHasHeaderRow !== previousFileHasHeaderRow
                ) {
                    summaryInstance?.handleSchemaUpdated();
                }
            },
        );

        // Listen for metadata updates
        connection.onNotification(
            "dataExplorer/metadata",
            (params: {
                displayName: string;
                numRows: number;
                numColumns: number;
            }) => {
                stores.state.update((s) => ({
                    ...s,
                    displayName: params.displayName,
                    schema:
                        s.backendState?.table_shape.num_columns !==
                        params.numColumns
                            ? []
                            : s.schema,
                    backendState: s.backendState
                        ? {
                              ...s.backendState,
                              display_name: params.displayName,
                              table_shape: {
                                  num_rows: params.numRows,
                                  num_columns: params.numColumns,
                              },
                          }
                        : null,
                }));
                if (gridInstance) {
                    gridInstance.setDimensions(
                        params.numColumns,
                        params.numRows,
                    );
                }
            },
        );

        // Listen for schema updates
        connection.onNotification(
            "dataExplorer/schema",
            (params: { columns: SchemaColumn[] }) => {
                if (gridInstance) {
                    gridInstance.setSchema(params.columns);
                }
                stores.state.update((s) => ({
                    ...s,
                    schema: mergeSchemaColumns(s.schema ?? [], params.columns),
                }));
            },
        );

        // Listen for summary schema updates
        connection.onNotification(
            "dataExplorer/summarySchema",
            (params: {
                columns: SchemaColumn[];
                columnIndices: number[];
                requestId?: number;
            }) => {
                summaryInstance?.handleSummarySchema(params);
            },
        );

        // Listen for column profile updates
        connection.onNotification(
            "dataExplorer/columnProfiles",
            (params: {
                profiles: Array<{ columnIndex: number; profile: unknown }>;
                error?: string;
                requestId?: number;
            }) => {
                summaryInstance?.handleColumnProfiles(
                    params.profiles,
                    params.error,
                    params.requestId,
                );
                if (params.error) {
                    stores.state.update((s) => ({
                        ...s,
                        error: params.error ?? s.error,
                    }));
                }
            },
        );

        // Listen for data updates
        connection.onNotification(
            "dataExplorer/data",
            (params: {
                columns: string[][];
                startRow: number;
                endRow: number;
                columnIndices?: number[];
                rowLabels?: string[];
                schema?: SchemaColumn[];
            }) => {
                if (!gridInstance) return;

                gridInstance.applyDataUpdate({
                    startRow: params.startRow,
                    columns: params.columns,
                    columnIndices: params.columnIndices,
                    rowLabels: params.rowLabels,
                });

                // Clear pending request flag
                const requestKey = getRequestKey(
                    params.startRow,
                    params.columnIndices,
                );
                pendingRequests.delete(requestKey);
            },
        );

        // Listen for backend state updates
        connection.onNotification(
            "dataExplorer/backendState",
            (params: { state: AugmentedBackendState }) => {
                const previousBackendState = $explorerState.backendState;
                const windowState = params.state.__ark_window_state;
                const convertToCodeSupport =
                    params.state.supported_features?.convert_to_code
                        ?.support_status === "supported";
                const codeSyntaxes =
                    params.state.supported_features?.convert_to_code
                        ?.code_syntaxes?.map((entry) => entry.code_syntax_name) ??
                    [];
                stores.state.update((s) => ({
                    ...s,
                    backendState: params.state,
                    schema:
                        previousBackendState?.table_shape.num_columns !==
                        params.state.table_shape.num_columns
                            ? []
                            : s.schema,
                    error: params.state.error_message ?? null,
                    supportsConvertToCode: convertToCodeSupport,
                    codeSyntaxes,
                    inNewWindow: windowState?.inNewWindow ?? false,
                }));
                if (gridInstance) {
                    const backendSortKeys = normalizeSortKeys(
                        params.state.sort_keys.map((sortKey, sortIndex) => ({
                            sortIndex,
                            columnIndex: sortKey.column_index,
                            ascending: sortKey.ascending,
                        })),
                    );
                    lastSortSignature = sortKeysSignature(backendSortKeys);
                    gridInstance.setDimensions(
                        params.state.table_shape.num_columns,
                        params.state.table_shape.num_rows,
                    );
                    gridInstance.applyBackendSortKeys(backendSortKeys);
                }
                summaryInstance?.handleBackendStateChanged(
                    previousBackendState,
                    params.state,
                );
            },
        );

        // Listen for error notifications
        connection.onNotification(
            "dataExplorer/error",
            (params: { message: string }) => {
                stores.state.update((s) => ({
                    ...s,
                    error: params.message,
                    isLoading: false,
                }));
            },
        );

        // Listen for loading state
        connection.onNotification(
            "dataExplorer/loading",
            (params: { isLoading: boolean }) => {
                stores.state.update((s) => ({
                    ...s,
                    isLoading: params.isLoading,
                }));
            },
        );

        // Subscribe to viewport changes to request data (debounced)
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        const unsubscribeViewport = gridInstance.viewport.subscribe(() => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                requestVisibleData();
            }, 50);
        });

        // Subscribe to sort key changes to send sort requests
        const unsubscribeSortKeys = gridInstance.sortKeys.subscribe(
            (sortKeys) => {
                const sortKeysToSend = normalizeSortKeys(sortKeys.values());
                const nextSignature = sortKeysSignature(sortKeysToSend);

                if (nextSignature === lastSortSignature) {
                    return;
                }

                lastSortSignature = nextSignature;

                invalidateTableData();

                if (sortKeysToSend.length === 0) {
                    connection!.sendNotification("dataExplorer/clearSort", {});
                    return;
                }

                connection!.sendNotification("dataExplorer/sort", {
                    sortKeys: sortKeysToSend,
                });
            },
        );

        // Signal ready
        connection.sendNotification("dataExplorer/ready");

        return () => {
            notifyFocusChanged(false);
            unsubscribeViewport();
            unsubscribeSortKeys();
            summaryInstance?.dispose();
            summaryInstance = undefined;
        };
    });

    // Request data for visible rows
    function requestVisibleData() {
        const inst = gridInstance;
        if (!connection || !inst) return;

        let firstRowIndex = 0;
        const unsubscribe = inst.viewport.subscribe((v) => {
            firstRowIndex = v.firstRowIndex;
        });
        unsubscribe();

        const startRow = Math.floor(firstRowIndex / BATCH_SIZE) * BATCH_SIZE;
        const endRow = startRow + BATCH_SIZE;
        let columnIndices: number[] = [];
        const unsubscribeColumns = inst.visibleColumns.subscribe(
            (cols) => {
                columnIndices = cols.map((c) => c.columnIndex);
            },
        );
        unsubscribeColumns();

        const requestKey = getRequestKey(startRow, columnIndices);

        // Check if we already have this data pending
        if (pendingRequests.has(requestKey)) {
            return; // Already pending
        }

        // Check if we already have cached data for this range
        const hasCachedData = columnIndices.length
            ? columnIndices.every(
                  (columnIndex) =>
                      inst.getCellData(startRow, columnIndex) !==
                      undefined,
              )
            : inst.getCellData(startRow, 0) !== undefined;
        if (hasCachedData) {
            return; // Already have data
        }

        pendingRequests.set(requestKey, true);
        connection.sendNotification("dataExplorer/requestData", {
            startRow,
            endRow,
            columns: columnIndices,
        });
    }
</script>

<div
    class="positron-data-explorer"
    bind:this={rootElement}
    onfocusin={handleRootFocusIn}
    onfocusout={handleRootFocusOut}
>
    {#if gridInstance}
        <DataExplorerPanel />
    {:else}
        <div class="loading">
            {localize("positron.loading", "Loading...")}
        </div>
    {/if}
    {#if closedReason}
        <DataExplorerClosed
            closedReason={closedReason}
            errorMessage={closedErrorMessage}
            onClose={handleClose}
        />
    {/if}
    {#if showConvertToCodeDialog}
        <ConvertToCodeDialog
            syntaxes={convertToCodeSyntaxes}
            selectedSyntax={selectedConvertToCodeSyntax}
            previewCode={convertToCodePreview}
            previewError={convertToCodePreviewError}
            previewLoading={convertToCodePreviewLoading}
            onApply={applyConvertToCode}
            onCancel={closeConvertToCodeDialog}
            onSyntaxChange={(syntax) => {
                selectedConvertToCodeSyntax = syntax;
                requestConvertToCodePreview(syntax);
            }}
        />
    {/if}
    {#if showFileOptionsDialog}
        <FileOptionsDialog
            hasHeaderRow={pendingHasHeaderRow}
            onApply={applyFileOptions}
            onCancel={closeFileOptionsDialog}
        />
    {/if}
</div>

<style>
    .positron-data-explorer {
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        position: relative;
        display: flex;
        flex-direction: column;
        color: var(--vscode-positronDataExplorer-foreground, var(--vscode-editor-foreground));
        background-color: var(--vscode-positronDataExplorer-background, var(--vscode-editor-background));
        font-family: var(--positron-data-explorer-font-family);
        font-size: var(--positron-data-explorer-font-size);
        font-weight: var(--positron-data-explorer-font-weight);
    }

    .loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        opacity: 0.6;
    }
</style>
