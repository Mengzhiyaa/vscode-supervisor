import * as assert from 'assert';
import * as vscode from 'vscode';
import { ViewerViewProvider } from '../../webview/viewerProvider';

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'viewer-provider-unit-test',
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
    readonly notifications = new Map<string, (params: any) => Promise<any> | any>();

    onNotification(type: { method: string } | string, handler: (params: any) => Promise<any> | any): vscode.Disposable {
        const method = typeof type === 'string' ? type : type.method;
        this.notifications.set(method, handler);
        return { dispose: () => undefined };
    }

    onRequest(): vscode.Disposable {
        return { dispose: () => undefined };
    }

    sendNotification(): void {
        // No-op for this unit test.
    }
}

function createProvider(options?: {
    getConsoleInstance?: (sessionId: string) => any;
}) {
    return new ViewerViewProvider(
        vscode.Uri.file('/tmp'),
        makeNoopLogChannel(),
        {
            onDidShowPreview: createEventStub(),
            handleShowUrl: () => undefined,
        } as any,
        {
            getConsoleInstance: options?.getConsoleInstance ?? (() => undefined),
        } as any,
    );
}

suite('[Unit] viewer provider interrupt routing', () => {
    test('routes interrupts through the console instance when available', async () => {
        const interrupts: string[] = [];
        const provider = createProvider({
            getConsoleInstance: (sessionId: string) =>
                sessionId === 'session-1'
                    ? {
                        interrupt: () => {
                            interrupts.push(sessionId);
                        },
                    }
                    : undefined,
        });
        (provider as any)._lastPreview = {
            type: 'url',
            uri: vscode.Uri.parse('https://example.com'),
            sessionId: 'session-1',
        };

        const connection = new FakeConnection();
        (provider as any)._registerRpcHandlers(connection as any);

        const handler = connection.notifications.get('viewer/interrupt');
        assert.ok(handler, 'expected viewer/interrupt handler to be registered');

        await handler?.(undefined);

        assert.deepStrictEqual(interrupts, ['session-1']);
    });

    test('no-ops when no console instance exists', async () => {
        const provider = createProvider({
            getConsoleInstance: () => undefined,
        });
        (provider as any)._lastPreview = {
            type: 'url',
            uri: vscode.Uri.parse('https://example.com'),
            sessionId: 'session-2',
        };

        const connection = new FakeConnection();
        (provider as any)._registerRpcHandlers(connection as any);

        const handler = connection.notifications.get('viewer/interrupt');
        assert.ok(handler, 'expected viewer/interrupt handler to be registered');

        await handler?.(undefined);

        assert.ok(true);
    });
});
