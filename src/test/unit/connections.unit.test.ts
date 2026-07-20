import * as assert from 'assert';
import * as vscode from 'vscode';
import { PositronConnectionInstance } from '../../services/connections/positronConnectionsService';
import type { PositronConnectionsComm } from '../../runtime/comms/positronConnectionsComm';

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
});
