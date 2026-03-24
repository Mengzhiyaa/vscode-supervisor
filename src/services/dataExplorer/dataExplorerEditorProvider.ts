/*---------------------------------------------------------------------------------------------
 *  Data Explorer Editor Provider
 *  Opens Data Explorer in the editor area as a WebviewPanel (like a tab)
 *  Uses JSON-RPC MessageConnection for webview communication (same pattern as console/plots)
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { createMessageConnection, MessageConnection } from 'vscode-jsonrpc';
import { ContextKeys } from '../../coreCommandIds';
import { WebviewMessageReader, WebviewMessageWriter } from '../../rpc/webview/transport';
import { IDataExplorerService, IDataExplorerInstance } from './dataExplorerService';
import { getDataExplorerBackingUri, isPlaintextDataExplorerIdentifier } from './dataExplorerUri';
import type {
    RowFilter,
    ColumnFilter,
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
    DataExplorerCopyNotification,
    DataExplorerRequestDataNotification,
    DataExplorerRequestSchemaNotification,
    DataExplorerSearchSchemaNotification,
    DataExplorerRequestColumnProfilesNotification,
    DataExplorerLayoutChangedNotification,
    DataExplorerSummaryCollapsedChangedNotification,
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
    DataExplorerConvertToCodeNotification,
    DataExplorerRunConvertToCodeNotification,
    DataExplorerOpenAsPlaintextNotification,
    DataExplorerToggleFileOptionsNotification,
    DataExplorerApplyFileOptionsNotification,
    DataExplorerRequestConvertToCodePreviewNotification,
    DataExplorerSetLayoutNotification,
    DataExplorerSetSummaryCollapsedNotification,
    DataExplorerFocusChangedNotification,
    DataExplorerInitializeNotification,
    DataExplorerShowColumnContextMenuNotification,
    DataExplorerShowRowContextMenuNotification,
    DataExplorerShowCellContextMenuNotification,
    DataExplorerConvertToCodePreviewNotification,
    DataExplorerMetadataNotification,
    DataExplorerSchemaNotification,
    DataExplorerSummarySchemaNotification,
    DataExplorerColumnProfilesNotification,
    DataExplorerDataNotification,
    DataExplorerBackendStateNotification,
    DataExplorerLoadingNotification,
    DataExplorerErrorNotification
} from '../../rpc/webview/dataExplorer';

const MAX_CLIPBOARD_CELLS = 10_000;
const DATA_EXPLORER_EDITOR_CONTEXT = ContextKeys.dataExplorerEditorActive;
const DATA_EXPLORER_LAYOUT_CONTEXT = ContextKeys.dataExplorerLayout;
const DATA_EXPLORER_COLUMN_SORTING_CONTEXT = ContextKeys.dataExplorerIsColumnSorting;
const DATA_EXPLORER_CONVERT_TO_CODE_ENABLED_CONTEXT = ContextKeys.dataExplorerIsConvertToCodeEnabled;
const DATA_EXPLORER_CODE_SYNTAXES_AVAILABLE_CONTEXT = ContextKeys.dataExplorerCodeSyntaxesAvailable;
const DATA_EXPLORER_ROW_FILTERING_CONTEXT = ContextKeys.dataExplorerIsRowFiltering;
const DATA_EXPLORER_IS_PLAINTEXT_CONTEXT = ContextKeys.dataExplorerIsPlaintext;
const DATA_EXPLORER_FILE_HAS_HEADER_ROW_CONTEXT = ContextKeys.dataExplorerFileHasHeaderRow;
const DATA_EXPLORER_SUMMARY_COLLAPSED_CONTEXT = ContextKeys.dataExplorerSummaryCollapsed;
const DATA_EXPLORER_FOCUSED_CONTEXT = ContextKeys.dataExplorerFocused;
const DATA_EXPLORER_IN_NEW_WINDOW_CONTEXT = ContextKeys.dataExplorerInNewWindow;
const SMALL_HISTOGRAM_NUM_BINS = 80;
const LARGE_HISTOGRAM_NUM_BINS = 100;
const SMALL_FREQUENCY_TABLE_LIMIT = 8;
const LARGE_FREQUENCY_TABLE_LIMIT = 16;
const BOOLEAN_FREQUENCY_TABLE_LIMIT = 2;

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

type DataExplorerLayoutState = 'SummaryOnLeft' | 'SummaryOnRight';
interface DataExplorerUiState {
    layout: DataExplorerLayoutState;
    summaryCollapsed: boolean;
}

export const enum DataExplorerCommandId {
    Copy = 'supervisor.dataExplorer._copyInternal',
    CopyTableData = 'supervisor.dataExplorer._copyTableDataInternal',
    CollapseSummary = 'supervisor.dataExplorer._collapseSummaryInternal',
    ExpandSummary = 'supervisor.dataExplorer._expandSummaryInternal',
    SummaryOnLeft = 'supervisor.dataExplorer._summaryOnLeftInternal',
    SummaryOnRight = 'supervisor.dataExplorer._summaryOnRightInternal',
    ClearColumnSorting = 'supervisor.dataExplorer._clearColumnSortingInternal',
    ConvertToCode = 'supervisor.dataExplorer._convertToCodeInternal',
    OpenAsPlaintext = 'supervisor.dataExplorer._openAsPlaintextInternal',
    ToggleFileOptions = 'supervisor.dataExplorer._toggleFileOptionsInternal',
    MoveToNewWindow = 'supervisor.dataExplorer._moveToNewWindowInternal',
    ShowColumnContextMenu = 'supervisor.dataExplorer._showColumnContextMenuInternal',
    ShowRowContextMenu = 'supervisor.dataExplorer._showRowContextMenuInternal',
    ShowCellContextMenu = 'supervisor.dataExplorer._showCellContextMenuInternal',
}

/**
 * Manages Data Explorer panels in the editor area
 */
export class DataExplorerEditorProvider implements vscode.Disposable {
    public static readonly viewType = 'positron.dataExplorerEditor';

    private readonly _panels = new Map<string, vscode.WebviewPanel>();
    private readonly _connections = new Map<string, MessageConnection>();
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _lastRequests = new Map<string, { startRow: number; endRow?: number; columns?: number[] }>();
    private readonly _focusedState = new Map<string, boolean>();
    private readonly _newWindowState = new Map<string, vscode.ViewColumn | undefined>();
    private readonly _foregroundLoadingCounts = new Map<string, number>();
    private readonly _uiState = new Map<string, DataExplorerUiState>();
    private readonly _skipInstanceCloseOnNextPanelDispose = new Set<string>();
    /** Instance IDs being opened by an external panel provider (e.g. Custom Editor). */
    private readonly _externalPanelInstances = new Set<string>();
    private _isDisposing = false;


    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _dataExplorerService: IDataExplorerService,
        private readonly _logChannel: vscode.LogOutputChannel,
        private readonly _getAdditionalLocalResourceRoots: () => readonly vscode.Uri[] = () => [],
        private readonly _getLanguageMonacoSupportModuleUris: (webview: vscode.Webview) => Readonly<Record<string, string>> = () => ({}),
        private readonly _getLanguageTextMateGrammarDefinitions: (
            webview: vscode.Webview,
        ) => Readonly<Record<string, { scopeName: string; grammarUrl: string }>> = () => ({}),
    ) {
        this._resetContexts();

        // Listen for new instances and open them in editor
        this._disposables.push(
            this._dataExplorerService.onDidCreateInstance(instance => {
                // Skip if the custom editor provider is handling this instance
                if (this._externalPanelInstances.has(instance.identifier)) {
                    return;
                }
                if (!instance.inlineOnly) {
                    this.openInstance(instance);
                }
            })
        );

        // Listen for instance close
        this._disposables.push(
            this._dataExplorerService.onDidCloseInstance(instanceId => {
                this._lastRequests.delete(instanceId);
                this._focusedState.delete(instanceId);
                this._newWindowState.delete(instanceId);
                this._foregroundLoadingCounts.delete(instanceId);
                this._uiState.delete(instanceId);
                const panel = this._panels.get(instanceId);
                if (panel) {
                    panel.dispose();
                    this._panels.delete(instanceId);
                }
            })
        );

        this._registerCommands();
    }

    private _registerCommands(): void {
        this._disposables.push(
            vscode.commands.registerCommand(DataExplorerCommandId.Copy, async () => {
                await this._sendToActiveWebview(DataExplorerCopyNotification.type.method);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(DataExplorerCommandId.CopyTableData, async () => {
                await this._sendToActiveWebview(DataExplorerCopyTableDataNotification.type.method);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(DataExplorerCommandId.CollapseSummary, async () => {
                await this._setSummaryCollapsedForActive(true);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(DataExplorerCommandId.ExpandSummary, async () => {
                await this._setSummaryCollapsedForActive(false);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(DataExplorerCommandId.SummaryOnLeft, async () => {
                await this._setLayoutForActive('SummaryOnLeft');
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(DataExplorerCommandId.SummaryOnRight, async () => {
                await this._setLayoutForActive('SummaryOnRight');
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(DataExplorerCommandId.ClearColumnSorting, async () => {
                await this._sendToActiveWebview(DataExplorerClearSortNotification.type.method);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(DataExplorerCommandId.ConvertToCode, async () => {
                await this._showConvertToCodeForActive();
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(DataExplorerCommandId.OpenAsPlaintext, async () => {
                await this._sendToActiveWebview(DataExplorerOpenAsPlaintextNotification.type.method);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(DataExplorerCommandId.ToggleFileOptions, async () => {
                await this._showFileOptionsForActive();
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(DataExplorerCommandId.MoveToNewWindow, async () => {
                await this._sendToActiveWebview(DataExplorerMoveToNewWindowNotification.type.method);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(DataExplorerCommandId.ShowColumnContextMenu, async () => {
                await this._sendToActiveWebview(DataExplorerShowColumnContextMenuNotification.type.method);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(DataExplorerCommandId.ShowRowContextMenu, async () => {
                await this._sendToActiveWebview(DataExplorerShowRowContextMenuNotification.type.method);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(DataExplorerCommandId.ShowCellContextMenu, async () => {
                await this._sendToActiveWebview(DataExplorerShowCellContextMenuNotification.type.method);
            })
        );
    }

    private async _sendToActiveWebview(method: string, params?: unknown): Promise<void> {
        const active = this._getActiveDataExplorer();
        if (!active) {
            vscode.window.showWarningMessage('No active Data Explorer editor.');
            return;
        }
        const connection = this._connections.get(active.identifier);
        if (!connection) {
            vscode.window.showWarningMessage('No active Data Explorer connection.');
            return;
        }
        connection.sendNotification(method, params as object | undefined);
    }

    private _getActiveDataExplorer(): { identifier: string; panel: vscode.WebviewPanel } | undefined {
        for (const [identifier, panel] of this._panels) {
            if (panel.active) {
                return { identifier, panel };
            }
        }
        return undefined;
    }

    private _getActiveExplorerContext(): {
        identifier: string;
        panel: vscode.WebviewPanel;
        instance: IDataExplorerInstance;
        connection: MessageConnection;
    } | undefined {
        const active = this._getActiveDataExplorer();
        if (!active) {
            return undefined;
        }

        const instance = this._dataExplorerService.getInstance(active.identifier);
        const connection = this._connections.get(active.identifier);
        if (!instance || !connection) {
            return undefined;
        }

        return {
            ...active,
            instance,
            connection,
        };
    }

    private _isLayoutState(value: string): value is DataExplorerLayoutState {
        return value === 'SummaryOnLeft' || value === 'SummaryOnRight';
    }

    private _ensureUiState(instanceId: string): DataExplorerUiState {
        const existing = this._uiState.get(instanceId);
        if (existing) {
            return existing;
        }
        const initialState: DataExplorerUiState = {
            layout: 'SummaryOnLeft',
            summaryCollapsed: false,
        };
        this._uiState.set(instanceId, initialState);
        return initialState;
    }

    private _updateUiState(instanceId: string, patch: Partial<DataExplorerUiState>): DataExplorerUiState {
        const current = this._ensureUiState(instanceId);
        const next: DataExplorerUiState = {
            ...current,
            ...patch,
        };
        this._uiState.set(instanceId, next);
        return next;
    }

    private _isInstanceActive(instanceId: string): boolean {
        return this._panels.get(instanceId)?.active ?? false;
    }

    private _updateFocusedState(instanceId: string, focused: boolean): void {
        this._focusedState.set(instanceId, focused);
        if (this._isInstanceActive(instanceId)) {
            this._syncActiveContexts();
        }
    }

    private _isInstanceInNewWindow(instanceId: string): boolean {
        return this._newWindowState.has(instanceId);
    }

    private _buildAugmentedBackendState(instance: IDataExplorerInstance) {
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
                inNewWindow: this._isInstanceInNewWindow(instance.identifier),
            },
        };
    }

    private _sendBackendStateUpdate(
        connection: MessageConnection,
        instance: IDataExplorerInstance
    ): void {
        const state = this._buildAugmentedBackendState(instance);
        if (!state) {
            return;
        }

        connection.sendNotification(DataExplorerBackendStateNotification.type, {
            state,
        });
    }

    private _setForegroundLoading(instanceId: string, isLoading: boolean): void {
        const connection = this._connections.get(instanceId);
        if (!connection) {
            return;
        }

        connection.sendNotification(DataExplorerLoadingNotification.type, {
            isLoading,
        });
    }

    private _beginForegroundLoading(instanceId: string): void {
        const nextCount = (this._foregroundLoadingCounts.get(instanceId) ?? 0) + 1;
        this._foregroundLoadingCounts.set(instanceId, nextCount);
        if (nextCount === 1) {
            this._setForegroundLoading(instanceId, true);
        }
    }

    private _endForegroundLoading(instanceId: string): void {
        const currentCount = this._foregroundLoadingCounts.get(instanceId) ?? 0;
        if (currentCount <= 1) {
            this._foregroundLoadingCounts.delete(instanceId);
            this._setForegroundLoading(instanceId, false);
            return;
        }

        this._foregroundLoadingCounts.set(instanceId, currentCount - 1);
    }

    private async _runWithForegroundLoading<T>(
        instanceId: string,
        task: () => Promise<T>,
    ): Promise<T> {
        this._beginForegroundLoading(instanceId);
        try {
            return await task();
        } finally {
            this._endForegroundLoading(instanceId);
        }
    }

    private async _showConvertToCodeForActive(): Promise<void> {
        const active = this._getActiveExplorerContext();
        if (!active) {
            vscode.window.showWarningMessage('No active Data Explorer editor.');
            return;
        }

        try {
            const backendState = await active.instance.clientInstance.getBackendState(true);
            const availableSyntaxes =
                backendState.supported_features.convert_to_code.code_syntaxes?.map(
                    syntax => syntax.code_syntax_name
                ) ?? [];

            if (
                backendState.supported_features.convert_to_code.support_status !== SupportStatus.Supported ||
                availableSyntaxes.length === 0
            ) {
                throw new Error('Convert to code is not supported by this dataset.');
            }

            const hasSorting = (backendState.sort_keys?.length ?? 0) > 0;
            const hasFiltering = (backendState.row_filters?.length ?? 0) > 0;
            if (!hasSorting && !hasFiltering) {
                throw new Error('Convert to code is available after applying sorting or row filters.');
            }

            const suggestedSyntax = await active.instance.clientInstance.suggestCodeSyntax();
            active.connection.sendNotification(DataExplorerConvertToCodeNotification.type, {
                suggestedSyntax: suggestedSyntax?.code_syntax_name,
                availableSyntaxes,
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Convert to code failed: ${String(error)}`);
        }
    }

    private async _showFileOptionsForActive(): Promise<void> {
        const active = this._getActiveExplorerContext();
        if (!active) {
            vscode.window.showWarningMessage('No active Data Explorer editor.');
            return;
        }

        if (
            !active.instance.supportsFileOptions ||
            !isPlaintextDataExplorerIdentifier(active.instance.identifier)
        ) {
            vscode.window.showErrorMessage('File options are not supported by this dataset.');
            return;
        }

        active.connection.sendNotification(DataExplorerToggleFileOptionsNotification.type, {
            hasHeaderRow: active.instance.fileHasHeaderRow,
            supportsFileOptions: active.instance.supportsFileOptions,
        });
    }

    private async _openAsPlaintext(instance: IDataExplorerInstance): Promise<void> {
        const backingUri = getDataExplorerBackingUri(instance.identifier);
        if (!backingUri) {
            throw new Error('No backing file URI is available for this dataset.');
        }

        if (!isPlaintextDataExplorerIdentifier(instance.identifier)) {
            throw new Error('Only CSV and TSV data sources can be opened as plain text.');
        }

        await vscode.workspace.fs.stat(backingUri);
        try {
            await vscode.commands.executeCommand('vscode.openWith', backingUri, 'default', {
                preview: true,
                preserveFocus: false,
            });
        } catch {
            await vscode.window.showTextDocument(backingUri, {
                preview: true,
                preserveFocus: false,
            });
        }
    }

    private _resetContexts(): void {
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_EDITOR_CONTEXT, false);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_LAYOUT_CONTEXT, 'SummaryOnLeft');
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_COLUMN_SORTING_CONTEXT, false);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_CONVERT_TO_CODE_ENABLED_CONTEXT, false);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_CODE_SYNTAXES_AVAILABLE_CONTEXT, false);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_ROW_FILTERING_CONTEXT, false);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_IS_PLAINTEXT_CONTEXT, false);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_FILE_HAS_HEADER_ROW_CONTEXT, true);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_SUMMARY_COLLAPSED_CONTEXT, false);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_FOCUSED_CONTEXT, false);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_IN_NEW_WINDOW_CONTEXT, false);
    }

    private _updateContextsForInstance(instance: IDataExplorerInstance): void {
        const backendState = instance.backendState;
        const uiState = this._ensureUiState(instance.identifier);
        const supportsConvertToCode =
            backendState?.supported_features?.convert_to_code?.support_status === SupportStatus.Supported;
        const hasCodeSyntaxes = (backendState?.supported_features?.convert_to_code?.code_syntaxes?.length ?? 0) > 0;

        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_EDITOR_CONTEXT, true);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_LAYOUT_CONTEXT, uiState.layout);
        void vscode.commands.executeCommand(
            'setContext',
            DATA_EXPLORER_COLUMN_SORTING_CONTEXT,
            (backendState?.sort_keys?.length ?? 0) > 0,
        );
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_CONVERT_TO_CODE_ENABLED_CONTEXT, supportsConvertToCode);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_CODE_SYNTAXES_AVAILABLE_CONTEXT, hasCodeSyntaxes);
        void vscode.commands.executeCommand(
            'setContext',
            DATA_EXPLORER_ROW_FILTERING_CONTEXT,
            (backendState?.row_filters?.length ?? 0) > 0,
        );
        void vscode.commands.executeCommand(
            'setContext',
            DATA_EXPLORER_IS_PLAINTEXT_CONTEXT,
            isPlaintextDataExplorerIdentifier(instance.identifier),
        );
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_FILE_HAS_HEADER_ROW_CONTEXT, instance.fileHasHeaderRow);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_SUMMARY_COLLAPSED_CONTEXT, uiState.summaryCollapsed);
        void vscode.commands.executeCommand(
            'setContext',
            DATA_EXPLORER_FOCUSED_CONTEXT,
            this._focusedState.get(instance.identifier) ?? false,
        );
        void vscode.commands.executeCommand(
            'setContext',
            DATA_EXPLORER_IN_NEW_WINDOW_CONTEXT,
            this._isInstanceInNewWindow(instance.identifier),
        );
    }

    private _syncActiveContexts(): void {
        const active = this._getActiveDataExplorer();
        if (!active) {
            this._dataExplorerService.setActiveInstance(undefined);
            this._resetContexts();
            return;
        }

        const instance = this._dataExplorerService.getInstance(active.identifier);
        this._dataExplorerService.setActiveInstance(instance);

        if (!instance) {
            this._resetContexts();
            return;
        }

        this._updateContextsForInstance(instance);
    }

    private _notifyLayoutChanged(instanceId: string, layout: DataExplorerLayoutState): void {
        const connection = this._connections.get(instanceId);
        if (!connection) {
            return;
        }
        connection.sendNotification(DataExplorerLayoutChangedNotification.type, { layout });
    }

    private _notifySummaryCollapsedChanged(instanceId: string, collapsed: boolean): void {
        const connection = this._connections.get(instanceId);
        if (!connection) {
            return;
        }
        connection.sendNotification(DataExplorerSummaryCollapsedChangedNotification.type, { collapsed });
    }

    private async _setLayoutForActive(layout: DataExplorerLayoutState): Promise<void> {
        const active = this._getActiveDataExplorer();
        if (!active) {
            vscode.window.showWarningMessage('No active Data Explorer editor.');
            return;
        }

        const uiState = this._updateUiState(active.identifier, { layout });
        this._notifyLayoutChanged(active.identifier, uiState.layout);
        this._syncActiveContexts();
    }

    private async _setSummaryCollapsedForActive(collapsed: boolean): Promise<void> {
        const active = this._getActiveDataExplorer();
        if (!active) {
            vscode.window.showWarningMessage('No active Data Explorer editor.');
            return;
        }

        const uiState = this._updateUiState(active.identifier, { summaryCollapsed: collapsed });
        this._notifySummaryCollapsedChanged(active.identifier, uiState.summaryCollapsed);
        this._syncActiveContexts();
    }

    /**
     * Opens a Data Explorer instance in the editor area
     */
    public openInstance(instance: IDataExplorerInstance): void {
        if (instance.inlineOnly) {
            return;
        }

        this._ensureUiState(instance.identifier);

        // Check if panel already exists
        const existingPanel = this._panels.get(instance.identifier);
        if (existingPanel) {
            existingPanel.reveal();
            return;
        }

        // Create new panel
        const panel = vscode.window.createWebviewPanel(
            DataExplorerEditorProvider.viewType,
            instance.displayName || 'Data Explorer',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: this._getWebviewLocalResourceRoots()
            }
        );

        this.attachToPanel(instance, panel);
    }

    /**
     * Marks an instance identifier as being opened by an external panel provider,
     * preventing the auto-open listener from creating a duplicate panel.
     */
    public markExternalPanel(identifier: string): void {
        this._externalPanelInstances.add(identifier);
    }

    /**
     * Removes an instance identifier from the external panel set.
     */
    public unmarkExternalPanel(identifier: string): void {
        this._externalPanelInstances.delete(identifier);
    }

    /**
     * Attaches a Data Explorer instance to an existing WebviewPanel.
     * Used by both openInstance() (self-created panels) and
     * DataExplorerCustomEditorProvider (VS Code-created panels from "Reopen With").
     */
    public attachToPanel(instance: IDataExplorerInstance, panel: vscode.WebviewPanel): void {
        this._ensureUiState(instance.identifier);

        const panelDisposables: vscode.Disposable[] = [];
        const disposePanelListeners = () => {
            while (panelDisposables.length) {
                panelDisposables.pop()?.dispose();
            }
        };

        // Set icon
        panel.iconPath = new vscode.ThemeIcon('table');

        // Store panel
        this._panels.set(instance.identifier, panel);

        // Custom editor panels provided by VS Code do not inherit the webview
        // options we set when creating our own panels, so ensure scripts and
        // local resources are enabled before loading the app shell.
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: this._getWebviewLocalResourceRoots(),
        };

        // Set HTML content
        panel.webview.html = this._getHtmlForWebview(panel.webview);

        // Set up JSON-RPC connection
        const reader = new WebviewMessageReader(panel.webview);
        const writer = new WebviewMessageWriter(panel.webview);
        const connection = createMessageConnection(reader, writer);
        this._connections.set(instance.identifier, connection);

        panelDisposables.push(
            panel.webview.onDidReceiveMessage((message: unknown) => {
                if (!message || typeof message !== 'object') {
                    return;
                }

                const event = message as {
                    type?: string;
                    message?: string;
                    source?: string;
                    lineno?: number;
                    colno?: number;
                    stack?: string;
                };

                if (event.type !== 'dataExplorerWebviewError') {
                    return;
                }

                const location = event.source
                    ? ` (${event.source}:${event.lineno ?? 0}:${event.colno ?? 0})`
                    : '';
                const stack = event.stack ? `\n${event.stack}` : '';
                this._logChannel.error(
                    `[DataExplorerWebview] ${event.message ?? 'Unknown error'}${location}${stack}`
                );
            })
        );

        // Register notification handlers
        this._registerNotificationHandlers(connection, panel, instance);

        // Start listening
        connection.listen();

        // Handle panel dispose
        panel.onDidDispose(() => {
            const shouldKeepInstanceOpen =
                this._isDisposing ||
                this._skipInstanceCloseOnNextPanelDispose.delete(instance.identifier);

            disposePanelListeners();
            connection.dispose();
            this._connections.delete(instance.identifier);
            this._panels.delete(instance.identifier);
            this._lastRequests.delete(instance.identifier);
            this._focusedState.delete(instance.identifier);
            this._newWindowState.delete(instance.identifier);
            this._foregroundLoadingCounts.delete(instance.identifier);

            if (!shouldKeepInstanceOpen) {
                const dataExplorerInstance = this._dataExplorerService.getInstance(instance.identifier);
                if (dataExplorerInstance) {
                    dataExplorerInstance.dispose();
                }
            }

            this._syncActiveContexts();
        });

        panel.onDidChangeViewState(event => {
            const trackedViewColumn = this._newWindowState.get(instance.identifier);
            if (
                this._newWindowState.has(instance.identifier) &&
                event.webviewPanel.visible &&
                event.webviewPanel.viewColumn !== trackedViewColumn
            ) {
                this._newWindowState.delete(instance.identifier);
                this._sendBackendStateUpdate(connection, instance);
            }

            if (event.webviewPanel.active) {
                this._syncActiveContexts();
            } else if (!this._getActiveDataExplorer()) {
                this._syncActiveContexts();
            }
        });

        // Update title when backend state changes
        panelDisposables.push(instance.onDidUpdateBackendState(state => {
            panel.title = state.display_name || 'Data Explorer';
            this._sendBackendStateUpdate(connection, instance);
            if (panel.active) {
                this._updateContextsForInstance(instance);
            }
        }));

        // Forward backend-driven schema/data updates
        panelDisposables.push(
            instance.clientInstance.onDidSchemaUpdate(async () => {
                try {
                    await this._runWithForegroundLoading(instance.identifier, async () => {
                        await this._sendDataFromLastRequest(connection, instance);
                    });
                } catch (error) {
                    this._logChannel.error(`[DataExplorerEditor] Schema refresh failed: ${error}`);
                }
            })
        );
        panelDisposables.push(
            instance.clientInstance.onDidDataUpdate(async () => {
                try {
                    await this._runWithForegroundLoading(instance.identifier, async () => {
                        await this._sendDataFromLastRequest(connection, instance);
                    });
                } catch (error) {
                    this._logChannel.error(`[DataExplorerEditor] Data refresh failed: ${error}`);
                }
            })
        );

        this._logChannel.info(`[DataExplorerEditor] Opened panel for ${instance.identifier}`);
        this._syncActiveContexts();
    }

    /**
     * Register notification handlers for the connection
     */
    private _registerNotificationHandlers(
        connection: MessageConnection,
        panel: vscode.WebviewPanel,
        instance: IDataExplorerInstance
    ): void {
        // Webview ready
        connection.onNotification(DataExplorerReadyNotification.type, async () => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/ready`);
            await this._runWithForegroundLoading(instance.identifier, async () => {
                try {
                    await instance.clientInstance.updateBackendState();
                } catch (error) {
                    this._logChannel.warn(`[DataExplorerEditor] Backend state update failed: ${error}`);
                }
                await this._sendInitialize(connection, instance);
                await this._sendData(connection, instance);
            });
        });

        // Close data explorer
        connection.onNotification(DataExplorerCloseNotification.type, () => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/close`);
            panel.dispose();
        });

        connection.onNotification(DataExplorerFocusChangedNotification.type, (params) => {
            this._logChannel.debug('[DataExplorerEditor] Received: dataExplorer/focusChanged');
            this._updateFocusedState(instance.identifier, params.focused === true);
        });

        // Set summary layout state from webview.
        connection.onNotification(DataExplorerSetLayoutNotification.type, (params) => {
            this._logChannel.debug('[DataExplorerEditor] Received: dataExplorer/setLayout');
            const layout = this._isLayoutState(params.layout) ? params.layout : 'SummaryOnLeft';
            const uiState = this._updateUiState(instance.identifier, { layout });
            this._notifyLayoutChanged(instance.identifier, uiState.layout);
            if (panel.active) {
                this._updateContextsForInstance(instance);
            }
        });

        // Set summary collapsed state from webview.
        connection.onNotification(DataExplorerSetSummaryCollapsedNotification.type, (params) => {
            this._logChannel.debug('[DataExplorerEditor] Received: dataExplorer/setSummaryCollapsed');
            const uiState = this._updateUiState(instance.identifier, { summaryCollapsed: !!params.collapsed });
            this._notifySummaryCollapsedChanged(instance.identifier, uiState.summaryCollapsed);
            if (panel.active) {
                this._updateContextsForInstance(instance);
            }
        });

        // Request data
        connection.onNotification(DataExplorerRequestDataNotification.type, async (params) => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/requestData`);
            this._lastRequests.set(instance.identifier, {
                startRow: params.startRow,
                endRow: params.endRow,
                columns: params.columns
            });
            await this._runWithForegroundLoading(instance.identifier, async () => {
                await this._sendData(connection, instance, params.startRow, params.endRow, params.columns);
            });
        });

        // Request schema
        connection.onNotification(DataExplorerRequestSchemaNotification.type, async (params) => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/requestSchema`);
            try {
                const schema = await instance.getSchema(params.columns);
                connection.sendNotification(DataExplorerSchemaNotification.type, {
                    columns: schema.columns
                });
            } catch (error) {
                connection.sendNotification(DataExplorerErrorNotification.type, {
                    message: String(error)
                });
            }
        });

        // Search schema
        connection.onNotification(DataExplorerSearchSchemaNotification.type, async (params) => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/searchSchema`);
            try {
                const backendState = await instance.clientInstance.getBackendState();
                const supportsSearch = backendState.supported_features.search_schema.support_status === SupportStatus.Supported;
                let columnIndices: number[] = [];
                if (supportsSearch) {
                    const filters: ColumnFilter[] = [];
                    if (params.text && params.text.trim().length > 0) {
                        filters.push({
                            filter_type: ColumnFilterType.TextSearch,
                            params: {
                                search_type: TextSearchType.Contains,
                                term: params.text.trim(),
                                case_sensitive: false
                            }
                        });
                    }
                    const result = await instance.clientInstance.searchSchema(filters, params.sortOrder as SearchSchemaSortOrder);
                    columnIndices = result.matches ?? [];
                } else {
                    columnIndices = Array.from(
                        { length: backendState.table_shape.num_columns },
                        (_, i) => i
                    );
                }

                if (params.pinnedColumns && params.pinnedColumns.length > 0) {
                    const pinned = params.pinnedColumns.filter(index =>
                        index >= 0 && index < backendState.table_shape.num_columns
                    );
                    const pinnedSet = new Set(pinned);
                    const rest = columnIndices.filter(index => !pinnedSet.has(index));
                    columnIndices = [...pinned, ...rest];
                }

                const schema = await instance.getSchema(columnIndices);
                connection.sendNotification(DataExplorerSummarySchemaNotification.type, {
                    columns: schema.columns,
                    columnIndices,
                    requestId: params.requestId,
                });
            } catch (error) {
                connection.sendNotification(DataExplorerErrorNotification.type, {
                    message: String(error)
                });
            }
        });

        // Request column profiles
        connection.onNotification(DataExplorerRequestColumnProfilesNotification.type, async (params) => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/requestColumnProfiles`);
            try {
                const backendState = await instance.clientInstance.getBackendState();
                const supportsProfiles = backendState.supported_features.get_column_profiles.support_status === SupportStatus.Supported;
                if (!supportsProfiles) {
                    connection.sendNotification(DataExplorerColumnProfilesNotification.type, {
                        profiles: params.columnIndices.map(columnIndex => ({
                            columnIndex,
                            profile: undefined,
                        })),
                        error: 'Column profiles are not supported by this backend.',
                        requestId: params.requestId,
                    });
                    return;
                }
                const supportedTypes =
                    backendState.supported_features.get_column_profiles
                        .supported_types ?? [];
                const supportedProfileTypes = new Set(
                    supportedTypes
                        .filter(typeSupport =>
                            typeSupport.support_status ===
                            SupportStatus.Supported
                        )
                        .map(typeSupport => typeSupport.profile_type),
                );
                const hasDeclaredSupportedTypes = supportedTypes.length > 0;
                const isProfileTypeSupported = (profileType: ColumnProfileType) =>
                    !hasDeclaredSupportedTypes ||
                    supportedProfileTypes.has(profileType);
                const expandedColumnIndices = new Set(
                    params.expandedColumnIndices ?? [],
                );

                const schema = await instance.getSchema(params.columnIndices);
                const schemaByIndex = new Map(
                    schema.columns.map(column => [column.column_index, column]),
                );

                const requests: ColumnProfileRequest[] = params.columnIndices.map(columnIndex => {
                    const columnSchema = schemaByIndex.get(columnIndex);
                    const profiles: ColumnProfileSpec[] = [];

                    if (isProfileTypeSupported(ColumnProfileType.NullCount)) {
                        profiles.push({ profile_type: ColumnProfileType.NullCount });
                    }

                    const expanded = expandedColumnIndices.has(columnIndex);

                    if (
                        expanded &&
                        isProfileTypeSupported(ColumnProfileType.SummaryStats)
                    ) {
                        profiles.push({ profile_type: ColumnProfileType.SummaryStats });
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

                    if (isNumericColumn && isProfileTypeSupported(ColumnProfileType.SmallHistogram)) {
                        profiles.push({
                            profile_type: ColumnProfileType.SmallHistogram,
                            params: {
                                method: ColumnHistogramParamsMethod.FreedmanDiaconis,
                                num_bins: SMALL_HISTOGRAM_NUM_BINS,
                            },
                        });
                        if (
                            expanded &&
                            isProfileTypeSupported(ColumnProfileType.LargeHistogram)
                        ) {
                            profiles.push({
                                profile_type: ColumnProfileType.LargeHistogram,
                                params: {
                                    method: ColumnHistogramParamsMethod.FreedmanDiaconis,
                                    num_bins: LARGE_HISTOGRAM_NUM_BINS,
                                },
                            });
                        }
                    } else if (isBooleanColumn && isProfileTypeSupported(ColumnProfileType.SmallFrequencyTable)) {
                        profiles.push({
                            profile_type: ColumnProfileType.SmallFrequencyTable,
                            params: {
                                limit: BOOLEAN_FREQUENCY_TABLE_LIMIT,
                            },
                        });
                    } else if (isStringColumn && isProfileTypeSupported(ColumnProfileType.SmallFrequencyTable)) {
                        profiles.push({
                            profile_type: ColumnProfileType.SmallFrequencyTable,
                            params: {
                                limit: SMALL_FREQUENCY_TABLE_LIMIT,
                            },
                        });
                        if (
                            expanded &&
                            isProfileTypeSupported(ColumnProfileType.LargeFrequencyTable)
                        ) {
                            profiles.push({
                                profile_type: ColumnProfileType.LargeFrequencyTable,
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

                const requestsWithProfiles = requests.filter(request =>
                    request.profiles.length > 0
                );

                if (requestsWithProfiles.length === 0) {
                    connection.sendNotification(DataExplorerColumnProfilesNotification.type, {
                        profiles: params.columnIndices.map(columnIndex => ({
                            columnIndex,
                            profile: undefined,
                        })),
                        requestId: params.requestId,
                    });
                    return;
                }

                const results = await instance.clientInstance.requestColumnProfiles(requestsWithProfiles);
                const resultByIndex = new Map<number, unknown>();
                requestsWithProfiles.forEach((request, index) => {
                    resultByIndex.set(request.column_index, results[index]);
                });
                const profiles = params.columnIndices.map(columnIndex => ({
                    columnIndex,
                    profile: resultByIndex.get(columnIndex)
                }));
                connection.sendNotification(DataExplorerColumnProfilesNotification.type, {
                    profiles,
                    requestId: params.requestId,
                });
            } catch (error) {
                connection.sendNotification(DataExplorerColumnProfilesNotification.type, {
                    profiles: params.columnIndices.map(columnIndex => ({
                        columnIndex,
                        profile: undefined,
                    })),
                    error: String(error),
                    requestId: params.requestId,
                });
            }
        });

        // Refresh
        connection.onNotification(DataExplorerRefreshNotification.type, async () => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/refresh`);
            await this._runWithForegroundLoading(instance.identifier, async () => {
                await instance.clientInstance.updateBackendState();
                await this._sendInitialize(connection, instance);
                await this._sendDataFromLastRequest(connection, instance);
            });
        });

        // Sort
        connection.onNotification(DataExplorerSortNotification.type, async (params) => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/sort`);
            try {
                await this._runWithForegroundLoading(instance.identifier, async () => {
                    await instance.clientInstance.setSortColumns(
                        params.sortKeys.map(sortKey => ({
                            column_index: sortKey.columnIndex,
                            ascending: sortKey.ascending
                        }))
                    );
                    await instance.clientInstance.updateBackendState();
                    await this._sendDataFromLastRequest(connection, instance);
                });
            } catch (error) {
                connection.sendNotification(DataExplorerErrorNotification.type, {
                    message: String(error)
                });
            }
        });

        // Clear sort
        connection.onNotification(DataExplorerClearSortNotification.type, async () => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/clearSort`);
            try {
                await this._runWithForegroundLoading(instance.identifier, async () => {
                    await instance.clientInstance.setSortColumns([]);
                    await instance.clientInstance.updateBackendState();
                    await this._sendDataFromLastRequest(connection, instance);
                });
            } catch (error) {
                connection.sendNotification(DataExplorerErrorNotification.type, {
                    message: String(error)
                });
            }
        });

        // Clear filters
        connection.onNotification(DataExplorerClearFiltersNotification.type, async () => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/clearFilters`);
            try {
                await this._runWithForegroundLoading(instance.identifier, async () => {
                    await instance.clientInstance.setRowFilters([]);
                    await instance.clientInstance.updateBackendState();
                    await this._sendDataFromLastRequest(connection, instance);
                });
            } catch (error) {
                connection.sendNotification(DataExplorerErrorNotification.type, {
                    message: String(error)
                });
            }
        });

        // Add filter
        connection.onNotification(DataExplorerAddFilterNotification.type, async (params) => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/addFilter`);
            try {
                const currentFilters = instance.backendState?.row_filters ?? [];
                await this._runWithForegroundLoading(instance.identifier, async () => {
                    await instance.clientInstance.setRowFilters([...currentFilters, params.filter as RowFilter]);
                    await instance.clientInstance.updateBackendState();
                    await this._sendDataFromLastRequest(connection, instance);
                });
            } catch (error) {
                connection.sendNotification(DataExplorerErrorNotification.type, {
                    message: String(error)
                });
            }
        });

        // Update filter
        connection.onNotification(DataExplorerUpdateFilterNotification.type, async (params) => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/updateFilter`);
            try {
                const currentFilters = instance.backendState?.row_filters ?? [];
                const updatedFilters = currentFilters.map(filter =>
                    filter.filter_id === (params.filter as RowFilter).filter_id ? params.filter as RowFilter : filter
                );
                await this._runWithForegroundLoading(instance.identifier, async () => {
                    await instance.clientInstance.setRowFilters(updatedFilters);
                    await instance.clientInstance.updateBackendState();
                    await this._sendDataFromLastRequest(connection, instance);
                });
            } catch (error) {
                connection.sendNotification(DataExplorerErrorNotification.type, {
                    message: String(error)
                });
            }
        });

        // Remove filter
        connection.onNotification(DataExplorerRemoveFilterNotification.type, async (params) => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/removeFilter`);
            try {
                const currentFilters = instance.backendState?.row_filters ?? [];
                const updatedFilters = currentFilters.filter(filter => filter.filter_id !== params.filterId);
                await this._runWithForegroundLoading(instance.identifier, async () => {
                    await instance.clientInstance.setRowFilters(updatedFilters);
                    await instance.clientInstance.updateBackendState();
                    await this._sendDataFromLastRequest(connection, instance);
                });
            } catch (error) {
                connection.sendNotification(DataExplorerErrorNotification.type, {
                    message: String(error)
                });
            }
        });

        // Copy to clipboard
        connection.onNotification(DataExplorerCopyToClipboardNotification.type, async (params) => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/copyToClipboard`);
            try {
                const backendState = instance.backendState;
                const totalRows = backendState?.table_shape.num_rows ?? 0;
                const totalColumns = backendState?.table_shape.num_columns ?? 0;

                let selection: { kind: string; selection: unknown };
                let selectedCells = 0;

                if (params.selectionType === 'cell' && params.columnIndex !== undefined && params.rowIndex !== undefined) {
                    selection = {
                        kind: TableSelectionKind.SingleCell,
                        selection: {
                            column_index: params.columnIndex,
                            row_index: params.rowIndex
                        }
                    };
                    selectedCells = 1;
                } else if (params.selectionType === 'cells' && params.columnIndexes && params.rowIndexes) {
                    selection = {
                        kind: TableSelectionKind.CellIndices,
                        selection: {
                            column_indices: params.columnIndexes,
                            row_indices: params.rowIndexes
                        }
                    };
                    selectedCells = params.columnIndexes.length * params.rowIndexes.length;
                } else if (params.selectionType === 'columns' && params.columnIndexes) {
                    selection = {
                        kind: TableSelectionKind.ColumnIndices,
                        selection: {
                            indices: params.columnIndexes
                        }
                    };
                    selectedCells = params.columnIndexes.length * totalRows;
                } else if (params.selectionType === 'rows' && params.rowIndexes) {
                    selection = {
                        kind: TableSelectionKind.RowIndices,
                        selection: {
                            indices: params.rowIndexes
                        }
                    };
                    selectedCells = params.rowIndexes.length * totalColumns;
                } else {
                    this._logChannel.warn('[DataExplorerEditor] Invalid clipboard selection');
                    return;
                }

                if (!selectedCells) {
                    vscode.window.showInformationMessage('There is nothing to copy to the clipboard.');
                    return;
                }

                if (selectedCells > MAX_CLIPBOARD_CELLS) {
                    vscode.window.showErrorMessage('There is too much data selected to copy to the clipboard.');
                    return;
                }

                const exported = await instance.clientInstance.exportDataSelection(
                    selection as any,
                    ExportFormat.Tsv
                );

                if (exported.data) {
                    await vscode.env.clipboard.writeText(exported.data);
                    this._logChannel.info('[DataExplorerEditor] Copied to clipboard');
                }
            } catch (error) {
                this._logChannel.error(`[DataExplorerEditor] Copy failed: ${error}`);
                connection.sendNotification(DataExplorerErrorNotification.type, {
                    message: `Copy failed: ${String(error)}`
                });
            }
        });

        // Copy table data
        connection.onNotification(DataExplorerCopyTableDataNotification.type, async () => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/copyTableData`);
            try {
                const backendState = await instance.clientInstance.getBackendState();
                const supportStatus =
                    backendState.supported_features.export_data_selection
                        .support_status;
                if (supportStatus !== SupportStatus.Supported) {
                    vscode.window.showErrorMessage('Copy table data is not supported by this backend.');
                    return;
                }

                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Preparing table data',
                        cancellable: false
                    },
                    async (progress) => {
                        const exported = await instance.clientInstance.exportDataSelection(
                            {
                                kind: TableSelectionKind.CellRange,
                                selection: {
                                    first_row_index: 0,
                                    last_row_index: Math.max(0, backendState.table_shape.num_rows - 1),
                                    first_column_index: 0,
                                    last_column_index: Math.max(0, backendState.table_shape.num_columns - 1)
                                }
                            },
                            ExportFormat.Tsv
                        );

                        if (!exported.data) {
                            throw new Error('No data returned from export');
                        }

                        progress.report({ message: 'Copying table data to the clipboard' });
                        await vscode.env.clipboard.writeText(exported.data);
                    }
                );

                vscode.window.showInformationMessage('Table data copied to the clipboard.');
                this._logChannel.info('[DataExplorerEditor] Copied table data to clipboard');
            } catch (error) {
                this._logChannel.error(`[DataExplorerEditor] Copy table data failed: ${error}`);
                vscode.window.showErrorMessage(`Copy table data failed: ${String(error)}`);
            }
        });

        // Export data
        connection.onNotification(DataExplorerExportDataNotification.type, async (params) => {
            this._logChannel.debug(`[DataExplorerEditor] Received: dataExplorer/exportData`);
            try {
                const format = params.format === 'csv' ? ExportFormat.Csv : ExportFormat.Tsv;
                const extension = params.format === 'csv' ? 'csv' : 'tsv';
                const filterName = params.format === 'csv' ? 'CSV Files' : 'TSV Files';

                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(`${instance.displayName}.${extension}`),
                    filters: {
                        [filterName]: [extension],
                        'All Files': ['*']
                    }
                });

                if (!saveUri) {
                    return;
                }

                const exported = await instance.clientInstance.exportDataSelection(
                    {
                        kind: TableSelectionKind.CellRange,
                        selection: {
                            first_row_index: 0,
                            last_row_index: Math.max(0, (instance.backendState?.table_shape.num_rows ?? 0) - 1),
                            first_column_index: 0,
                            last_column_index: Math.max(0, (instance.backendState?.table_shape.num_columns ?? 0) - 1)
                        }
                    },
                    format
                );

                if (exported.data) {
                    await vscode.workspace.fs.writeFile(
                        saveUri,
                        Buffer.from(exported.data, 'utf-8')
                    );
                    vscode.window.showInformationMessage(`Data exported to ${saveUri.fsPath}`);
                    this._logChannel.info(`[DataExplorerEditor] Exported data to ${saveUri.fsPath}`);
                } else {
                    throw new Error('No data returned from export');
                }
            } catch (error) {
                this._logChannel.error(`[DataExplorerEditor] Export failed: ${error}`);
                vscode.window.showErrorMessage(`Export failed: ${String(error)}`);
            }
        });

        // Move current data explorer tab into a new window.
        connection.onNotification(DataExplorerMoveToNewWindowNotification.type, async () => {
            this._logChannel.debug('[DataExplorerEditor] Received: dataExplorer/moveToNewWindow');
            if (this._isInstanceInNewWindow(instance.identifier)) {
                return;
            }
            this._skipInstanceCloseOnNextPanelDispose.add(instance.identifier);
            try {
                await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
                this._newWindowState.set(instance.identifier, panel.viewColumn);
                this._sendBackendStateUpdate(connection, instance);
                this._syncActiveContexts();
                setTimeout(() => {
                    if (this._panels.has(instance.identifier)) {
                        this._skipInstanceCloseOnNextPanelDispose.delete(instance.identifier);
                    }
                }, 1000);
            } catch (error) {
                this._skipInstanceCloseOnNextPanelDispose.delete(instance.identifier);
                connection.sendNotification(DataExplorerErrorNotification.type, {
                    message: `Failed to move editor to new window: ${String(error)}`
                });
            }
        });

        // Generate preview code for the current filters/sort keys.
        connection.onNotification(DataExplorerRequestConvertToCodePreviewNotification.type, async (params) => {
            this._logChannel.debug('[DataExplorerEditor] Received: dataExplorer/requestConvertToCodePreview');

            try {
                const backendState = await instance.clientInstance.getBackendState(true);
                const availableSyntaxes =
                    backendState.supported_features.convert_to_code.code_syntaxes ?? [];
                const desiredSyntax = availableSyntaxes.find(
                    syntax => syntax.code_syntax_name === params.desiredSyntax
                );

                if (!desiredSyntax) {
                    throw new Error(`Unsupported code syntax: ${params.desiredSyntax}`);
                }

                const converted = await instance.clientInstance.convertToCode(desiredSyntax);
                connection.sendNotification(DataExplorerConvertToCodePreviewNotification.type, {
                    desiredSyntax: params.desiredSyntax,
                    requestId: params.requestId,
                    code: converted.converted_code.join('\n'),
                });
            } catch (error) {
                connection.sendNotification(DataExplorerConvertToCodePreviewNotification.type, {
                    desiredSyntax: params.desiredSyntax,
                    requestId: params.requestId,
                    code: '',
                    error: String(error),
                });
            }
        });

        // Convert current view to code and copy result to clipboard.
        connection.onNotification(DataExplorerRunConvertToCodeNotification.type, async (params) => {
            this._logChannel.debug('[DataExplorerEditor] Received: dataExplorer/runConvertToCode');
            try {
                if (!params.desiredSyntax?.trim()) {
                    throw new Error('No code syntax was selected.');
                }

                const syntax: CodeSyntaxName = {
                    code_syntax_name: params.desiredSyntax,
                };
                const converted = await instance.clientInstance.convertToCode(syntax);
                const code = converted.converted_code.join('\n').trim();
                if (!code) {
                    throw new Error('No code was generated for the current view.');
                }

                await vscode.env.clipboard.writeText(code);
                vscode.window.showInformationMessage(
                    `Converted to ${params.desiredSyntax} code and copied to clipboard.`
                );
            } catch (error) {
                connection.sendNotification(DataExplorerErrorNotification.type, {
                    message: `Convert to code failed: ${String(error)}`
                });
            }
        });

        // Open currently focused data source as plain text file.
        connection.onNotification(DataExplorerOpenAsPlaintextNotification.type, async () => {
            this._logChannel.debug('[DataExplorerEditor] Received: dataExplorer/openAsPlaintext');
            try {
                await this._openAsPlaintext(instance);
            } catch (error) {
                connection.sendNotification(DataExplorerErrorNotification.type, {
                    message: `Open as plain text failed: ${String(error)}`
                });
            }
        });

        // Apply file options chosen in the webview.
        connection.onNotification(DataExplorerApplyFileOptionsNotification.type, async (params) => {
            this._logChannel.debug('[DataExplorerEditor] Received: dataExplorer/applyFileOptions');
            try {
                if (!instance.supportsFileOptions) {
                    throw new Error('File options are not supported by this dataset.');
                }
                const options: DatasetImportOptions = {
                    has_header_row: params.hasHeaderRow,
                };
                await this._runWithForegroundLoading(instance.identifier, async () => {
                    const result = await instance.setDatasetImportOptions(options);
                    if (result.error_message) {
                        throw new Error(result.error_message);
                    }
                    await instance.clientInstance.updateBackendState();
                    await this._sendInitialize(connection, instance);
                    await this._sendDataFromLastRequest(connection, instance);
                });
            } catch (error) {
                connection.sendNotification(DataExplorerErrorNotification.type, {
                    message: `File options update failed: ${String(error)}`
                });
            }
        });
    }

    /**
     * Send initialize notification with full state
     */
    private async _sendInitialize(connection: MessageConnection, instance: IDataExplorerInstance): Promise<void> {
        const uiState = this._ensureUiState(instance.identifier);

        connection.sendNotification(DataExplorerInitializeNotification.type, {
            identifier: instance.identifier,
            displayName: instance.displayName,
            languageName: instance.languageName,
            backendState: this._buildAugmentedBackendState(instance)
        });

        connection.sendNotification(DataExplorerLayoutChangedNotification.type, {
            layout: uiState.layout,
        });
        connection.sendNotification(DataExplorerSummaryCollapsedChangedNotification.type, {
            collapsed: uiState.summaryCollapsed,
        });

        const backendState = instance.backendState;
        if (backendState) {
            connection.sendNotification(DataExplorerMetadataNotification.type, {
                displayName: backendState.display_name,
                numRows: backendState.table_shape.num_rows,
                numColumns: backendState.table_shape.num_columns,
                hasRowLabels: backendState.has_row_labels
            });
        }

        if (this._isInstanceActive(instance.identifier)) {
            this._updateContextsForInstance(instance);
        }
    }

    /**
     * Send data notification
     */
    private async _sendData(
        connection: MessageConnection,
        instance: IDataExplorerInstance,
        startRow: number = 0,
        endRow?: number,
        columnIndices?: number[]
    ): Promise<void> {
        try {
            const backendState = instance.backendState;
            if (!backendState) {
                return;
            }

            const numColumns = backendState.table_shape.num_columns;
            const numRows = backendState.table_shape.num_rows;

            const columns = columnIndices && columnIndices.length > 0
                ? columnIndices
                : Array.from({ length: numColumns }, (_, i) => i);
            const displayEndRow = Math.min(endRow ?? numRows, numRows);

            if (columns.length === 0 || numRows === 0) {
                connection.sendNotification(DataExplorerDataNotification.type, {
                    columns: [],
                    schema: [],
                    startRow: 0,
                    endRow: 0,
                    columnIndices: []
                });
                return;
            }

            const schema = await instance.getSchema(columns);

            connection.sendNotification(DataExplorerSchemaNotification.type, {
                columns: schema.columns
            });

            const columnSelections = columns.map(i => ({
                column_index: i,
                spec: { first_index: startRow, last_index: displayEndRow - 1 }
            }));
            const tableData = await instance.clientInstance.getDataValues(columnSelections);

            let rowLabels: string[] | undefined;
            if (backendState.has_row_labels && displayEndRow > startRow) {
                const rowLabelResult = await instance.clientInstance.getRowLabels({
                    first_index: startRow,
                    last_index: displayEndRow - 1
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
                totalColumns: numColumns
            });

        } catch (error) {
            this._logChannel.error(`[DataExplorerEditor] Error fetching data: ${error}`);
            connection.sendNotification(DataExplorerErrorNotification.type, {
                message: String(error)
            });
        }
    }

    private async _sendDataFromLastRequest(
        connection: MessageConnection,
        instance: IDataExplorerInstance
    ): Promise<void> {
        const lastRequest = this._lastRequests.get(instance.identifier);
        if (lastRequest) {
            await this._sendData(
                connection,
                instance,
                lastRequest.startRow,
                lastRequest.endRow,
                lastRequest.columns
            );
            return;
        }
        await this._sendData(connection, instance);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Get URIs for Svelte-built assets
        const webviewDistPath = vscode.Uri.joinPath(this._extensionUri, 'webview', 'dist', 'dataExplorer');
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDistPath, 'index.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDistPath, 'index.css'));
        const languageMonacoSupportModules = this._serializeInlineScriptData(
            this._getLanguageMonacoSupportModuleUris(webview)
        );
        const languageTextMateGrammars = this._serializeInlineScriptData(
            this._getLanguageTextMateGrammarDefinitions(webview)
        );

        // Use nonce for security
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource}; worker-src blob:;">
    <title>Data Explorer</title>
    <link rel="stylesheet" href="${styleUri}">
</head>
<body>
    <div id="app"></div>
    <script nonce="${nonce}">
        globalThis.__arkLanguageMonacoSupportModules = ${languageMonacoSupportModules};
        globalThis.__arkLanguageTextMateGrammars = ${languageTextMateGrammars};
    </script>
    <script nonce="${nonce}">
        const vscode = globalThis.__arkVsCodeApi ?? acquireVsCodeApi();
        globalThis.__arkVsCodeApi = vscode;
        window.addEventListener('error', (event) => {
            vscode.postMessage({
                type: 'dataExplorerWebviewError',
                message: event.message,
                source: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error?.stack,
            });
        });
        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            vscode.postMessage({
                type: 'dataExplorerWebviewError',
                message: reason?.message ?? String(reason),
                stack: reason?.stack,
            });
        });
    </script>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private _getWebviewLocalResourceRoots(): vscode.Uri[] {
        const uniqueRoots = new Map<string, vscode.Uri>();

        for (const root of [this._extensionUri, ...this._getAdditionalLocalResourceRoots()]) {
            uniqueRoots.set(root.toString(), root);
        }

        return Array.from(uniqueRoots.values());
    }

    private _serializeInlineScriptData(value: unknown): string {
        return JSON.stringify(value).replace(/</g, '\\u003c');
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    dispose(): void {
        this._isDisposing = true;

        // Dispose all panels
        for (const panel of this._panels.values()) {
            panel.dispose();
        }
        this._panels.clear();
        this._lastRequests.clear();
        this._newWindowState.clear();
        this._uiState.clear();
        this._skipInstanceCloseOnNextPanelDispose.clear();
        this._resetContexts();
        this._disposables.forEach(d => d.dispose());
    }
}
