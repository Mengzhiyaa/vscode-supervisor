import * as vscode from 'vscode';

export const PACKAGE_METADATA_CACHE_ENABLED_SETTING = 'packages.metadataCache.enabled';
export const PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_SETTING = 'packages.metadataCache.maxAgeHours';
export const PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_DEFAULT = 24;
export const PACKAGE_METADATA_CACHE_SCHEMA_VERSION = 1;
export const PACKAGE_METADATA_CACHE_STORAGE_KEY = 'positron.packages.metadataCache';

const MS_PER_HOUR = 60 * 60 * 1_000;

export interface CachedPackageMetadata {
    version: string;
    outdated?: boolean;
    latestVersion?: string;
}

export interface CachedPackageEnvironment {
    lastFetched: number;
    packages: Record<string, CachedPackageMetadata>;
}

interface PersistedPackageMetadata {
    schemaVersion: number;
    environments: Record<string, CachedPackageEnvironment>;
}

/**
 * Workspace-scoped, interpreter-keyed package metadata cache. Keeping this
 * workspace scoped is important: runtimeId identifies an interpreter, but not
 * project-specific virtual environments, library paths, or repositories.
 */
export class PackageMetadataCache {
    private _cache: PersistedPackageMetadata;

    constructor(
        private readonly _storage: vscode.Memento,
        private readonly _outputChannel: vscode.LogOutputChannel,
    ) {
        this._cache = this._read();
    }

    get(runtimeId: string): CachedPackageEnvironment | undefined {
        return this._enabled ? this._cache.environments[runtimeId] : undefined;
    }

    isFresh(runtimeId: string, now = Date.now()): boolean {
        const environment = this.get(runtimeId);
        return environment !== undefined &&
            now - environment.lastFetched < this._maxAgeMs;
    }

    upsert(
        runtimeId: string,
        packages: Record<string, CachedPackageMetadata>,
        now = Date.now(),
    ): void {
        if (!this._enabled) {
            return;
        }
        this._cache.environments[runtimeId] = { lastFetched: now, packages };
        this._write();
    }

    evict(runtimeId: string, packageNames: readonly string[]): void {
        if (!this._enabled || packageNames.length === 0) {
            return;
        }
        const environment = this._cache.environments[runtimeId];
        if (!environment) {
            return;
        }
        for (const packageName of packageNames) {
            delete environment.packages[packageName.toLowerCase()];
        }
        this._write();
    }

    clear(runtimeId: string): void {
        if (!this._enabled || !this._cache.environments[runtimeId]) {
            return;
        }
        delete this._cache.environments[runtimeId];
        this._write();
    }

    private get _enabled(): boolean {
        return vscode.workspace
            .getConfiguration()
            .get<boolean>(PACKAGE_METADATA_CACHE_ENABLED_SETTING, true);
    }

    private get _maxAgeMs(): number {
        const configured = vscode.workspace
            .getConfiguration()
            .get<number>(
                PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_SETTING,
                PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_DEFAULT,
            );
        const hours = Number.isFinite(configured) && configured > 0
            ? configured
            : PACKAGE_METADATA_CACHE_MAX_AGE_HOURS_DEFAULT;
        return hours * MS_PER_HOUR;
    }

    private _read(): PersistedPackageMetadata {
        const value = this._storage.get<unknown>(PACKAGE_METADATA_CACHE_STORAGE_KEY);
        if (!value || typeof value !== 'object') {
            return this._empty();
        }
        const parsed = value as Partial<PersistedPackageMetadata>;
        if (parsed.schemaVersion !== PACKAGE_METADATA_CACHE_SCHEMA_VERSION ||
            !parsed.environments ||
            typeof parsed.environments !== 'object') {
            return this._empty();
        }
        return {
            schemaVersion: PACKAGE_METADATA_CACHE_SCHEMA_VERSION,
            environments: parsed.environments,
        };
    }

    private _write(): void {
        void this._storage.update(PACKAGE_METADATA_CACHE_STORAGE_KEY, this._cache).then(
            undefined,
            error => this._outputChannel.warn(
                `[Packages] Failed to persist package metadata cache: ${error}`,
            ),
        );
    }

    private _empty(): PersistedPackageMetadata {
        return {
            schemaVersion: PACKAGE_METADATA_CACHE_SCHEMA_VERSION,
            environments: {},
        };
    }
}
