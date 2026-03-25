import * as assert from 'assert';
import * as vscode from 'vscode';
import { CoreCommandIds } from '../../coreCommandIds';
import { registerConsoleActions } from '../../services/console/consoleActions';

type RegisteredCommandHandler = (...args: any[]) => unknown;

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'console-actions-unit-test',
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

function makeEditor(lines: string[], selection: vscode.Selection): vscode.TextEditor {
    const getTextInRange = (range?: vscode.Range): string => {
        if (!range) {
            return lines.join('\n');
        }

        if (range.start.line === range.end.line) {
            return lines[range.start.line].slice(range.start.character, range.end.character);
        }

        const selectedLines = lines.slice(range.start.line, range.end.line + 1);
        selectedLines[0] = selectedLines[0].slice(range.start.character);
        selectedLines[selectedLines.length - 1] =
            selectedLines[selectedLines.length - 1].slice(0, range.end.character);
        return selectedLines.join('\n');
    };

    const document = {
        languageId: 'r',
        uri: vscode.Uri.parse('file:///workspace/test.R'),
        lineCount: lines.length,
        getText: (range?: vscode.Range) => getTextInRange(range),
        lineAt: (line: number) => ({
            text: lines[line],
            range: new vscode.Range(line, 0, line, lines[line].length),
        }),
    } as unknown as vscode.TextDocument;

    return {
        document,
        selection,
        selections: [selection],
        viewColumn: vscode.ViewColumn.One,
        revealRange: () => undefined,
        edit: async () => true,
    } as unknown as vscode.TextEditor;
}

suite('[Unit] console actions', () => {
    const originalRegisterCommand = vscode.commands.registerCommand.bind(vscode.commands);
    const originalExecuteCommand = vscode.commands.executeCommand.bind(vscode.commands);
    const originalActiveTextEditor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor');

    function setActiveTextEditor(editor: vscode.TextEditor | undefined): void {
        Object.defineProperty(vscode.window, 'activeTextEditor', {
            configurable: true,
            get: () => editor,
        });
    }

    teardown(() => {
        (vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }).registerCommand =
            originalRegisterCommand;
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
            originalExecuteCommand;

        if (originalActiveTextEditor) {
            Object.defineProperty(vscode.window, 'activeTextEditor', originalActiveTextEditor);
        } else {
            setActiveTextEditor(undefined);
        }
    });

    test('ctrl+enter advances to the next line after executing a selection', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        const executionCalls: string[] = [];

        (vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }).registerCommand =
            ((command: string, callback: RegisteredCommandHandler) => {
                registeredCommands.set(command, callback);
                return new vscode.Disposable(() => undefined);
            }) as typeof vscode.commands.registerCommand;
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
            (async () => undefined) as typeof vscode.commands.executeCommand;

        const editor = makeEditor(
            ['x <- 1', 'y <- 2'],
            new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 6)),
        );
        setActiveTextEditor(editor);

        const disposables = registerConsoleActions({
            executeCode: async (_languageId: string, _sessionId: string | undefined, code: string) => {
                executionCalls.push(code);
                return 'session-1';
            },
            activePositronConsoleInstance: undefined,
            focusConsole: async () => undefined,
        } as any, makeNoopLogChannel());

        try {
            const handler = registeredCommands.get(CoreCommandIds.consoleExecuteCode);
            assert.ok(handler, 'expected execute command to be registered');

            await handler?.();

            assert.deepStrictEqual(executionCalls, ['x <- 1']);
            assert.strictEqual(editor.selection.isEmpty, true);
            assert.strictEqual(editor.selection.active.line, 1);
            assert.strictEqual(editor.selection.active.character, 0);
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
        }
    });

    test('ctrl+enter treats a full-line selection ending at column 0 as advancing to that line', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();

        (vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }).registerCommand =
            ((command: string, callback: RegisteredCommandHandler) => {
                registeredCommands.set(command, callback);
                return new vscode.Disposable(() => undefined);
            }) as typeof vscode.commands.registerCommand;
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
            (async () => undefined) as typeof vscode.commands.executeCommand;

        const editor = makeEditor(
            ['x <- 1', 'y <- 2', 'z <- 3'],
            new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(1, 0)),
        );
        setActiveTextEditor(editor);

        const disposables = registerConsoleActions({
            executeCode: async () => 'session-1',
            activePositronConsoleInstance: undefined,
            focusConsole: async () => undefined,
        } as any, makeNoopLogChannel());

        try {
            const handler = registeredCommands.get(CoreCommandIds.consoleExecuteCode);
            assert.ok(handler, 'expected execute command to be registered');

            await handler?.();

            assert.strictEqual(editor.selection.active.line, 1);
            assert.strictEqual(editor.selection.active.character, 0);
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
        }
    });

    test('alt+enter preserves the current selection', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();

        (vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }).registerCommand =
            ((command: string, callback: RegisteredCommandHandler) => {
                registeredCommands.set(command, callback);
                return new vscode.Disposable(() => undefined);
            }) as typeof vscode.commands.registerCommand;
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
            (async () => undefined) as typeof vscode.commands.executeCommand;

        const editor = makeEditor(
            ['x <- 1', 'y <- 2'],
            new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 6)),
        );
        setActiveTextEditor(editor);

        const disposables = registerConsoleActions({
            executeCode: async () => 'session-1',
            activePositronConsoleInstance: undefined,
            focusConsole: async () => undefined,
        } as any, makeNoopLogChannel());

        try {
            const handler = registeredCommands.get(CoreCommandIds.consoleExecuteCodeWithoutAdvancing);
            assert.ok(handler, 'expected execute-without-advancing command to be registered');

            await handler?.();

            assert.strictEqual(editor.selection.isEmpty, false);
            assert.strictEqual(editor.selection.start.line, 0);
            assert.strictEqual(editor.selection.end.line, 0);
            assert.strictEqual(editor.selection.end.character, 6);
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
        }
    });
});
