import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { RuntimeSessionService } from '../../runtime/runtimeSession';

function createMemento(): vscode.Memento {
    const store = new Map<string, unknown>();
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

function makeContext(): vscode.ExtensionContext {
    const extensionPath = path.resolve(__dirname, '../../..');
    return {
        extensionPath,
        extensionUri: vscode.Uri.file(extensionPath),
        subscriptions: [],
        globalState: createMemento(),
        workspaceState: createMemento(),
        asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
    } as unknown as vscode.ExtensionContext;
}

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'runtime-session-restore-unit-test',
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

suite('[Unit] runtime session persisted restore state', () => {
    test('tracks in-progress restore and waiters', async () => {
        const service = new RuntimeSessionService(makeContext(), makeNoopLogChannel());
        let resolveRestore: (() => void) | undefined;
        let handlerRuns = 0;

        service.registerPersistedSessionRestoreHandler(async () => {
            handlerRuns += 1;
            await new Promise<void>((resolve) => {
                resolveRestore = resolve;
            });
        });

        const restorePromise = service.restorePersistedSessionsInBackground();
        const waiterPromise = service.waitForPersistedSessionRestore();

        assert.strictEqual(service.isRestoringPersistedSessions, true);
        assert.strictEqual(handlerRuns, 1);

        resolveRestore?.();
        await Promise.all([restorePromise, waiterPromise]);

        assert.strictEqual(service.isRestoringPersistedSessions, false);
        service.dispose();
    });
});
