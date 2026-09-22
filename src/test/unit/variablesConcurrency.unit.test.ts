import * as assert from 'assert';
import * as vscode from 'vscode';
import { PositronVariablesInstance } from '../../services/variables/variablesInstance';
import { RuntimeState } from '../../internal/runtimeTypes';
import { RuntimeClientState, RuntimeClientStatus } from '../../services/variables/interfaces/variablesService';
import type { RuntimeSession } from '../../runtime/session';
import { VariableKind, type Variable } from '../../runtime/comms/positronVariablesComm';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function variable(name: string, children = false): Variable {
    return { access_key: name, display_name: name, display_value: name, display_type: 'list', type_info: '', kind: VariableKind.Collection, length: 1, size: 1, has_children: children, has_viewer: false, is_truncated: false, updated_time: 0 };
}
function session(): RuntimeSession {
    return {
        sessionId: 'same-session-id', state: RuntimeState.Idle,
        onDidCreateClientManager: () => new vscode.Disposable(() => undefined),
        onDidChangeRuntimeState: () => new vscode.Disposable(() => undefined),
    } as unknown as RuntimeSession;
}

suite('[Unit] Variables asynchronous state', () => {
    let instance: PositronVariablesInstance;
    let log: vscode.LogOutputChannel;
    let notifications: string[];
    const showError = vscode.window.showErrorMessage;
    const client = (overrides: Record<string, unknown>) => ({ dispose: () => undefined, ...overrides });
    const attach = (value: unknown) => {
        Object.assign(instance, { _variablesClient: value });
        instance.setState(RuntimeClientState.Connected);
    };

    setup(() => {
        log = vscode.window.createOutputChannel('Variables concurrency tests', { log: true });
        instance = new PositronVariablesInstance(session(), log);
        notifications = [];
        vscode.window.showErrorMessage = async (message: string) => { notifications.push(message); return undefined; };
    });
    teardown(() => { instance.dispose(); log.dispose(); vscode.window.showErrorMessage = showError; });

    test('an old refresh cannot repopulate a restarted session or clear its busy state', async () => {
        const old = deferred<{ data: Variable[] }>();
        attach(client({ requestRefresh: () => old.promise }));
        const oldRequest = instance.requestRefresh();
        instance.setRuntimeSession(session());
        const current = deferred<{ data: Variable[] }>();
        attach(client({ requestRefresh: () => current.promise }));
        const currentRequest = instance.requestRefresh();
        old.resolve({ data: [variable('old')] });
        await oldRequest;
        assert.strictEqual(instance.variableItems.length, 0);
        assert.strictEqual(instance.status, RuntimeClientStatus.Busy);
        current.resolve({ data: [variable('current')] });
        await currentRequest;
        assert.deepStrictEqual(instance.variableItems.map(item => item.displayName), ['current']);
        assert.strictEqual(instance.status, RuntimeClientStatus.Idle);
    });

    test('newer refresh and kernel updates win over late snapshots', async () => {
        const first = deferred<{ data: Variable[] }>();
        const second = deferred<{ data: Variable[] }>();
        let calls = 0;
        attach(client({ requestRefresh: () => (++calls === 1 ? first : second).promise }));
        const a = instance.requestRefresh();
        const b = instance.requestRefresh();
        second.resolve({ data: [variable('newer')] });
        await b;
        first.resolve({ data: [variable('older')] });
        await a;
        assert.strictEqual(instance.variableItems[0].displayName, 'newer');
        const third = deferred<{ data: Variable[] }>();
        attach(client({ requestRefresh: () => third.promise }));
        const c = instance.requestRefresh();
        instance.updateVariables([variable('notification')]);
        third.resolve({ data: [variable('snapshot')] });
        await c;
        assert.strictEqual(instance.variableItems[0].displayName, 'notification');
    });

    test('clear completion from a prior session cannot refresh its replacement', async () => {
        const pending = deferred<void>();
        attach(client({ requestClear: () => pending.promise }));
        const clear = instance.requestClear(false);
        instance.setRuntimeSession(session());
        let refreshes = 0;
        attach(client({ requestRefresh: async () => { refreshes++; return { data: [] }; } }));
        pending.resolve();
        await clear;
        assert.strictEqual(refreshes, 0);
        assert.deepStrictEqual(notifications, []);
    });

    test('errors from a disposed client do not produce errors in the new session', async () => {
        const pending = deferred<{ data: Variable[] }>();
        attach(client({ requestRefresh: () => pending.promise }));
        const refresh = instance.requestRefresh();
        instance.setRuntimeSession(session());
        pending.reject(new Error('old comm closed'));
        await refresh;
        assert.deepStrictEqual(notifications, []);
    });

    test('closing the comm invalidates pending work before its final closed event', async () => {
        const pending = deferred<{ data: Variable[] }>();
        attach(client({ requestRefresh: () => pending.promise }));
        const refresh = instance.requestRefresh();
        (instance as unknown as { _syncClientState(state: RuntimeClientState): void })._syncClientState(RuntimeClientState.Closing);
        pending.resolve({ data: [variable('too-late')] });
        await refresh;
        assert.strictEqual(instance.variableItems.length, 0);
        assert.strictEqual(instance.status, RuntimeClientStatus.Disconnected);
    });

    test('a delayed delete reply reconciles a variable reassigned while the request was pending', async () => {
        const pending = deferred<{ assigned: []; removed: string[] }>();
        let refreshes = 0;
        attach(client({
            requestDelete: () => pending.promise,
            requestRefresh: async () => { refreshes++; return { data: [variable('root')] }; },
        }));
        instance.updateVariables([variable('root')]);
        const deletion = instance.requestDelete(['root']);
        instance.updateVariables([variable('root')]);
        pending.resolve({ assigned: [], removed: ['root'] });
        await deletion;
        assert.strictEqual(refreshes, 1);
        assert.strictEqual(instance.variableItems[0].displayName, 'root');
    });

    test('a failed inspection is visible and can be retried without collapsing first', async () => {
        let attempts = 0;
        attach(client({ inspect: async () => {
            if (++attempts === 1) { throw new Error('inspect failed'); }
            return { children: [variable('child')], length: 4 };
        } }));
        instance.updateVariables([variable('root', true)]);
        await assert.rejects(instance.expandVariableItem(['root']), /inspect failed/);
        assert.strictEqual(notifications.length, 1);
        await instance.expandVariableItem(['root']);
        assert.strictEqual(attempts, 2);
        assert.strictEqual(instance.variableItems[0].childItems?.[0].displayName, 'child');
    });

    test('a superseded child inspection cannot overwrite a later expansion', async () => {
        const old = deferred<{ children: Variable[]; length: number }>();
        const current = deferred<{ children: Variable[]; length: number }>();
        let attempts = 0;
        attach(client({ inspect: () => (++attempts === 1 ? old : current).promise }));
        instance.updateVariables([variable('root', true)]);
        const a = instance.expandVariableItem(['root']);
        instance.collapseVariableItem(['root']);
        const b = instance.expandVariableItem(['root']);
        current.resolve({ children: [variable('new')], length: 1 });
        await b;
        old.resolve({ children: [variable('old')], length: 1 });
        await a;
        assert.strictEqual(instance.variableItems[0].childItems?.[0].displayName, 'new');
    });
});
