/*---------------------------------------------------------------------------------------------
 *  Data Explorer Editor Provider
 *  Opens Data Explorer in the editor area as a WebviewPanel (like a tab)
 *  Uses JSON-RPC MessageConnection for webview communication (same pattern as console/plots)
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CoreCommandIds } from '../../coreCommandIds';
import { createMessageConnection, MessageConnection } from 'vscode-jsonrpc/node';
import { WebviewMessageReader, WebviewMessageWriter } from '../../rpc/webview/transport';
import {
    type IPositronDataExplorerInstance,
    type IPositronDataExplorerService,
} from './positronDataExplorerService';
import {
    createDataExplorerEditorUri,
    getDataExplorerBackingUri,
    isPlaintextDataExplorerIdentifier,
    isSpreadsheetDataExplorerIdentifier,
    supportsDataExplorerFileOptions,
} from './dataExplorerUri';
import { PositronDataExplorerCommandId } from './positronDataExplorerActions';
import {
    DataExplorerWebviewBridge,
    type DataExplorerLayoutState,
} from './dataExplorerWebviewBridge';
import {
    DATA_EXPLORER_CODE_SYNTAXES_AVAILABLE_CONTEXT,
    DATA_EXPLORER_COLUMN_SORTING_CONTEXT,
    DATA_EXPLORER_CONVERT_TO_CODE_ENABLED_CONTEXT,
    DATA_EXPLORER_EDITOR_CONTEXT,
    DATA_EXPLORER_FOCUSED_CONTEXT,
    DATA_EXPLORER_IN_NEW_WINDOW_CONTEXT,
    DATA_EXPLORER_IS_PLAINTEXT_CONTEXT,
    DATA_EXPLORER_IS_XLSX_CONTEXT,
    DATA_EXPLORER_LAYOUT_CONTEXT,
    DATA_EXPLORER_ROW_FILTERING_CONTEXT,
    DATA_EXPLORER_SUMMARY_COLLAPSED_CONTEXT,
} from './positronDataExplorerContextKeys';
import { SupportStatus } from '../../runtime/comms/positronDataExplorerComm';
import {
    DataExplorerCopyNotification,
    DataExplorerFocusNotification,
    DataExplorerClearSortNotification,
    DataExplorerCopyTableDataNotification,
    DataExplorerMoveToNewWindowNotification,
    DataExplorerConvertToCodeNotification,
    DataExplorerOpenAsPlaintextNotification,
    DataExplorerToggleFileOptionsNotification,
    DataExplorerShowColumnContextMenuNotification,
    DataExplorerShowRowContextMenuNotification,
    DataExplorerShowCellContextMenuNotification,
} from '../../rpc/webview/dataExplorer';
import {
    createSurfaceModelId,
    SurfaceKind,
    SurfaceLifecycleService,
    SurfaceModelKind,
} from '../surfaces/surfaceLifecycleService';
import { serializeWebviewLocalizationMessages } from '../../webview/webviewLocalization';
import { DataExplorerPreviewEnabled } from './positronDataExplorerSummary';

const DATA_EXPLORER_EDITOR_NAME_MAX_LENGTH = 30;

export function escapeDataExplorerHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => {
        switch (character) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case '\'': return '&#39;';
            default: return character;
        }
    });
}

export function formatDataExplorerEditorTitle(displayName: string | undefined): string {
    const fallbackName = vscode.l10n.t('Data Explorer');
    if (!displayName) {
        return fallbackName;
    }
    const truncatedName = displayName.length > DATA_EXPLORER_EDITOR_NAME_MAX_LENGTH
        ? `${displayName.slice(0, DATA_EXPLORER_EDITOR_NAME_MAX_LENGTH - 3)}...`
        : displayName;
    return vscode.l10n.t('Data: {0}', truncatedName);
}

/**
 * Manages Data Explorer panels in the editor area
 */
export class PositronDataExplorerEditorProvider implements vscode.Disposable {
    public static readonly viewType = 'positron.dataExplorerEditor';

    private readonly _panels = new Map<string, vscode.WebviewPanel>();
    private readonly _connections = new Map<string, MessageConnection>();
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _instancesInNewWindow = new Set<string>();
    private readonly _skipInstanceCloseOnNextPanelDispose = new Set<string>();
    private readonly _instanceFocusDisposables = new Map<string, vscode.Disposable>();
    /** Instance IDs being opened by an external panel provider (e.g. Custom Editor). */
    private readonly _externalPanelInstances = new Set<string>();
    private readonly _openingInstances = new Set<string>();
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
        private readonly _surfaceLifecycle?: SurfaceLifecycleService,
    ) {
        this._resetContexts();

        // Listen for new instances and open them in editor
        this._disposables.push(
            this._dataExplorerService.onDidCreateInstance(instance => {
                this._instanceFocusDisposables.get(instance.identifier)?.dispose();
                this._instanceFocusDisposables.set(
                    instance.identifier,
                    instance.onDidRequestFocus(() => {
                        this.openInstance(instance, true);
                        setTimeout(() => {
                            this._connections.get(instance.identifier)?.sendNotification(
                                DataExplorerFocusNotification.type,
                            );
                        }, 0);
                    }),
                );
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
                this._instanceFocusDisposables.get(instanceId)?.dispose();
                this._instanceFocusDisposables.delete(instanceId);
                this._instancesInNewWindow.delete(instanceId);
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
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerOpenInline, (identifier?: string) => {
                if (!identifier) {
                    return;
                }
                const instance = this._dataExplorerService.getInstance(identifier);
                if (instance) {
                    this.openInstance(instance, true);
                }
            }),
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
            vscode.commands.registerCommand(PositronDataExplorerCommandId.OpenAsSpreadsheet, async () => {
                const active = this._getActiveDataExplorer();
                const instance = active
                    ? this._dataExplorerService.getInstance(active.identifier)
                    : undefined;
                if (!instance) {
                    vscode.window.showWarningMessage('No active Data Explorer editor.');
                    return;
                }
                try {
                    await this._openAsSpreadsheet(instance);
                } catch (error) {
                    vscode.window.showErrorMessage(String(error));
                }
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.ToggleFileOptions, async () => {
                await this._showFileOptionsForActive();
            })
        );
        this._disposables.push(
            vscode.commands.registerCommand(PositronDataExplorerCommandId.SelectWorksheet, async () => {
                await this._selectWorksheetForActive();
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

    private _isInstanceActive(instanceId: string): boolean {
        return this._panels.get(instanceId)?.active ?? false;
    }

    private _isInstanceInNewWindow(instanceId: string): boolean {
        return this._instancesInNewWindow.has(instanceId);
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
            !supportsDataExplorerFileOptions(active.instance.identifier)
        ) {
            vscode.window.showErrorMessage('File options are not supported by this dataset.');
            return;
        }

        active.connection.sendNotification(DataExplorerToggleFileOptionsNotification.type, {
            hasHeaderRow: active.instance.fileHasHeaderRow,
            supportsFileOptions: active.instance.supportsFileOptions,
            availableSheets: [...active.instance.fileAvailableSheets],
            selectedSheet: active.instance.fileSelectedSheet,
        });
    }

    private async _selectWorksheetForActive(): Promise<void> {
        const active = this._getActiveExplorerContext();
        if (!active) {
            vscode.window.showWarningMessage(vscode.l10n.t('No active Data Explorer editor.'));
            return;
        }

        const worksheets = active.instance.fileAvailableSheets;
        if (!isSpreadsheetDataExplorerIdentifier(active.identifier) || worksheets.length === 0) {
            vscode.window.showWarningMessage(
                vscode.l10n.t('This dataset does not provide selectable worksheets.'),
            );
            return;
        }

        const selected = await vscode.window.showQuickPick(
            worksheets.map(label => ({
                label,
                picked: label === active.instance.fileSelectedSheet,
            })),
            {
                placeHolder: vscode.l10n.t('Select a worksheet'),
                title: vscode.l10n.t('Data Explorer Worksheet'),
            },
        );
        if (!selected || selected.label === active.instance.fileSelectedSheet) {
            return;
        }

        try {
            await active.instance.runWithForegroundLoading(async () => {
                const result = await active.instance.setDatasetImportOptions({
                    has_header_row: active.instance.fileHasHeaderRow,
                    sheet_name: selected.label,
                });
                if (result.error_message) {
                    throw new Error(result.error_message);
                }
                await active.instance.clientInstance.updateBackendState();
            });
        } catch (error) {
            vscode.window.showErrorMessage(
                vscode.l10n.t('Failed to select worksheet: {0}', String(error)),
            );
        }
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

    private async _openAsSpreadsheet(instance: IPositronDataExplorerInstance): Promise<void> {
        const backingUri = getDataExplorerBackingUri(instance.identifier);
        if (!backingUri || !isSpreadsheetDataExplorerIdentifier(instance.identifier)) {
            throw new Error('This Data Explorer is not backed by an Excel workbook.');
        }
        if (!await vscode.env.openExternal(backingUri)) {
            throw new Error(`The operating system could not open ${backingUri.fsPath}.`);
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
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_IS_XLSX_CONTEXT, false);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_SUMMARY_COLLAPSED_CONTEXT, false);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_FOCUSED_CONTEXT, false);
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_IN_NEW_WINDOW_CONTEXT, false);
    }

    private _updateContextsForInstance(instance: IPositronDataExplorerInstance): void {
        const backendState = instance.backendState;
        const uiState = instance.uiState;
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
        void vscode.commands.executeCommand(
            'setContext',
            DATA_EXPLORER_IS_XLSX_CONTEXT,
            isSpreadsheetDataExplorerIdentifier(instance.identifier),
        );
        void vscode.commands.executeCommand('setContext', DATA_EXPLORER_SUMMARY_COLLAPSED_CONTEXT, uiState.summaryCollapsed);
        void vscode.commands.executeCommand(
            'setContext',
            DATA_EXPLORER_FOCUSED_CONTEXT,
            instance.focused,
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
            this._resetContexts();
            return;
        }

        const instance = this._dataExplorerService.getInstance(active.identifier);
        if (!instance) {
            this._resetContexts();
            return;
        }

        this._updateContextsForInstance(instance);
    }

    private async _setLayoutForActive(layout: DataExplorerLayoutState): Promise<void> {
        const active = this._getActiveDataExplorer();
        if (!active) {
            vscode.window.showWarningMessage('No active Data Explorer editor.');
            return;
        }

        this._dataExplorerService.getInstance(active.identifier)?.setLayout(layout);
        this._syncActiveContexts();
    }

    private async _setSummaryCollapsedForActive(collapsed: boolean): Promise<void> {
        const active = this._getActiveDataExplorer();
        if (!active) {
            vscode.window.showWarningMessage('No active Data Explorer editor.');
            return;
        }

        this._dataExplorerService.getInstance(active.identifier)?.setSummaryCollapsed(collapsed);
        this._syncActiveContexts();
    }

    /**
     * Opens a Data Explorer instance in the editor area
     */
    public openInstance(instance: IPositronDataExplorerInstance, allowInline: boolean = false): void {
        if (instance.inlineOnly && !allowInline) {
            return;
        }

        // Check if panel already exists
        const existingPanel = this._panels.get(instance.identifier);
        if (existingPanel) {
            existingPanel.reveal();
            return;
        }
        if (this._openingInstances.has(instance.identifier)) {
            return;
        }

        // Route through the custom editor so VS Code owns preview/pinned tab
        // semantics. Direct createWebviewPanel calls can only create pinned tabs.
        const preview = DataExplorerPreviewEnabled();
        const resource = createDataExplorerEditorUri(instance.identifier);
        this._openingInstances.add(instance.identifier);
        void vscode.commands.executeCommand(
            'vscode.openWith',
            resource,
            PositronDataExplorerEditorProvider.viewType,
            { preview, preserveFocus: false, viewColumn: vscode.ViewColumn.Active },
        ).then(
            () => this._openingInstances.delete(instance.identifier),
            error => {
                this._openingInstances.delete(instance.identifier);
                this._logChannel.error(`[DataExplorerEditor] Failed to open ${instance.identifier}: ${error}`);
            },
        );
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
     * Installs a script-free shell while a file-backed Data Explorer is created.
     * DuckDB runs in a Node worker in the extension host; this page deliberately
     * does not relax the Webview CSP or start a browser worker.
     */
    public showLoading(panel: vscode.WebviewPanel, displayName: string): void {
        panel.iconPath = new vscode.ThemeIcon('table');
        panel.title = formatDataExplorerEditorTitle(displayName);
        panel.webview.html = this._getStatusHtml(
            vscode.l10n.t('Loading Data Explorer'),
            vscode.l10n.t('Opening {0}…', displayName),
        );
    }

    public showError(panel: vscode.WebviewPanel, error: unknown): void {
        panel.webview.html = this._getStatusHtml(
            vscode.l10n.t('Failed to open in Data Explorer'),
            String(error),
            true,
        );
    }

    /**
     * Attaches a Data Explorer instance to an existing WebviewPanel.
     * Used by both openInstance() (self-created panels) and
     * PositronDataExplorerCustomEditorProvider (VS Code-created panels from "Reopen With").
     */
    public attachToPanel(instance: IPositronDataExplorerInstance, panel: vscode.WebviewPanel): void {
        this._openingInstances.delete(instance.identifier);
        const panelDisposables: vscode.Disposable[] = [];
        const disposePanelListeners = () => {
            while (panelDisposables.length) {
                panelDisposables.pop()?.dispose();
            }
        };

        // Set icon
        panel.iconPath = new vscode.ThemeIcon('table');
        panel.title = formatDataExplorerEditorTitle(instance.displayName);

        // Store panel
        this._panels.set(instance.identifier, panel);

        const modelId = createSurfaceModelId(SurfaceModelKind.DataExplorer, instance.identifier);
        let surfaceAttachment: vscode.Disposable | undefined;
        let visibilityLease: vscode.Disposable | undefined;
        const updateVisibility = (visible: boolean) => {
            if (visible && !visibilityLease) {
                visibilityLease = instance.acquireVisibility(
                    `data-explorer-editor:${instance.identifier}`,
                );
            } else if (!visible && visibilityLease) {
                visibilityLease.dispose();
                visibilityLease = undefined;
            }
        };
        updateVisibility(panel.visible);
        const attachSurfaceModel = () => {
            if (surfaceAttachment || !this._surfaceLifecycle?.getModel(modelId)) {
                return false;
            }
            surfaceAttachment = this._surfaceLifecycle.attach(modelId, {
                surfaceId: `data-explorer-editor:${instance.identifier}`,
                kind: SurfaceKind.DataExplorerEditor,
                ownerId: 'data-explorer-editor-provider',
                metadata: { identifier: instance.identifier },
            });
            return true;
        };
        if (!attachSurfaceModel() && this._surfaceLifecycle) {
            // The editor provider subscribes to instance creation before the
            // lifecycle coordinator is initialized. Wait for the matching
            // model so the first panel cannot miss its attachment lease.
            let modelRegistrationListener: vscode.Disposable | undefined;
            modelRegistrationListener = this._surfaceLifecycle.onDidChange(event => {
                if (event.model.id === modelId && attachSurfaceModel()) {
                    modelRegistrationListener?.dispose();
                }
            });
            panelDisposables.push(new vscode.Disposable(() => modelRegistrationListener?.dispose()));
        }

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
            isInstanceActive: () => this._isInstanceActive(instance.identifier),
            isInstanceInNewWindow: () =>
                this._isInstanceInNewWindow(instance.identifier),
            onSyncActiveContexts: () => {
                this._syncActiveContexts();
            },
            onMoveToNewWindow: async () => {
                await this._moveInstanceToNewWindow(instance, bridge);
            },
            openAsPlaintext: async () => {
                await this._openAsPlaintext(instance);
            },
            openAsSpreadsheet: async () => {
                await this._openAsSpreadsheet(instance);
            },
        });
        bridge.setSurfaceVisible(panel.visible);
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

            surfaceAttachment?.dispose();
            visibilityLease?.dispose();
            visibilityLease = undefined;
            bridge.dispose();
            disposePanelListeners();
            connection.dispose();
            this._connections.delete(instance.identifier);
            this._panels.delete(instance.identifier);
            this._instancesInNewWindow.delete(instance.identifier);

            if (!shouldKeepInstanceOpen) {
                const model = this._surfaceLifecycle?.getModel(modelId);
                if (model && model.attachments.length === 0) {
                    this._surfaceLifecycle!.disposeModel(modelId, 'data-explorer-surface-closed');
                } else if (model) {
                    this._logChannel.debug(
                        `[DataExplorer] Kept backend ${instance.identifier}; ` +
                        `${model.attachments.length} other surface attachment(s) remain.`,
                    );
                } else {
                    // Preserve legacy behavior when no lifecycle registry is supplied.
                    this._dataExplorerService.getInstance(instance.identifier)?.dispose();
                }
            }

            this._syncActiveContexts();
        });

        panel.onDidChangeViewState(event => {
            updateVisibility(event.webviewPanel.visible);
            bridge.setSurfaceVisible(event.webviewPanel.visible);
            if (event.webviewPanel.active) {
                this._syncActiveContexts();
            } else if (!this._getActiveDataExplorer()) {
                this._syncActiveContexts();
            }
        });

        // Update title when backend state changes
        panelDisposables.push(instance.onDidUpdateBackendState(state => {
            panel.title = formatDataExplorerEditorTitle(state.display_name);
            bridge.sendBackendStateUpdate();
            if (panel.active) {
                this._updateContextsForInstance(instance);
            }
        }));

        this._logChannel.info(`[DataExplorerEditor] Opened panel for ${instance.identifier}`);
        this._syncActiveContexts();
    }

    private async _moveInstanceToNewWindow(
        instance: IPositronDataExplorerInstance,
        bridge: DataExplorerWebviewBridge,
    ): Promise<void> {
        this._skipInstanceCloseOnNextPanelDispose.add(instance.identifier);
        try {
            await vscode.commands.executeCommand(
                'workbench.action.moveEditorToNewWindow',
            );
            this._instancesInNewWindow.add(instance.identifier);
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
        const monacoStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this._extensionUri,
            'webview',
            'dist',
            'setup',
            'index.css',
        ));
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
    <link rel="stylesheet" href="${monacoStyleUri}">
    <link rel="stylesheet" href="${styleUri}">
</head>
<body>
    <div id="app"></div>
    <script nonce="${nonce}">
        globalThis.__arkLanguageMonacoSupportModules = ${languageMonacoSupportModules};
        globalThis.__arkLanguageTextMateGrammars = ${languageTextMateGrammars};
        globalThis.__arkLocalization = ${serializeWebviewLocalizationMessages()};
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

    private _getStatusHtml(title: string, message: string, isError = false): string {
        const nonce = this._getNonce();
        const escapedTitle = escapeDataExplorerHtml(title);
        const escapedMessage = escapeDataExplorerHtml(message);
        const role = isError ? 'alert' : 'status';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
    <title>${escapedTitle}</title>
    <style nonce="${nonce}">
        body {
            display: grid;
            height: 100vh;
            margin: 0;
            place-items: center;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            font-family: var(--vscode-font-family);
        }
        main { max-width: 560px; padding: 24px; text-align: center; }
        h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
        p { margin: 0; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
    </style>
</head>
<body>
    <main role="${role}">
        <h2>${escapedTitle}</h2>
        <p>${escapedMessage}</p>
    </main>
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
        this._instancesInNewWindow.clear();
        this._instanceFocusDisposables.forEach(disposable => disposable.dispose());
        this._instanceFocusDisposables.clear();
        this._skipInstanceCloseOnNextPanelDispose.clear();
        this._resetContexts();
        this._disposables.forEach(d => d.dispose());
    }
}
