import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
    ILanguageRuntimeProvider,
    LanguageRuntimeMetadata,
    RuntimeRootSignature,
} from '../../api';
import { RuntimeManager } from '../../runtime/manager';
import {
    RUNTIME_DISCOVERY_CACHE_STORAGE_KEY,
    RuntimeDiscoveryCache,
} from '../../runtime/runtimeDiscoveryCache';

class MemoryMemento implements vscode.Memento {
    readonly values = new Map<string, unknown>();
    keys(): readonly string[] { return [...this.values.keys()]; }
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined;
    }
    update(key: string, value: unknown): Thenable<void> {
        this.values.set(key, value);
        return Promise.resolve();
    }
}

function logChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    return {
        name: 'runtime-discovery-cache-test',
        logLevel: vscode.LogLevel.Trace,
        onDidChangeLogLevel: () => ({ dispose: noop }),
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

suite('[Unit] Runtime discovery cache', () => {
    test('does not let an older provider lease remove its replacement', () => {
        const context = { globalState: new MemoryMemento() } as unknown as vscode.ExtensionContext;
        const manager = new RuntimeManager(context, {} as any, logChannel());
        const provider = { languageId: 'r' } as ILanguageRuntimeProvider<unknown>;

        const older = manager.registerRuntimeProvider(provider);
        const newer = manager.registerRuntimeProvider(provider);
        older.dispose();
        assert.strictEqual(manager.getRuntimeProvider('r'), provider);

        newer.dispose();
        assert.strictEqual(manager.getRuntimeProvider('r'), undefined);
        manager.dispose();
    });

    test('ignores dynamic runtime removal events from an old provider generation', () => {
        const context = { globalState: new MemoryMemento() } as unknown as vscode.ExtensionContext;
        const removed: string[] = [];
        const manager = new RuntimeManager(context, {
            registerDiscoveredRuntime: () => undefined,
            unregisterDiscoveredRuntime: (runtimeId: string) => removed.push(runtimeId),
        } as any, logChannel());
        const oldDiscover = new vscode.EventEmitter<{ path: string }>();
        const oldRemove = new vscode.EventEmitter<{ runtimeId: string }>();
        const newDiscover = new vscode.EventEmitter<{ path: string }>();
        const newRemove = new vscode.EventEmitter<{ runtimeId: string }>();
        const makeProvider = (
            discover: vscode.Event<{ path: string }>,
            remove: vscode.Event<{ runtimeId: string }>,
        ) => ({
            languageId: 'r',
            onDidDiscoverInstallation: discover,
            onDidRemoveRuntime: remove,
            getRuntimePath: (installation: { path: string }) => installation.path,
            createRuntimeMetadata: (_context: unknown, installation: { path: string }) => ({
                runtimeId: installation.path,
                runtimePath: installation.path,
                languageId: 'r',
            }),
        } as any);

        const oldLease = manager.registerRuntimeProvider(makeProvider(oldDiscover.event, oldRemove.event));
        const newLease = manager.registerRuntimeProvider(makeProvider(newDiscover.event, newRemove.event));
        newDiscover.fire({ path: 'runtime-1' });
        oldRemove.fire({ runtimeId: 'runtime-1' });
        assert.ok(manager.getRuntime('runtime-1'));

        newRemove.fire({ runtimeId: 'runtime-1' });
        assert.strictEqual(manager.getRuntime('runtime-1'), undefined);
        assert.deepStrictEqual(removed, ['runtime-1']);

        oldLease.dispose();
        newLease.dispose();
        oldDiscover.dispose();
        oldRemove.dispose();
        newDiscover.dispose();
        newRemove.dispose();
        manager.dispose();
    });

    test('invalidates legacy string root signatures within the current schema', async () => {
        const state = new MemoryMemento();
        await state.update(RUNTIME_DISCOVERY_CACHE_STORAGE_KEY, {
            schemaVersion: 2,
            buckets: {
                'test.extension::python': {
                    entries: [],
                    lastFullDiscovery: Date.now(),
                    discoveryRootSignature: 'legacy-roots',
                },
            },
        });

        const cache = new RuntimeDiscoveryCache(state, logChannel());

        assert.strictEqual(
            cache.getBucket('test.extension', 'python')?.discoveryRootSignature,
            undefined,
        );
    });

    test('requires an explicit cacheable opt-in from runtime metadata', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'supervisor-discovery-opt-in-'));
        const runtimePath = path.join(directory, 'runtime');
        await fs.writeFile(runtimePath, 'runtime');
        const cache = new RuntimeDiscoveryCache(new MemoryMemento(), logChannel());
        await cache.replaceBucket('test.extension', 'python', [{
            runtimeId: 'project-runtime',
            runtimeName: 'Project Runtime',
            runtimePath,
            runtimeVersion: '1',
            runtimeShortName: '1',
            runtimeSource: 'workspace',
            languageId: 'python',
            languageName: 'Python',
            languageVersion: '3',
        }], { entries: [] });

        assert.deepStrictEqual(
            cache.getBucket('test.extension', 'python')?.entries,
            [],
        );
        await fs.rm(directory, { recursive: true, force: true });
    });

    test('restores an unchanged executable without rescanning the provider', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'supervisor-discovery-'));
        const runtimePath = path.join(directory, 'runtime');
        await fs.writeFile(runtimePath, 'runtime');
        const state = new MemoryMemento();
        const context = {
            globalState: state,
        } as unknown as vscode.ExtensionContext;
        const sessionManager = {
            registerDiscoveredRuntime: () => true,
        } as any;
        let discoveryCalls = 0;
        let discoveryRootSignature: RuntimeRootSignature = {
            entries: [{ path: '/roots/a', exists: true, mtimeMs: 1 }],
            opaque: 'settings-a',
        };
        const metadata: LanguageRuntimeMetadata = {
            runtimeId: 'cached-runtime',
            runtimeName: 'Cached Runtime',
            runtimePath,
            runtimeVersion: '1',
            runtimeShortName: '1',
            runtimeSource: 'test',
            languageId: 'cache-language',
            languageName: 'Cache',
            languageVersion: '1',
            cacheable: true,
        };
        const provider: ILanguageRuntimeProvider<{ path: string }> = {
            extensionId: 'runtime-discovery-cache-test',
            languageId: 'cache-language',
            languageName: 'Cache',
            getDiscoveryRootSignature: async () => discoveryRootSignature,
            discoverInstallations: async function* () {
                discoveryCalls++;
                yield { path: runtimePath };
            },
            resolveInitialInstallation: async () => undefined,
            promptForInstallation: async () => undefined,
            formatRuntimeName: () => 'Cached Runtime',
            getRuntimePath: installation => installation.path,
            getRuntimeSource: () => 'test',
            createRuntimeMetadata: () => metadata,
            createKernelSpec: async () => ({
                argv: [],
                env: {},
                display_name: 'Cache',
                language: 'cache-language',
                kernel_protocol_version: '5.3',
            }),
            restoreInstallationFromMetadata: value => ({ path: value.runtimePath }),
        };

        const first = new RuntimeManager(context, sessionManager, logChannel());
        first.registerRuntimeProvider(provider);
        await first.discoverAllRuntimes([]);
        assert.strictEqual(discoveryCalls, 1);
        first.dispose();

        const second = new RuntimeManager(context, sessionManager, logChannel());
        second.registerRuntimeProvider(provider);
        await second.discoverAllRuntimes([]);
        assert.strictEqual(discoveryCalls, 1);
        assert.strictEqual(second.runtimes[0]?.runtimeId, metadata.runtimeId);
        second.dispose();

        discoveryRootSignature = {
            entries: [{ path: '/roots/a', exists: true, mtimeMs: 2 }],
            opaque: 'settings-a',
        };
        const third = new RuntimeManager(context, sessionManager, logChannel());
        third.registerRuntimeProvider(provider);
        await third.discoverAllRuntimes([]);
        assert.strictEqual(
            discoveryCalls,
            2,
            'a changed discovery root must bypass an otherwise valid cache bucket',
        );
        third.dispose();
        await fs.rm(directory, { recursive: true, force: true });
    });

    test('prefers a freshly resolved workspace installation over a cached global installation', async () => {
        const context = { globalState: new MemoryMemento() } as unknown as vscode.ExtensionContext;
        const registered: LanguageRuntimeMetadata[] = [];
        const manager = new RuntimeManager(context, {
            registerDiscoveredRuntime: (_languageId: string, _installation: unknown, metadata: LanguageRuntimeMetadata) => {
                registered.push(metadata);
            },
        } as any, logChannel());
        const globalInstallation = { path: '/usr/bin/python' };
        const workspaceInstallation = { path: '/workspace/.venv/bin/python' };
        const provider: ILanguageRuntimeProvider<{ path: string }> = {
            languageId: 'python',
            languageName: 'Python',
            discoverInstallations: async function* () { return; },
            resolveInitialInstallation: async () => workspaceInstallation,
            promptForInstallation: async () => undefined,
            formatRuntimeName: installation => installation.path,
            getRuntimePath: installation => installation.path,
            getRuntimeSource: () => 'test',
            createRuntimeMetadata: (_extensionContext, installation) => ({
                runtimeId: installation.path,
                runtimeName: installation.path,
                runtimePath: installation.path,
                runtimeVersion: '1',
                runtimeShortName: '1',
                runtimeSource: 'test',
                languageId: 'python',
                languageName: 'Python',
                languageVersion: '3',
            }),
            createKernelSpec: async () => ({
                argv: [],
                display_name: 'Python',
                language: 'python',
                kernel_protocol_version: '5.3',
            }),
            shouldRecommendForWorkspace: async () => true,
        };
        manager.registerRuntimeProvider(provider);
        manager.registerDiscoveredRuntime('python', globalInstallation, provider.createRuntimeMetadata(
            context,
            globalInstallation,
            logChannel(),
        ));

        const recommendations = await manager.recommendWorkspaceRuntimes([]);

        assert.strictEqual(recommendations[0]?.runtimePath, workspaceInstallation.path);
        assert.strictEqual(registered.at(-1)?.runtimePath, workspaceInstallation.path);
        manager.dispose();
    });
});
