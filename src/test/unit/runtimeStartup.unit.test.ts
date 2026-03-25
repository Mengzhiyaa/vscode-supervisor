import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageRuntimeStartupBehavior } from '../../api';
import { RuntimeStartupService } from '../../runtime/runtimeStartup';

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
        name: 'runtime-startup-unit-test',
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

function createEventStub<T>(): vscode.Event<T> {
    return () => ({ dispose: () => undefined });
}

function createDeferred<T = void>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
} {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
    });

    return { promise, resolve, reject };
}

function makeRuntimeMetadata() {
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
        startupBehavior: LanguageRuntimeStartupBehavior.Manual,
        extraRuntimeData: {
            homepath: '/usr/lib/R',
            binpath: '/usr/bin/R',
        },
    };
}

function makeSessionManager() {
    let persistedRestoreHandler: (() => Promise<void>) | undefined;
    const sessionManager = {
        updateActiveLanguagesCalls: 0,
        value: undefined as any,
    };

    sessionManager.value = {
        sessions: [],
        activeSession: undefined,
        activeSessionId: undefined,
        encounteredLanguages: [],
        implicitStartupSuppressed: false,
        onWillStartSession: createEventStub(),
        onDidStartRuntime: createEventStub(),
        onDidFailStartRuntime: createEventStub(),
        onDidChangeForegroundSession: createEventStub(),
        onDidDeleteRuntimeSession: createEventStub(),
        onDidUpdateSessionName: createEventStub(),
        registerPersistedSessionRestoreHandler: (handler: () => Promise<void>) => {
            persistedRestoreHandler = handler;
        },
        restorePersistedSessionsInBackground: async () => {
            await persistedRestoreHandler?.();
        },
        updateActiveLanguages: () => {
            sessionManager.updateActiveLanguagesCalls += 1;
        },
        hasStartingOrRunningConsole: () => false,
        autoStartRuntime: async () => {
            throw new Error('autoStartRuntime should not be called in this test');
        },
        getSession: () => undefined,
        getActiveSession: () => undefined,
        validateRuntimeSession: async () => true,
        restoreRuntimeSession: async () => undefined,
    } as any;

    return sessionManager;
}

function makeRuntimeManager() {
    return {
        getInstallations: () => [],
        getSupportedLanguageIds: () => [],
        getRuntimeProvider: () => undefined,
        getRuntime: () => undefined,
        runtimes: [],
    } as any;
}

suite('[Unit] runtime startup', () => {
    test('clears dismissal keys for one language or all languages', async () => {
        const context = makeContext({
            'vscode-supervisor.dismissedArchMismatch.v1.r': true,
            'vscode-supervisor.dismissedArchMismatch.v1.python': true,
            'vscode-supervisor.other': true,
        });

        const startupService = new RuntimeStartupService(
            context,
            {
                getInstallations: () => [],
            } as any,
            {
                sessions: [],
                onWillStartSession: createEventStub(),
                onDidStartRuntime: createEventStub(),
                onDidFailStartRuntime: createEventStub(),
                onDidChangeForegroundSession: createEventStub(),
                onDidDeleteRuntimeSession: createEventStub(),
                onDidUpdateSessionName: createEventStub(),
                registerPersistedSessionRestoreHandler: () => undefined,
            } as any,
            makeNoopLogChannel(),
        );

        startupService.resetArchitectureMismatchWarning('r');
        assert.strictEqual(context.globalState.get('vscode-supervisor.dismissedArchMismatch.v1.r'), undefined);
        assert.strictEqual(context.globalState.get('vscode-supervisor.dismissedArchMismatch.v1.python'), true);

        startupService.resetArchitectureMismatchWarning();
        assert.strictEqual(context.globalState.get('vscode-supervisor.dismissedArchMismatch.v1.python'), undefined);
        assert.strictEqual(context.globalState.get('vscode-supervisor.other'), true);

        startupService.dispose();
    });

    test('waits for newly registered new-folder init tasks before continuing startup', async () => {
        const context = makeContext();
        const runtimeMetadata = makeRuntimeMetadata();
        const deferredTask = createDeferred<void>();
        const localSessionManager = makeSessionManager();

        const startupService = new RuntimeStartupService(
            context,
            makeRuntimeManager(),
            localSessionManager.value,
            makeNoopLogChannel(),
        );

        startupService.registerNewFolderInitTask(async () => {
            startupService.registerNewFolderInitTask(deferredTask.promise, {
                label: 'follow-up-task',
                affiliatedRuntimeMetadata: runtimeMetadata,
            });
        }, {
            label: 'initial-task',
        });

        let completed = false;
        const phaseReached = new Promise<void>((resolve) => {
            const disposable = startupService.onDidChangeRuntimeStartupPhase((phase) => {
                if (phase !== 'newFolderTasks') {
                    return;
                }

                disposable.dispose();
                resolve();
            });
        });
        const startupPromise = startupService.startup().then(() => {
            completed = true;
        });

        await phaseReached;
        assert.strictEqual(startupService.startupPhase, 'newFolderTasks');
        assert.strictEqual(completed, false);
        assert.strictEqual(localSessionManager.updateActiveLanguagesCalls, 1);

        deferredTask.resolve();
        await startupPromise;

        assert.strictEqual(completed, true);
        assert.strictEqual(startupService.startupPhase, 'complete');
        assert.strictEqual(localSessionManager.updateActiveLanguagesCalls, 2);
        assert.strictEqual(
            startupService.getAffiliatedRuntimeMetadata(runtimeMetadata.languageId)?.runtimeId,
            runtimeMetadata.runtimeId,
        );

        startupService.dispose();
    });
});
