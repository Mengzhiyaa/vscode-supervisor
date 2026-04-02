/*---------------------------------------------------------------------------------------------
 *  Data Explorer Editor Provider
 *  Opens Data Explorer in the editor area as a WebviewPanel (like a tab)
 *  Uses JSON-RPC MessageConnection for webview communication (same pattern as console/plots)
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { createMessageConnection, MessageConnection } from 'vscode-jsonrpc';
import { WebviewMessageReader, WebviewMessageWriter } from '../../rpc/webview/transport';
import {
    type IPositronDataExplorerInstance,
    type IPositronDataExplorerService,
} from './positronDataExplorerService';
import { getDataExplorerBackingUri, isPlaintextDataExplorerIdentifier } from './dataExplorerUri';
import { PositronDataExplorerCommandId } from './positronDataExplorerActions';
import {
    DataExplorerWebviewBridge,
    type DataExplorerLayoutState,
    type DataExplorerUiState,
} from './dataExplorerWebviewBridge';
import {
    DATA_EXPLORER_CODE_SYNTAXES_AVAILABLE_CONTEXT,
    DATA_EXPLORER_COLUMN_SORTING_CONTEXT,
    DATA_EXPLORER_CONVERT_TO_CODE_ENABLED_CONTEXT,
    DATA_EXPLORER_EDITOR_CONTEXT,
    DATA_EXPLORER_FILE_HAS_HEADER_ROW_CONTEXT,
    DATA_EXPLORER_FOCUSED_CONTEXT,
    DATA_EXPLORER_IN_NEW_WINDOW_CONTEXT,
    DATA_EXPLORER_IS_PLAINTEXT_CONTEXT,
    DATA_EXPLORER_LAYOUT_CONTEXT,
    DATA_EXPLORER_ROW_FILTERING_CONTEXT,
    DATA_EXPLORER_SUMMARY_COLLAPSED_CONTEXT,
} from './positronDataExplorerContextKeys';
import { SupportStatus } from '../../runtime/comms/positronDataExplorerComm';
import {
    DataExplorerCopyNotification,
    DataExplorerLayoutChangedNotification,
    DataExplorerSummaryCollapsedChangedNotification,
    DataExplorerClearSortNotification,
    DataExplorerCopyTableDataNotification,
    DataExplorerMoveToNewWindowNotification,
    DataExplorerConvertToCodeNotification,
    DataExplorerOpenAsPlaintextNotification,
    DataExplorerToggleFileOptionsNotification,
    DataExplorerShowColumnContextMenuNotification,
    DataExplorerShowRowContextMenuNotification,
    DataExplorerShowCellContextMenuNotification,
    DataExplorerLoadingNotification,
} from '../../rpc/webview/dataExplorer';

/**
 * Manages Data Explorer panels in the editor area
 */
export class PositronDataExplorerEditorProvider implements vscode.Disposable {
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
        private readonly _dataExplorerService: IPositronDataExplorerService,
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
            vscode.commands.registerCommand(PositronDataExplorerCommandId.Copy, async () => {
                await this._sendToActiveWebview(DataExplorerCopyNotification.type.method);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.CopyTableData, async () => {
                await this._sendToActiveWebview(DataExplorerCopyTableDataNotification.type.method);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.CollapseSummary, async () => {
                await this._setSummaryCollapsedForActive(true);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.ExpandSummary, async () => {
                await this._setSummaryCollapsedForActive(false);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.SummaryOnLeft, async () => {
                await this._setLayoutForActive('SummaryOnLeft');
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.SummaryOnRight, async () => {
                await this._setLayoutForActive('SummaryOnRight');
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.ClearColumnSorting, async () => {
                await this._sendToActiveWebview(DataExplorerClearSortNotification.type.method);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.ConvertToCode, async () => {
                await this._showConvertToCodeForActive();
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.OpenAsPlaintext, async () => {
                await this._sendToActiveWebview(DataExplorerOpenAsPlaintextNotification.type.method);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.ToggleFileOptions, async () => {
                await this._showFileOptionsForActive();
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.MoveToNewWindow, async () => {
                await this._sendToActiveWebview(DataExplorerMoveToNewWindowNotification.type.method);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.ShowColumnContextMenu, async () => {
                await this._sendToActiveWebview(DataExplorerShowColumnContextMenuNotification.type.method);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.ShowRowContextMenu, async () => {
                await this._sendToActiveWebview(DataExplorerShowRowContextMenuNotification.type.method);
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.ShowCellContextMenu, async () => {
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
        instance: IPositronDataExplorerInstance;
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

    private async _openAsPlaintext(instance: IPositronDataExplorerInstance): Promise<void> {
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

    private _updateContextsForInstance(instance: IPositronDataExplorerInstance): void {
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
    public openInstance(instance: IPositronDataExplorerInstance): void {
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
            PositronDataExplorerEditorProvider.viewType,
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
    public attachToPanel(instance: IPositronDataExplorerInstance, panel: vscode.WebviewPanel): void {
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
        const bridge = new DataExplorerWebviewBridge({
            connection,
            panel,
            instance,
            logChannel: this._logChannel,
            getUiState: () => this._ensureUiState(instance.identifier),
            isInstanceActive: () => this._isInstanceActive(instance.identifier),
            isInstanceInNewWindow: () =>
                this._isInstanceInNewWindow(instance.identifier),
            getLastRequest: () => this._lastRequests.get(instance.identifier),
            setLastRequest: (request) => {
                this._lastRequests.set(instance.identifier, request);
            },
            runWithForegroundLoading: (task) =>
                this._runWithForegroundLoading(instance.identifier, task),
            onFocusChanged: (focused) => {
                this._updateFocusedState(instance.identifier, focused);
            },
            onSetLayout: (layout) =>
                this._updateUiState(instance.identifier, { layout }),
            onSetSummaryCollapsed: (summaryCollapsed) =>
                this._updateUiState(instance.identifier, { summaryCollapsed }),
            onSyncActiveContexts: () => {
                this._syncActiveContexts();
            },
            onMoveToNewWindow: async () => {
                await this._moveInstanceToNewWindow(instance, panel, bridge);
            },
            openAsPlaintext: async () => {
                await this._openAsPlaintext(instance);
            },
        });

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
        bridge.registerNotificationHandlers();

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
                bridge.sendBackendStateUpdate();
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
            bridge.sendBackendStateUpdate();
            if (panel.active) {
                this._updateContextsForInstance(instance);
            }
        }));

        // Forward backend-driven schema/data updates
        panelDisposables.push(
            instance.clientInstance.onDidSchemaUpdate(async () => {
                try {
                    await this._runWithForegroundLoading(instance.identifier, async () => {
                        await bridge.sendDataFromLastRequest();
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
                        await bridge.sendDataFromLastRequest();
                    });
                } catch (error) {
                    this._logChannel.error(`[DataExplorerEditor] Data refresh failed: ${error}`);
                }
            })
        );

        this._logChannel.info(`[DataExplorerEditor] Opened panel for ${instance.identifier}`);
        this._syncActiveContexts();
    }

    private async _moveInstanceToNewWindow(
        instance: IPositronDataExplorerInstance,
        panel: vscode.WebviewPanel,
        bridge: DataExplorerWebviewBridge,
    ): Promise<void> {
        this._skipInstanceCloseOnNextPanelDispose.add(instance.identifier);
        try {
            await vscode.commands.executeCommand(
                'workbench.action.moveEditorToNewWindow',
            );
            this._newWindowState.set(instance.identifier, panel.viewColumn);
            bridge.sendBackendStateUpdate();
            this._syncActiveContexts();
            setTimeout(() => {
                if (this._panels.has(instance.identifier)) {
                    this._skipInstanceCloseOnNextPanelDispose.delete(
                        instance.identifier,
                    );
                }
            }, 1000);
        } catch (error) {
            this._skipInstanceCloseOnNextPanelDispose.delete(instance.identifier);
            throw error;
        }
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
