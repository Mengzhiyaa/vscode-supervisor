import * as assert from 'assert';
import * as vscode from 'vscode';
import { ViewIds } from '../../coreCommandIds';
import { PositronConsoleService } from '../../services/console';

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

    function getShowOptions(
        value: vscode.ViewColumn | vscode.TextDocumentShowOptions | undefined,
    ): vscode.TextDocumentShowOptions | undefined {
        return typeof value === 'object' && value !== null ? value : undefined;
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

    test('restores editor focus after revealing a hidden console view with preserveFocus', async () => {
        const service = new PositronConsoleService({} as any, makeNoopLogChannel());
        const showCalls: boolean[] = [];
        const restoreCalls: Array<{
            document: vscode.TextDocument;
            viewColumnOrOptions?: vscode.ViewColumn | vscode.TextDocumentShowOptions;
        }> = [];

        const document = vscode.Uri.parse('file:///workspace/focus-test.R');
        const editor = {
            document: { uri: document } as vscode.TextDocument,
            viewColumn: vscode.ViewColumn.One,
        } as vscode.TextEditor;

        setActiveTextEditor(editor);
        (vscode.window as { showTextDocument: typeof vscode.window.showTextDocument }).showTextDocument =
            (async (target, options) => {
                restoreCalls.push({
                    document: target as vscode.TextDocument,
                    viewColumnOrOptions: options,
                });
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
        assert.strictEqual(restoreCalls.length, 1);
        assert.strictEqual(restoreCalls[0].document, editor.document);
        assert.strictEqual(getShowOptions(restoreCalls[0].viewColumnOrOptions)?.viewColumn, vscode.ViewColumn.One);
        assert.strictEqual(getShowOptions(restoreCalls[0].viewColumnOrOptions)?.preserveFocus, false);

        service.dispose();
    });

    test('reveals console view without stealing focus when provider is unavailable', async () => {
        const service = new PositronConsoleService({} as any, makeNoopLogChannel());
        const executedCommands: Array<{ command: string; args: unknown[] }> = [];
        const restoreCalls: Array<{
            document: vscode.TextDocument;
            viewColumnOrOptions?: vscode.ViewColumn | vscode.TextDocumentShowOptions;
        }> = [];

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
                restoreCalls.push({
                    document: target as vscode.TextDocument,
                    viewColumnOrOptions: options,
                });
                return editor;
            }) as typeof vscode.window.showTextDocument;

        await service.revealConsole(true);

        assert.deepStrictEqual(executedCommands, [{
            command: 'workbench.views.action.showView',
            args: [ViewIds.console],
        }]);
        assert.strictEqual(restoreCalls.length, 1);
        assert.strictEqual(restoreCalls[0].document, editor.document);
        assert.strictEqual(getShowOptions(restoreCalls[0].viewColumnOrOptions)?.viewColumn, vscode.ViewColumn.Two);
        assert.strictEqual(getShowOptions(restoreCalls[0].viewColumnOrOptions)?.preserveFocus, false);

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
            sessionMetadata: { createdTimestamp: 1 },
            attachedRuntimeSession: pythonSession,
            enqueueCode: async () => undefined,
            focusInput: () => undefined,
            dispose: () => undefined,
        } as any;
        const rInstance = {
            sessionId: 'r-session',
            runtimeMetadata: { languageId: 'r' },
            sessionMetadata: { createdTimestamp: 2 },
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
            sessionMetadata: { createdTimestamp: 1 },
            revealExecution: () => true,
            dispose: () => undefined,
        } as any;

        (service as any)._consoleInstancesBySessionId.set(instance.sessionId, instance);

        service.revealExecution('r-session', 'exec-1');

        assert.deepStrictEqual(revealCalls, [true]);

        service.dispose();
    });
});
