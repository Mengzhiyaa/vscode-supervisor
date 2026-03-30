import * as assert from 'assert';
import * as vscode from 'vscode';
import { LanguageRuntimeSessionMode } from '../../api';
import { ViewIds } from '../../coreCommandIds';
import { PositronConsoleService, PositronConsoleState } from '../../services/console';

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'console-service-focus-unit-test',
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

suite('[Unit] console service focus preservation', () => {
    const originalActiveTextEditor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor');
    const originalShowTextDocument = vscode.window.showTextDocument.bind(vscode.window);
    const originalExecuteCommand = vscode.commands.executeCommand.bind(vscode.commands);

    function setActiveTextEditor(editor: vscode.TextEditor | undefined): void {
        Object.defineProperty(vscode.window, 'activeTextEditor', {
            configurable: true,
            get: () => editor,
        });
    }

    teardown(() => {
        (vscode.window as { showTextDocument: typeof vscode.window.showTextDocument }).showTextDocument = originalShowTextDocument;
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = originalExecuteCommand;

        if (originalActiveTextEditor) {
            Object.defineProperty(vscode.window, 'activeTextEditor', originalActiveTextEditor);
        } else {
            setActiveTextEditor(undefined);
        }
    });

    test('shows an existing console view without restoring editor focus when preserveFocus is enabled', async () => {
        const service = new PositronConsoleService({} as any, makeNoopLogChannel());
        const showCalls: boolean[] = [];
        const restoreCalls: vscode.TextDocument[] = [];

        const document = vscode.Uri.parse('file:///workspace/focus-test.R');
        const editor = {
            document: { uri: document } as vscode.TextDocument,
            viewColumn: vscode.ViewColumn.One,
        } as vscode.TextEditor;

        setActiveTextEditor(editor);
        (vscode.window as { showTextDocument: typeof vscode.window.showTextDocument }).showTextDocument =
            (async (target, options) => {
                void options;
                restoreCalls.push(target as vscode.TextDocument);
                return editor;
            }) as typeof vscode.window.showTextDocument;

        service.setConsoleViewProvider({
            view: {
                visible: false,
                show: (preserveFocus?: boolean) => {
                    showCalls.push(Boolean(preserveFocus));
                },
            } as vscode.WebviewView,
        });

        await service.revealConsole(true);

        assert.deepStrictEqual(showCalls, [true]);
        assert.strictEqual(restoreCalls.length, 0);

        service.dispose();
    });

    test('reveals console view without restoring editor focus when provider is unavailable', async () => {
        const service = new PositronConsoleService({} as any, makeNoopLogChannel());
        const executedCommands: Array<{ command: string; args: unknown[] }> = [];
        const restoreCalls: Array<vscode.TextDocument> = [];

        const document = vscode.Uri.parse('file:///workspace/fallback-focus-test.R');
        const editor = {
            document: { uri: document } as vscode.TextDocument,
            viewColumn: vscode.ViewColumn.Two,
        } as vscode.TextEditor;

        setActiveTextEditor(editor);
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
            (async (command: string, ...args: unknown[]) => {
                executedCommands.push({ command, args });
                return undefined;
            }) as typeof vscode.commands.executeCommand;
        (vscode.window as { showTextDocument: typeof vscode.window.showTextDocument }).showTextDocument =
            (async (target, options) => {
                void options;
                restoreCalls.push(target as vscode.TextDocument);
                return editor;
            }) as typeof vscode.window.showTextDocument;

        await service.revealConsole(true);

        assert.deepStrictEqual(executedCommands, [{
            command: 'workbench.views.action.showView',
            args: [ViewIds.console],
        }]);
        assert.deepStrictEqual(restoreCalls, []);

        service.dispose();
    });

    test('executeCode prefers an existing console for the requested language and updates foreground session', async () => {
        const sessionManager = {
            foregroundSession: undefined,
            startNewRuntimeSession: async () => {
                throw new Error('Expected existing console instance to be reused');
            },
            startConsoleSession: async () => {
                throw new Error('Expected existing console instance to be reused');
            },
        } as any;
        const service = new PositronConsoleService(sessionManager, makeNoopLogChannel());
        const revealCalls: boolean[] = [];
        const executionCalls: string[] = [];

        service.setConsoleViewProvider({
            reveal: async (preserveFocus: boolean) => {
                revealCalls.push(preserveFocus);
            },
        });

        const pythonSession = { sessionId: 'python-session' };
        const rSession = { sessionId: 'r-session' };
        const pythonInstance = {
            sessionId: 'python-session',
            runtimeMetadata: { languageId: 'python' },
            sessionMetadata: { createdTimestamp: 1, sessionMode: LanguageRuntimeSessionMode.Console },
            attachedRuntimeSession: pythonSession,
            enqueueCode: async () => undefined,
            focusInput: () => undefined,
            dispose: () => undefined,
        } as any;
        const rInstance = {
            sessionId: 'r-session',
            runtimeMetadata: { languageId: 'r' },
            sessionMetadata: { createdTimestamp: 2, sessionMode: LanguageRuntimeSessionMode.Console },
            attachedRuntimeSession: rSession,
            enqueueCode: async (code: string) => {
                executionCalls.push(code);
            },
            focusInput: () => undefined,
            dispose: () => undefined,
        } as any;

        (service as any)._consoleInstancesBySessionId.set(pythonInstance.sessionId, pythonInstance);
        (service as any)._consoleInstancesBySessionId.set(rInstance.sessionId, rInstance);
        (service as any)._activeConsoleInstance = pythonInstance;

        const sessionId = await service.executeCode(
            'r',
            undefined,
            'mean(x)',
            { source: 'editor' },
            false,
        );

        assert.deepStrictEqual(revealCalls, [true]);
        assert.strictEqual(sessionId, 'r-session');
        assert.deepStrictEqual(executionCalls, ['mean(x)']);
        assert.strictEqual(service.activePositronConsoleInstance, rInstance);
        assert.strictEqual(sessionManager.foregroundSession, rSession);

        service.dispose();
    });

    test('executeCode ignores a non-console active instance when selecting a language target', async () => {
        const sessionManager = {
            foregroundSession: undefined,
            startNewRuntimeSession: async () => {
                throw new Error('Expected existing console instance to be reused');
            },
            startConsoleSession: async () => {
                throw new Error('Expected existing console instance to be reused');
            },
            getRuntimeProvider: () => ({ languageId: 'r' }),
        } as any;
        const service = new PositronConsoleService(sessionManager, makeNoopLogChannel());
        const executionCalls: string[] = [];

        service.setConsoleViewProvider({
            reveal: async () => undefined,
        });

        const notebookBackedSession = { sessionId: 'r-notebook-session' };
        const consoleSession = { sessionId: 'r-console-session' };
        const notebookInstance = {
            sessionId: 'r-notebook-session',
            runtimeMetadata: { languageId: 'r' },
            sessionMetadata: { createdTimestamp: 3, sessionMode: LanguageRuntimeSessionMode.Notebook },
            attachedRuntimeSession: notebookBackedSession,
            enqueueCode: async () => undefined,
            focusInput: () => undefined,
            dispose: () => undefined,
        } as any;
        const consoleInstance = {
            sessionId: 'r-console-session',
            runtimeMetadata: { languageId: 'r' },
            sessionMetadata: { createdTimestamp: 2, sessionMode: LanguageRuntimeSessionMode.Console },
            attachedRuntimeSession: consoleSession,
            enqueueCode: async (code: string) => {
                executionCalls.push(code);
            },
            focusInput: () => undefined,
            dispose: () => undefined,
        } as any;

        (service as any)._consoleInstancesBySessionId.set(notebookInstance.sessionId, notebookInstance);
        (service as any)._consoleInstancesBySessionId.set(consoleInstance.sessionId, consoleInstance);
        (service as any)._activeConsoleInstance = notebookInstance;

        const sessionId = await service.executeCode(
            'r',
            undefined,
            'mean(y)',
            { source: 'editor' },
            false,
        );

        assert.strictEqual(sessionId, 'r-console-session');
        assert.deepStrictEqual(executionCalls, ['mean(y)']);
        assert.strictEqual(service.activePositronConsoleInstance, consoleInstance);
        assert.strictEqual(sessionManager.foregroundSession, consoleSession);

        service.dispose();
    });

    test('executeCode skips a failed active console instance and reuses a healthy console for the same language', async () => {
        const sessionManager = {
            foregroundSession: undefined,
            startNewRuntimeSession: async () => {
                throw new Error('Expected existing console instance to be reused');
            },
            startConsoleSession: async () => {
                throw new Error('Expected existing console instance to be reused');
            },
            getRuntimeProvider: () => ({ languageId: 'r' }),
        } as any;
        const service = new PositronConsoleService(sessionManager, makeNoopLogChannel());
        const executionCalls: string[] = [];

        service.setConsoleViewProvider({
            reveal: async () => undefined,
        });

        const failedSession = { sessionId: 'r-failed-session' };
        const healthySession = { sessionId: 'r-healthy-session' };
        const failedInstance = {
            sessionId: 'r-failed-session',
            runtimeMetadata: { languageId: 'r' },
            sessionMetadata: { createdTimestamp: 3, sessionMode: LanguageRuntimeSessionMode.Console },
            attachedRuntimeSession: failedSession,
            runtimeAttached: false,
            state: PositronConsoleState.Exited,
            enqueueCode: async () => {
                throw new Error('Expected failed console instance to be skipped');
            },
            focusInput: () => undefined,
            dispose: () => undefined,
        } as any;
        const healthyInstance = {
            sessionId: 'r-healthy-session',
            runtimeMetadata: { languageId: 'r' },
            sessionMetadata: { createdTimestamp: 2, sessionMode: LanguageRuntimeSessionMode.Console },
            attachedRuntimeSession: healthySession,
            runtimeAttached: true,
            state: PositronConsoleState.Ready,
            enqueueCode: async (code: string) => {
                executionCalls.push(code);
            },
            focusInput: () => undefined,
            dispose: () => undefined,
        } as any;

        (service as any)._consoleInstancesBySessionId.set(failedInstance.sessionId, failedInstance);
        (service as any)._consoleInstancesBySessionId.set(healthyInstance.sessionId, healthyInstance);
        (service as any)._activeConsoleInstance = failedInstance;

        const sessionId = await service.executeCode(
            'r',
            undefined,
            'mean(z)',
            { source: 'editor' },
            false,
        );

        assert.strictEqual(sessionId, 'r-healthy-session');
        assert.deepStrictEqual(executionCalls, ['mean(z)']);
        assert.strictEqual(service.activePositronConsoleInstance, healthyInstance);
        assert.strictEqual(sessionManager.foregroundSession, healthySession);

        service.dispose();
    });

    test('executeCode rejects explicit session ids for failed console instances', async () => {
        const service = new PositronConsoleService({} as any, makeNoopLogChannel());

        service.setConsoleViewProvider({
            reveal: async () => undefined,
        });

        const failedInstance = {
            sessionId: 'r-failed-session',
            runtimeMetadata: { languageId: 'r' },
            sessionMetadata: { createdTimestamp: 1, sessionMode: LanguageRuntimeSessionMode.Console },
            runtimeAttached: false,
            state: PositronConsoleState.Exited,
            enqueueCode: async () => undefined,
            focusInput: () => undefined,
            dispose: () => undefined,
        } as any;

        (service as any)._consoleInstancesBySessionId.set(failedInstance.sessionId, failedInstance);

        await assert.rejects(
            () => service.executeCode('r', failedInstance.sessionId, 'mean(z)', { source: 'editor' }, false),
            /cannot accept code execution/i,
        );

        service.dispose();
    });

    test('keeps the active console pinned while it transiently exits during restart', () => {
        const sessionManager = {
            foregroundSession: { sessionId: 'r-active-session' },
        } as any;
        const service = new PositronConsoleService(sessionManager, makeNoopLogChannel());

        const createInstance = (sessionId: string, activate: boolean) => {
            return (service as any)._createPositronConsoleInstance(
                {
                    sessionId,
                    sessionName: sessionId,
                    sessionMode: LanguageRuntimeSessionMode.Console,
                    createdTimestamp: sessionId === 'r-active-session' ? 2 : 1,
                },
                {
                    runtimeId: `${sessionId}-runtime`,
                    runtimeName: 'R 4.4.1',
                    runtimePath: `/runtime/${sessionId}`,
                    runtimeVersion: '0.0.1',
                    runtimeShortName: '4.4.1',
                    runtimeSource: 'system',
                    languageId: 'r',
                    languageName: 'R',
                    languageVersion: '4.4.1',
                },
                activate,
            );
        };

        const activeInstance = createInstance('r-active-session', true);
        const healthyInstance = createInstance('r-healthy-session', false);

        (activeInstance as any)._runtimeAttached = false;
        (healthyInstance as any)._runtimeAttached = true;
        (healthyInstance as any).setState(PositronConsoleState.Ready);
        (activeInstance as any).setState(PositronConsoleState.Exited);

        assert.strictEqual(service.activePositronConsoleInstance?.sessionId, 'r-active-session');

        service.dispose();
    });

    test('executeCode rejects languages without a registered runtime provider before fallback startup', async () => {
        let startConsoleSessionCalls = 0;
        const sessionManager = {
            foregroundSession: undefined,
            startNewRuntimeSession: async () => {
                throw new Error('Expected no runtime startup for unsupported language');
            },
            startConsoleSession: async () => {
                startConsoleSessionCalls += 1;
                throw new Error('Expected no fallback console startup for unsupported language');
            },
            getRuntimeProvider: () => undefined,
        } as any;
        const service = new PositronConsoleService(sessionManager, makeNoopLogChannel());

        service.setConsoleViewProvider({
            reveal: async () => undefined,
        });

        await assert.rejects(
            () => service.executeCode('python', undefined, 'print(1)', { source: 'editor' }, false),
            /no registered runtime/i,
        );
        assert.strictEqual(startConsoleSessionCalls, 0);

        service.dispose();
    });

    test('revealExecution reveals the console without requesting focus', () => {
        const service = new PositronConsoleService({} as any, makeNoopLogChannel());
        const revealCalls: boolean[] = [];

        service.setConsoleViewProvider({
            reveal: async (preserveFocus: boolean) => {
                revealCalls.push(preserveFocus);
            },
        });

        const instance = {
            sessionId: 'r-session',
            runtimeMetadata: { languageId: 'r' },
            sessionMetadata: { createdTimestamp: 1, sessionMode: LanguageRuntimeSessionMode.Console },
            revealExecution: () => true,
            dispose: () => undefined,
        } as any;

        (service as any)._consoleInstancesBySessionId.set(instance.sessionId, instance);

        service.revealExecution('r-session', 'exec-1');

        assert.deepStrictEqual(revealCalls, [true]);

        service.dispose();
    });
});
