import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    createSurfaceModelId,
    SurfaceKind,
    SurfaceLifecycleService,
    SurfaceModelKind,
    SurfaceSourceKind,
} from '../../services/surfaces/surfaceLifecycleService';

class MemoryMemento implements vscode.Memento {
    private readonly _values = new Map<string, unknown>();

    keys(): readonly string[] {
        return [...this._values.keys()];
    }

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        return (this._values.has(key) ? this._values.get(key) : defaultValue) as T | undefined;
    }

    update(key: string, value: unknown): Thenable<void> {
        if (value === undefined) {
            this._values.delete(key);
        } else {
            this._values.set(key, value);
        }
        return Promise.resolve();
    }
}

function model(
    id: string,
    options?: { retention?: 'transient' | 'retain-on-detach' | 'persistent'; stop?: () => void },
) {
    return {
        id,
        kind: SurfaceModelKind.Viewer,
        resourceId: id,
        title: id,
        source: {
            kind: SurfaceSourceKind.Runtime,
            id: 'session-1',
            sessionId: 'session-1',
            stop: options?.stop,
        },
        retention: options?.retention,
        payload: { value: id },
    };
}

suite('[Unit] surface-neutral model lifecycle', () => {
    let service: SurfaceLifecycleService;
    let memento: MemoryMemento;
    let output: vscode.LogOutputChannel;

    setup(async () => {
        memento = new MemoryMemento();
        output = vscode.window.createOutputChannel('surface-lifecycle-test', { log: true });
        service = new SurfaceLifecycleService(memento, output, 'test.surfaceModels');
        await service.initialize();
    });

    teardown(() => {
        service.dispose();
        output.dispose();
    });

    test('uses exclusive attachment leases and ignores stale lease disposal', () => {
        service.upsertModel(model('model-1'));
        service.upsertModel(model('model-2'));
        const first = service.attach('model-1', {
            surfaceId: 'viewer:main',
            kind: SurfaceKind.ViewerPane,
            ownerId: 'viewer',
        });
        const second = service.attach('model-2', {
            surfaceId: 'viewer:main',
            kind: SurfaceKind.ViewerPane,
            ownerId: 'viewer',
        });

        first.dispose();

        assert.strictEqual(service.getModel('model-1')?.state, 'detached');
        assert.strictEqual(service.getModel('model-2')?.state, 'attached');
        assert.strictEqual(service.getAttachments()[0]?.id, second.id);
    });

    test('disposes a transient model and its owned resource after its final detach', () => {
        let disposeCount = 0;
        service.upsertModel({
            ...model('transient', { retention: 'transient' }),
            ownedResource: new vscode.Disposable(() => disposeCount++),
        });
        const lease = service.attach('transient', {
            surfaceId: 'fallback:1',
            kind: SurfaceKind.Fallback,
            ownerId: 'fallback-renderer',
        });

        lease.dispose();
        service.disposeModel('transient');

        assert.strictEqual(service.getModel('transient'), undefined);
        assert.strictEqual(disposeCount, 1);
    });

    test('keeps a shared model alive when one of multiple surfaces closes', () => {
        service.upsertModel(model('shared-data-explorer'));
        const inline = service.attach('shared-data-explorer', {
            surfaceId: 'data-explorer-inline:notebook:output-1',
            kind: SurfaceKind.DataExplorerInline,
            ownerId: 'notebook-renderer',
        });
        const editor = service.attach('shared-data-explorer', {
            surfaceId: 'data-explorer-editor:comm-1',
            kind: SurfaceKind.DataExplorerEditor,
            ownerId: 'data-explorer-editor',
        });

        editor.dispose();

        const snapshot = service.getModel('shared-data-explorer');
        assert.strictEqual(snapshot?.state, 'attached');
        assert.deepStrictEqual(snapshot?.attachments.map(attachment => attachment.kind), [
            SurfaceKind.DataExplorerInline,
        ]);
        inline.dispose();
    });

    test('persists only restore tokens and restores them detached', async () => {
        const modelId = createSurfaceModelId(SurfaceModelKind.Viewer, 'session-1', 'output-1');
        service.upsertModel({
            ...model(modelId, { retention: 'persistent' }),
            outputId: 'output-1',
        });
        service.attach(modelId, {
            surfaceId: 'viewer:main',
            kind: SurfaceKind.ViewerPane,
            ownerId: 'viewer',
        });
        await service.whenPersisted();

        const restored = new SurfaceLifecycleService(memento, output, 'test.surfaceModels');
        await restored.initialize();
        const snapshot = restored.getModel(modelId);

        assert.strictEqual(snapshot?.state, 'restored');
        assert.strictEqual(snapshot?.attachments.length, 0);
        assert.strictEqual(snapshot?.canStop, false);
        assert.strictEqual(snapshot?.outputId, 'output-1');
        restored.dispose();
    });

    test('routes stop through source ownership and tears down models by session', async () => {
        let stopCount = 0;
        service.upsertModel(model('stoppable', { stop: () => stopCount++ }));
        service.upsertModel({
            ...model('other-session'),
            source: {
                kind: SurfaceSourceKind.Runtime,
                id: 'session-2',
                sessionId: 'session-2',
            },
        });

        const result = await service.stopModel('stoppable');
        const disposed = service.disposeSession('session-1');

        assert.deepStrictEqual(result, { handled: true });
        assert.strictEqual(stopCount, 1);
        assert.strictEqual(disposed, 1);
        assert.strictEqual(service.getModel('stoppable'), undefined);
        assert.ok(service.getModel('other-session'));
    });
});
