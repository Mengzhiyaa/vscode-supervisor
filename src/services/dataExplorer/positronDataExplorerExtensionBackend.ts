import * as vscode from 'vscode';
import {
    ArraySelection,
    BackendState,
    CodeSyntaxName,
    ColumnFilter,
    ColumnProfileRequest,
    ColumnSelection,
    ColumnSortKey,
    ConvertedCode,
    DataExplorerBackendRequest,
    DatasetImportOptions,
    ExportedData,
    ExportFormat,
    FilterResult,
    FormatOptions,
    IDataExplorerComm,
    ReturnColumnProfilesEvent,
    RowFilter,
    SchemaUpdateEvent,
    SearchSchemaResult,
    SearchSchemaSortOrder,
    SetDatasetImportOptionsResult,
    TableData,
    TableRowLabels,
    TableSchema,
    TableSelection,
} from '../../runtime/comms/positronDataExplorerComm';

export interface DataExplorerRpcRequest {
    readonly method: string;
    readonly uri: string;
    readonly params: Readonly<Record<string, unknown>>;
}

export interface DataExplorerBackendEvent {
    readonly method: 'schema_update' | 'data_update' | 'return_column_profiles' | 'close';
    readonly uri: string;
    readonly params?: unknown;
}

export interface DataExplorerBackendTransport extends vscode.Disposable {
    /** Stable provider-scoped dataset identity. Defaults to the requested URI. */
    readonly datasetId?: string;
    /** Stable client identity. Defaults to provider ID plus dataset identity. */
    readonly clientId?: string;
    readonly onDidEmitEvent?: vscode.Event<DataExplorerBackendEvent>;
    handleRpc(request: DataExplorerRpcRequest): Promise<unknown>;
}

export interface DataExplorerRpcError {
    readonly code?: string | number;
    readonly message: string;
    readonly data?: unknown;
}

export interface DataExplorerRpcResponse<T> {
    readonly result?: T;
    readonly error?: DataExplorerRpcError;
    readonly error_message?: string;
}

export interface DataExplorerBackendProvider {
    readonly id: string;
    canHandle(uri: vscode.Uri): boolean | Promise<boolean>;
    open(uri: vscode.Uri): Promise<DataExplorerBackendTransport>;
}

/** Positron-style typed Data Explorer client over an extension-owned RPC transport. */
export class PositronDataExplorerExtensionBackend implements IDataExplorerComm {
    private readonly _onDidSchemaUpdate = new vscode.EventEmitter<SchemaUpdateEvent>();
    private readonly _onDidDataUpdate = new vscode.EventEmitter<Record<string, never>>();
    private readonly _onDidReturnColumnProfiles = new vscode.EventEmitter<ReturnColumnProfilesEvent>();
    private readonly _onDidClose = new vscode.EventEmitter<void>();
    private readonly _disposables: vscode.Disposable[];
    private _disposed = false;

    readonly onDidSchemaUpdate = this._onDidSchemaUpdate.event;
    readonly onDidDataUpdate = this._onDidDataUpdate.event;
    readonly onDidReturnColumnProfiles = this._onDidReturnColumnProfiles.event;
    readonly onDidClose = this._onDidClose.event;

    constructor(
        readonly providerId: string,
        readonly datasetUri: string,
        private readonly _transport: DataExplorerBackendTransport,
        readonly datasetId: string = datasetUri,
        readonly clientId: string = `${providerId}:${datasetId}`,
    ) {
        this._disposables = [
            this._onDidSchemaUpdate,
            this._onDidDataUpdate,
            this._onDidReturnColumnProfiles,
            this._onDidClose,
        ];
        if (_transport.onDidEmitEvent) {
            this._disposables.push(_transport.onDidEmitEvent(event => this._handleEvent(event)));
        }
    }

    getState(): Promise<BackendState> { return this._rpc(DataExplorerBackendRequest.GetState, {}); }
    getSchema(columnIndices: number[]): Promise<TableSchema> {
        return this._rpc(DataExplorerBackendRequest.GetSchema, { column_indices: columnIndices });
    }
    searchSchema(filters: ColumnFilter[], sortOrder: SearchSchemaSortOrder): Promise<SearchSchemaResult> {
        return this._rpc(DataExplorerBackendRequest.SearchSchema, { filters, sort_order: sortOrder });
    }
    getDataValues(columns: ColumnSelection[], formatOptions: FormatOptions): Promise<TableData> {
        return this._rpc(DataExplorerBackendRequest.GetDataValues, { columns, format_options: formatOptions });
    }
    getRowLabels(selection: ArraySelection, formatOptions: FormatOptions): Promise<TableRowLabels> {
        return this._rpc(DataExplorerBackendRequest.GetRowLabels, { selection, format_options: formatOptions });
    }
    exportDataSelection(selection: TableSelection, format: ExportFormat): Promise<ExportedData> {
        return this._rpc(DataExplorerBackendRequest.ExportDataSelection, { selection, format });
    }
    convertToCode(
        columnFilters: ColumnFilter[],
        rowFilters: RowFilter[],
        sortKeys: ColumnSortKey[],
        codeSyntaxName: CodeSyntaxName,
    ): Promise<ConvertedCode> {
        return this._rpc(DataExplorerBackendRequest.ConvertToCode, {
            column_filters: columnFilters,
            row_filters: rowFilters,
            sort_keys: sortKeys,
            code_syntax: codeSyntaxName,
        });
    }
    suggestCodeSyntax(): Promise<CodeSyntaxName | undefined> {
        return this._rpc(DataExplorerBackendRequest.SuggestCodeSyntax, {});
    }
    openDataExplorer(): Promise<void> {
        return this._rpc(DataExplorerBackendRequest.OpenDataExplorer, {});
    }
    setColumnFilters(filters: ColumnFilter[]): Promise<void> {
        return this._rpc(DataExplorerBackendRequest.SetColumnFilters, { filters });
    }
    setRowFilters(filters: RowFilter[]): Promise<FilterResult> {
        return this._rpc(DataExplorerBackendRequest.SetRowFilters, { filters });
    }
    setSortColumns(sortKeys: ColumnSortKey[]): Promise<void> {
        return this._rpc(DataExplorerBackendRequest.SetSortColumns, { sort_keys: sortKeys });
    }
    getColumnProfiles(
        callbackId: string,
        profiles: ColumnProfileRequest[],
        formatOptions: FormatOptions,
    ): Promise<void> {
        return this._rpc(DataExplorerBackendRequest.GetColumnProfiles, {
            callback_id: callbackId,
            profiles,
            format_options: formatOptions,
        });
    }
    setDatasetImportOptions(options: DatasetImportOptions): Promise<SetDatasetImportOptionsResult> {
        return this._rpc(DataExplorerBackendRequest.SetDatasetImportOptions, { ...options });
    }

    closeClient(): void { this.dispose(); }

    dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._onDidClose.fire();
        this._transport.dispose();
        this._disposables.forEach(disposable => disposable.dispose());
    }

    private async _rpc<T>(method: DataExplorerBackendRequest, params: Record<string, unknown>): Promise<T> {
        if (this._disposed) {
            throw new Error(`Data Explorer backend '${this.clientId}' is closed.`);
        }
        const response = await this._transport.handleRpc({
            method,
            uri: this.datasetUri,
            params,
        });
        if (response && typeof response === 'object') {
            const envelope = response as DataExplorerRpcResponse<T>;
            if (envelope.error) {
                const code = envelope.error.code === undefined ? '' : ` (${envelope.error.code})`;
                throw new Error(
                    `Data Explorer backend '${this.providerId}' RPC '${method}' failed${code}: ` +
                    envelope.error.message,
                );
            }
            if (envelope.error_message) {
                throw new Error(
                    `Data Explorer backend '${this.providerId}' RPC '${method}' failed: ` +
                    envelope.error_message,
                );
            }
            if (Object.prototype.hasOwnProperty.call(envelope, 'result')) {
                return envelope.result as T;
            }
        }
        return response as T;
    }

    private _handleEvent(event: DataExplorerBackendEvent): void {
        if (event.uri !== this.datasetUri) {
            return;
        }
        switch (event.method) {
            case 'schema_update': this._onDidSchemaUpdate.fire({}); break;
            case 'data_update': this._onDidDataUpdate.fire({}); break;
            case 'return_column_profiles':
                this._onDidReturnColumnProfiles.fire(event.params as ReturnColumnProfilesEvent);
                break;
            case 'close': this.dispose(); break;
        }
    }
}

export class DataExplorerBackendRegistry implements vscode.Disposable {
    private readonly _providers = new Map<string, DataExplorerBackendProvider>();

    registerProvider(provider: DataExplorerBackendProvider): vscode.Disposable {
        if (this._providers.has(provider.id)) {
            throw new Error(`Data Explorer backend provider '${provider.id}' is already registered.`);
        }
        this._providers.set(provider.id, provider);
        return new vscode.Disposable(() => {
            if (this._providers.get(provider.id) === provider) {
                this._providers.delete(provider.id);
            }
        });
    }

    async open(uri: vscode.Uri, providerId?: string): Promise<PositronDataExplorerExtensionBackend> {
        const candidates = providerId
            ? [this._providers.get(providerId)].filter((provider): provider is DataExplorerBackendProvider => !!provider)
            : [...this._providers.values()];
        for (const provider of candidates) {
            if (await provider.canHandle(uri)) {
                const transport = await provider.open(uri);
                const datasetId = transport.datasetId ?? uri.toString();
                const clientId = transport.clientId ?? `${provider.id}:${datasetId}`;
                return new PositronDataExplorerExtensionBackend(
                    provider.id,
                    uri.toString(),
                    transport,
                    datasetId,
                    clientId,
                );
            }
        }
        throw new Error(providerId
            ? `Data Explorer backend provider '${providerId}' cannot open '${uri.toString()}'.`
            : `No Data Explorer backend provider can open '${uri.toString()}'.`);
    }

    dispose(): void { this._providers.clear(); }
}
