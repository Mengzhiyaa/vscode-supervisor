import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import * as path from 'path';
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
    private readonly _filePath: string | undefined;
    private _fileWritePending = false;
    private _fileWritePromise: Promise<void> | undefined;

    constructor(
        private readonly _storage: vscode.Memento,
        private readonly _outputChannel: vscode.LogOutputChannel,
        storageUri?: vscode.Uri,
    ) {
        this._cache = this._readMemento();
        this._filePath = storageUri?.fsPath
            ? path.join(storageUri.fsPath, 'package-metadata-cache', 'v1', 'cache.json')
            : undefined;
    }

    async initialize(): Promise<void> {
        if (!this._filePath) {
            return;
        }
        await mkdir(path.dirname(this._filePath), { recursive: true });

        let loadedFromFile = false;
        try {
            const parsed = this._parse(JSON.parse(await readFile(this._filePath, 'utf8')));
            if (parsed) {
                this._cache = parsed;
                loadedFromFile = true;
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                this._outputChannel.warn(`[Packages] Ignoring invalid package metadata cache: ${error}`);
            }
        }

        const hasLegacyCache = this._storage.keys().includes(PACKAGE_METADATA_CACHE_STORAGE_KEY);
        if (!loadedFromFile && hasLegacyCache) {
            await this._writeFile();
            loadedFromFile = true;
        }
        if (hasLegacyCache && loadedFromFile) {
            await this._storage.update(PACKAGE_METADATA_CACHE_STORAGE_KEY, undefined);
        }
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

    private _readMemento(): PersistedPackageMetadata {
        const value = this._storage.get<unknown>(PACKAGE_METADATA_CACHE_STORAGE_KEY);
        return this._parse(value) ?? this._empty();
    }

    private _parse(value: unknown): PersistedPackageMetadata | undefined {
        if (!value || typeof value !== 'object') {
            return undefined;
        }
        const parsed = value as Partial<PersistedPackageMetadata>;
        if (parsed.schemaVersion !== PACKAGE_METADATA_CACHE_SCHEMA_VERSION ||
            !parsed.environments ||
            typeof parsed.environments !== 'object') {
            return undefined;
        }
        return {
            schemaVersion: PACKAGE_METADATA_CACHE_SCHEMA_VERSION,
            environments: parsed.environments,
        };
    }

    private _write(): void {
        if (!this._filePath) {
            const current = this._storage.get<unknown>(PACKAGE_METADATA_CACHE_STORAGE_KEY);
            if (JSON.stringify(current) === JSON.stringify(this._cache)) {
                return;
            }
            void this._storage.update(PACKAGE_METADATA_CACHE_STORAGE_KEY, this._cache).then(
                undefined,
                error => this._outputChannel.warn(
                    `[Packages] Failed to persist package metadata cache: ${error}`,
                ),
            );
            return;
        }

        this._fileWritePending = true;
        if (this._fileWritePromise) {
            return;
        }
        const drain = this._drainFileWrites()
            .catch(error => {
                this._outputChannel.warn(
                    `[Packages] Failed to persist package metadata cache: ${error}`,
                );
            })
            .finally(() => {
                if (this._fileWritePromise === drain) {
                    this._fileWritePromise = undefined;
                }
                if (this._fileWritePending) {
                    this._write();
                }
            });
        this._fileWritePromise = drain;
    }

    private async _drainFileWrites(): Promise<void> {
        while (this._fileWritePending) {
            this._fileWritePending = false;
            await this._writeFile();
        }
    }

    private async _writeFile(): Promise<void> {
        const target = this._filePath!;
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, JSON.stringify(this._cache), 'utf8');
            await rename(temporary, target);
        } finally {
            await rm(temporary, { force: true }).catch(() => undefined);
        }
    }

    private _empty(): PersistedPackageMetadata {
        return {
            schemaVersion: PACKAGE_METADATA_CACHE_SCHEMA_VERSION,
            environments: {},
        };
    }
}
