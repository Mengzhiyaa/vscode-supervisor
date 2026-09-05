import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    type ILanguageLsp,
    LanguageLspState,
    LanguageRuntimeSessionMode,
    LanguageRuntimeStartupBehavior,
    type LanguageRuntimeMetadata,
    type IRuntimeSessionMetadata,
} from '../../api';
import { RuntimeStartMode, RuntimeState } from '../../internal/runtimeTypes';
import { RuntimeSessionService } from '../../runtime/runtimeSession';
import { RuntimeSession } from '../../runtime/session';

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

function registerNotebookController(service: RuntimeSessionService): vscode.Disposable {
    return service.registerNotebookController({
        id: 'r-notebook-controller',
        notebookType: 'jupyter-notebook',
        supportedLanguages: ['r'],
    } as vscode.NotebookController, ['r']);
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
        startupBehavior: LanguageRuntimeStartupBehavior.Explicit,
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
        readonly isForeground: boolean;
        start: () => Promise<void>;
        setForeground: (_foreground: boolean) => void;
        activateLsp: () => Promise<void>;
        deactivateLsp: () => Promise<void>;
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
    let isForeground = false;

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
        get isForeground() { return isForeground; },
        start: async () => undefined,
        setForeground: (foreground: boolean) => { isForeground = foreground; },
        activateLsp: async () => undefined,
        deactivateLsp: async () => undefined,
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
        const controllerRegistration = registerNotebookController(service);
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
        controllerRegistration.dispose();
        service.dispose();
    });

    test('allows console and notebook sessions for the same runtime to start concurrently', async () => {
        const service = new RuntimeSessionService(makeContext(), makeNoopLogChannel());
        const controllerRegistration = registerNotebookController(service);
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
        controllerRegistration.dispose();
        service.dispose();
    });

    test('rejects notebook sessions without a language-owned controller', async () => {
        const service = new RuntimeSessionService(makeContext(), makeNoopLogChannel());
        const runtimeMetadata = makeRuntimeMetadata();
        (service as any)._requireRuntimeEntry = () => ({
            metadata: runtimeMetadata,
            installation: {},
            provider: {},
        });

        await assert.rejects(
            service.startNewRuntimeSession(
                runtimeMetadata.runtimeId,
                runtimeMetadata.runtimeName,
                LanguageRuntimeSessionMode.Notebook,
                vscode.Uri.parse('file:///workspace/notebook.ipynb'),
                'unit-test',
                RuntimeStartMode.Starting,
                false,
            ),
            /no language extension has registered ownership/,
        );
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

    test('finalizes and activates a console session that becomes ready after the startup wait times out', async () => {
        const service = new RuntimeSessionService(makeContext(), makeNoopLogChannel());
        const runtimeMetadata = makeRuntimeMetadata();
        const { session, fireRuntimeState, dispose } = makeAttachableConsoleSession(
            runtimeMetadata,
            'late-ready-session',
        );
        session.state = RuntimeState.Starting;
        let activateLspCalls = 0;
        session.activateLsp = async () => { activateLspCalls++; };
        (service as any)._sessions.set(session.sessionId, session);
        (service as any)._waitForSessionReady = async () => {
            const error = new Error('ready observation timed out');
            error.name = 'RuntimeSessionReadyTimeoutError';
            throw error;
        };
        const startedSessionIds: string[] = [];
        const failedSessionIds: string[] = [];
        service.onDidStartRuntime(startedSession => startedSessionIds.push(startedSession.sessionId));
        service.onDidFailStartRuntime(failedSession => failedSessionIds.push(failedSession.sessionId));

        await (service as any).doStartRuntimeSession(
            session,
            RuntimeStartMode.Starting,
            true,
            true,
        );
        assert.deepStrictEqual(startedSessionIds, []);
        assert.deepStrictEqual(failedSessionIds, []);

        fireRuntimeState(RuntimeState.Ready);
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.deepStrictEqual(startedSessionIds, [session.sessionId]);
        assert.deepStrictEqual(failedSessionIds, []);
        assert.strictEqual(service.activeSessionId, session.sessionId);
        assert.ok(activateLspCalls >= 1);

        (service as any)._sessions.delete(session.sessionId);
        dispose();
        service.dispose();
    });

    test('attaches an LSP factory to a session created before language registration', async () => {
        const runtimeMetadata = makeRuntimeMetadata();
        const sessionMetadata: IRuntimeSessionMetadata = {
            sessionId: 'late-lsp-session',
            sessionMode: LanguageRuntimeSessionMode.Console,
            sessionName: 'late-lsp-session',
            createdTimestamp: Date.now(),
            startReason: 'unit-test',
        };
        let disposed = 0;
        const lsp: ILanguageLsp = {
            state: LanguageLspState.Stopped,
            activate: async () => undefined,
            deactivate: async () => undefined,
            wait: async () => false,
            showOutput: () => undefined,
            requestCompletion: async () => [],
            requestHover: async () => null,
            requestSignatureHelp: async () => null,
            dispose: () => { disposed++; },
        };
        const session = new RuntimeSession(
            sessionMetadata.sessionId,
            runtimeMetadata,
            sessionMetadata,
            makeNoopLogChannel(),
        );

        await session.attachLspFactory({
            languageId: runtimeMetadata.languageId,
            create: () => lsp,
        });

        assert.strictEqual(session.lsp, lsp);
        await session.dispose();
        assert.strictEqual(disposed, 1);
    });

    test('replaces and removes LSP factories with generation guards', async () => {
        const runtimeMetadata = makeRuntimeMetadata();
        const sessionMetadata: IRuntimeSessionMetadata = {
            sessionId: 'generation-lsp-session',
            sessionMode: LanguageRuntimeSessionMode.Console,
            sessionName: 'generation-lsp-session',
            createdTimestamp: Date.now(),
            startReason: 'unit-test',
        };
        const disposals = [0, 0];
        const makeLsp = (index: number): ILanguageLsp => ({
            state: LanguageLspState.Stopped,
            activate: async () => undefined,
            deactivate: async () => undefined,
            wait: async () => false,
            showOutput: () => undefined,
            requestCompletion: async () => [],
            requestHover: async () => null,
            requestSignatureHelp: async () => null,
            dispose: () => { disposals[index]++; },
        });
        const first = makeLsp(0);
        const second = makeLsp(1);
        const session = new RuntimeSession(
            sessionMetadata.sessionId,
            runtimeMetadata,
            sessionMetadata,
            makeNoopLogChannel(),
        );

        await session.bindLspFactory({ languageId: 'r', create: () => first }, 1);
        await session.bindLspFactory({ languageId: 'r', create: () => second }, 2);
        await session.removeLspFactory(1);

        assert.strictEqual(session.lsp, second);
        assert.strictEqual(session.boundLspGeneration, 2);
        assert.deepStrictEqual(disposals, [1, 0]);

        await session.removeLspFactory(2);
        assert.notStrictEqual(session.lsp, second);
        assert.deepStrictEqual(disposals, [1, 1]);
        await session.dispose();
    });

    test('delegates working-directory changes to the language-owned hook', async () => {
        const runtimeMetadata = makeRuntimeMetadata();
        const sessionMetadata: IRuntimeSessionMetadata = {
            sessionId: 'working-directory-session',
            sessionMode: LanguageRuntimeSessionMode.Console,
            sessionName: 'working-directory-session',
            createdTimestamp: Date.now(),
            startReason: 'unit-test',
        };
        const requested: string[] = [];
        const session = new RuntimeSession(
            sessionMetadata.sessionId,
            runtimeMetadata,
            sessionMetadata,
            makeNoopLogChannel(),
            sessionMetadata.sessionName,
            undefined,
            {
                setWorkingDirectory: async directory => {
                    requested.push(directory);
                },
            },
        );

        await session.setWorkingDirectory('/workspace/project');

        assert.deepStrictEqual(requested, ['/workspace/project']);
        assert.strictEqual(session.workingDirectory, '/workspace/project');
        await session.dispose();
    });

    test('tracks watchdog state and delegates force quit to the runtime session', async () => {
        const service = new RuntimeSessionService(makeContext(), makeNoopLogChannel());
        let forceQuitCalls = 0;
        const session = {
            sessionId: 'unresponsive-session',
            state: RuntimeState.Interrupting,
            runtimeMetadata: makeRuntimeMetadata(),
            forceQuit: async () => { forceQuitCalls++; },
        };
        (service as any)._sessions.set(session.sessionId, session);
        (service as any)._startStateWatchdog(session, RuntimeState.Interrupting);

        const watchdog = (service as any)._stateWatchdogs.get(session.sessionId);
        assert.deepStrictEqual(watchdog.expectedStates, [RuntimeState.Idle, RuntimeState.Ready]);

        await service.forceQuitSession(session.sessionId);
        assert.strictEqual(forceQuitCalls, 1);
        assert.strictEqual((service as any)._stateWatchdogs.has(session.sessionId), false);
        (service as any)._sessions.delete(session.sessionId);
        service.dispose();
    });
});
