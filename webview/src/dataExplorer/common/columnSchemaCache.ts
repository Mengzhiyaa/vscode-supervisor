/*---------------------------------------------------------------------------------------------
 *  Column schema cache - aligned with Positron's ColumnSchemaCache
 *--------------------------------------------------------------------------------------------*/

import type { SchemaColumn } from '../../dataGrid/types';
import type { DataExplorerSchemaClient } from './dataExplorerSchemaClient';

const TRIM_CACHE_TIMEOUT = 3_000;

export interface ColumnSchemaCacheUpdateDescriptor {
    columnIndices: number[];
    invalidateCache: boolean;
}

type UpdateListener = () => void;

export class ColumnSchemaCache {
    private _updatingCache = false;
    private _pendingCacheUpdateDescriptor:
        | ColumnSchemaCacheUpdateDescriptor
        | undefined;
    private _trimCacheHandle: ReturnType<typeof setTimeout> | undefined;
    private readonly _columnSchemaCache = new Map<number, SchemaColumn>();
    private readonly _listeners = new Set<UpdateListener>();
    private _disposed = false;

    constructor(private readonly _schemaClient: DataExplorerSchemaClient) {}

    readonly onDidUpdateCache = (listener: UpdateListener) => {
        this._listeners.add(listener);
        return {
            dispose: () => {
                this._listeners.delete(listener);
            },
        };
    };

    async update(
        cacheUpdateDescriptor: ColumnSchemaCacheUpdateDescriptor,
    ): Promise<void> {
        this._clearTrimCacheTimeout();
        if (
            cacheUpdateDescriptor.columnIndices.length === 0 &&
            !cacheUpdateDescriptor.invalidateCache
        ) {
            return;
        }

        if (this._updatingCache) {
            this._pendingCacheUpdateDescriptor = cacheUpdateDescriptor;
            return;
        }

        this._updatingCache = true;
        try {
            const visibleIndices = [...new Set(cacheUpdateDescriptor.columnIndices)];
            const columnIndices = cacheUpdateDescriptor.invalidateCache
                ? visibleIndices
                : visibleIndices.filter(
                      (columnIndex) =>
                          !this._columnSchemaCache.has(columnIndex),
                  );
            const tableSchema = await this._schemaClient.getSchema(columnIndices);
            if (this._disposed) {
                return;
            }

            if (cacheUpdateDescriptor.invalidateCache) {
                this._columnSchemaCache.clear();
            }
            for (const columnSchema of tableSchema) {
                this._columnSchemaCache.set(
                    columnSchema.column_index,
                    columnSchema,
                );
            }
            this._emitDidUpdateCache();
        } finally {
            this._updatingCache = false;
            if (this._pendingCacheUpdateDescriptor) {
                const pendingCacheUpdateDescriptor =
                    this._pendingCacheUpdateDescriptor;
                this._pendingCacheUpdateDescriptor = undefined;
                await this.update(pendingCacheUpdateDescriptor);
                return;
            }

            if (
                !cacheUpdateDescriptor.invalidateCache &&
                cacheUpdateDescriptor.columnIndices.length > 0
            ) {
                this._trimCacheHandle = setTimeout(() => {
                    this._trimCacheHandle = undefined;
                    this._trimCache(
                        new Set(cacheUpdateDescriptor.columnIndices),
                    );
                }, TRIM_CACHE_TIMEOUT);
            }
        }
    }

    setColumnSchema(columns: SchemaColumn[]): void {
        let didChange = false;
        for (const column of columns) {
            const previous = this._columnSchemaCache.get(column.column_index);
            if (previous !== column) {
                this._columnSchemaCache.set(column.column_index, column);
                didChange = true;
            }
        }
        if (didChange) {
            this._emitDidUpdateCache();
        }
    }

    getColumnSchema(columnIndex: number): SchemaColumn | undefined {
        return this._columnSchemaCache.get(columnIndex);
    }

    getColumnSchemas(columnIndices: Iterable<number>): SchemaColumn[] {
        return [...columnIndices]
            .map((columnIndex) => this._columnSchemaCache.get(columnIndex))
            .filter((column): column is SchemaColumn => Boolean(column));
    }

    clear(): void {
        this._clearTrimCacheTimeout();
        this._pendingCacheUpdateDescriptor = undefined;
        this._columnSchemaCache.clear();
        this._emitDidUpdateCache();
    }

    dispose(): void {
        this._disposed = true;
        this._clearTrimCacheTimeout();
        this._pendingCacheUpdateDescriptor = undefined;
        this._columnSchemaCache.clear();
        this._listeners.clear();
    }

    private _trimCache(columnIndices: Set<number>): void {
        for (const columnIndex of this._columnSchemaCache.keys()) {
            if (!columnIndices.has(columnIndex)) {
                this._columnSchemaCache.delete(columnIndex);
            }
        }
    }

    private _clearTrimCacheTimeout(): void {
        if (this._trimCacheHandle) {
            clearTimeout(this._trimCacheHandle);
            this._trimCacheHandle = undefined;
        }
    }

    private _emitDidUpdateCache(): void {
        for (const listener of this._listeners) {
            listener();
        }
    }
}
