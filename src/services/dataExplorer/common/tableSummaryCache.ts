/*---------------------------------------------------------------------------------------------
 *  Host-owned column profile cache shared by every Data Explorer surface.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type {
    ColumnProfileRequest,
    ColumnProfileResult,
} from '../../../runtime/comms/positronDataExplorerComm';
import type { DataExplorerClientInstance } from '../languageRuntimeDataExplorerClient';

const PROFILE_REQUEST_CHUNK_SIZE = 8;
const PROFILE_TRIM_DELAY_MS = 3_000;

export class TableSummaryCache {
    private readonly _profiles = new Map<string, ColumnProfileResult>();
    private readonly _pending = new Map<string, Promise<void>>();
    private readonly _pendingOwners = new WeakMap<Promise<void>, Set<symbol>>();
    private readonly _pendingTokens = new WeakMap<Promise<void>, vscode.CancellationTokenSource>();
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
        const keys = requests.map((request) => JSON.stringify(request));
        keys.forEach((key) => this._retainedKeys.add(key));

        const pending = new Set<Promise<void>>();
        keys.forEach((key) => {
            const request = this._pending.get(key);
            if (request) {
                pending.add(request);
            }
        });
        if (pending.size > 0) {
            await this._waitForPending(pending, token);
        }
        if (generation !== this._generation || token?.isCancellationRequested) {
            return [];
        }

        const misses = requests.filter((_, index) => !this._profiles.has(keys[index]));
        const nullCountsOnly = misses.every(
            (request) =>
                request.profiles.length > 0 &&
                request.profiles.every((profile) => profile.profile_type === 'null_count'),
        );
        const chunkSize = nullCountsOnly ? Math.max(1, misses.length) : PROFILE_REQUEST_CHUNK_SIZE;
        for (let offset = 0; offset < misses.length; offset += chunkSize) {
            const chunk = misses.slice(offset, offset + chunkSize);
            await this._requestChunk(chunk, generation, token);
            if (generation !== this._generation || token?.isCancellationRequested) {
                return [];
            }
        }

        this._scheduleTrim();
        return keys.map((key) => this._profiles.get(key) ?? {});
    }

    private async _requestChunk(
        requests: ColumnProfileRequest[],
        generation: number,
        token?: vscode.CancellationToken,
    ): Promise<void> {
        const keys = requests.map((request) => JSON.stringify(request));
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
            await this._waitForPending(pending, token);
        }
        if (
            uncachedRequests.length === 0 ||
            generation !== this._generation ||
            token?.isCancellationRequested
        ) {
            return;
        }

        const tokenSource = new vscode.CancellationTokenSource();
        this._requestTokenSources.add(tokenSource);
        const request = this._clientInstance
            .requestColumnProfiles(uncachedRequests, tokenSource.token)
            .then((results) => {
                if (generation !== this._generation || tokenSource.token.isCancellationRequested) {
                    return;
                }
                uncachedKeys.forEach((key, index) => {
                    const result = results[index];
                    if (
                        result &&
                        uncachedRequests[index].profiles.every(
                            (profile) =>
                                result[profile.profile_type as keyof ColumnProfileResult] !==
                                undefined,
                        )
                    ) {
                        this._profiles.set(key, result);
                    }
                });
            })
            .finally(() => {
                uncachedKeys.forEach((key) => {
                    if (this._pending.get(key) === request) {
                        this._pending.delete(key);
                    }
                });
                this._requestTokenSources.delete(tokenSource);
                tokenSource.dispose();
            });
        this._pendingTokens.set(request, tokenSource);
        uncachedKeys.forEach((key) => this._pending.set(key, request));
        await this._waitForPending(new Set([request]), token);
    }

    private async _waitForPending(
        pending: Set<Promise<void>>,
        token?: vscode.CancellationToken,
    ): Promise<void> {
        const owner = Symbol('profile-consumer');
        for (const request of pending) {
            const owners = this._pendingOwners.get(request) ?? new Set<symbol>();
            owners.add(owner);
            this._pendingOwners.set(request, owners);
        }
        await new Promise<void>((resolve, reject) => {
            let completed = false;
            let cancellation: vscode.Disposable | undefined;
            const finish = (failed = false, error?: unknown) => {
                if (completed) {
                    return;
                }
                completed = true;
                cancellation?.dispose();
                for (const request of pending) {
                    const owners = this._pendingOwners.get(request);
                    owners?.delete(owner);
                    const source = this._pendingTokens.get(request);
                    // A split editor can share this request. Cancel its backend
                    // wait only after the final interested surface leaves.
                    if (owners?.size === 0 && source && this._requestTokenSources.has(source)) {
                        source.cancel();
                    }
                }
                if (failed) {
                    reject(error);
                } else {
                    resolve();
                }
            };
            cancellation = token?.onCancellationRequested(() => finish());
            Promise.all(pending).then(
                () => finish(),
                (error) => finish(true, error),
            );
            if (token?.isCancellationRequested) {
                finish();
            }
        });
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
