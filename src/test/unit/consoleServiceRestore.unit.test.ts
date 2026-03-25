import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { PositronConsoleService, PositronConsoleState } from '../../services/console';

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

function makeContext(workspaceStateEntries: Record<string, unknown> = {}): vscode.ExtensionContext {
    const extensionPath = path.resolve(__dirname, '../../..');
    return {
        extensionPath,
        extensionUri: vscode.Uri.file(extensionPath),
        subscriptions: [],
        globalState: createMemento(),
        workspaceState: createMemento(workspaceStateEntries),
        asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
    } as unknown as vscode.ExtensionContext;
}

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'console-service-restore-unit-test',
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

suite('[Unit] console service restored session placeholders', () => {
    test('creates provisional console instances for restored sessions and surfaces restore failures', async () => {
        const sessionId = 'restored-r-session';
        const onSessionRestoreFailure = new vscode.EventEmitter<{ sessionId: string; error: Error }>();
        const service = new PositronConsoleService(
            {
                sessions: [],
                activeSessionId: undefined,
                onWillStartSession: createEventStub(),
                onDidChangeForegroundSession: createEventStub(),
                onDidDeleteRuntimeSession: createEventStub(),
                onDidReceiveRuntimeEvent: createEventStub(),
            } as any,
            makeNoopLogChannel(),
            makeContext({
                [`vscode-supervisor.console.state.${sessionId}`]: {
                    version: 2,
                    items: [],
                    inputHistory: ['1 + 1'],
                    trace: false,
                    wordWrap: true,
                    inputPrompt: '>',
                    continuationPrompt: '+',
                    workingDirectory: '/tmp/restored',
                },
            }),
            {
                getRestoredSessions: async () => [{
                    sessionName: 'Restored R',
                    runtimeMetadata: {
                        runtimeId: 'r-restore',
                        runtimeName: 'R 4.4.1',
                        runtimePath: '/usr/bin/R',
                        runtimeVersion: '0.0.1',
                        runtimeShortName: '4.4.1',
                        runtimeSource: 'system',
                        languageId: 'r',
                        languageName: 'R',
                        languageVersion: '4.4.1',
                    },
                    metadata: {
                        sessionId,
                        sessionName: 'Restored R',
                        sessionMode: 'console',
                    },
                    sessionState: 'ready',
                    workingDirectory: '/tmp/restored',
                    hasConsole: true,
                    lastUsed: Date.now(),
                }],
                onSessionRestoreFailure: onSessionRestoreFailure.event,
            } as any,
        );

        service.initialize();
        await Promise.resolve();
        await Promise.resolve();

        const instance = service.getConsoleInstance(sessionId);
        assert.ok(instance);
        assert.strictEqual(service.activePositronConsoleInstance?.sessionId, sessionId);
        assert.strictEqual(instance?.runtimeAttached, false);
        assert.strictEqual(instance?.workingDirectory, '/tmp/restored');
        assert.deepStrictEqual(instance?.inputHistory, ['1 + 1']);

        onSessionRestoreFailure.fire({
            sessionId,
            error: new Error('Session is no longer available'),
        });

        assert.strictEqual(instance?.state, PositronConsoleState.Exited);
        service.dispose();
        onSessionRestoreFailure.dispose();
    });
});
