import * as assert from 'assert';
import * as vscode from 'vscode';
import { CoreCommandIds } from '../../coreCommandIds';
import { registerConsoleActions } from '../../services/console/consoleActions';
import {
    RuntimeCodeExecutionMode,
    RuntimeErrorBehavior,
} from '../../services/console/interfaces/consoleService';

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
        selectedLines[selectedLines.length - 1] = selectedLines[selectedLines.length - 1].slice(
            0,
            range.end.character,
        );
        return selectedLines.join('\n');
    };

    const document = {
        languageId: 'r',
        uri: vscode.Uri.parse('file:///workspace/test.R'),
        get lineCount() {
            return lines.length;
        },
        eol: vscode.EndOfLine.LF,
        version: 1,
        validatePosition: (position: vscode.Position) =>
            new vscode.Position(
                Math.max(0, Math.min(position.line, lines.length - 1)),
                Math.max(
                    0,
                    Math.min(
                        position.character,
                        lines[Math.max(0, Math.min(position.line, lines.length - 1))].length,
                    ),
                ),
            ),
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
    const originalShowInformationMessage = vscode.window.showInformationMessage.bind(vscode.window);
    const originalShowErrorMessage = vscode.window.showErrorMessage.bind(vscode.window);
    const originalShowWarningMessage = vscode.window.showWarningMessage.bind(vscode.window);
    const originalOpenTextDocument = vscode.workspace.openTextDocument;
    const originalApplyEdit = vscode.workspace.applyEdit;
    const originalShowTextDocument = vscode.window.showTextDocument;
    const originalActiveTextEditor = Object.getOwnPropertyDescriptor(
        vscode.window,
        'activeTextEditor',
    );

    function setActiveTextEditor(editor: vscode.TextEditor | undefined): void {
        Object.defineProperty(vscode.window, 'activeTextEditor', {
            configurable: true,
            get: () => editor,
        });
    }

    function executionFixture(
        provider: (
            uri: string,
            position: { line: number; character: number },
            token: vscode.CancellationToken,
        ) => unknown,
    ) {
        const commands = new Map<string, RegisteredCommandHandler>();
        const calls: Array<{ code: string; attribution: any }> = [];
        (
            vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }
        ).registerCommand = ((command: string, callback: RegisteredCommandHandler) => {
            commands.set(command, callback);
            return new vscode.Disposable(() => undefined);
        }) as typeof vscode.commands.registerCommand;
        (
            vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }
        ).executeCommand = (async (command: string, ...args: any[]) => {
            if (command === 'supervisor.lsp.getStatementRange') {
                return provider(args[0], args[1], args[2]);
            }
            return undefined;
        }) as typeof vscode.commands.executeCommand;
        const disposables = registerConsoleActions(
            {
                executeCode: async (
                    _language: string,
                    _session: string | undefined,
                    code: string,
                    attribution: any,
                ) => {
                    calls.push({ code, attribution });
                    return 'session-1';
                },
            } as any,
            makeNoopLogChannel(),
        );
        return {
            commands,
            calls,
            dispose: () => disposables.forEach((disposable) => disposable.dispose()),
        };
    }

    teardown(() => {
        (
            vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }
        ).registerCommand = originalRegisterCommand;
        (
            vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }
        ).executeCommand = originalExecuteCommand;
        (
            vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }
        ).showInformationMessage = originalShowInformationMessage;
        (
            vscode.window as { showErrorMessage: typeof vscode.window.showErrorMessage }
        ).showErrorMessage = originalShowErrorMessage;
        (
            vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage }
        ).showWarningMessage = originalShowWarningMessage;
        (
            vscode.workspace as { openTextDocument: typeof vscode.workspace.openTextDocument }
        ).openTextDocument = originalOpenTextDocument;
        (vscode.workspace as { applyEdit: typeof vscode.workspace.applyEdit }).applyEdit =
            originalApplyEdit;
        (
            vscode.window as { showTextDocument: typeof vscode.window.showTextDocument }
        ).showTextDocument = originalShowTextDocument;

        if (originalActiveTextEditor) {
            Object.defineProperty(vscode.window, 'activeTextEditor', originalActiveTextEditor);
        } else {
            setActiveTextEditor(undefined);
        }
    });

    test('execute code preserves the selection for repeated execution', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        const executionCalls: string[] = [];

        (
            vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }
        ).registerCommand = ((command: string, callback: RegisteredCommandHandler) => {
            registeredCommands.set(command, callback);
            return new vscode.Disposable(() => undefined);
        }) as typeof vscode.commands.registerCommand;
        (
            vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }
        ).executeCommand = (async () => undefined) as typeof vscode.commands.executeCommand;

        const editor = makeEditor(
            ['x <- 1', 'y <- 2'],
            new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 6)),
        );
        setActiveTextEditor(editor);

        const disposables = registerConsoleActions(
            {
                executeCode: async (
                    _languageId: string,
                    _sessionId: string | undefined,
                    code: string,
                ) => {
                    executionCalls.push(code);
                    return 'session-1';
                },
                activePositronConsoleInstance: undefined,
                focusConsole: async () => undefined,
            } as any,
            makeNoopLogChannel(),
        );

        try {
            const handler = registeredCommands.get(CoreCommandIds.consoleExecuteCode);
            assert.ok(handler, 'expected execute command to be registered');

            await handler?.();
            await handler?.();

            assert.deepStrictEqual(executionCalls, ['x <- 1', 'x <- 1']);
            assert.strictEqual(editor.selection.isEmpty, false);
            assert.strictEqual(editor.selection.active.line, 0);
            assert.strictEqual(editor.selection.active.character, 6);
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
        }
    });

    test('passes command execution options through to the console service', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        let executionArguments: unknown[] = [];
        (
            vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }
        ).registerCommand = ((command: string, callback: RegisteredCommandHandler) => {
            registeredCommands.set(command, callback);
            return new vscode.Disposable(() => undefined);
        }) as typeof vscode.commands.registerCommand;

        setActiveTextEditor(
            makeEditor(
                ['x <- 1'],
                new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 6)),
            ),
        );
        const disposables = registerConsoleActions(
            {
                executeCode: async (...args: unknown[]) => {
                    executionArguments = args;
                    return 'session-1';
                },
                activePositronConsoleInstance: undefined,
                focusConsole: async () => undefined,
            } as any,
            makeNoopLogChannel(),
        );

        try {
            await registeredCommands.get(CoreCommandIds.consoleExecuteCode)?.({
                allowIncomplete: true,
                mode: RuntimeCodeExecutionMode.Silent,
                errorBehavior: RuntimeErrorBehavior.Stop,
            });
            assert.strictEqual(executionArguments[5], true);
            assert.strictEqual(executionArguments[6], RuntimeCodeExecutionMode.Silent);
            assert.strictEqual(executionArguments[7], RuntimeErrorBehavior.Stop);
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
        }
    });

    test('execute code preserves a full-line selection ending at column zero', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();

        (
            vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }
        ).registerCommand = ((command: string, callback: RegisteredCommandHandler) => {
            registeredCommands.set(command, callback);
            return new vscode.Disposable(() => undefined);
        }) as typeof vscode.commands.registerCommand;
        (
            vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }
        ).executeCommand = (async () => undefined) as typeof vscode.commands.executeCommand;

        const editor = makeEditor(
            ['x <- 1', 'y <- 2', 'z <- 3'],
            new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(1, 0)),
        );
        setActiveTextEditor(editor);

        const disposables = registerConsoleActions(
            {
                executeCode: async () => 'session-1',
                activePositronConsoleInstance: undefined,
                focusConsole: async () => undefined,
            } as any,
            makeNoopLogChannel(),
        );

        try {
            const handler = registeredCommands.get(CoreCommandIds.consoleExecuteCode);
            assert.ok(handler, 'expected execute command to be registered');

            await handler?.();

            assert.strictEqual(editor.selection.active.line, 1);
            assert.strictEqual(editor.selection.active.character, 0);
            assert.strictEqual(editor.selection.isEmpty, false);
            assert.strictEqual(editor.selection.start.line, 0);
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
        }
    });

    test('alt+enter preserves the current selection', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();

        (
            vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }
        ).registerCommand = ((command: string, callback: RegisteredCommandHandler) => {
            registeredCommands.set(command, callback);
            return new vscode.Disposable(() => undefined);
        }) as typeof vscode.commands.registerCommand;
        (
            vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }
        ).executeCommand = (async () => undefined) as typeof vscode.commands.executeCommand;

        const editor = makeEditor(
            ['x <- 1', 'y <- 2'],
            new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 6)),
        );
        setActiveTextEditor(editor);

        const disposables = registerConsoleActions(
            {
                executeCode: async () => 'session-1',
                activePositronConsoleInstance: undefined,
                focusConsole: async () => undefined,
            } as any,
            makeNoopLogChannel(),
        );

        try {
            const handler = registeredCommands.get(
                CoreCommandIds.consoleExecuteCodeWithoutAdvancing,
            );
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

    test('editor execution records the exact UTF-8 selection range', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        let capturedAttribution: any;

        (
            vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }
        ).registerCommand = ((command: string, callback: RegisteredCommandHandler) => {
            registeredCommands.set(command, callback);
            return new vscode.Disposable(() => undefined);
        }) as typeof vscode.commands.registerCommand;

        const editor = makeEditor(
            ['变量 <- 1'],
            new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 2)),
        );
        setActiveTextEditor(editor);

        const disposables = registerConsoleActions(
            {
                executeCode: async (
                    _languageId: string,
                    _sessionId: string | undefined,
                    _code: string,
                    attribution: unknown,
                ) => {
                    capturedAttribution = attribution;
                    return 'session-1';
                },
                activePositronConsoleInstance: undefined,
                focusConsole: async () => undefined,
            } as any,
            makeNoopLogChannel(),
        );

        try {
            const handler = registeredCommands.get(
                CoreCommandIds.consoleExecuteCodeWithoutAdvancing,
            );
            assert.ok(handler, 'expected execute-without-advancing command to be registered');

            await handler?.();

            assert.strictEqual(
                capturedAttribution.codeLocation.uri.toString(),
                'file:///workspace/test.R',
            );
            assert.deepStrictEqual(capturedAttribution.codeLocation.range, {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 6 },
            });
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
        }
    });

    test('execute code before cursor preserves the original code text and keeps editor focus', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        const executeCalls: Array<{ code: string; focus: boolean }> = [];

        (
            vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }
        ).registerCommand = ((command: string, callback: RegisteredCommandHandler) => {
            registeredCommands.set(command, callback);
            return new vscode.Disposable(() => undefined);
        }) as typeof vscode.commands.registerCommand;
        (
            vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }
        ).executeCommand = (async () => undefined) as typeof vscode.commands.executeCommand;

        const editor = makeEditor(
            ['x <- 1', ''],
            new vscode.Selection(new vscode.Position(1, 0), new vscode.Position(1, 0)),
        );
        setActiveTextEditor(editor);

        const disposables = registerConsoleActions(
            {
                executeCode: async (
                    _languageId: string,
                    _sessionId: string | undefined,
                    code: string,
                    _attribution: unknown,
                    focus: boolean,
                ) => {
                    executeCalls.push({ code, focus });
                    return 'session-1';
                },
                activePositronConsoleInstance: undefined,
                focusConsole: async () => undefined,
            } as any,
            makeNoopLogChannel(),
        );

        try {
            const handler = registeredCommands.get(CoreCommandIds.consoleExecuteCodeBeforeCursor);
            assert.ok(handler, 'expected execute-before-cursor command to be registered');

            await handler?.();

            assert.deepStrictEqual(executeCalls, [
                {
                    code: 'x <- 1\n',
                    focus: false,
                },
            ]);
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
        }
    });

    test('statement range syntax rejection notifies and aborts execution', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        const messages: string[] = [];
        let executeCalls = 0;

        (
            vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }
        ).registerCommand = ((command: string, callback: RegisteredCommandHandler) => {
            registeredCommands.set(command, callback);
            return new vscode.Disposable(() => undefined);
        }) as typeof vscode.commands.registerCommand;
        (
            vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }
        ).executeCommand = (async (command: string) => {
            if (command === 'supervisor.lsp.getStatementRange') {
                return {
                    kind: 'rejection',
                    rejectionKind: 'syntax',
                    line: 0,
                };
            }
            return undefined;
        }) as typeof vscode.commands.executeCommand;
        (
            vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }
        ).showInformationMessage = (async (message: string) => {
            messages.push(message);
            return undefined;
        }) as typeof vscode.window.showInformationMessage;

        const editor = makeEditor(
            [')'],
            new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)),
        );
        setActiveTextEditor(editor);

        const disposables = registerConsoleActions(
            {
                executeCode: async () => {
                    executeCalls += 1;
                    return 'session-1';
                },
                activePositronConsoleInstance: undefined,
                focusConsole: async () => undefined,
            } as any,
            makeNoopLogChannel(),
        );

        try {
            const handler = registeredCommands.get(CoreCommandIds.consoleExecuteCode);
            assert.ok(handler, 'expected execute command to be registered');

            await handler?.();

            assert.strictEqual(executeCalls, 0);
            assert.deepStrictEqual(messages, [
                "Can't execute code due to a syntax error near line 1.",
            ]);
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
        }
    });

    test('statement range execution marks attribution completeness as verified', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        const attributions: Array<Record<string, unknown> | undefined> = [];
        let statementRangeCalls = 0;

        (
            vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }
        ).registerCommand = ((command: string, callback: RegisteredCommandHandler) => {
            registeredCommands.set(command, callback);
            return new vscode.Disposable(() => undefined);
        }) as typeof vscode.commands.registerCommand;
        (
            vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }
        ).executeCommand = (async (command: string) => {
            if (command === 'supervisor.lsp.getStatementRange') {
                statementRangeCalls += 1;
                // The second request is made while advancing the editor.
                if (statementRangeCalls === 1) {
                    return {
                        kind: 'success',
                        range: {
                            start: { line: 0, character: 0 },
                            end: { line: 1, character: 12 },
                        },
                        code: 'for i in range(3):\n    print(i)',
                    };
                }
                return undefined;
            }
            return undefined;
        }) as typeof vscode.commands.executeCommand;

        setActiveTextEditor(
            makeEditor(
                ['for i in range(3):', '    print(i)', 'after = 1'],
                new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)),
            ),
        );

        const disposables = registerConsoleActions(
            {
                executeCode: async (...args: unknown[]) => {
                    attributions.push(args[3] as Record<string, unknown> | undefined);
                    return 'session-1';
                },
                activePositronConsoleInstance: undefined,
                focusConsole: async () => undefined,
            } as any,
            makeNoopLogChannel(),
        );

        try {
            const handler = registeredCommands.get(CoreCommandIds.consoleExecuteCode);
            assert.ok(handler, 'expected execute command to be registered');

            await handler?.();

            assert.strictEqual(statementRangeCalls, 2);
            assert.deepStrictEqual(attributions[0]?.metadata, { completenessVerified: true });
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
        }
    });

    test('execution failures are shown without converting code into pending input', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        const messages: string[] = [];

        (
            vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }
        ).registerCommand = ((command: string, callback: RegisteredCommandHandler) => {
            registeredCommands.set(command, callback);
            return new vscode.Disposable(() => undefined);
        }) as typeof vscode.commands.registerCommand;
        (
            vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }
        ).executeCommand = (async () => undefined) as typeof vscode.commands.executeCommand;
        (
            vscode.window as { showErrorMessage: typeof vscode.window.showErrorMessage }
        ).showErrorMessage = (async (message: string) => {
            messages.push(message);
            return undefined;
        }) as typeof vscode.window.showErrorMessage;

        const editor = makeEditor(
            ['1 + 1'],
            new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)),
        );
        setActiveTextEditor(editor);

        const disposables = registerConsoleActions(
            {
                executeCode: async () => {
                    throw new Error('completeness unavailable');
                },
                activePositronConsoleInstance: undefined,
                focusConsole: async () => undefined,
            } as any,
            makeNoopLogChannel(),
        );

        try {
            const handler = registeredCommands.get(CoreCommandIds.consoleExecuteCode);
            assert.ok(handler, 'expected execute command to be registered');

            await handler?.();

            assert.deepStrictEqual(messages, ['Cannot execute code: completeness unavailable']);
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
        }
    });

    test('explicit URI execution advances past EOF without opening an editor and respects advance false', async () => {
        for (const advance of [true, false]) {
            const lines = ['print(1)'];
            const editor = makeEditor(lines, new vscode.Selection(0, 0, 0, 0));
            setActiveTextEditor(editor);
            const fixture = executionFixture(() => ({
                kind: 'success',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } },
                code: 'print(1)',
            }));
            let edits = 0;
            (
                vscode.workspace as { openTextDocument: typeof vscode.workspace.openTextDocument }
            ).openTextDocument = (async () =>
                editor.document) as typeof vscode.workspace.openTextDocument;
            (
                vscode.window as { showTextDocument: typeof vscode.window.showTextDocument }
            ).showTextDocument = (async () => {
                throw new Error('Explicit URI execution must not open an editor');
            }) as typeof vscode.window.showTextDocument;
            (vscode.workspace as { applyEdit: typeof vscode.workspace.applyEdit }).applyEdit =
                async (edit) => {
                    const changes = edit.get(editor.document.uri);
                    assert.strictEqual(changes.length, 1);
                    assert.strictEqual(changes[0].newText, '\n');
                    lines.push('');
                    edits += 1;
                    return true;
                };
            try {
                const next = await fixture.commands.get(CoreCommandIds.consoleExecuteCode)?.({
                    uri: editor.document.uri,
                    position: new vscode.Position(0, 0),
                    advance,
                });
                assert.deepStrictEqual(next, advance ? new vscode.Position(1, 0) : undefined);
                assert.strictEqual(edits, advance ? 1 : 0);
                assert.deepStrictEqual(
                    fixture.calls.map((call) => call.code),
                    ['print(1)'],
                );
                assert.strictEqual(editor.selection.active.line, 0);
            } finally {
                fixture.dispose();
            }
        }
    });

    test('explicit URI advancement uses the next statement boundary including enclosing scopes', async () => {
        for (const enclosingScope of [false, true]) {
            const editor = makeEditor(
                ['{', '  x <- 1', '# gap', '}', '', 'next <- 2'],
                new vscode.Selection(1, 2, 1, 2),
            );
            const positions: Array<{ line: number; character: number }> = [];
            const fixture = executionFixture((_uri, position) => {
                positions.push(position);
                return {
                    kind: 'success',
                    range:
                        positions.length === 1
                            ? { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } }
                            : enclosingScope
                              ? { start: { line: 0, character: 0 }, end: { line: 3, character: 1 } }
                              : {
                                    start: { line: 5, character: 0 },
                                    end: { line: 5, character: 9 },
                                },
                    code: 'x <- 1',
                };
            });
            (
                vscode.workspace as { openTextDocument: typeof vscode.workspace.openTextDocument }
            ).openTextDocument = (async () =>
                editor.document) as typeof vscode.workspace.openTextDocument;
            try {
                const next = await fixture.commands.get(CoreCommandIds.consoleExecuteCode)?.({
                    uri: editor.document.uri,
                    position: { line: 1, character: 2 },
                });
                assert.deepStrictEqual(
                    next,
                    enclosingScope ? new vscode.Position(3, 1) : new vscode.Position(5, 0),
                );
                assert.deepStrictEqual(positions, [
                    { line: 1, character: 2 },
                    { line: 2, character: 0 },
                ]);
            } finally {
                fixture.dispose();
            }
        }
    });

    test('provider Python code is sent unchanged with completeness verified', async () => {
        const code = 'for i in range(3):\n    print(i)';
        const editor = makeEditor(code.split('\n'), new vscode.Selection(0, 0, 0, 0));
        Object.defineProperty(editor.document, 'languageId', { value: 'python' });
        setActiveTextEditor(editor);
        const fixture = executionFixture(() => ({
            kind: 'success',
            range: { start: { line: 0, character: 0 }, end: { line: 1, character: 12 } },
            code,
        }));
        try {
            const next = await fixture.commands.get(
                CoreCommandIds.consoleExecuteCodeWithoutAdvancing,
            )?.();
            assert.strictEqual(next, undefined);
            assert.strictEqual(fixture.calls[0].code, code);
            assert.strictEqual(fixture.calls[0].attribution.metadata.completenessVerified, true);
        } finally {
            fixture.dispose();
        }
    });

    test('generic editor commands reject notebook cells before selecting a console', async () => {
        const editor = makeEditor(['x <- 1'], new vscode.Selection(0, 0, 0, 6));
        Object.defineProperty(editor.document, 'uri', {
            value: vscode.Uri.parse('vscode-notebook-cell:///test.ipynb#cell'),
        });
        setActiveTextEditor(editor);
        let providerCalls = 0;
        const fixture = executionFixture(() => {
            providerCalls += 1;
        });
        (
            vscode.workspace as { openTextDocument: typeof vscode.workspace.openTextDocument }
        ).openTextDocument = (async () =>
            editor.document) as typeof vscode.workspace.openTextDocument;
        try {
            for (const command of [
                CoreCommandIds.consoleExecuteCode,
                CoreCommandIds.consoleExecuteCodeWithoutAdvancing,
                CoreCommandIds.consoleExecuteCodeBeforeCursor,
                CoreCommandIds.consoleExecuteCodeAfterCursor,
            ]) {
                await fixture.commands.get(command)?.();
                await fixture.commands.get(command)?.({
                    uri: editor.document.uri,
                    position: { line: 0, character: 0 },
                });
            }
            assert.strictEqual(providerCalls, 0);
            assert.strictEqual(fixture.calls.length, 0);
        } finally {
            fixture.dispose();
        }
    });

    test('cancel and run as is settle an unresponsive provider and ignore its late result', async () => {
        for (const runAsIs of [false, true]) {
            const editor = makeEditor(['x <- 1', 'next <- 2'], new vscode.Selection(0, 0, 0, 0));
            setActiveTextEditor(editor);
            let started!: () => void;
            const providerStarted = new Promise<void>((resolve) => {
                started = resolve;
            });
            let complete!: (value: unknown) => void;
            let token: vscode.CancellationToken | undefined;
            const work = new Promise((resolve) => {
                complete = resolve;
            });
            const fixture = executionFixture((_uri, _position, source) => {
                token = source;
                started();
                return work;
            });
            try {
                const submission = fixture.commands.get(CoreCommandIds.consoleExecuteCode)?.();
                await providerStarted;
                await fixture.commands.get(
                    runAsIs
                        ? CoreCommandIds.consoleRunCodeAsIs
                        : CoreCommandIds.consoleCancelCodeSubmission,
                )?.();
                await submission;
                assert.strictEqual(token?.isCancellationRequested, true);
                assert.deepStrictEqual(
                    fixture.calls.map((call) => call.code),
                    runAsIs ? ['x <- 1'] : [],
                );
                if (runAsIs) {
                    assert.strictEqual(fixture.calls[0].attribution.metadata, undefined);
                }
                complete({
                    kind: 'success',
                    range: { start: { line: 0, character: 0 }, end: { line: 1, character: 9 } },
                    code: 'late code',
                });
                await work;
                await Promise.resolve();
                assert.strictEqual(fixture.calls.length, runAsIs ? 1 : 0);
                assert.strictEqual(editor.selection.active.line, runAsIs ? 1 : 0);
            } finally {
                fixture.dispose();
            }
        }
    });

    test('cancelling next-statement detection also prevents the original statement from executing', async () => {
        const editor = makeEditor(['x <- 1', 'next <- 2'], new vscode.Selection(0, 0, 0, 0));
        setActiveTextEditor(editor);
        let queryCount = 0;
        let started!: () => void;
        const advancing = new Promise<void>((resolve) => {
            started = resolve;
        });
        const fixture = executionFixture(() => {
            if (++queryCount === 1) {
                return {
                    kind: 'success',
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
                };
            }
            started();
            return new Promise(() => undefined);
        });
        try {
            const submission = fixture.commands.get(CoreCommandIds.consoleExecuteCode)?.();
            await advancing;
            await fixture.commands.get(CoreCommandIds.consoleCancelCodeSubmission)?.();
            await submission;
            assert.strictEqual(fixture.calls.length, 0);
            assert.strictEqual(editor.selection.active.line, 0);
        } finally {
            fixture.dispose();
        }
    });

    test('a new selection execution supersedes a pending detection even if the old provider rejects late', async () => {
        const editor = makeEditor(['x <- 1', 'next <- 2'], new vscode.Selection(0, 0, 0, 0));
        setActiveTextEditor(editor);
        let started!: () => void;
        const providerStarted = new Promise<void>((resolve) => {
            started = resolve;
        });
        let reject!: (error: Error) => void;
        const work = new Promise((_resolve, rejectWork) => {
            reject = rejectWork;
        });
        const fixture = executionFixture(() => {
            started();
            return work;
        });
        try {
            const first = fixture.commands.get(CoreCommandIds.consoleExecuteCode)?.();
            await providerStarted;
            editor.selection = new vscode.Selection(1, 0, 1, 9);
            await fixture.commands.get(CoreCommandIds.consoleExecuteCode)?.();
            await first;
            reject(new Error('Late provider failure'));
            await work.catch(() => undefined);
            await Promise.resolve();
            assert.deepStrictEqual(
                fixture.calls.map((call) => call.code),
                ['next <- 2'],
            );
            assert.strictEqual(editor.selection.isEmpty, false);
        } finally {
            fixture.dispose();
        }
    });

    test('clears input history only after modal confirmation', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        let clearCalls = 0;
        let promptOptions: vscode.MessageOptions | undefined;
        (
            vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }
        ).registerCommand = ((command: string, callback: RegisteredCommandHandler) => {
            registeredCommands.set(command, callback);
            return new vscode.Disposable(() => undefined);
        }) as typeof vscode.commands.registerCommand;
        (
            vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage }
        ).showWarningMessage = (async (
            _message: string,
            options: vscode.MessageOptions,
            clear: string,
        ) => {
            promptOptions = options;
            return clear;
        }) as typeof vscode.window.showWarningMessage;

        const disposables = registerConsoleActions(
            {
                activePositronConsoleInstance: {
                    runtimeMetadata: { languageName: 'R' },
                    clearInputHistory: () => {
                        clearCalls++;
                    },
                },
                focusConsole: async () => undefined,
            } as any,
            makeNoopLogChannel(),
        );

        try {
            await registeredCommands.get(CoreCommandIds.consoleClearInputHistory)?.();
            assert.strictEqual(promptOptions?.modal, true);
            assert.strictEqual(clearCalls, 1);
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
        }
    });

    test('keeps input history when modal confirmation is cancelled', async () => {
        const registeredCommands = new Map<string, RegisteredCommandHandler>();
        let clearCalls = 0;
        (
            vscode.commands as { registerCommand: typeof vscode.commands.registerCommand }
        ).registerCommand = ((command: string, callback: RegisteredCommandHandler) => {
            registeredCommands.set(command, callback);
            return new vscode.Disposable(() => undefined);
        }) as typeof vscode.commands.registerCommand;
        (
            vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage }
        ).showWarningMessage = (async () => undefined) as typeof vscode.window.showWarningMessage;

        const disposables = registerConsoleActions(
            {
                activePositronConsoleInstance: {
                    runtimeMetadata: { languageName: 'Python' },
                    clearInputHistory: () => {
                        clearCalls++;
                    },
                },
                focusConsole: async () => undefined,
            } as any,
            makeNoopLogChannel(),
        );

        try {
            await registeredCommands.get(CoreCommandIds.consoleClearInputHistory)?.();
            assert.strictEqual(clearCalls, 0);
        } finally {
            disposables.forEach((disposable) => disposable.dispose());
        }
    });
});
