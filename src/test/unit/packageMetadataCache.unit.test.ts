import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    PACKAGE_METADATA_CACHE_STORAGE_KEY,
    PackageMetadataCache,
} from '../../services/packages/packageMetadataCache';
import { PositronPackagesInstance } from '../../services/packages/packagesInstance';

function eventStub<T>(): vscode.Event<T> {
    return () => ({ dispose: () => undefined });
}

function logStub(): vscode.LogOutputChannel {
    const noop = () => undefined;
    return {
        name: 'package-metadata-cache-test',
        logLevel: vscode.LogLevel.Trace,
        onDidChangeLogLevel: eventStub(),
        trace: noop,
        debug: noop,
        info: noop,
        warn: noop,
        error: noop,
        append: noop,
        appendLine: noop,
        replace: noop,
        clear: noop,
        show: noop,
        hide: noop,
        dispose: noop,
    };
}

class MemoryMemento implements vscode.Memento {
    private readonly values = new Map<string, unknown>();
    readonly keys = (): readonly string[] => Array.from(this.values.keys());

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined;
    }

    async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this.values.delete(key);
        } else {
            this.values.set(key, value);
        }
    }

    setKeysForSync(): void {
        // Workspace metadata is intentionally machine-local.
    }
}

suite('[Unit] package metadata cache', () => {
    test('merges metadata only when its installed-version anchor matches', () => {
        const instance = Object.create(
            PositronPackagesInstance.prototype,
        ) as PositronPackagesInstance;
        Object.assign(instance as any, {
            _packages: [{
                id: 'numpy',
                name: 'NumPy',
                displayName: 'NumPy',
                version: '2.0.0',
            }],
            _metadataCache: new Map([[
                'numpy',
                {
                    version: '1.26.0',
                    outdated: true,
                    latestVersion: '2.1.0',
                },
            ]]),
        });

        assert.strictEqual(instance.packages[0].outdated, undefined);
        (instance as any)._metadataCache.set('numpy', {
            version: '2.0.0',
            outdated: true,
            latestVersion: '2.1.0',
        });
        assert.strictEqual(instance.packages[0].outdated, true);
        assert.strictEqual(instance.packages[0].latestVersion, '2.1.0');
    });

    test('persists per-runtime version anchors and evicts affected names', async () => {
        const storage = new MemoryMemento();
        const cache = new PackageMetadataCache(storage, logStub());
        cache.upsert('runtime-1', {
            numpy: {
                version: '2.0.0',
                outdated: true,
                latestVersion: '2.1.0',
            },
        }, 1_000);
        await Promise.resolve();

        const restored = new PackageMetadataCache(storage, logStub());
        assert.deepStrictEqual(restored.get('runtime-1'), {
            lastFetched: 1_000,
            packages: {
                numpy: {
                    version: '2.0.0',
                    outdated: true,
                    latestVersion: '2.1.0',
                },
            },
        });
        assert.strictEqual(restored.isFresh('runtime-1', 1_001), true);

        restored.evict('runtime-1', ['NumPy']);
        assert.deepStrictEqual(restored.get('runtime-1')?.packages, {});
        assert.ok(storage.get(PACKAGE_METADATA_CACHE_STORAGE_KEY));
    });
});
