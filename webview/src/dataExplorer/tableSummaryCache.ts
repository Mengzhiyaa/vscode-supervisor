/*---------------------------------------------------------------------------------------------
 *  Table summary cache
 *--------------------------------------------------------------------------------------------*/

import { get } from 'svelte/store';
import type { SchemaColumn } from '../dataGrid/types';
import type { ColumnProfileViewResult } from './columnProfileTypes';
import type { DataExplorerStores } from './stores';
import type { WebviewMessage } from './types';
import {
    mergeColumnProfiles,
    simplifyColumnProfile,
} from './profileUtils';

const BASIC_PROFILE_COVERAGE = 1;
const EXPANDED_PROFILE_COVERAGE = 2;

type ProfileCoverage =
    | typeof BASIC_PROFILE_COVERAGE
    | typeof EXPANDED_PROFILE_COVERAGE;

/**
 * Lightweight cache that mirrors the responsibilities of Positron's summary
 * cache while keeping Svelte stores as the view-model surface.
 */
export class TableSummaryCache {
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

    getColumnProfile(columnIndex: number): ColumnProfileViewResult | undefined {
        return this._profiles.get(columnIndex);
    }

    invalidateProfiles(columnIndices?: Iterable<number>): void {
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
        getColumnSchema: (columnIndex: number) => SchemaColumn | undefined,
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

            if (!getColumnSchema(columnIndex)) {
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
}
