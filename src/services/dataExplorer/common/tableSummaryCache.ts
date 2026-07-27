/*---------------------------------------------------------------------------------------------
 *  Host-owned column profile cache shared by every Data Explorer surface.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { ColumnProfileRequest, ColumnProfileResult } from '../../../runtime/comms/positronDataExplorerComm';
import type { DataExplorerClientInstance } from '../languageRuntimeDataExplorerClient';

const PROFILE_REQUEST_CHUNK_SIZE = 8;
const PROFILE_TRIM_DELAY_MS = 3_000;

export class TableSummaryCache {
    private readonly _profiles = new Map<string, ColumnProfileResult>();
    private readonly _pending = new Map<string, Promise<void>>();
    private readonly _retainedKeys = new Set<string>();
    private readonly _requestTokenSources = new Set<vscode.CancellationTokenSource>();
    private _trimTimer: ReturnType<typeof setTimeout> | undefined;
    private _generation = 0;

    constructor(private _clientInstance: DataExplorerClientInstance) {}

    rebindClientInstance(clientInstance: DataExplorerClientInstance): void {
        this._clientInstance = clientInstance;
        this.invalidate(this._generation + 1);
    }

    invalidate(generation: number): void {
        this._generation = generation;
        for (const tokenSource of this._requestTokenSources) {
            tokenSource.cancel();
            tokenSource.dispose();
        }
        this._requestTokenSources.clear();
        this._profiles.clear();
        this._pending.clear();
        this._retainedKeys.clear();
        if (this._trimTimer) {
            clearTimeout(this._trimTimer);
            this._trimTimer = undefined;
        }
    }

    dispose(): void {
        this.invalidate(this._generation + 1);
    }

    async requestColumnProfiles(
        requests: ColumnProfileRequest[],
        generation: number,
        token?: vscode.CancellationToken,
    ): Promise<ColumnProfileResult[]> {
        if (generation !== this._generation || token?.isCancellationRequested) {
            return [];
        }
        const keys = requests.map(request => JSON.stringify(request));
        keys.forEach(key => this._retainedKeys.add(key));

        const pending = new Set<Promise<void>>();
        keys.forEach(key => {
            const request = this._pending.get(key);
            if (request) {
                pending.add(request);
            }
        });
        if (pending.size > 0) {
            await Promise.all(pending);
        }
        if (generation !== this._generation || token?.isCancellationRequested) {
            return [];
        }

        const misses = requests.filter((_, index) => !this._profiles.has(keys[index]));
        for (let offset = 0; offset < misses.length; offset += PROFILE_REQUEST_CHUNK_SIZE) {
            const chunk = misses.slice(offset, offset + PROFILE_REQUEST_CHUNK_SIZE);
            await this._requestChunk(chunk, generation);
            if (generation !== this._generation || token?.isCancellationRequested) {
                return [];
            }
        }

        this._scheduleTrim();
        return keys.map(key => this._profiles.get(key) ?? {});
    }

    private async _requestChunk(
        requests: ColumnProfileRequest[],
        generation: number,
    ): Promise<void> {
        const keys = requests.map(request => JSON.stringify(request));
        const uncachedRequests: ColumnProfileRequest[] = [];
        const uncachedKeys: string[] = [];
        const pending = new Set<Promise<void>>();

        requests.forEach((request, index) => {
            if (this._profiles.has(keys[index])) {
                return;
            }
            const existing = this._pending.get(keys[index]);
            if (existing) {
                pending.add(existing);
            } else {
                uncachedRequests.push(request);
                uncachedKeys.push(keys[index]);
            }
        });
        if (pending.size > 0) {
            await Promise.all(pending);
        }
        if (uncachedRequests.length === 0 || generation !== this._generation) {
            return;
        }

        const tokenSource = new vscode.CancellationTokenSource();
        this._requestTokenSources.add(tokenSource);
        const request = this._clientInstance
            .requestColumnProfiles(uncachedRequests, tokenSource.token)
            .then(results => {
                if (generation !== this._generation || tokenSource.token.isCancellationRequested) {
                    return;
                }
                uncachedKeys.forEach((key, index) => {
                    this._profiles.set(key, results[index] ?? {});
                });
            });
        uncachedKeys.forEach(key => this._pending.set(key, request));
        try {
            await request;
        } finally {
            uncachedKeys.forEach(key => {
                if (this._pending.get(key) === request) {
                    this._pending.delete(key);
                }
            });
            this._requestTokenSources.delete(tokenSource);
            tokenSource.dispose();
        }
    }

    private _scheduleTrim(): void {
        if (this._trimTimer) {
            clearTimeout(this._trimTimer);
        }
        this._trimTimer = setTimeout(() => {
            this._trimTimer = undefined;
            for (const key of this._profiles.keys()) {
                if (!this._retainedKeys.has(key)) {
                    this._profiles.delete(key);
                }
            }
            this._retainedKeys.clear();
        }, PROFILE_TRIM_DELAY_MS);
    }
}
