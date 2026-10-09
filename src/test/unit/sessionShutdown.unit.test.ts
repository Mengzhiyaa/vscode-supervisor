import * as assert from 'assert';
import * as vscode from 'vscode';
import { RuntimeExitReason, RuntimeState } from '../../internal/runtimeTypes';
import { RuntimeSessionService } from '../../runtime/runtimeSession';
import { KallichoreSession } from '../../supervisor/KallichoreSession';
import { Barrier } from '../../supervisor/async';
import { ShutdownRequest } from '../../supervisor/jupyter/ShutdownRequest';

function createKernel(connected = true) {
    const kernel = Object.create(KallichoreSession.prototype) as any;
    const barrier = new Barrier();
    if (connected) {
        barrier.open();
    }
    const sent: string[] = [];
    const exit = new vscode.EventEmitter<any>();
    let markSent!: () => void;
    const sentRequest = new Promise<void>((resolve) => { markSent = resolve; });
    Object.assign(kernel, {
        metadata: { sessionId: 'session-1' },
        runtimeMetadata: { runtimeName: 'Test runtime' },
        dynState: { sessionName: 'Test session' },
        _connected: barrier,
        _socket: {
            sessionId: 'session-1',
            userId: 'test',
            channel: { debug: () => undefined },
            ws: {
                send: (message: string) => {
                    sent.push(message);
                    markSent();
                },
            },
            close: () => undefined,
        },
        _pendingRequests: new Map(),
        _pendingUiCommRequests: [],
        _clients: new Map(),
        _comms: new Map(),
        _startingComms: new Map(),
        _lspClientRegistrations: new Map(),
        _disposables: [],
        _exit: exit,
        onDidEndSession: exit.event,
        _messages: { emitJupyter: () => undefined },
        _exitReason: RuntimeExitReason.Unknown,
        log: () => undefined,
    });
    return { kernel, barrier, sent, sentRequest };
}

suite('[Unit] session shutdown', () => {
    test('deletes the session when the kernel exits before replying to shutdown', async () => {
        const { kernel, sent, sentRequest } = createKernel();
        const session = {
            sessionId: 'session-1',
            state: RuntimeState.Idle,
            shutdown: () => kernel.shutdown(RuntimeExitReason.Shutdown),
        };
        const removed: string[] = [];
        const manager = {
            _sessions: new Map([[session.sessionId, session]]),
            _deletingSessionPromises: new Map(),
            _deleteSession: (RuntimeSessionService.prototype as any)._deleteSession,
            _outputChannel: { debug: () => undefined, warn: () => undefined },
            _removeSession: async (removedSession: typeof session) => {
                removed.push(removedSession.sessionId);
            },
        };

        const deletion = RuntimeSessionService.prototype.deleteSession.call(manager as any, session.sessionId);
        await sentRequest;
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(kernel._pendingRequests.size, 1);
        kernel.onExited(0);

        assert.strictEqual(await deletion, true);
        assert.deepStrictEqual(removed, ['session-1']);
        assert.strictEqual(kernel._pendingRequests.size, 0);
    });

    test('accepts a shutdown reply and clears the pending request', async () => {
        const { kernel, sent, sentRequest } = createKernel();
        const request = new ShutdownRequest(false);
        const response = kernel.sendRequest(request, 1000);
        await sentRequest;
        assert.strictEqual(sent.length, 1);
        await kernel.handleJupyterMessage({
            header: { msg_type: request.replyType },
            parent_header: { msg_id: request.msgId },
            content: { status: 'ok', restart: false },
            channel: 'control',
        });
        assert.deepStrictEqual(await response, { status: 'ok', restart: false });
        assert.strictEqual(kernel._pendingRequests.size, 0);
    });

    test('bounds a missing shutdown reply and removes the pending request', async () => {
        const { kernel, sent } = createKernel();
        await assert.rejects(
            kernel.sendRequest(new ShutdownRequest(false), 10),
            /Timed out waiting for shutdown_request/,
        );
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(kernel._pendingRequests.size, 0);
    });

    test('terminates the kernel through the supervisor if graceful shutdown fails', async () => {
        const { kernel } = createKernel();
        let killedSession: string | undefined;
        kernel.sendRequest = async (_request: ShutdownRequest, timeoutMs: number) => {
            assert.strictEqual(timeoutMs, 10000);
            throw new Error('Shutdown deadline exceeded');
        };
        kernel._api = {
            killSession: async (sessionId: string, options: { timeout: number }) => {
                assert.strictEqual(options.timeout, 5000);
                killedSession = sessionId;
            },
            getSession: async () => ({ data: { status: 'exited' } }),
        };
        await kernel.shutdown(RuntimeExitReason.Shutdown);
        assert.strictEqual(killedSession, 'session-1');
    });

    test('a shutdown acknowledgement does not complete deletion before the kernel exits', async () => {
        const { kernel, sentRequest } = createKernel();
        let completed = false;
        const shutdown = kernel.shutdown(RuntimeExitReason.Shutdown).then(() => { completed = true; });
        await sentRequest;
        const request = [...kernel._pendingRequests.values()][0] as ShutdownRequest;
        request.resolve({ status: 'ok', restart: false });
        await Promise.resolve();
        await Promise.resolve();
        assert.strictEqual(completed, false);
        kernel.onExited(0);
        await shutdown;
        assert.strictEqual(completed, true);
    });

    test('unregisters a session even when backend shutdown fails', async () => {
        let removed = false;
        const session = {
            state: RuntimeState.Idle,
            shutdown: async () => { throw new Error('Supervisor unavailable'); },
        };
        const manager = {
            _sessions: new Map([['session-1', session]]),
            _deletingSessionPromises: new Map(),
            _deleteSession: (RuntimeSessionService.prototype as any)._deleteSession,
            _outputChannel: { debug: () => undefined, warn: () => undefined },
            _removeSession: async () => {
                removed = true;
                manager._sessions.delete('session-1');
            },
        };
        await assert.rejects(
            RuntimeSessionService.prototype.deleteSession.call(manager as any, 'session-1'),
            /Supervisor unavailable/,
        );
        assert.strictEqual(removed, true);
        assert.strictEqual(manager._sessions.has('session-1'), false);
        assert.strictEqual(manager._deletingSessionPromises.size, 0);
    });

    test('concurrent delete requests share one shutdown and one removal', async () => {
        let finishShutdown!: () => void;
        const pendingShutdown = new Promise<void>((resolve) => { finishShutdown = resolve; });
        let shutdowns = 0;
        let removals = 0;
        const manager = {
            _sessions: new Map([['session-1', {
                state: RuntimeState.Idle,
                shutdown: async () => { shutdowns += 1; await pendingShutdown; },
            }]]),
            _deletingSessionPromises: new Map(),
            _deleteSession: (RuntimeSessionService.prototype as any)._deleteSession,
            _outputChannel: { debug: () => undefined, warn: () => undefined },
            _removeSession: async () => { removals += 1; },
        };
        const first = RuntimeSessionService.prototype.deleteSession.call(manager as any, 'session-1');
        const second = RuntimeSessionService.prototype.deleteSession.call(manager as any, 'session-1');
        assert.strictEqual(shutdowns, 1);
        finishShutdown();
        assert.deepStrictEqual(await Promise.all([first, second]), [true, true]);
        assert.strictEqual(removals, 1);
    });

    test('does not send a timed-out shutdown after reconnecting', async () => {
        const { kernel, barrier, sent } = createKernel(false);
        await assert.rejects(
            kernel.sendRequest(new ShutdownRequest(false), 10),
            /Timed out waiting for shutdown_request/,
        );
        barrier.open();
        await Promise.resolve();
        await Promise.resolve();
        assert.deepStrictEqual(sent, []);
        assert.strictEqual(kernel._pendingRequests.size, 0);
    });

    test('rejects a pending request when the session is disposed', async () => {
        const { kernel } = createKernel(false);
        const pending = kernel.sendRequest(new ShutdownRequest(false), 1000);
        kernel.dispose();
        await assert.rejects(pending, /disposed/);
        assert.strictEqual(kernel._pendingRequests.size, 0);
    });
});
