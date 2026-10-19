import * as assert from 'assert';
import * as vscode from 'vscode';
import { RuntimeClientManager } from '../../runtime/runtimeClientManager';
import { RuntimeClientType, RuntimeState } from '../../internal/runtimeTypes';
import type { JupyterLanguageRuntimeSession } from '../../supervisor/positron-supervisor';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function makeManager(
    listClients: (type?: RuntimeClientType) => Promise<Record<string, string>> = async () => ({}),
    createClient: (id: string, type: RuntimeClientType) => Promise<void> = async () => undefined,
) {
    const states = new vscode.EventEmitter<RuntimeState>();
    const created: Array<{ id: string; type: RuntimeClientType }> = [];
    const removed: string[] = [];
    const session = {
        runtimeMetadata: { languageId: 'r' },
        onDidChangeRuntimeState: states.event,
        listClients,
        createClient: async (id: string, type: RuntimeClientType) => {
            created.push({ id, type });
            await createClient(id, type);
        },
        removeClient: (id: string) => {
            removed.push(id);
        },
        sendClientMessage: () => undefined,
    } as unknown as JupyterLanguageRuntimeSession;
    const noop = () => undefined;
    const log = {
        info: noop,
        debug: noop,
        warn: noop,
        error: noop,
    } as unknown as vscode.LogOutputChannel;
    const manager = new RuntimeClientManager(session, log);
    return { manager, states, created, removed };
}

suite('[Unit] RuntimeClientManager lifecycle', () => {
    test('ignores a late comm-info reply after disposal', async () => {
        const reply = deferred<Record<string, string>>();
        const { manager, states, created, removed } = makeManager(() => reply.promise);
        const initializing = manager.initializeClients();
        manager.dispose();
        reply.resolve({ existing: RuntimeClientType.Variables });
        await initializing;
        await manager.initializeClients();
        assert.deepStrictEqual(created, []);
        assert.deepStrictEqual(removed, [], 'a discovered backend comm is not a new orphan');
        assert.deepStrictEqual(manager.clientInstances, []);
        states.dispose();
    });

    test('direct restoration cannot register clients after disposal', async () => {
        const reply = deferred<Record<string, string>>();
        const { manager, states } = makeManager(() => reply.promise);
        const restoring = manager.restoreExistingClients();
        manager.dispose();
        reply.resolve({ existing: RuntimeClientType.Ui });
        await restoring;
        assert.deepStrictEqual(manager.clientInstances, []);
        assert.strictEqual(manager.uiClientId, undefined);
        states.dispose();
    });

    for (const type of [
        RuntimeClientType.Variables,
        RuntimeClientType.Ui,
        RuntimeClientType.Help,
    ]) {
        test(`removes a late ${type} creation after disposal`, async () => {
            const entered = deferred<void>();
            const creation = deferred<void>();
            const { manager, states, created, removed } = makeManager(
                undefined,
                async (_id, creatingType) => {
                    if (creatingType === type) {
                        entered.resolve();
                        await creation.promise;
                    }
                },
            );
            const initializing = manager.initializeClients();
            await entered.promise;
            manager.dispose();
            creation.resolve();
            await initializing;
            manager.dispose();
            assert.strictEqual(created[created.length - 1].type, type);
            assert.deepStrictEqual(
                removed.slice().sort(),
                created.map((client) => client.id).sort(),
            );
            assert.deepStrictEqual(manager.clientInstances, []);
            assert.strictEqual(manager.variablesClientId, undefined);
            assert.strictEqual(manager.uiClientId, undefined);
            assert.strictEqual(manager.helpClientId, undefined);
            states.dispose();
        });
    }

    test('does not create Help after its availability reply arrives late', async () => {
        const entered = deferred<void>();
        const reply = deferred<Record<string, string>>();
        const { manager, states, created } = makeManager(async (type) => {
            if (type === RuntimeClientType.Help) {
                entered.resolve();
                return reply.promise;
            }
            return {};
        });
        const initializing = manager.initializeClients();
        await entered.promise;
        manager.dispose();
        reply.resolve({});
        await initializing;
        assert.deepStrictEqual(
            created.map((client) => client.type),
            [RuntimeClientType.Variables, RuntimeClientType.Ui],
        );
        states.dispose();
    });

    test('an old initialization cannot clear the new restart initialization', async () => {
        const oldReply = deferred<Record<string, string>>();
        const newReply = deferred<Record<string, string>>();
        let queries = 0;
        const { manager, states, created } = makeManager(async (type) => {
            if (type) {
                return {};
            }
            queries++;
            return queries === 1 ? oldReply.promise : newReply.promise;
        });
        try {
            const oldInitialization = manager.initializeClients();
            states.fire(RuntimeState.Exited);
            const newInitialization = manager.initializeClients();
            oldReply.resolve({ obsolete: RuntimeClientType.Variables });
            await oldInitialization;
            const concurrentInitialization = manager.initializeClients();
            assert.strictEqual(queries, 2, 'concurrent callers must reuse the new initialization');
            assert.strictEqual(manager.getClient('obsolete'), undefined);
            newReply.resolve({});
            await Promise.all([newInitialization, concurrentInitialization]);
            assert.strictEqual(created.length, 3);
            assert.strictEqual(manager.clientInstances.length, 3);
        } finally {
            manager.dispose();
            states.dispose();
        }
    });
});
