import * as assert from 'assert';
import * as vscode from 'vscode';
import type { DataConnection, DataConnectionDriver } from '../../api';
import {
    PositronConnectionInstance,
    PositronConnectionsService,
} from '../../services/connections/positronConnectionsService';
import type { PositronConnectionsComm } from '../../runtime/comms/positronConnectionsComm';
import {
    DataConnectionNodeKind,
    DataConnectionParameterType,
    DataConnectionProfileStore,
    DataConnectionsDriverManager,
} from '../../services/connections/dataConnections';
import {
    createSurfaceModelId,
    SurfaceLifecycleService,
    SurfaceModelKind,
} from '../../services/surfaces/surfaceLifecycleService';

class MemoryMemento implements vscode.Memento {
    readonly values = new Map<string, unknown>();
    keys(): readonly string[] { return [...this.values.keys()]; }
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined;
    }
    update(key: string, value: unknown): Thenable<void> { this.values.set(key, value); return Promise.resolve(); }
}

class MemorySecretStorage implements vscode.SecretStorage {
    readonly values = new Map<string, string>();
    private readonly _onDidChange = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
    readonly onDidChange = this._onDidChange.event;
    keys(): Thenable<string[]> { return Promise.resolve([...this.values.keys()]); }
    get(key: string): Thenable<string | undefined> { return Promise.resolve(this.values.get(key)); }
    store(key: string, value: string): Thenable<void> {
        this.values.set(key, value);
        this._onDidChange.fire({ key });
        return Promise.resolve();
    }
    delete(key: string): Thenable<void> {
        this.values.delete(key);
        this._onDidChange.fire({ key });
        return Promise.resolve();
    }
    dispose(): void { this._onDidChange.dispose(); }
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(complete => { resolve = complete; });
    return { promise, resolve };
}

async function createProfileHarness(connect: DataConnectionDriver['connect'], state = new MemoryMemento()) {
    const secrets = new MemorySecretStorage();
    const output = vscode.window.createOutputChannel('connections-lifecycle-test', { log: true });
    const lifecycle = new SurfaceLifecycleService(new MemoryMemento(), output);
    await lifecycle.initialize();
    const service = new PositronConnectionsService({ sessions: [] } as any, lifecycle, output, state, secrets);
    service.registerDriver({
        id: 'test-driver', name: 'Test', description: '', iconSvg: '', supportedLanguageIds: ['python'],
        mechanisms: [{ id: 'host', label: 'Host', description: '', parameters: [{
            id: 'password', label: 'Password', type: DataConnectionParameterType.Password, secret: true,
        }] }],
        connect,
    });
    const profile = {
        id: 'test-profile', createdAt: 1, driverId: 'test-driver', connectionName: 'Test',
        mechanismId: 'host', parameterValues: { password: 'secret' },
    };
    await service.addUpdateProfile(profile, false);
    return {
        service, secrets, profile, state, lifecycle,
        dispose: () => { service.dispose(); lifecycle.dispose(); secrets.dispose(); output.dispose(); },
    };
}

function createConnection(disconnect: () => Promise<void> = async () => undefined): DataConnection {
    return {
        isReadOnly: async () => true, isConnected: async () => true,
        getChildren: async () => [], disconnect,
    };
}

suite('[Unit] Connections surface', () => {
    test('coalesces profile connections before asynchronous secret reads', async () => {
        let connects = 0;
        const harness = await createProfileHarness(async () => { connects++; return createConnection(); });
        const secret = deferred<string>();
        const readingSecret = deferred<void>();
        harness.secrets.get = async () => { readingSecret.resolve(); return secret.promise; };
        try {
            const first = harness.service.connectProfile(harness.profile.id);
            await readingSecret.promise;
            const second = harness.service.connectProfile(harness.profile.id);
            secret.resolve('secret');
            const [left, right] = await Promise.all([first, second]);
            assert.strictEqual(left, right);
            assert.strictEqual(connects, 1);
            assert.strictEqual(harness.service.connections.length, 1);
            await harness.service.removeProfile(harness.profile.id);
        } finally {
            secret.resolve('secret');
            harness.dispose();
        }
    });

    test('allows retrying a failed profile connection', async () => {
        let attempts = 0;
        const harness = await createProfileHarness(async () => {
            if (++attempts === 1) {
                throw new Error('injected connection failure');
            }
            return createConnection();
        });
        try {
            await assert.rejects(harness.service.connectProfile(harness.profile.id), /injected connection failure/);
            assert.strictEqual((await harness.service.connectProfile(harness.profile.id)).active, true);
            assert.strictEqual(attempts, 2);
            await harness.service.removeProfile(harness.profile.id);
        } finally {
            harness.dispose();
        }
    });

    test('disconnects a modern connection exactly once when removing its profile', async () => {
        let disconnects = 0;
        const harness = await createProfileHarness(async () => createConnection(async () => { disconnects++; }));
        try {
            const instance = await harness.service.connectProfile(harness.profile.id);
            assert.strictEqual(await harness.service.removeProfile(harness.profile.id), true);
            await instance.dispose();
            assert.strictEqual(disconnects, 1);
            assert.strictEqual(instance.active, false);
            assert.strictEqual(harness.service.getConnection(instance.id), undefined);
        } finally {
            harness.dispose();
        }
    });

    test('retains legacy disposal after disconnecting a profile', async () => {
        const cleanup: string[] = [];
        const handle = {
            ...createConnection(async () => { cleanup.push('disconnect'); }),
            dispose: () => { cleanup.push('dispose'); },
        };
        const harness = await createProfileHarness(async () => handle);
        try {
            await harness.service.connectProfile(harness.profile.id);
            await harness.service.removeProfile(harness.profile.id);
            assert.deepStrictEqual(cleanup, ['disconnect', 'dispose']);
        } finally {
            harness.dispose();
        }
    });

    for (const action of ['remove', 'dispose']) {
        test(`disconnects late results after profile ${action} without restoring the connection`, async () => {
            const connection = deferred<DataConnection>();
            const started = deferred<void>();
            let disconnects = 0;
            const harness = await createProfileHarness(async () => { started.resolve(); return connection.promise; });
            try {
                const pending = harness.service.connectProfile(harness.profile.id);
                const rejected = assert.rejects(pending, /cancelled/);
                await started.promise;
                if (action === 'remove') {
                    await harness.service.removeProfile(harness.profile.id);
                } else {
                    harness.service.dispose();
                }
                connection.resolve(createConnection(async () => { disconnects++; }));
                await rejected;
                assert.strictEqual(disconnects, 1);
                assert.strictEqual(harness.service.connections.length, 0);
                assert.strictEqual(harness.service.profileStore.getProfile(harness.profile.id), undefined);
                const persisted = new DataConnectionProfileStore(harness.state, harness.secrets);
                if (action === 'remove') {
                    assert.strictEqual(persisted.getProfile(harness.profile.id), undefined);
                } else {
                    assert.ok(persisted.getProfile(harness.profile.id));
                }
                persisted.dispose();
            } finally {
                harness.dispose();
            }
        });
    }

    test('does not let an old connection overwrite a removed and recreated profile', async () => {
        const oldConnection = deferred<DataConnection>();
        const oldStarted = deferred<void>();
        let connects = 0;
        let oldDisconnects = 0;
        const harness = await createProfileHarness(async () => {
            if (++connects === 1) {
                oldStarted.resolve();
                return oldConnection.promise;
            }
            return createConnection();
        });
        try {
            const oldPending = harness.service.connectProfile(harness.profile.id);
            const rejected = assert.rejects(oldPending, /cancelled/);
            await oldStarted.promise;
            await harness.service.removeProfile(harness.profile.id);
            await harness.service.addUpdateProfile({ ...harness.profile, connectionName: 'Replacement' }, false);
            const replacement = await harness.service.connectProfile(harness.profile.id);
            oldConnection.resolve(createConnection(async () => { oldDisconnects++; }));
            await rejected;
            assert.strictEqual(oldDisconnects, 1);
            assert.strictEqual(harness.service.getConnection(replacement.id), replacement);
            assert.strictEqual(harness.service.profileStore.getProfile(harness.profile.id)?.connectionName,
                'Replacement');
            await harness.service.removeProfile(harness.profile.id);
        } finally {
            harness.dispose();
        }
    });

    test('does not restore a profile deleted while persisting its last-used timestamp', async () => {
        const state = new MemoryMemento();
        const saved = deferred<void>();
        const releaseSave = deferred<void>();
        const update = state.update.bind(state);
        state.update = async (key, value) => {
            await update(key, value);
            if (JSON.stringify(value).includes('lastUsedAt')) {
                saved.resolve();
                await releaseSave.promise;
            }
        };
        let disconnects = 0;
        const harness = await createProfileHarness(async () => createConnection(async () => { disconnects++; }), state);
        try {
            const pending = harness.service.connectProfile(harness.profile.id);
            const rejected = assert.rejects(pending, /cancelled/);
            await saved.promise;
            await harness.service.removeProfile(harness.profile.id);
            releaseSave.resolve();
            await rejected;
            assert.strictEqual(disconnects, 1);
            assert.strictEqual(harness.service.connections.length, 0);
            const restored = new DataConnectionProfileStore(state, harness.secrets);
            assert.strictEqual(restored.getProfile(harness.profile.id), undefined);
            restored.dispose();
        } finally {
            releaseSave.resolve();
            harness.dispose();
        }
    });

    test('expands objects, lists fields for data nodes, and previews through the runtime comm', async () => {
        const updateEmitter = new vscode.EventEmitter<Record<string, never>>();
        const closeEmitter = new vscode.EventEmitter<void>();
        const focusEmitter = new vscode.EventEmitter<Record<string, never>>();
        const stateEmitter = new vscode.EventEmitter<any>();
        const previews: string[][] = [];
        let disposed = false;
        const comm = {
            onDidUpdate: updateEmitter.event,
            onDidClose: closeEmitter.event,
            onDidFocus: focusEmitter.event,
            listObjects: async (path: Array<{ name: string }>) => path.length === 0
                ? [{ name: 'sales', kind: 'table' }, { name: 'analytics', kind: 'schema' }]
                : [],
            listFields: async () => [{ name: 'amount', dtype: 'double' }],
            containsData: async (path: Array<{ name: string }>) => path.at(-1)?.name === 'sales',
            previewObject: async (path: Array<{ name: string }>) => {
                previews.push(path.map(entry => entry.name));
                return null;
            },
            dispose: () => { disposed = true; },
        } as unknown as PositronConnectionsComm;
        const client = {
            onDidChangeClientState: stateEmitter.event,
            dispose: () => undefined,
        } as any;
        const connection = new PositronConnectionInstance(
            'session-1',
            'comm-1',
            { name: 'Warehouse', language_id: 'python', type: 'duckdb' },
            comm,
            client,
        );

        const roots = await connection.getChildren();
        assert.deepStrictEqual(roots.map(node => [node.name, node.containsData]), [
            ['sales', true],
            ['analytics', false],
        ]);
        const fields = await connection.getChildren(roots[0].path);
        assert.deepStrictEqual(fields.map(node => [node.name, node.kind, node.dtype]), [
            ['amount', 'field', 'double'],
        ]);
        await connection.preview(roots[0].path);
        assert.deepStrictEqual(previews, [['sales']]);

        connection.dispose();
        assert.strictEqual(disposed, true);
        updateEmitter.dispose();
        closeEmitter.dispose();
        focusEmitter.dispose();
        stateEmitter.dispose();
    });

    test('persists profile descriptors without secrets and hydrates them on restore', async () => {
        const state = new MemoryMemento();
        const secrets = new MemorySecretStorage();
        const store = new DataConnectionProfileStore(state, secrets);
        await store.addUpdateProfile({
            id: 'warehouse',
            createdAt: 1,
            driverId: 'postgres',
            connectionName: 'Warehouse',
            mechanismId: 'host',
            parameterValues: { host: 'db.example.test', password: 'cleartext' },
            autoConnect: true,
        }, ['password']);

        const serialized = JSON.stringify([...state.values.values()]);
        assert.ok(!serialized.includes('cleartext'));
        assert.ok([...secrets.values.values()].includes('cleartext'));
        assert.deepStrictEqual(store.getProfile('warehouse')?.parameterValues, { host: 'db.example.test' });

        const restored = new DataConnectionProfileStore(state, secrets);
        assert.deepStrictEqual((await restored.getProfileWithSecrets('warehouse'))?.parameterValues, {
            host: 'db.example.test',
            password: 'cleartext',
        });
        restored.dispose();
        store.dispose();
        secrets.dispose();
    });

    test('registers and removes drivers with stable ids', () => {
        const manager = new DataConnectionsDriverManager();
        const driver = {
            id: 'duckdb',
            metadata: { id: 'duckdb', name: 'DuckDB', mechanisms: [] },
            connect: async () => { throw new Error('not used'); },
        };
        const registration = manager.registerDriver(driver);
        assert.strictEqual(manager.getDriver('duckdb')?.name, 'DuckDB');
        registration.dispose();
        assert.strictEqual(manager.getDriver('duckdb'), undefined);
        manager.dispose();
    });

    test('supports current Positron driver and node callback contracts', async () => {
        const manager = new DataConnectionsDriverManager();
        let previewed = false;
        manager.registerDriver({
            id: 'current-driver',
            name: 'Current Driver',
            description: 'Current Positron API',
            iconSvg: '<svg/>',
            supportedLanguageIds: ['python'],
            mechanisms: [{
                id: 'file',
                label: 'File',
                description: 'Open a database file',
                parameters: [{
                    id: 'path',
                    label: 'Path',
                    type: DataConnectionParameterType.File,
                    required: true,
                }],
            }],
            connect: async () => ({
                isReadOnly: async () => true,
                isConnected: async () => true,
                disconnect: async () => undefined,
                getChildren: async () => [{
                    name: 'sales',
                    kind: DataConnectionNodeKind.Table,
                    preview: async () => { previewed = true; },
                }],
            }),
        });

        const summaries = manager.getDriverSummaries();
        assert.deepStrictEqual(summaries.map(driver => driver.id), ['current-driver']);
        const connection = await manager.connect('current-driver', 'file', { path: '/tmp/db' });
        assert.strictEqual(await connection.isReadOnly(), true);
        const nodes = await connection.getChildren();
        assert.strictEqual(nodes[0].kind, DataConnectionNodeKind.Table);
        await nodes[0].preview?.();
        assert.strictEqual(previewed, true);
        manager.dispose();
    });

    test('restores a saved profile definition without reconnecting until explicitly requested', async () => {
        const profileState = new MemoryMemento();
        const lifecycleState = new MemoryMemento();
        const secrets = new MemorySecretStorage();
        const output = vscode.window.createOutputChannel('connections-restore-test', { log: true });
        const createSession = new vscode.EventEmitter<any>();
        const deleteSession = new vscode.EventEmitter<string>();
        const sessionManager = {
            sessions: [],
            onDidCreateSession: createSession.event,
            onDidDeleteRuntimeSession: deleteSession.event,
        } as any;
        const passwords: string[] = [];
        const driver = {
            id: 'warehouse-driver',
            metadata: {
                id: 'warehouse-driver',
                name: 'Warehouse',
                mechanisms: [{
                    id: 'host',
                    label: 'Host',
                    parameters: [
                        { id: 'host', label: 'Host', type: 'string' as const, required: true },
                        { id: 'password', label: 'Password', type: 'password' as const, secret: true },
                    ],
                }],
            },
            connect: async (_mechanismId: string, values: Record<string, boolean | number | string>) => {
                passwords.push(String(values.password));
                return {
                    isConnected: async () => true,
                    getChildren: async () => [],
                    nodeGetChildren: async () => [],
                    nodePreview: async () => undefined,
                    disconnect: async () => undefined,
                    dispose: () => undefined,
                };
            },
        };

        const firstLifecycle = new SurfaceLifecycleService(lifecycleState, output, 'connections.models');
        await firstLifecycle.initialize();
        const first = new PositronConnectionsService(
            sessionManager, firstLifecycle, output, profileState, secrets,
        );
        first.initialize();
        first.registerDriver(driver);
        await first.addUpdateProfile({
            id: 'warehouse-profile',
            createdAt: Date.now(),
            driverId: driver.id,
            connectionName: 'Warehouse',
            mechanismId: 'host',
            parameterValues: { host: 'db.example.test', password: 'secret' },
            autoConnect: true,
        });
        await firstLifecycle.whenPersisted();
        first.dispose();
        firstLifecycle.dispose();

        const secondLifecycle = new SurfaceLifecycleService(lifecycleState, output, 'connections.models');
        await secondLifecycle.initialize();
        const modelId = createSurfaceModelId(SurfaceModelKind.Connection, 'profile', 'warehouse-profile');
        assert.strictEqual(secondLifecycle.getModel(modelId)?.restore.backend, 'pending');

        const second = new PositronConnectionsService(
            sessionManager, secondLifecycle, output, profileState, secrets,
        );
        second.initialize();
        second.registerDriver(driver);

        assert.deepStrictEqual(passwords, ['secret']);
        assert.strictEqual(
            second.connections.find(connection => connection.id === 'profile:warehouse-profile')?.active,
            false,
        );
        assert.strictEqual(secondLifecycle.getModel(modelId)?.restore.backend, 'ready');
        assert.strictEqual(secondLifecycle.getModel(modelId)?.restore.surface, 'pending');

        await second.connectProfile('warehouse-profile');
        assert.deepStrictEqual(passwords, ['secret', 'secret']);
        assert.strictEqual(
            second.connections.find(connection => connection.id === 'profile:warehouse-profile')?.active,
            true,
        );
        second.dispose();
        secondLifecycle.dispose();
        createSession.dispose();
        deleteSession.dispose();
        secrets.dispose();
        output.dispose();
    });
});
