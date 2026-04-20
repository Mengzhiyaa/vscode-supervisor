import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageRuntimeSessionMode } from '../../api';
import { RuntimeState } from '../../internal/runtimeTypes';
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

    test('detaches local sessions without shutting down runtimes on extension host shutdown', async () => {
        const service = new RuntimeSessionService(makeContext(), makeNoopLogChannel());
        let shutdownCalls = 0;
        let detachCalls = 0;
        let disposeCalls = 0;
        let autoStartDisposeCalls = 0;
        let localSupervisorDisposeCalls = 0;

        const fakeSession = {
            sessionId: 'session-1',
            runtimeMetadata: {
                runtimeId: 'runtime-1',
                runtimeName: 'R 4.4.1',
                runtimePath: '/usr/bin/R',
                runtimeSource: 'system',
                runtimeShortName: '4.4.1',
                runtimeVersion: '4.4.1',
                languageId: 'r',
                languageName: 'R',
                languageVersion: '4.4.1',
            },
            sessionMetadata: {
                sessionId: 'session-1',
                sessionName: 'session-1',
                sessionMode: LanguageRuntimeSessionMode.Console,
                createdTimestamp: 1,
                startReason: 'unit-test',
            },
            state: RuntimeState.Ready,
            created: 1,
            shutdown: async () => {
                shutdownCalls += 1;
            },
            detachForExtensionHostShutdown: async () => {
                detachCalls += 1;
            },
            dispose: async () => {
                disposeCalls += 1;
            },
        };

        (service as any)._sessions.set(fakeSession.sessionId, fakeSession);
        (service as any)._foregroundSessionId = fakeSession.sessionId;
        (service as any)._deferredAutoStartDisposablesByRuntimeId.set('runtime-1', {
            dispose: () => {
                autoStartDisposeCalls += 1;
            },
        });
        (service as any)._localSupervisor = {
            dispose: () => {
                localSupervisorDisposeCalls += 1;
            },
        };

        await service.detachForExtensionHostShutdown();

        assert.strictEqual(shutdownCalls, 0);
        assert.strictEqual(detachCalls, 1);
        assert.strictEqual(disposeCalls, 0);
        assert.strictEqual((service as any)._sessions.size, 0);
        assert.strictEqual((service as any)._foregroundSessionId, undefined);
        assert.strictEqual(autoStartDisposeCalls, 1);
        assert.strictEqual(localSupervisorDisposeCalls, 1);

        service.dispose();
    });
});
