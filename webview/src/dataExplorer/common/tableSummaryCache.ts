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
const PROFILE_CHUNK_SIZE = 8;
const TRIM_CACHE_TIMEOUT = 3_000;

type ProfileCoverage =
    | typeof BASIC_PROFILE_COVERAGE
    | typeof EXPANDED_PROFILE_COVERAGE;

interface ProfileRequestChunk {
    readonly columnIndices: number[];
    readonly expandedColumnIndices: number[];
    readonly coverage: Map<number, ProfileCoverage>;
}

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
    private readonly _pendingRequestGenerations = new Map<number, number>();
    private _profileRequestQueue: ProfileRequestChunk[] = [];
    private _activeProfileRequestId: number | undefined;
    private _activeProfilePassSignature: string | undefined;
    private _nextRequestId = 0;
    private _generation = 0;

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
        let changed = false;
        for (const column of columns) {
            const columnIndex = column.column_index;
            const previous = this._schemaCache.get(columnIndex);
            if (
                !previous ||
                previous.column_name !== column.column_name ||
                previous.type_name !== column.type_name ||
                previous.type_display !== column.type_display ||
                previous.description !== column.description
            ) {
                changed = true;
            }
            this._schemaCache.set(columnIndex, column);
        }
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

    clear(generation?: number): void {
        this._synchronizeGeneration(generation);
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

        const requestsToCancel = [...this._pendingRequests]
            .filter(([, coverageByColumn]) =>
                [...coverageByColumn.keys()].some(
                    (columnIndex) => !keepColumns.has(columnIndex),
                ),
            )
            .map(([requestId]) => requestId);
        if (requestsToCancel.length > 0) {
            this._cancelPendingRequests(requestsToCancel);
            didChange = true;
        }

        if (didChange) {
            this._stores.columnProfiles.set(nextProfiles);
        }
    }

    getColumnProfile(columnIndex: number): ColumnProfileViewResult | undefined {
        return this._profiles.get(columnIndex);
    }

    invalidateProfiles(
        generation?: number,
        columnIndices?: Iterable<number>,
    ): void {
        this._synchronizeGeneration(generation);
        if (!columnIndices) {
            this._clearTrimCacheTimeout();
        }

        if (!columnIndices) {
            this._cancelPendingRequests([...this._pendingRequests.keys()]);
            this._profiles.clear();
            this._profileCoverage.clear();
            this._pendingCoverage.clear();
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
        // A generation applies to the full profile model. Cancel every older
        // batch so no unaffected-looking column can publish a result computed
        // against the previous row/filter state.
        this._cancelPendingRequests([...this._pendingRequests.keys()]);
        this._stores.columnProfiles.set(nextProfiles);

    }

    private _synchronizeGeneration(generation?: number): void {
        // The host owns the generation shared by its summary cache and this
        // webview cache. Local cache maintenance must not advance it.
        if (generation !== undefined) {
            this._generation = generation;
        }
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
        this._cancelPendingRequests([...this._pendingRequests.keys()]);
    }

    handleColumnProfiles(
        profiles: Array<{ columnIndex: number; profile: unknown }>,
        error?: string,
        requestId?: number,
        generation?: number,
    ): void {
        if (requestId === undefined || generation === undefined) {
            return;
        }

        const nextProfiles = new Map(get(this._stores.columnProfiles));
        const requestCoverage = this._pendingRequests.get(requestId);
        if (
            !requestCoverage ||
            generation !== this._generation ||
            this._pendingRequestGenerations.get(requestId) !== generation
        ) {
            return;
        }
        const affectedColumns = [...requestCoverage.keys()];

        for (const entry of profiles) {
            if (!requestCoverage.has(entry.columnIndex)) {
                continue;
            }
            const pendingCoverage =
                requestCoverage.get(entry.columnIndex) ??
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

        this._pendingRequests.delete(requestId);
        this._pendingRequestGenerations.delete(requestId);
        this._recomputePendingCoverage(affectedColumns);

        if (error && requestCoverage) {
            for (const columnIndex of requestCoverage.keys()) {
                if (!nextProfiles.has(columnIndex)) {
                    this._profiles.delete(columnIndex);
                }
            }
        }

        this._stores.columnProfiles.set(nextProfiles);
        if (this._activeProfileRequestId === requestId) {
            this._activeProfileRequestId = undefined;
            if (error) {
                this._profileRequestQueue = [];
                this._activeProfilePassSignature = undefined;
            } else {
                this._requestNextProfileChunk();
            }
        }
    }

    requestColumnProfiles(
        columnIndices: number[],
        expandedColumns: Set<number>,
        supportsColumnProfiles: boolean,
    ): void {
        if (!supportsColumnProfiles) {
            return;
        }

        const uniqueColumnIndices = [...new Set(columnIndices)];
        const passSignature = JSON.stringify({
            generation: this._generation,
            columnIndices: uniqueColumnIndices,
            expandedColumnIndices: uniqueColumnIndices.filter((columnIndex) =>
                expandedColumns.has(columnIndex),
            ),
        });
        if (this._activeProfilePassSignature === passSignature) {
            return;
        }
        if (
            this._activeProfileRequestId !== undefined ||
            this._profileRequestQueue.length > 0
        ) {
            this._cancelPendingRequests([...this._pendingRequests.keys()]);
            this._profileRequestQueue = [];
            this._activeProfileRequestId = undefined;
            this._activeProfilePassSignature = undefined;
        }

        const requestColumnIndices: number[] = [];
        const expandedColumnIndices: number[] = [];
        const requestCoverage = new Map<number, ProfileCoverage>();
        const seen = new Set<number>();

        for (const columnIndex of uniqueColumnIndices) {
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

        const chunks: ProfileRequestChunk[] = [];
        for (
            let offset = 0;
            offset < requestColumnIndices.length;
            offset += PROFILE_CHUNK_SIZE
        ) {
            const chunkColumnIndices = requestColumnIndices.slice(
                offset,
                offset + PROFILE_CHUNK_SIZE,
            );
            const chunkCoverage = new Map<number, ProfileCoverage>();
            for (const columnIndex of chunkColumnIndices) {
                const coverage = requestCoverage.get(columnIndex);
                if (coverage !== undefined) {
                    chunkCoverage.set(columnIndex, coverage);
                }
            }

            chunks.push({
                columnIndices: chunkColumnIndices,
                expandedColumnIndices: expandedColumnIndices.filter(
                    (columnIndex) => chunkCoverage.has(columnIndex),
                ),
                coverage: chunkCoverage,
            });
        }
        this._activeProfilePassSignature = passSignature;
        this._profileRequestQueue = chunks;
        this._requestNextProfileChunk();
    }

    private _requestNextProfileChunk(): void {
        const chunk = this._profileRequestQueue.shift();
        if (!chunk) {
            this._activeProfileRequestId = undefined;
            this._activeProfilePassSignature = undefined;
            return;
        }

        for (const [columnIndex, coverage] of chunk.coverage) {
            const currentPending = this._pendingCoverage.get(columnIndex) ?? 0;
            this._pendingCoverage.set(
                columnIndex,
                Math.max(currentPending, coverage) as ProfileCoverage,
            );
        }

        const requestId = ++this._nextRequestId;
        this._activeProfileRequestId = requestId;
        this._pendingRequests.set(requestId, chunk.coverage);
        this._pendingRequestGenerations.set(requestId, this._generation);
        this._postMessage({
            type: 'requestColumnProfiles',
            columnIndices: chunk.columnIndices,
            expandedColumnIndices: chunk.expandedColumnIndices,
            requestId,
            generation: this._generation,
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

        for (const columnIndex of [...this._schemaCache.keys()]) {
            if (!columnIndices.has(columnIndex)) {
                this._schemaCache.delete(columnIndex);
                didChange = true;
            }
        }

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

        const requestsToCancel = [...this._pendingRequests]
            .filter(([, coverageByColumn]) =>
                [...coverageByColumn.keys()].some(
                    (columnIndex) => !columnIndices.has(columnIndex),
                ),
            )
            .map(([requestId]) => requestId);
        if (requestsToCancel.length > 0) {
            this._cancelPendingRequests(requestsToCancel);
            didChange = true;
        }

        if (didChange) {
            this._stores.columnProfiles.set(nextProfiles);
        }
    }

    private _cancelPendingRequests(requestIds: number[]): void {
        const activeRequestIds = requestIds.filter((requestId) =>
            this._pendingRequests.has(requestId),
        );
        if (activeRequestIds.length === 0) {
            return;
        }

        const affectedColumns = new Set<number>();
        for (const requestId of activeRequestIds) {
            const coverageByColumn = this._pendingRequests.get(requestId);
            for (const columnIndex of coverageByColumn?.keys() ?? []) {
                affectedColumns.add(columnIndex);
            }
            this._pendingRequests.delete(requestId);
            this._pendingRequestGenerations.delete(requestId);
        }
        if (
            this._activeProfileRequestId !== undefined &&
            activeRequestIds.includes(this._activeProfileRequestId)
        ) {
            this._activeProfileRequestId = undefined;
            this._profileRequestQueue = [];
            this._activeProfilePassSignature = undefined;
        }
        this._recomputePendingCoverage(affectedColumns);
        this._postMessage({
            type: 'cancelColumnProfiles',
            requestIds: activeRequestIds,
        });
    }
}
