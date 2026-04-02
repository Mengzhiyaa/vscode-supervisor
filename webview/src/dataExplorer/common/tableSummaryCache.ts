/*---------------------------------------------------------------------------------------------
 *  Table summary cache
 *--------------------------------------------------------------------------------------------*/

import { get } from 'svelte/store';
import type { SchemaColumn } from '../../dataGrid/types';
import type { ColumnProfileViewResult } from '../columnProfileTypes';
import type { DataExplorerStores } from '../stores';
import type { WebviewMessage } from '../types';
import {
    mergeColumnProfiles,
    simplifyColumnProfile,
} from '../profileUtils';

const BASIC_PROFILE_COVERAGE = 1;
const EXPANDED_PROFILE_COVERAGE = 2;
const TRIM_CACHE_TIMEOUT = 3_000;

type ProfileCoverage =
    | typeof BASIC_PROFILE_COVERAGE
    | typeof EXPANDED_PROFILE_COVERAGE;

export class TableSummaryCache {
    private _columns = 0;
    private _rows = 0;
    private _trimCacheHandle: ReturnType<typeof setTimeout> | undefined;
    private readonly _schemaCache = new Map<number, SchemaColumn>();
    private readonly _profiles = new Map<number, ColumnProfileViewResult>();
    private readonly _profileCoverage = new Map<number, ProfileCoverage>();
    private readonly _pendingCoverage = new Map<number, ProfileCoverage>();
    private readonly _pendingRequests = new Map<
        number,
        Map<number, ProfileCoverage>
    >();
    private _nextRequestId = 0;

    constructor(
        private readonly _stores: DataExplorerStores,
        private readonly _postMessage: (message: WebviewMessage) => void,
    ) {}

    get columns(): number {
        return this._columns;
    }

    get rows(): number {
        return this._rows;
    }

    setDimensions(columns: number, rows: number): boolean {
        const changed = this._columns !== columns || this._rows !== rows;
        this._columns = columns;
        this._rows = rows;
        return changed;
    }

    setSchema(columns: SchemaColumn[]): boolean {
        const nextSchema = new Map(
            columns.map((column) => [column.column_index, column]),
        );
        let changed = nextSchema.size !== this._schemaCache.size;

        if (!changed) {
            for (const [columnIndex, column] of nextSchema) {
                const previous = this._schemaCache.get(columnIndex);
                if (
                    !previous ||
                    previous.column_name !== column.column_name ||
                    previous.type_name !== column.type_name ||
                    previous.type_display !== column.type_display ||
                    previous.description !== column.description
                ) {
                    changed = true;
                    break;
                }
            }
        }

        this._schemaCache.clear();
        for (const [columnIndex, column] of nextSchema) {
            this._schemaCache.set(columnIndex, column);
        }
        this.trimToColumns(nextSchema.keys());
        return changed;
    }

    getColumnSchema(columnIndex: number): SchemaColumn | undefined {
        return this._schemaCache.get(columnIndex);
    }

    getSchemaColumns(): SchemaColumn[] {
        return Array.from(this._schemaCache.values()).sort(
            (left, right) => left.column_index - right.column_index,
        );
    }

    clear(): void {
        this._clearTrimCacheTimeout();
        this._columns = 0;
        this._rows = 0;
        this._schemaCache.clear();
        this.invalidateProfiles();
    }

    trimToColumns(columnIndices: Iterable<number>): void {
        const keepColumns = new Set(columnIndices);
        const nextProfiles = new Map(get(this._stores.columnProfiles));
        let didChange = false;

        for (const columnIndex of [...this._schemaCache.keys()]) {
            if (!keepColumns.has(columnIndex)) {
                this._schemaCache.delete(columnIndex);
                didChange = true;
            }
        }

        for (const columnIndex of [...this._profiles.keys()]) {
            if (!keepColumns.has(columnIndex)) {
                this._profiles.delete(columnIndex);
                this._profileCoverage.delete(columnIndex);
                this._pendingCoverage.delete(columnIndex);
                nextProfiles.delete(columnIndex);
                didChange = true;
            }
        }

        for (const [requestId, coverageByColumn] of this._pendingRequests) {
            for (const columnIndex of [...coverageByColumn.keys()]) {
                if (!keepColumns.has(columnIndex)) {
                    coverageByColumn.delete(columnIndex);
                    didChange = true;
                }
            }
            if (coverageByColumn.size === 0) {
                this._pendingRequests.delete(requestId);
            }
        }

        if (didChange) {
            this._stores.columnProfiles.set(nextProfiles);
        }
    }

    getColumnProfile(columnIndex: number): ColumnProfileViewResult | undefined {
        return this._profiles.get(columnIndex);
    }

    invalidateProfiles(columnIndices?: Iterable<number>): void {
        if (!columnIndices) {
            this._clearTrimCacheTimeout();
        }

        if (!columnIndices) {
            this._profiles.clear();
            this._profileCoverage.clear();
            this._pendingCoverage.clear();
            this._pendingRequests.clear();
            this._stores.columnProfiles.set(new Map());
            return;
        }

        const indices = [...columnIndices];
        const nextProfiles = new Map(get(this._stores.columnProfiles));
        for (const columnIndex of indices) {
            this._profiles.delete(columnIndex);
            this._profileCoverage.delete(columnIndex);
            this._pendingCoverage.delete(columnIndex);
            nextProfiles.delete(columnIndex);
        }
        for (const [requestId, coverageByColumn] of this._pendingRequests) {
            for (const columnIndex of indices) {
                coverageByColumn.delete(columnIndex);
            }
            if (coverageByColumn.size === 0) {
                this._pendingRequests.delete(requestId);
            }
        }
        this._stores.columnProfiles.set(nextProfiles);
    }

    scheduleProfileTrim(columnIndices: Iterable<number>): void {
        const keepColumns = [...columnIndices];
        this._clearTrimCacheTimeout();

        if (keepColumns.length === 0) {
            return;
        }

        this._trimCacheHandle = setTimeout(() => {
            this._trimCacheHandle = undefined;
            this._trimProfilesToColumns(new Set(keepColumns));
        }, TRIM_CACHE_TIMEOUT);
    }

    dispose(): void {
        this._clearTrimCacheTimeout();
    }

    handleColumnProfiles(
        profiles: Array<{ columnIndex: number; profile: unknown }>,
        error?: string,
        requestId?: number,
    ): void {
        const nextProfiles = new Map(get(this._stores.columnProfiles));
        const requestCoverage = requestId !== undefined
            ? this._pendingRequests.get(requestId)
            : undefined;
        const affectedColumns = requestCoverage
            ? [...requestCoverage.keys()]
            : profiles.map((entry) => entry.columnIndex);

        for (const entry of profiles) {
            const pendingCoverage =
                requestCoverage?.get(entry.columnIndex) ??
                this._pendingCoverage.get(entry.columnIndex);
            const simplified = simplifyColumnProfile(entry.profile);
            const merged = mergeColumnProfiles(
                nextProfiles.get(entry.columnIndex),
                simplified,
            );

            if (merged) {
                nextProfiles.set(entry.columnIndex, merged);
                this._profiles.set(entry.columnIndex, merged);
            }

            if (!error && pendingCoverage !== undefined) {
                const currentCoverage =
                    this._profileCoverage.get(entry.columnIndex) ?? 0;
                this._profileCoverage.set(
                    entry.columnIndex,
                    Math.max(currentCoverage, pendingCoverage) as ProfileCoverage,
                );
            }
        }

        if (requestId !== undefined) {
            this._pendingRequests.delete(requestId);
        }
        this._recomputePendingCoverage(affectedColumns);

        if (error && requestCoverage) {
            for (const columnIndex of requestCoverage.keys()) {
                if (!nextProfiles.has(columnIndex)) {
                    this._profiles.delete(columnIndex);
                }
            }
        }

        this._stores.columnProfiles.set(nextProfiles);
    }

    requestColumnProfiles(
        columnIndices: number[],
        expandedColumns: Set<number>,
        supportsColumnProfiles: boolean,
    ): void {
        if (!supportsColumnProfiles) {
            return;
        }

        const requestColumnIndices: number[] = [];
        const expandedColumnIndices: number[] = [];
        const requestCoverage = new Map<number, ProfileCoverage>();
        const seen = new Set<number>();

        for (const columnIndex of columnIndices) {
            if (seen.has(columnIndex)) {
                continue;
            }
            seen.add(columnIndex);

            if (!this._schemaCache.has(columnIndex)) {
                continue;
            }

            const requiredCoverage = expandedColumns.has(columnIndex)
                ? EXPANDED_PROFILE_COVERAGE
                : BASIC_PROFILE_COVERAGE;
            const currentCoverage =
                this._profileCoverage.get(columnIndex) ?? 0;
            const pendingCoverage =
                this._pendingCoverage.get(columnIndex) ?? 0;

            if (
                currentCoverage >= requiredCoverage ||
                pendingCoverage >= requiredCoverage
            ) {
                continue;
            }

            requestColumnIndices.push(columnIndex);
            requestCoverage.set(columnIndex, requiredCoverage);
            if (requiredCoverage === EXPANDED_PROFILE_COVERAGE) {
                expandedColumnIndices.push(columnIndex);
            }
        }

        if (requestColumnIndices.length === 0) {
            return;
        }

        const requestId = ++this._nextRequestId;
        this._pendingRequests.set(requestId, requestCoverage);
        for (const [columnIndex, coverage] of requestCoverage) {
            const currentPending = this._pendingCoverage.get(columnIndex) ?? 0;
            this._pendingCoverage.set(
                columnIndex,
                Math.max(currentPending, coverage) as ProfileCoverage,
            );
        }

        this._postMessage({
            type: 'requestColumnProfiles',
            columnIndices: requestColumnIndices,
            expandedColumnIndices,
            requestId,
        });
    }

    private _recomputePendingCoverage(columnIndices: Iterable<number>): void {
        for (const columnIndex of columnIndices) {
            let nextCoverage = 0;
            for (const coverageByColumn of this._pendingRequests.values()) {
                const coverage = coverageByColumn.get(columnIndex) ?? 0;
                if (coverage > nextCoverage) {
                    nextCoverage = coverage;
                }
            }

            if (nextCoverage > 0) {
                this._pendingCoverage.set(
                    columnIndex,
                    nextCoverage as ProfileCoverage,
                );
            } else {
                this._pendingCoverage.delete(columnIndex);
            }
        }
    }

    private _clearTrimCacheTimeout(): void {
        if (this._trimCacheHandle) {
            clearTimeout(this._trimCacheHandle);
            this._trimCacheHandle = undefined;
        }
    }

    private _trimProfilesToColumns(columnIndices: Set<number>): void {
        const nextProfiles = new Map(get(this._stores.columnProfiles));
        let didChange = false;

        for (const columnIndex of [...this._profiles.keys()]) {
            if (columnIndices.has(columnIndex)) {
                continue;
            }

            this._profiles.delete(columnIndex);
            this._profileCoverage.delete(columnIndex);
            this._pendingCoverage.delete(columnIndex);
            nextProfiles.delete(columnIndex);
            didChange = true;
        }

        for (const [requestId, coverageByColumn] of this._pendingRequests) {
            for (const columnIndex of [...coverageByColumn.keys()]) {
                if (!columnIndices.has(columnIndex)) {
                    coverageByColumn.delete(columnIndex);
                    didChange = true;
                }
            }
            if (coverageByColumn.size === 0) {
                this._pendingRequests.delete(requestId);
            }
        }

        if (didChange) {
            this._stores.columnProfiles.set(nextProfiles);
        }
    }
}
