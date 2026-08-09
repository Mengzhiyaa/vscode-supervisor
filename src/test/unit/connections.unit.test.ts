import * as assert from 'assert';
import * as vscode from 'vscode';
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

suite('[Unit] Connections surface', () => {
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
