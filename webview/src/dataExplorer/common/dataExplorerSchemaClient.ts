/*---------------------------------------------------------------------------------------------
 *  Data Explorer schema RPC client
 *--------------------------------------------------------------------------------------------*/

import type { SchemaColumn } from '../../dataGrid/types';
import type { SearchSchemaSortOrder, WebviewMessage } from '../types';

interface PendingSchemaRequest<T> {
    readonly resolve: (value: T) => void;
    readonly timeoutHandle: ReturnType<typeof setTimeout>;
}

const SCHEMA_REQUEST_TIMEOUT = 60_000;

/**
 * Adapts Positron's direct DataExplorerClientInstance schema API to the
 * asynchronous VS Code webview transport.
 */
export class DataExplorerSchemaClient {
    private _nextRequestId = 0;
    private readonly _schemaRequests = new Map<
        number,
        PendingSchemaRequest<SchemaColumn[]>
    >();
    private readonly _searchRequests = new Map<
        number,
        PendingSchemaRequest<number[]>
    >();

    constructor(
        private readonly _postMessage: (message: WebviewMessage) => void,
    ) {}

    getSchema(columnIndices: number[]): Promise<SchemaColumn[]> {
        if (columnIndices.length === 0) {
            return Promise.resolve([]);
        }

        const requestId = ++this._nextRequestId;
        const promise = new Promise<SchemaColumn[]>((resolve) => {
            const timeoutHandle = setTimeout(() => {
                this._schemaRequests.delete(requestId);
                resolve([]);
            }, SCHEMA_REQUEST_TIMEOUT);
            this._schemaRequests.set(requestId, { resolve, timeoutHandle });
        });
        this._postMessage({
            type: 'requestSchema',
            columns: columnIndices,
            requestId,
        });
        return promise;
    }

    searchSchema(options: {
        searchText?: string;
        sortOption?: SearchSchemaSortOrder;
        pinnedColumns?: number[];
    }): Promise<number[]> {
        const requestId = ++this._nextRequestId;
        const promise = new Promise<number[]>((resolve) => {
            const timeoutHandle = setTimeout(() => {
                this._searchRequests.delete(requestId);
                resolve([]);
            }, SCHEMA_REQUEST_TIMEOUT);
            this._searchRequests.set(requestId, { resolve, timeoutHandle });
        });
        this._postMessage({
            type: 'searchSchema',
            text: options.searchText ?? '',
            sortOrder: options.sortOption ?? 'original',
            pinnedColumns: options.pinnedColumns,
            requestId,
        });
        return promise;
    }

    handleSchema(params: {
        columns: SchemaColumn[];
        requestId?: number;
    }): void {
        if (params.requestId === undefined) {
            return;
        }
        const pending = this._schemaRequests.get(params.requestId);
        if (!pending) {
            return;
        }
        clearTimeout(pending.timeoutHandle);
        this._schemaRequests.delete(params.requestId);
        pending.resolve(params.columns);
    }

    handleSearchSchema(params: {
        columnIndices: number[];
        requestId?: number;
    }): void {
        if (params.requestId === undefined) {
            return;
        }
        const pending = this._searchRequests.get(params.requestId);
        if (!pending) {
            return;
        }
        clearTimeout(pending.timeoutHandle);
        this._searchRequests.delete(params.requestId);
        pending.resolve(params.columnIndices);
    }

    dispose(): void {
        for (const pending of this._schemaRequests.values()) {
            clearTimeout(pending.timeoutHandle);
            pending.resolve([]);
        }
        for (const pending of this._searchRequests.values()) {
            clearTimeout(pending.timeoutHandle);
            pending.resolve([]);
        }
        this._schemaRequests.clear();
        this._searchRequests.clear();
    }
}
