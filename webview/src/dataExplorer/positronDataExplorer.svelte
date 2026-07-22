<!--
  PositronDataExplorer.svelte - Main Data Explorer component
-->
<script lang="ts">
    import { onMount, setContext } from "svelte";
    import { getRpcConnection } from "$lib/rpc/client";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import { PositronDataExplorerInstance } from "./positronDataExplorerInstance";
    import ActionBar from "./components/actionBar/actionBar.svelte";
    import DataExplorerPanel from "./components/dataExplorerPanel/dataExplorerPanel.svelte";
    import ConvertToCodeModalDialog from "./components/convertToCodeModalDialog.svelte";
    import DataExplorerClosed, {
        type DataExplorerClosedStatus,
    } from "./components/dataExplorerClosed/positronDataExplorerClosed.svelte";
    import FileOptionsModalDialog from "./components/fileOptionsModalDialog.svelte";
    import { DATA_EXPLORER_CONTEXT_KEY } from "./positronDataExplorerContext";
    import {
        PositronDataExplorerLayout,
        type WebviewMessage,
    } from "./types";

    let connection = $state<MessageConnection | undefined>(undefined);
    let rootElement = $state<HTMLDivElement | undefined>(undefined);
    let dataExplorerFocused = $state(false);
    let showConvertToCodeModalDialog = $state(false);
    let convertToCodeSyntaxes = $state<string[]>([]);
    let selectedConvertToCodeSyntax = $state("");
    let convertToCodePreview = $state("");
    let convertToCodePreviewError = $state<string | undefined>(undefined);
    let convertToCodePreviewLoading = $state(false);
    let activeConvertToCodePreviewRequestId = $state(0);
    let showFileOptionsModalDialog = $state(false);
    let pendingHasHeaderRow = $state(true);
    let pendingAvailableSheets = $state<string[]>([]);
    let pendingSelectedSheet = $state<string | undefined>();

    const instance = new PositronDataExplorerInstance(postMessage);
    const stores = instance.stores;
    const { state: explorerState } = stores;
    const { isLoading, errorMessage } = stores;
    const tableDataDataGridInstance = instance.tableDataDataGridInstance;
    const tableSchemaDataGridInstance = instance.tableSchemaDataGridInstance;

    function postMessage(message: WebviewMessage) {
        connection?.sendNotification(`dataExplorer/${message.type}`, message);
    }

    function invalidateTableData() {
        instance.invalidateTableData();
    }

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
        if (!showConvertToCodeModalDialog || !syntax) {
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

    function queryDataGridElement(selector: string): HTMLElement | undefined {
        const element = document.querySelector(
            `.data-grid[data-grid-role="table"] ${selector}`,
        );
        return element instanceof HTMLElement ? element : undefined;
    }

    async function showColumnContextMenuAtCursor() {
        const columnIndex = tableDataDataGridInstance.cursorColumnIndex;
        const headerElement = queryDataGridElement(
            `.data-grid-column-header[data-column-index="${columnIndex}"]`,
        );
        if (!headerElement) {
            return;
        }

        await tableDataDataGridInstance.showColumnContextMenu(
            columnIndex,
            headerElement,
            centeredPoint(headerElement),
        );
    }

    async function showRowContextMenuAtCursor() {
        const rowIndex = tableDataDataGridInstance.cursorRowIndex;
        const headerElement = queryDataGridElement(
            `.data-grid-row-header[data-row-index="${rowIndex}"]`,
        );
        if (!headerElement) {
            return;
        }

        await tableDataDataGridInstance.showRowContextMenu(
            rowIndex,
            headerElement,
            centeredPoint(headerElement),
        );
    }

    async function showCellContextMenuAtCursor() {
        const columnIndex = tableDataDataGridInstance.cursorColumnIndex;
        const rowIndex = tableDataDataGridInstance.cursorRowIndex;
        const cellElement = queryDataGridElement(
            `.data-grid-row-cell[data-column-index="${columnIndex}"][data-row-index="${rowIndex}"]`,
        );
        if (!cellElement) {
            return;
        }

        await tableDataDataGridInstance.showCellContextMenu(
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

    function dismissError() {
        stores.state.update((state) => ({ ...state, error: null }));
    }

    function openConvertToCodeModalDialog(params?: {
        suggestedSyntax?: string;
        availableSyntaxes?: string[];
    }) {
        const availableSyntaxes =
            params?.availableSyntaxes?.length
                ? params.availableSyntaxes
                : ($explorerState.codeSyntaxes ?? []);

        if (availableSyntaxes.length === 0) {
            stores.state.update((state) => ({
                ...state,
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
        showFileOptionsModalDialog = false;
        showConvertToCodeModalDialog = true;
    }

    function closeConvertToCodeModalDialog() {
        showConvertToCodeModalDialog = false;
        convertToCodePreviewLoading = false;
        activeConvertToCodePreviewRequestId += 1;
    }

    function applyConvertToCode(syntax: string) {
        showConvertToCodeModalDialog = false;
        postMessage({
            type: "runConvertToCode",
            desiredSyntax: syntax,
        });
    }

    function openFileOptionsModalDialog(params?: {
        hasHeaderRow?: boolean;
        supportsFileOptions?: boolean;
        availableSheets?: string[];
        selectedSheet?: string;
    }) {
        const supportsFileOptions =
            params?.supportsFileOptions ??
            $explorerState.supportsFileOptions ??
            false;

        if (!supportsFileOptions) {
            stores.state.update((state) => ({
                ...state,
                error: "File options are not supported by this dataset.",
            }));
            return;
        }

        pendingHasHeaderRow =
            params?.hasHeaderRow ??
            $explorerState.fileHasHeaderRow ??
            true;
        pendingAvailableSheets =
            params?.availableSheets ?? $explorerState.fileAvailableSheets ?? [];
        pendingSelectedSheet =
            params?.selectedSheet ?? $explorerState.fileSelectedSheet ?? pendingAvailableSheets[0];
        showConvertToCodeModalDialog = false;
        showFileOptionsModalDialog = true;
    }

    function closeFileOptionsModalDialog() {
        showFileOptionsModalDialog = false;
    }

    function applyFileOptions(hasHeaderRow: boolean, sheetName?: string) {
        showFileOptionsModalDialog = false;
        invalidateTableData();
        postMessage({
            type: "applyFileOptions",
            hasHeaderRow,
            sheetName,
        });
    }

    setContext(DATA_EXPLORER_CONTEXT_KEY, {
        stores,
        instance,
        positronDataExplorerInstance: instance,
        tableDataDataGridInstance,
        tableSchemaDataGridInstance,
        gridInstance: tableDataDataGridInstance,
        summaryInstance: tableSchemaDataGridInstance,
        postMessage,
        invalidateTableData,
        notifyFocusChanged,
    });

    onMount(() => {
        connection = getRpcConnection();

        connection.onNotification("dataExplorer/copy", () => {
            tableDataDataGridInstance.copyCurrentSelection();
        });
        connection.onNotification("dataExplorer/copyTableData", () => {
            postMessage({ type: "copyTableData" });
        });
        connection.onNotification("dataExplorer/clearSort", () => {
            void instance.clearColumnSorting();
        });
        connection.onNotification("dataExplorer/moveToNewWindow", () => {
            postMessage({ type: "moveToNewWindow" });
        });
        connection.onNotification("dataExplorer/convertToCode", (params?: {
            suggestedSyntax?: string;
            availableSyntaxes?: string[];
        }) => {
            openConvertToCodeModalDialog(params);
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
            availableSheets?: string[];
            selectedSheet?: string;
        }) => {
            openFileOptionsModalDialog(params);
        });
        connection.onNotification(
            "dataExplorer/layoutChanged",
            (params: { layout: PositronDataExplorerLayout }) => {
                instance.handleLayoutChanged(params.layout);
            },
        );
        connection.onNotification(
            "dataExplorer/summaryCollapsedChanged",
            (params: { collapsed: boolean }) => {
                instance.handleSummaryCollapsedChanged(params.collapsed);
            },
        );
        connection.onNotification(
            "dataExplorer/initialize",
            (params: {
                identifier: string;
                displayName: string;
                languageName?: string;
                backendState: unknown;
            }) => {
                instance.handleInitialize({
                    identifier: params.identifier,
                    displayName: params.displayName,
                    languageName: params.languageName,
                    backendState: params.backendState as never,
                });
            },
        );
        connection.onNotification(
            "dataExplorer/metadata",
            (params: {
                displayName: string;
                numRows: number;
                numColumns: number;
                hasRowLabels?: boolean;
            }) => {
                instance.handleMetadata(params);
            },
        );
        connection.onNotification(
            "dataExplorer/schema",
            (params: { columns: unknown[] }) => {
                instance.handleSchema({
                    columns: params.columns as never[],
                });
            },
        );
        connection.onNotification(
            "dataExplorer/summarySchema",
            (params: {
                columns: unknown[];
                columnIndices: number[];
                requestId?: number;
            }) => {
                instance.handleSummarySchema({
                    columns: params.columns as never[],
                    columnIndices: params.columnIndices,
                    requestId: params.requestId,
                });
            },
        );
        connection.onNotification(
            "dataExplorer/columnProfiles",
            (params: {
                profiles: Array<{ columnIndex: number; profile: unknown }>;
                error?: string;
                requestId?: number;
            }) => {
                instance.handleColumnProfiles(params);
            },
        );
        connection.onNotification(
            "dataExplorer/data",
            (params: {
                columns: string[][];
                startRow: number;
                endRow: number;
                columnIndices?: number[];
                rowLabels?: string[];
                schema?: unknown[];
            }) => {
                instance.handleData({
                    ...params,
                    schema: params.schema as never[] | undefined,
                });
            },
        );
        connection.onNotification(
            "dataExplorer/backendState",
            (params: { state: unknown }) => {
                instance.handleBackendState({
                    state: params.state as never,
                });
            },
        );
        connection.onNotification(
            "dataExplorer/error",
            (params: { message: string }) => {
                instance.handleError(params);
            },
        );
        connection.onNotification(
            "dataExplorer/loading",
            (params: { isLoading: boolean }) => {
                instance.handleLoading(params);
            },
        );

        connection.sendNotification("dataExplorer/ready");

        return () => {
            notifyFocusChanged(false);
            instance.dispose();
        };
    });
</script>

<div
    class="positron-data-explorer"
    bind:this={rootElement}
    aria-busy={$isLoading}
    aria-label="Data Explorer"
    onfocusin={handleRootFocusIn}
    onfocusout={handleRootFocusOut}
>
    <ActionBar />
    {#if $isLoading && !closedReason}
        <div class="data-explorer-progress" aria-hidden="true"><span></span></div>
        <div class="screen-reader-status" role="status" aria-live="polite">
            Loading Data Explorer
        </div>
    {/if}
    {#if $errorMessage && !closedReason}
        <div class="data-explorer-error" role="alert">
            <span class="codicon codicon-error" aria-hidden="true"></span>
            <span>{$errorMessage}</span>
            <button type="button" aria-label="Dismiss error" title="Dismiss" onclick={dismissError}>
                <span class="codicon codicon-close" aria-hidden="true"></span>
            </button>
        </div>
    {/if}
    <DataExplorerPanel />
    {#if closedReason}
        <DataExplorerClosed
            closedReason={closedReason}
            errorMessage={closedErrorMessage}
            onClose={handleClose}
        />
    {/if}
    {#if showConvertToCodeModalDialog}
        <ConvertToCodeModalDialog
            syntaxes={convertToCodeSyntaxes}
            selectedSyntax={selectedConvertToCodeSyntax}
            previewCode={convertToCodePreview}
            previewError={convertToCodePreviewError}
            previewLoading={convertToCodePreviewLoading}
            onApply={applyConvertToCode}
            onCancel={closeConvertToCodeModalDialog}
            onSyntaxChange={(syntax) => {
                selectedConvertToCodeSyntax = syntax;
                requestConvertToCodePreview(syntax);
            }}
        />
    {/if}
    {#if showFileOptionsModalDialog}
        <FileOptionsModalDialog
            hasHeaderRow={pendingHasHeaderRow}
            availableSheets={pendingAvailableSheets}
            selectedSheet={pendingSelectedSheet}
            onApply={applyFileOptions}
            onCancel={closeFileOptionsModalDialog}
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
        display: grid;
        grid-template-rows: [action-bar] min-content [data-explorer-panel] 1fr [end];
        grid-template-columns: [content] minmax(0, 1fr) [end-columns];
        color: var(
            --vscode-positronDataExplorer-foreground,
            var(--vscode-editor-foreground)
        );
        background-color: var(
            --vscode-positronDataExplorer-background,
            var(--vscode-editor-background)
        );
    }

    .data-explorer-progress {
        position: absolute;
        z-index: 25;
        top: var(--vscode-positronActionBar-height, 28px);
        left: 0;
        width: 100%;
        height: 2px;
        overflow: hidden;
        pointer-events: none;
        background: color-mix(in srgb, var(--vscode-progressBar-background) 24%, transparent);
    }

    .data-explorer-progress span {
        display: block;
        width: 35%;
        height: 100%;
        background: var(--vscode-progressBar-background);
        animation: data-explorer-progress 1.2s ease-in-out infinite;
    }

    .data-explorer-error {
        position: absolute;
        z-index: 26;
        top: calc(var(--vscode-positronActionBar-height, 28px) + 6px);
        right: 8px;
        display: flex;
        align-items: center;
        gap: 7px;
        max-width: min(480px, calc(100% - 16px));
        padding: 6px 7px 6px 9px;
        border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
        border-radius: 4px;
        box-shadow: 0 2px 8px var(--vscode-widget-shadow);
        color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
        background: var(--vscode-inputValidation-errorBackground, var(--vscode-editorWidget-background));
    }

    .data-explorer-error > span:nth-child(2) {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .data-explorer-error button {
        display: flex;
        flex-shrink: 0;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 0;
        border-radius: 3px;
        align-items: center;
        justify-content: center;
        color: inherit;
        background: transparent;
        cursor: pointer;
    }

    .data-explorer-error button:hover {
        background: var(--vscode-toolbar-hoverBackground);
    }

    .data-explorer-error button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
    }

    .screen-reader-status {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }

    @keyframes data-explorer-progress {
        from { transform: translateX(-110%); }
        to { transform: translateX(320%); }
    }

    @media (prefers-reduced-motion: reduce) {
        .data-explorer-progress span {
            width: 100%;
            animation: none;
        }
    }
</style>
