/*---------------------------------------------------------------------------------------------
 *  Table summary cache. The profile passes follow Positron's TableSummaryCache.
 *--------------------------------------------------------------------------------------------*/

import { get } from 'svelte/store';
import type { SchemaColumn } from '../../dataGrid/types';
import type { ColumnProfileViewResult } from '../columnProfileTypes';
import type { DataExplorerStores } from '../stores';
import type { WebviewMessage } from '../types';
import { mergeColumnProfiles, simplifyColumnProfile } from '../profileUtils';
import {
    getEffectiveColumnDisplayType,
    isNumericDisplayType,
    isBooleanDisplayType,
    isStringDisplayType,
} from '../columnDisplayTypeUtils';

const TRIM_CACHE_TIMEOUT = 3_000;
const PROFILE_CHUNK_PROBE_SIZE = 1;
const PROFILE_CHUNK_MAX_SIZE = 8;
const PROFILE_CHUNK_TARGET = 3_000;
const PROFILE_PASS_BUDGET = 30_000;
const PROFILE_REQUEST_TIMEOUT = 65_000;

export type ColumnProfilesFailure = 'calculation' | 'disconnected' | 'paused';
interface ColumnProfileRequest {
    column_index: number;
    profiles: Array<{ profile_type: string }>;
}
interface ProfilePass {
    readonly id: number;
    readonly generation: number;
    readonly signature: string;
    cancelled: boolean;
}
interface PendingProfileRequest {
    readonly requests: ColumnProfileRequest[];
    readonly pass: ProfilePass;
    readonly resolve: (success: boolean) => void;
    readonly timeout: ReturnType<typeof setTimeout>;
}

export class TableSummaryCache {
    private _columns = 0;
    private _rows = 0;
    private _generation = 0;
    private _visible = false;
    private _disposed = false;
    private _nextRequestId = 0;
    private _nextPassId = 0;
    private _trimCacheHandle: ReturnType<typeof setTimeout> | undefined;
    private readonly _schemaCache = new Map<number, SchemaColumn>();
    private readonly _profiles = new Map<number, ColumnProfileViewResult>();
    private readonly _pendingRequests = new Map<number, PendingProfileRequest>();
    private readonly _expandedPasses = new Map<number, ProfilePass>();
    private _expandedColumns = new Set<number>();
    private _columnIndices: number[] = [];
    private _activePass: ProfilePass | undefined;
    private _columnProfilesFailure: ColumnProfilesFailure | undefined;
    private _columnProfilesRetrying = false;
    private _detailCostPerColumn: number | undefined;

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
    get columnProfilesFailure(): ColumnProfilesFailure | undefined {
        return this._columnProfilesFailure;
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
            const previous = this._schemaCache.get(column.column_index);
            changed ||= JSON.stringify(previous) !== JSON.stringify(column);
            this._schemaCache.set(column.column_index, column);
        }
        return changed;
    }

    getColumnSchema(columnIndex: number): SchemaColumn | undefined {
        return this._schemaCache.get(columnIndex);
    }
    getSchemaColumns(): SchemaColumn[] {
        return [...this._schemaCache.values()].sort(
            (left, right) => left.column_index - right.column_index,
        );
    }
    getColumnProfile(columnIndex: number): ColumnProfileViewResult | undefined {
        return this._profiles.get(columnIndex);
    }

    clear(generation?: number): void {
        this._columns = 0;
        this._rows = 0;
        this._schemaCache.clear();
        this.invalidateProfiles(generation);
    }

    invalidateProfiles(generation?: number, columnIndices?: Iterable<number>): void {
        if (generation !== undefined) {
            this._generation = generation;
        }
        this.cancelColumnProfiles();
        this._clearTrimCacheTimeout();
        if (columnIndices) {
            for (const columnIndex of columnIndices) {
                this._profiles.delete(columnIndex);
            }
        } else {
            this._profiles.clear();
        }
        this._columnProfilesFailure = undefined;
        this._columnProfilesRetrying = false;
        this._detailCostPerColumn = undefined;
        this._publishProfiles();
    }

    setVisible(visible: boolean): void {
        this._visible = visible;
        if (!visible) {
            this._clearTrimCacheTimeout();
            this.cancelColumnProfiles();
        }
    }

    setConnected(connected: boolean): void {
        if (!connected) {
            this.cancelColumnProfiles();
            this._setFailure('disconnected');
        } else if (this._columnProfilesFailure === 'disconnected') {
            this._columnProfilesFailure = undefined;
            this._publishState();
        }
    }

    cancelColumnProfiles(): void {
        if (this._activePass) {
            this._activePass.cancelled = true;
        }
        for (const pass of this._expandedPasses.values()) {
            pass.cancelled = true;
        }
        this._cancelPendingRequests([...this._pendingRequests.keys()]);
        this._activePass = undefined;
        this._expandedPasses.clear();
        this._columnProfilesRetrying = false;
        this._publishState();
    }

    trimToColumns(columnIndices: Iterable<number>): void {
        const keep = new Set(columnIndices);
        for (const columnIndex of this._schemaCache.keys()) {
            if (!keep.has(columnIndex)) {
                this._schemaCache.delete(columnIndex);
            }
        }
        for (const columnIndex of this._profiles.keys()) {
            if (!keep.has(columnIndex)) {
                this._profiles.delete(columnIndex);
            }
        }
        const cancel = [...this._pendingRequests]
            .filter(([, pending]) =>
                pending.requests.some((request) => !keep.has(request.column_index)),
            )
            .map(([requestId]) => requestId);
        this._cancelPendingRequests(cancel);
        this._publishProfiles();
    }

    scheduleProfileTrim(columnIndices: Iterable<number>): void {
        this._clearTrimCacheTimeout();
        const keep = [...columnIndices];
        if (this._visible && keep.length > 0) {
            this._trimCacheHandle = setTimeout(() => {
                this._trimCacheHandle = undefined;
                this.trimToColumns(keep);
            }, TRIM_CACHE_TIMEOUT);
        }
    }

    dispose(): void {
        this._disposed = true;
        this.cancelColumnProfiles();
        this._clearTrimCacheTimeout();
    }

    requestColumnProfiles(
        columnIndices: number[],
        expandedColumns: Set<number>,
        supportsColumnProfiles: boolean,
    ): void {
        const newlyExpanded = [...expandedColumns].filter(
            (columnIndex) => !this._expandedColumns.has(columnIndex),
        );
        this._expandedColumns = new Set(expandedColumns);
        this._columnIndices = [...new Set(columnIndices)].filter((columnIndex) =>
            this._schemaCache.has(columnIndex),
        );
        if (
            !supportsColumnProfiles ||
            !this._visible ||
            this._disposed ||
            this._columnProfilesFailure
        ) {
            return;
        }
        if (get(this._stores.state).backendState?.connected === false) {
            this._setFailure('disconnected');
            return;
        }
        // Expanded-column loads have their own lifetime, independent of scrolling.
        for (const columnIndex of newlyExpanded) {
            this._loadExpandedColumnProfile(columnIndex);
        }
        const signature = JSON.stringify([this._generation, this._columnIndices]);
        if (this._activePass?.signature === signature) {
            return;
        }
        this._columnProfilesRetrying = false;
        this._publishState();
        void this.updateColumnProfileCache(this._columnIndices);
    }

    private async updateColumnProfileCache(columnIndices: number[]): Promise<void> {
        if (this._activePass) {
            this._activePass.cancelled = true;
            this._cancelPendingRequests(
                [...this._pendingRequests]
                    .filter(([, pending]) => pending.pass === this._activePass)
                    .map(([requestId]) => requestId),
            );
        }
        const pass = this._createPass(JSON.stringify([this._generation, columnIndices]));
        this._activePass = pass;
        try {
            await this.loadColumnProfiles(columnIndices, pass);
        } finally {
            if (this._activePass === pass) {
                this._activePass = undefined;
                this._columnProfilesRetrying = false;
                this._publishState();
            }
        }
    }

    async retryColumnProfiles(): Promise<void> {
        if (
            !this._visible ||
            this._disposed ||
            this._columnProfilesRetrying ||
            !this._columnProfilesFailure ||
            this._columnIndices.length === 0
        ) {
            return;
        }
        if (get(this._stores.state).backendState?.connected === false) {
            this._setFailure('disconnected');
            return;
        }
        this.cancelColumnProfiles();
        this._columnProfilesFailure = undefined;
        this._columnProfilesRetrying = true;
        this._publishState();
        await this.updateColumnProfileCache(this._columnIndices);
    }

    private _loadExpandedColumnProfile(columnIndex: number): void {
        if (this._expandedPasses.has(columnIndex)) {
            return;
        }
        const pass = this._createPass(`expanded:${columnIndex}`);
        this._expandedPasses.set(columnIndex, pass);
        void this.loadColumnProfiles([columnIndex], pass).finally(() => {
            if (this._expandedPasses.get(columnIndex) === pass) {
                this._expandedPasses.delete(columnIndex);
            }
        });
    }

    private _createPass(signature: string): ProfilePass {
        return {
            id: ++this._nextPassId,
            generation: this._generation,
            signature,
            cancelled: false,
        };
    }

    private _passActive(pass: ProfilePass): boolean {
        return (
            !this._disposed &&
            this._visible &&
            !pass.cancelled &&
            pass.generation === this._generation
        );
    }

    private async loadColumnProfiles(columnIndices: number[], pass: ProfilePass): Promise<void> {
        const deadline = Date.now() + PROFILE_PASS_BUDGET;
        const nullCountRequests = columnIndices
            .map((columnIndex) => this.buildNullCountRequest(columnIndex))
            .filter((request): request is ColumnProfileRequest => request !== undefined);
        if (
            nullCountRequests.length &&
            !(await this.requestColumnProfilesChunk(nullCountRequests, pass))
        ) {
            return;
        }
        for (;;) {
            if (!this._passActive(pass) || this._columnProfilesFailure) {
                return;
            }
            const detailRequests = columnIndices
                .map((columnIndex) => this.buildDetailRequest(columnIndex))
                .filter((request): request is ColumnProfileRequest => request !== undefined);
            if (detailRequests.length === 0) {
                return;
            }
            if (Date.now() >= deadline) {
                this._setFailure('paused');
                return;
            }
            const chunk = detailRequests.slice(0, this.nextDetailChunkSize());
            const started = Date.now();
            if (!(await this.requestColumnProfilesChunk(chunk, pass))) {
                return;
            }
            this._detailCostPerColumn = (Date.now() - started) / chunk.length;
        }
    }

    private nextDetailChunkSize(): number {
        if (this._detailCostPerColumn === undefined) {
            return PROFILE_CHUNK_PROBE_SIZE;
        }
        if (this._detailCostPerColumn <= 0) {
            return PROFILE_CHUNK_MAX_SIZE;
        }
        return Math.min(
            Math.max(Math.floor(PROFILE_CHUNK_TARGET / this._detailCostPerColumn), 1),
            PROFILE_CHUNK_MAX_SIZE,
        );
    }

    private _supports(profileType: string): boolean {
        return (
            get(
                this._stores.state,
            ).backendState?.supported_features?.get_column_profiles?.supported_types?.some(
                (entry) =>
                    entry.profile_type === profileType && entry.support_status === 'supported',
            ) ?? false
        );
    }

    private buildNullCountRequest(columnIndex: number): ColumnProfileRequest | undefined {
        return this._profiles.get(columnIndex)?.null_count === undefined &&
            this._supports('null_count')
            ? { column_index: columnIndex, profiles: [{ profile_type: 'null_count' }] }
            : undefined;
    }

    private buildDetailRequest(columnIndex: number): ColumnProfileRequest | undefined {
        const schema = this._schemaCache.get(columnIndex);
        if (!schema) {
            return undefined;
        }
        const cached = this._profiles.get(columnIndex);
        const type = getEffectiveColumnDisplayType(schema.type_display, schema.type_name);
        const profiles: Array<{ profile_type: string }> = [];
        const add = (profileType: keyof ColumnProfileViewResult) => {
            if (cached?.[profileType] === undefined && this._supports(profileType)) {
                profiles.push({ profile_type: profileType });
            }
        };
        const expanded = this._expandedColumns.has(columnIndex);
        if (expanded) {
            add('summary_stats');
        }
        if (isNumericDisplayType(type)) {
            add('small_histogram');
            if (expanded) {
                add('large_histogram');
            }
        } else if (isBooleanDisplayType(type)) {
            add('small_frequency_table');
        } else if (isStringDisplayType(type)) {
            add('small_frequency_table');
            if (expanded) {
                add('large_frequency_table');
            }
        }
        return profiles.length ? { column_index: columnIndex, profiles } : undefined;
    }

    private requestColumnProfilesChunk(
        requests: ColumnProfileRequest[],
        pass: ProfilePass,
    ): Promise<boolean> {
        if (!this._passActive(pass)) {
            return Promise.resolve(false);
        }
        const requestId = ++this._nextRequestId;
        return new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => {
                this.handleColumnProfiles(
                    [],
                    'Column profile request timed out.',
                    requestId,
                    pass.generation,
                );
                this._postMessage({ type: 'cancelColumnProfiles', requestIds: [requestId] });
            }, PROFILE_REQUEST_TIMEOUT);
            this._pendingRequests.set(requestId, { requests, pass, resolve, timeout });
            this._postMessage({
                type: 'requestColumnProfiles',
                columnIndices: requests.map((request) => request.column_index),
                expandedColumnIndices: requests
                    .filter((request) => this._expandedColumns.has(request.column_index))
                    .map((request) => request.column_index),
                profiles: requests,
                requestId,
                generation: pass.generation,
            });
        });
    }

    handleColumnProfiles(
        profiles: Array<{ columnIndex: number; profile: unknown }>,
        error?: string,
        requestId?: number,
        generation?: number,
    ): void {
        if (requestId === undefined) {
            return;
        }
        const pending = this._pendingRequests.get(requestId);
        if (!pending || generation !== this._generation || !this._passActive(pending.pass)) {
            return;
        }
        this._pendingRequests.delete(requestId);
        clearTimeout(pending.timeout);
        const received = new Map(
            profiles.map((entry) => [entry.columnIndex, simplifyColumnProfile(entry.profile)]),
        );
        let complete = !error;
        for (const request of pending.requests) {
            const profile = received.get(request.column_index);
            const merged = mergeColumnProfiles(this._profiles.get(request.column_index), profile);
            if (merged) {
                this._profiles.set(request.column_index, merged);
            }
            if (
                !profile ||
                request.profiles.some(
                    (spec) =>
                        profile[spec.profile_type as keyof ColumnProfileViewResult] === undefined,
                )
            ) {
                complete = false;
            }
        }
        if (!complete) {
            this._setFailure(
                get(this._stores.state).backendState?.connected === false
                    ? 'disconnected'
                    : 'calculation',
            );
        }
        this._publishProfiles();
        pending.resolve(complete);
    }

    private _setFailure(failure: ColumnProfilesFailure): void {
        this._columnProfilesFailure = failure;
        this._publishState();
    }
    private _publishProfiles(): void {
        this._stores.columnProfiles.set(new Map(this._profiles));
        this._publishState();
    }
    private _publishState(): void {
        this._stores.columnProfilesState.set({
            failure: this._columnProfilesFailure,
            partial: [...this._profiles.values()].some((profile) =>
                Object.values(profile).some((value) => value !== undefined),
            ),
            retrying: this._columnProfilesRetrying,
        });
    }
    private _clearTrimCacheTimeout(): void {
        if (this._trimCacheHandle) {
            clearTimeout(this._trimCacheHandle);
            this._trimCacheHandle = undefined;
        }
    }
    private _cancelPendingRequests(requestIds: number[]): void {
        const cancelled: number[] = [];
        for (const requestId of requestIds) {
            const pending = this._pendingRequests.get(requestId);
            if (!pending) {
                continue;
            }
            this._pendingRequests.delete(requestId);
            clearTimeout(pending.timeout);
            pending.resolve(false);
            cancelled.push(requestId);
        }
        if (cancelled.length) {
            this._postMessage({ type: 'cancelColumnProfiles', requestIds: cancelled });
        }
    }
}
