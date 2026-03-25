import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type { LanguageRuntimeMetadata } from '../../api';
import { NewFolderStartupPhase } from '../../newFolder/positronNewFolder';
import { PositronNewFolderService } from '../../newFolder/positronNewFolderService';

function createMemento(initialEntries: Record<string, unknown> = {}): vscode.Memento {
    const store = new Map<string, unknown>(Object.entries(initialEntries));
    return {
        get: <T>(key: string, defaultValue?: T) => {
            return (store.has(key) ? store.get(key) : defaultValue) as T;
        },
        update: async (key: string, value: unknown) => {
            if (value === undefined) {
                store.delete(key);
            } else {
                store.set(key, value);
            }
        },
        keys: () => Array.from(store.keys()),
    };
}

function makeContext(globalStateEntries: Record<string, unknown> = {}): vscode.ExtensionContext {
    const extensionPath = path.resolve(__dirname, '../../..');
    return {
        extensionPath,
        extensionUri: vscode.Uri.file(extensionPath),
        subscriptions: [],
        globalState: createMemento(globalStateEntries),
        workspaceState: createMemento(),
        asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
    } as unknown as vscode.ExtensionContext;
}

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'new-folder-unit-test',
        logLevel: vscode.LogLevel.Trace,
        onDidChangeLogLevel: event,
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

function createDeferred<T = void>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
} {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((innerResolve) => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}

function makeRuntimeMetadata(): LanguageRuntimeMetadata {
    return {
        runtimeId: 'r-4.4.1-test',
        runtimeName: 'R 4.4.1',
        runtimePath: '/usr/bin/R',
        runtimeVersion: '0.0.1',
        runtimeShortName: '4.4.1',
        runtimeSource: 'system',
        languageId: 'r',
        languageName: 'R',
        languageVersion: '4.4.1',
        extraRuntimeData: {
            homepath: '/usr/lib/R',
            binpath: '/usr/bin/R',
        },
    };
}

suite('[Unit] positron new folder service', () => {
    test('completes immediately when there is no new-folder config or tasks', async () => {
        const service = new PositronNewFolderService(makeContext(), makeNoopLogChannel());

        await service.initNewFolder();

        assert.strictEqual(service.startupPhase, NewFolderStartupPhase.Complete);
        assert.strictEqual(service.initTasksComplete.isOpen(), true);
        assert.strictEqual(service.postInitTasksComplete.isOpen(), true);

        service.dispose();
    });

    test('advances through runtime startup and post-initialization phases', async () => {
        const context = makeContext();
        const service = new PositronNewFolderService(context, makeNoopLogChannel());
        const runtimeMetadata = makeRuntimeMetadata();
        const deferredTask = createDeferred<void>();
        const observedPhases: NewFolderStartupPhase[] = [];

        service.onDidChangeNewFolderStartupPhase((phase) => {
            observedPhases.push(phase);
        });
        service.registerInitTask(deferredTask.promise, {
            label: 'prepare-runtime',
            runtimeMetadata,
        });

        const initPromise = service.initNewFolder();
        await Promise.resolve();

        assert.strictEqual(service.startupPhase, NewFolderStartupPhase.CreatingFolder);
        assert.strictEqual(service.initTasksComplete.isOpen(), false);

        deferredTask.resolve();
        await initPromise;

        assert.strictEqual(service.startupPhase, NewFolderStartupPhase.RuntimeStartup);
        assert.strictEqual(service.initTasksComplete.isOpen(), true);
        assert.strictEqual(service.postInitTasksComplete.isOpen(), false);
        assert.strictEqual(service.newFolderRuntimeMetadata?.runtimeId, runtimeMetadata.runtimeId);

        await service.completeRuntimeStartup();

        assert.strictEqual(service.startupPhase, NewFolderStartupPhase.Complete);
        assert.strictEqual(service.postInitTasksComplete.isOpen(), true);
        assert.ok(observedPhases.includes(NewFolderStartupPhase.PostInitialization));
        assert.strictEqual(context.globalState.keys().length, 0);

        service.dispose();
    });
});
