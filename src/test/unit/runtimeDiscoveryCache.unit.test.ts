import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
    ILanguageRuntimeProvider,
    LanguageRuntimeMetadata,
} from '../../api';
import { RuntimeManager } from '../../runtime/manager';

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
        };
        const provider: ILanguageRuntimeProvider<{ path: string }> = {
            languageId: 'cache-language',
            languageName: 'Cache',
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
        await fs.rm(directory, { recursive: true, force: true });
    });
});
