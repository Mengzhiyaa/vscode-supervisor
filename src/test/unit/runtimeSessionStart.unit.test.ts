import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageRuntimeSessionMode,
    type LanguageRuntimeMetadata,
    type IRuntimeSessionMetadata,
} from '../../api';
import { RuntimeStartMode, RuntimeState } from '../../internal/runtimeTypes';
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
        name: 'runtime-session-start-unit-test',
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

function makeRuntimeMetadata(runtimeId: string = 'runtime-1'): LanguageRuntimeMetadata {
    return {
        runtimeId,
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

function makeConsoleSession(
    runtimeMetadata: LanguageRuntimeMetadata,
    sessionId: string,
): {
    sessionId: string;
    runtimeMetadata: LanguageRuntimeMetadata;
    sessionMetadata: IRuntimeSessionMetadata;
    state: RuntimeState;
    created: number;
} {
    return {
        sessionId,
        runtimeMetadata,
        sessionMetadata: {
            sessionId,
            sessionMode: LanguageRuntimeSessionMode.Console,
            sessionName: sessionId,
            createdTimestamp: Date.now(),
            startReason: 'unit-test',
        },
        state: RuntimeState.Ready,
        created: Date.now(),
    };
}

function makeNotebookSession(
    runtimeMetadata: LanguageRuntimeMetadata,
    sessionId: string,
    notebookUri: vscode.Uri,
): {
    sessionId: string;
    runtimeMetadata: LanguageRuntimeMetadata;
    sessionMetadata: IRuntimeSessionMetadata;
    state: RuntimeState;
    created: number;
} {
    return {
        sessionId,
        runtimeMetadata,
        sessionMetadata: {
            sessionId,
            sessionMode: LanguageRuntimeSessionMode.Notebook,
            sessionName: sessionId,
            notebookUri,
            createdTimestamp: Date.now(),
            startReason: 'unit-test',
        },
        state: RuntimeState.Ready,
        created: Date.now(),
    };
}

function makeAttachableConsoleSession(
    runtimeMetadata: LanguageRuntimeMetadata,
    sessionId: string,
): {
    session: {
        sessionId: string;
        runtimeMetadata: LanguageRuntimeMetadata;
        sessionMetadata: IRuntimeSessionMetadata;
        state: RuntimeState;
        created: number;
        workingDirectory: string | undefined;
        clientManager: undefined;
        dynState: {
            sessionName: string;
            inputPrompt: string;
            continuationPrompt: string;
            busy: boolean;
            currentWorkingDirectory: string | undefined;
        };
        onDidCreateClientManager: vscode.Event<unknown>;
        onDidChangeRuntimeState: vscode.Event<RuntimeState>;
        onDidChangeWorkingDirectory: vscode.Event<string>;
        onDidEndSession: vscode.Event<unknown>;
        setForeground: (_foreground: boolean) => void;
        dispose: () => Promise<void>;
    };
    fireRuntimeState: (state: RuntimeState) => void;
    dispose: () => void;
} {
    const onDidCreateClientManager = new vscode.EventEmitter<unknown>();
    const onDidChangeRuntimeState = new vscode.EventEmitter<RuntimeState>();
    const onDidChangeWorkingDirectory = new vscode.EventEmitter<string>();
    const onDidEndSession = new vscode.EventEmitter<unknown>();
    const sessionMetadata: IRuntimeSessionMetadata = {
        sessionId,
        sessionMode: LanguageRuntimeSessionMode.Console,
        sessionName: sessionId,
        createdTimestamp: Date.now(),
        startReason: 'unit-test',
    };

    const session = {
        sessionId,
        runtimeMetadata,
        sessionMetadata,
        state: RuntimeState.Idle,
        created: Date.now(),
        workingDirectory: undefined,
        clientManager: undefined,
        dynState: {
            sessionName: sessionId,
            inputPrompt: '>',
            continuationPrompt: '+',
            busy: false,
            currentWorkingDirectory: undefined,
        },
        onDidCreateClientManager: onDidCreateClientManager.event,
        onDidChangeRuntimeState: onDidChangeRuntimeState.event,
        onDidChangeWorkingDirectory: onDidChangeWorkingDirectory.event,
        onDidEndSession: onDidEndSession.event,
        setForeground: (_foreground: boolean) => undefined,
        dispose: async () => undefined,
    };

    return {
        session,
        fireRuntimeState: (state: RuntimeState) => {
            session.state = state;
            onDidChangeRuntimeState.fire(state);
        },
        dispose: () => {
            onDidCreateClientManager.dispose();
            onDidChangeRuntimeState.dispose();
            onDidChangeWorkingDirectory.dispose();
            onDidEndSession.dispose();
        },
    };
}

suite('[Unit] runtime session start semantics', () => {
    test('allows multiple console sessions for the same runtime', async () => {
        const service = new RuntimeSessionService(makeContext(), makeNoopLogChannel());
        const runtimeMetadata = makeRuntimeMetadata();
        let createCalls = 0;

        (service as any)._requireRuntimeEntry = () => ({
            metadata: runtimeMetadata,
            installation: {},
            provider: {},
        });
        (service as any)._doCreateRuntimeSession = async () => `session-${++createCalls}`;

        const firstSessionId = await service.startNewRuntimeSession(
            runtimeMetadata.runtimeId,
            runtimeMetadata.runtimeName,
            LanguageRuntimeSessionMode.Console,
            undefined,
            'unit-test',
            RuntimeStartMode.Starting,
            true,
        );
        const secondSessionId = await service.startNewRuntimeSession(
            runtimeMetadata.runtimeId,
            runtimeMetadata.runtimeName,
            LanguageRuntimeSessionMode.Console,
            undefined,
            'unit-test',
            RuntimeStartMode.Starting,
            true,
        );

        assert.strictEqual(createCalls, 2);
        assert.notStrictEqual(firstSessionId, secondSessionId);
        service.dispose();
    });

    test('reuses the existing notebook session for the same runtime and notebook URI', async () => {
        const service = new RuntimeSessionService(makeContext(), makeNoopLogChannel());
        const runtimeMetadata = makeRuntimeMetadata();
        const notebookUri = vscode.Uri.parse('file:///workspace/notebook.ipynb');
        let createCalls = 0;

        (service as any)._requireRuntimeEntry = () => ({
            metadata: runtimeMetadata,
            installation: {},
            provider: {},
        });
        (service as any)._doCreateRuntimeSession = async () => {
            createCalls += 1;
            return `session-${createCalls}`;
        };
        (service as any)._notebookSessionsByNotebookUri.set(
            notebookUri.toString(),
            makeNotebookSession(runtimeMetadata, 'notebook-session-1', notebookUri),
        );

        const sessionId = await service.startNewRuntimeSession(
            runtimeMetadata.runtimeId,
            runtimeMetadata.runtimeName,
            LanguageRuntimeSessionMode.Notebook,
            notebookUri,
            'unit-test',
            RuntimeStartMode.Starting,
            false,
        );

        assert.strictEqual(sessionId, 'notebook-session-1');
        assert.strictEqual(createCalls, 0);
        service.dispose();
    });

    test('allows console and notebook sessions for the same runtime to start concurrently', async () => {
        const service = new RuntimeSessionService(makeContext(), makeNoopLogChannel());
        const runtimeMetadata = makeRuntimeMetadata();
        const notebookUri = vscode.Uri.parse('file:///workspace/notebook.ipynb');
        let createCalls = 0;

        (service as any)._requireRuntimeEntry = () => ({
            metadata: runtimeMetadata,
            installation: {},
            provider: {},
        });
        (service as any)._doCreateRuntimeSession = async (
            _metadata: LanguageRuntimeMetadata,
            _sessionName: string,
            sessionMode: LanguageRuntimeSessionMode,
        ) => {
            createCalls += 1;
            await new Promise((resolve) => setTimeout(resolve, 10));
            return sessionMode === LanguageRuntimeSessionMode.Console
                ? 'console-session'
                : 'notebook-session';
        };

        const [consoleSessionId, notebookSessionId] = await Promise.all([
            service.startNewRuntimeSession(
                runtimeMetadata.runtimeId,
                runtimeMetadata.runtimeName,
                LanguageRuntimeSessionMode.Console,
                undefined,
                'unit-test',
                RuntimeStartMode.Starting,
                true,
            ),
            service.startNewRuntimeSession(
                runtimeMetadata.runtimeId,
                runtimeMetadata.runtimeName,
                LanguageRuntimeSessionMode.Notebook,
                notebookUri,
                'unit-test',
                RuntimeStartMode.Starting,
                false,
            ),
        ]);

        assert.strictEqual(createCalls, 2);
        assert.strictEqual(consoleSessionId, 'console-session');
        assert.strictEqual(notebookSessionId, 'notebook-session');
        service.dispose();
    });

    test('cleans console and notebook session maps after exit', () => {
        const service = new RuntimeSessionService(makeContext(), makeNoopLogChannel());
        const runtimeMetadata = makeRuntimeMetadata();
        const notebookUri = vscode.Uri.parse('file:///workspace/notebook.ipynb');
        const consoleSession = makeConsoleSession(runtimeMetadata, 'console-session-1');
        const notebookSession = makeNotebookSession(runtimeMetadata, 'notebook-session-1', notebookUri);

        (service as any)._consoleSessionsByRuntimeId.set(runtimeMetadata.runtimeId, [consoleSession]);
        (service as any)._notebookSessionsByNotebookUri.set(notebookUri.toString(), notebookSession);

        (service as any).updateSessionMapsAfterExit(consoleSession);
        (service as any).updateSessionMapsAfterExit(notebookSession);

        assert.strictEqual((service as any)._consoleSessionsByRuntimeId.has(runtimeMetadata.runtimeId), false);
        assert.strictEqual((service as any)._notebookSessionsByNotebookUri.has(notebookUri.toString()), false);
        service.dispose();
    });

    test('treats exited to starting as a restart for attached sessions', () => {
        const service = new RuntimeSessionService(makeContext(), makeNoopLogChannel());
        const runtimeMetadata = makeRuntimeMetadata();
        const { session, fireRuntimeState, dispose } = makeAttachableConsoleSession(
            runtimeMetadata,
            'console-session-1',
        );
        const willStartEvents: RuntimeStartMode[] = [];
        const runtimeTransitions: Array<{ oldState: RuntimeState; newState: RuntimeState }> = [];

        service.onWillStartSession((event) => {
            willStartEvents.push(event.startMode);
        });
        service.onDidChangeRuntimeState((event) => {
            runtimeTransitions.push({
                oldState: event.old_state,
                newState: event.new_state,
            });
        });

        (service as any).attachToSession(session, true, true);

        fireRuntimeState(RuntimeState.Exited);
        fireRuntimeState(RuntimeState.Starting);

        assert.deepStrictEqual(runtimeTransitions, [
            {
                oldState: RuntimeState.Idle,
                newState: RuntimeState.Exited,
            },
            {
                oldState: RuntimeState.Exited,
                newState: RuntimeState.Starting,
            },
        ]);
        assert.deepStrictEqual(willStartEvents, [RuntimeStartMode.Restarting]);

        dispose();
        service.dispose();
    });
});
