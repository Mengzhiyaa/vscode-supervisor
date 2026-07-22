/*---------------------------------------------------------------------------------------------
 *  Host-owned column profile cache shared by every Data Explorer surface.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { ColumnProfileRequest, ColumnProfileResult } from '../../../runtime/comms/positronDataExplorerComm';
import type { DataExplorerClientInstance } from '../languageRuntimeDataExplorerClient';

export class TableSummaryCache {
    private readonly _profiles = new Map<string, ColumnProfileResult>();
    private _generation = 0;

    constructor(private _clientInstance: DataExplorerClientInstance) {}

    rebindClientInstance(clientInstance: DataExplorerClientInstance): void {
        this._clientInstance = clientInstance;
        this.invalidate(this._generation + 1);
    }

    invalidate(generation: number): void {
        this._generation = generation;
        this._profiles.clear();
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
        const misses = requests.filter((_, index) => !this._profiles.has(keys[index]));
        if (misses.length > 0) {
            const results = await this._clientInstance.requestColumnProfiles(misses, token);
            if (generation !== this._generation || token?.isCancellationRequested) {
                return [];
            }
            let resultIndex = 0;
            requests.forEach((_, index) => {
                if (!this._profiles.has(keys[index])) {
                    const result = results[resultIndex++];
                    if (result !== undefined) {
                        this._profiles.set(keys[index], result);
                    }
                }
            });
        }
        return keys.map(key => this._profiles.get(key) ?? {});
    }
}
