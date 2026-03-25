import * as assert from 'assert';
import * as vscode from 'vscode';
import * as VariablesProtocol from '../../rpc/webview/variables';
import { VariablesViewProvider } from '../../webview/variablesProvider';

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'variables-provider-unit-test',
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

class FakeConnection {
    readonly requests = new Map<string, (params: any) => Promise<any> | any>();

    onRequest(type: { method: string }, handler: (params: any) => Promise<any> | any): vscode.Disposable {
        this.requests.set(type.method, handler);
        return { dispose: () => undefined };
    }

    onNotification(): vscode.Disposable {
        return { dispose: () => undefined };
    }

    sendNotification(): void {
        // No-op for this unit test.
    }
}

suite('[Unit] variables provider active-session sync', () => {
    test('writes foreground session before aligning variables service', async () => {
        const calls: string[] = [];
        const session = { sessionId: 'session-1' };

        const provider = new VariablesViewProvider(
            vscode.Uri.file('/tmp'),
            makeNoopLogChannel(),
            {
                sessions: [session],
                activeSessionId: 'session-1',
                onDidChangeForegroundSession: createEventStub(),
                onDidUpdateSessionName: createEventStub(),
                onDidDeleteRuntimeSession: createEventStub(),
                onDidChangeSessionState: createEventStub(),
                getSession: (sessionId: string) => sessionId === 'session-1' ? session : undefined,
                focusSession: (sessionId: string) => {
                    calls.push(`manager:${sessionId}`);
                },
            } as any,
            {
                positronVariablesInstances: [],
                activePositronVariablesInstance: undefined,
                onDidStartPositronVariablesInstance: createEventStub(),
                onDidStopPositronVariablesInstance: createEventStub(),
                onDidChangeActivePositronVariablesInstance: createEventStub(),
                setActivePositronVariablesSession: (sessionId: string) => {
                    calls.push(`variables:${sessionId}`);
                },
                getVariablesInstance: () => undefined,
                setViewVisible: () => undefined,
            } as any,
        );

        const connection = new FakeConnection();
        (provider as any)._registerRpcHandlers(connection as any);

        const handler = connection.requests.get(VariablesProtocol.SetActiveVariablesSessionRequest.type.method);
        assert.ok(handler, 'expected variables/setActiveSession handler to be registered');

        await handler?.({ sessionId: 'session-1' });

        assert.deepStrictEqual(calls, [
            'manager:session-1',
            'variables:session-1',
        ]);
    });

    test('still aligns variables service when session manager does not know the session', async () => {
        const calls: string[] = [];

        const provider = new VariablesViewProvider(
            vscode.Uri.file('/tmp'),
            makeNoopLogChannel(),
            {
                sessions: [],
                activeSessionId: undefined,
                onDidChangeForegroundSession: createEventStub(),
                onDidUpdateSessionName: createEventStub(),
                onDidDeleteRuntimeSession: createEventStub(),
                onDidChangeSessionState: createEventStub(),
                getSession: () => undefined,
                focusSession: (sessionId: string) => {
                    calls.push(`manager:${sessionId}`);
                },
            } as any,
            {
                positronVariablesInstances: [],
                activePositronVariablesInstance: undefined,
                onDidStartPositronVariablesInstance: createEventStub(),
                onDidStopPositronVariablesInstance: createEventStub(),
                onDidChangeActivePositronVariablesInstance: createEventStub(),
                setActivePositronVariablesSession: (sessionId: string) => {
                    calls.push(`variables:${sessionId}`);
                },
                getVariablesInstance: () => undefined,
                setViewVisible: () => undefined,
            } as any,
        );

        const connection = new FakeConnection();
        (provider as any)._registerRpcHandlers(connection as any);

        const handler = connection.requests.get(VariablesProtocol.SetActiveVariablesSessionRequest.type.method);
        assert.ok(handler, 'expected variables/setActiveSession handler to be registered');

        await handler?.({ sessionId: 'detached-session' });

        assert.deepStrictEqual(calls, [
            'variables:detached-session',
        ]);
    });
});
