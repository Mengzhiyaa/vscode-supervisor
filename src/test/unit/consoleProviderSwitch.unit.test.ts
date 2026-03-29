import * as assert from 'assert';
import * as vscode from 'vscode';
import * as SessionProtocol from '../../rpc/webview/session';
import { ConsoleViewProvider } from '../../webview/consoleProvider';

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'console-provider-switch-unit-test',
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

function createDeferred<T = void>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
} {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
    });

    return { promise, resolve, reject };
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

suite('[Unit] console provider session switching', () => {
    test('awaits foreground-session switching before sending a session snapshot', async () => {
        const calls: string[] = [];
        const deferred = createDeferred<void>();

        const provider = new ConsoleViewProvider(
            vscode.Uri.file('/tmp'),
            makeNoopLogChannel(),
            {
                getSession: (sessionId: string) =>
                    sessionId === 'session-2'
                        ? ({ sessionId, sessionMetadata: { sessionMode: 'console' } } as any)
                        : undefined,
                focusSession: async (sessionId: string) => {
                    calls.push(`focus:start:${sessionId}`);
                    await deferred.promise;
                    calls.push(`focus:end:${sessionId}`);
                },
                onDidReceiveRuntimeEvent: createEventStub(),
                onDidUpdateSessionName: createEventStub(),
            } as any,
        );

        const connection = new FakeConnection();
        (provider as any)._sendSessionInfoUpdate = () => {
            calls.push('snapshot');
        };
        (provider as any)._registerRpcHandlers(connection as any);

        const handler = connection.requests.get(SessionProtocol.SwitchSessionRequest.type.method);
        assert.ok(handler, 'expected session/switch handler to be registered');

        const requestPromise = Promise.resolve(handler?.({ sessionId: 'session-2' }));
        await Promise.resolve();

        assert.deepStrictEqual(calls, ['focus:start:session-2']);

        deferred.resolve();
        await requestPromise;

        assert.deepStrictEqual(calls, [
            'focus:start:session-2',
            'focus:end:session-2',
            'snapshot',
        ]);
    });
});
