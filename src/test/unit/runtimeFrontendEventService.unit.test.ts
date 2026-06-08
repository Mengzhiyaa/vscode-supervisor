import * as assert from 'assert';
import * as vscode from 'vscode';
import { UiFrontendEvent } from '../../runtime/comms/positronUiComm';
import { RuntimeFrontendEventService } from '../../runtime/runtimeFrontendEventService';

function createEventStub<T>(): vscode.Event<T> {
    return () => ({ dispose: () => undefined });
}

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'runtime-frontend-event-unit-test',
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

suite('[Unit] runtime frontend event service', () => {
    const originalTextDocuments = Object.getOwnPropertyDescriptor(vscode.workspace, 'textDocuments');
    const originalExecuteCommand = vscode.commands.executeCommand.bind(vscode.commands);

    function setTextDocuments(documents: readonly vscode.TextDocument[]): void {
        Object.defineProperty(vscode.workspace, 'textDocuments', {
            configurable: true,
            get: () => documents,
        });
    }

    setup(() => {
        setTextDocuments([]);
    });

    teardown(() => {
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = originalExecuteCommand;

        if (originalTextDocuments) {
            Object.defineProperty(vscode.workspace, 'textDocuments', originalTextDocuments);
        }
    });

    test('opens runtime-requested workspace in a new window when an editor is dirty', async () => {
        const calls: Array<{ command: string; args: unknown[] }> = [];
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
            (async (command: string, ...args: unknown[]) => {
                calls.push({ command, args });
                return undefined;
            }) as typeof vscode.commands.executeCommand;
        setTextDocuments([{ isDirty: true } as vscode.TextDocument]);

        const service = new RuntimeFrontendEventService(
            { onDidReceiveRuntimeEvent: createEventStub() } as any,
            makeNoopLogChannel(),
        );

        await service.handleRuntimeEvent({
            session_id: 'session-1',
            event: {
                name: UiFrontendEvent.OpenWorkspace,
                data: {
                    path: '/tmp/project',
                    new_window: false,
                },
            },
        });

        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].command, 'vscode.openFolder');
        assert.ok(calls[0].args[0] instanceof vscode.Uri);
        assert.strictEqual((calls[0].args[0] as vscode.Uri).fsPath, '/tmp/project');
        assert.strictEqual(calls[0].args[1], true);
    });

    test('preserves same-window workspace requests when no editor is dirty', async () => {
        const calls: Array<{ command: string; args: unknown[] }> = [];
        (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
            (async (command: string, ...args: unknown[]) => {
                calls.push({ command, args });
                return undefined;
            }) as typeof vscode.commands.executeCommand;

        const service = new RuntimeFrontendEventService(
            { onDidReceiveRuntimeEvent: createEventStub() } as any,
            makeNoopLogChannel(),
        );

        await service.handleRuntimeEvent({
            session_id: 'session-1',
            event: {
                name: UiFrontendEvent.OpenWorkspace,
                data: {
                    path: '/tmp/project',
                    new_window: false,
                },
            },
        });

        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].command, 'vscode.openFolder');
        assert.strictEqual(calls[0].args[1], false);
    });
});
