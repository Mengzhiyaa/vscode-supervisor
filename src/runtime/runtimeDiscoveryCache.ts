import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import type { LanguageRuntimeMetadata, RuntimeRootSignature } from '../api';

export const RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION = 2;
export const RUNTIME_DISCOVERY_CACHE_STORAGE_KEY =
    `vscode-supervisor.runtimeDiscoveryCache.v${RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION}`;

const RUNTIME_DISCOVERY_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const BUCKET_SEPARATOR = '::';

export interface RuntimeFingerprint {
    readonly size: number;
    readonly mtimeMs: number;
    readonly ctimeMs: number;
}

export interface CachedRuntime {
    readonly metadata: LanguageRuntimeMetadata;
    readonly fingerprint: RuntimeFingerprint;
    readonly resolvedPath: string;
    readonly firstSeen: number;
    readonly lastValidated: number;
}

export interface DiscoveryCacheBucket {
    readonly extensionId: string;
    readonly languageId: string;
    readonly entries: readonly CachedRuntime[];
    readonly lastFullDiscovery: number;
    readonly discoveryRootSignature?: RuntimeRootSignature;
}

interface PersistedBucket {
    entries: CachedRuntime[];
    lastFullDiscovery: number;
    discoveryRootSignature?: RuntimeRootSignature;
}

interface PersistedCache {
    schemaVersion: 2;
    buckets: Record<string, PersistedBucket>;
}

function bucketKey(extensionId: string, languageId: string): string {
    return `${extensionId}${BUCKET_SEPARATOR}${languageId}`;
}

function unpackBucketKey(key: string): { extensionId: string; languageId: string } | undefined {
    const index = key.indexOf(BUCKET_SEPARATOR);
    if (index <= 0 || index === key.length - BUCKET_SEPARATOR.length) {
        return undefined;
    }
    return {
        extensionId: key.substring(0, index),
        languageId: key.substring(index + BUCKET_SEPARATOR.length),
    };
}

/**
 * Persistent runtime discovery cache partitioned by provider and language.
 * The v1 language-only cache is deliberately not migrated because its owner
 * cannot be recovered safely.
 */
export class RuntimeDiscoveryCache {
    private readonly _buckets = new Map<string, PersistedBucket>();
    private _writeChain = Promise.resolve();

    constructor(
        private readonly _state: vscode.Memento,
        private readonly _outputChannel: vscode.LogOutputChannel,
    ) {
        const persisted = this._state.get<PersistedCache>(RUNTIME_DISCOVERY_CACHE_STORAGE_KEY);
        if (!persisted || persisted.schemaVersion !== RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION) {
            return;
        }
        for (const [key, bucket] of Object.entries(persisted.buckets ?? {})) {
            if (unpackBucketKey(key)) {
                this._buckets.set(key, {
                    ...bucket,
                    // Early schema-v2 builds stored this as a string. Treat it
                    // as absent so the next provider signature forces a clean
                    // discovery and rewrites the bucket in structured form.
                    discoveryRootSignature: this._isRootSignature(bucket.discoveryRootSignature)
                        ? bucket.discoveryRootSignature
                        : undefined,
                });
            }
        }
    }

    getBucket(extensionId: string, languageId: string): DiscoveryCacheBucket | undefined {
        const bucket = this._buckets.get(bucketKey(extensionId, languageId));
        if (!bucket) {
            return undefined;
        }
        const cutoff = Date.now() - RUNTIME_DISCOVERY_CACHE_MAX_AGE_MS;
        return {
            extensionId,
            languageId,
            entries: bucket.entries.filter(entry => entry.firstSeen >= cutoff),
            lastFullDiscovery: bucket.lastFullDiscovery,
            discoveryRootSignature: bucket.discoveryRootSignature,
        };
    }

    async replaceBucket(
        extensionId: string,
        languageId: string,
        metadata: readonly LanguageRuntimeMetadata[],
        discoveryRootSignature?: RuntimeRootSignature,
    ): Promise<void> {
        const previous = this._buckets.get(bucketKey(extensionId, languageId));
        const previousByPath = new Map(
            (previous?.entries ?? []).map(entry => [entry.metadata.runtimePath, entry]),
        );
        const now = Date.now();
        const entries: CachedRuntime[] = [];
        for (const runtime of metadata) {
            // Match Positron's default-false contract: providers must assert
            // that a runtime is system-scoped and safe to reuse cross-window.
            if (runtime.cacheable !== true) {
                continue;
            }
            const stat = await this.statRuntimePath(runtime.runtimePath);
            if (!stat) {
                continue;
            }
            entries.push({
                metadata: runtime,
                fingerprint: stat.fingerprint,
                resolvedPath: stat.resolvedPath,
                firstSeen: previousByPath.get(runtime.runtimePath)?.firstSeen ?? now,
                lastValidated: now,
            });
        }
        this._buckets.set(bucketKey(extensionId, languageId), {
            entries,
            lastFullDiscovery: now,
            discoveryRootSignature,
        });
        await this._persist();
    }

    async markValidated(
        extensionId: string,
        languageId: string,
        runtimePath: string,
        fingerprint: RuntimeFingerprint,
    ): Promise<void> {
        const key = bucketKey(extensionId, languageId);
        const bucket = this._buckets.get(key);
        const index = bucket?.entries.findIndex(entry => entry.metadata.runtimePath === runtimePath) ?? -1;
        if (!bucket || index < 0) {
            return;
        }
        bucket.entries[index] = {
            ...bucket.entries[index],
            fingerprint,
            lastValidated: Date.now(),
        };
        await this._persist();
    }

    async statRuntimePath(
        runtimePath: string,
    ): Promise<{ resolvedPath: string; fingerprint: RuntimeFingerprint } | undefined> {
        try {
            const resolvedPath = await fs.realpath(runtimePath);
            const stat = await fs.stat(resolvedPath);
            if (!stat.isFile()) {
                return undefined;
            }
            return {
                resolvedPath,
                fingerprint: {
                    size: stat.size,
                    mtimeMs: stat.mtimeMs,
                    ctimeMs: stat.ctimeMs,
                },
            };
        } catch (error) {
            this._outputChannel.trace(`[Runtime cache] stat failed for ${runtimePath}: ${error}`);
            return undefined;
        }
    }

    fingerprintsEqual(left: RuntimeFingerprint, right: RuntimeFingerprint): boolean {
        return left.size === right.size &&
            left.mtimeMs === right.mtimeMs &&
            left.ctimeMs === right.ctimeMs;
    }

    private _isRootSignature(value: unknown): value is RuntimeRootSignature {
        if (!value || typeof value !== 'object') {
            return false;
        }
        const candidate = value as Partial<RuntimeRootSignature>;
        return (candidate.opaque === undefined || typeof candidate.opaque === 'string') &&
            Array.isArray(candidate.entries) && candidate.entries.every(entry => {
            return !!entry &&
                typeof entry.path === 'string' &&
                typeof entry.exists === 'boolean' &&
                typeof entry.mtimeMs === 'number';
        });
    }

    private async _persist(): Promise<void> {
        const buckets: Record<string, PersistedBucket> = {};
        for (const [key, bucket] of this._buckets) {
            buckets[key] = bucket;
        }
        const payload: PersistedCache = {
            schemaVersion: RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION,
            buckets,
        };
        const write = this._writeChain.then(() =>
            this._state.update(RUNTIME_DISCOVERY_CACHE_STORAGE_KEY, payload),
        );
        this._writeChain = write.then(() => undefined, () => undefined);
        await write;
    }
}
