import * as assert from 'assert';
import * as vscode from 'vscode';
import { SupportStatus } from '../../shared/dataExplorer';
import {
    DataExplorerBackendRegistry,
    DataExplorerBackendTransport,
} from '../../services/dataExplorer/positronDataExplorerExtensionBackend';

suite('[Unit] Data Explorer extension backend', () => {
    test('routes typed requests and isolates events by dataset URI', async () => {
        const eventEmitter = new vscode.EventEmitter<any>();
        const requests: any[] = [];
        let disposed = false;
        const transport: DataExplorerBackendTransport = {
            onDidEmitEvent: eventEmitter.event,
            handleRpc: async request => {
                requests.push(request);
                return request.method === 'get_state' ? backendState() : undefined;
            },
            dispose: () => { disposed = true; },
        };
        const registry = new DataExplorerBackendRegistry();
        registry.registerProvider({
            id: 'test-provider',
            canHandle: uri => uri.scheme === 'test-data',
            open: async () => transport,
        });
        const backend = await registry.open(vscode.Uri.parse('test-data:/table'));
        const state = await backend.getState();
        await backend.setSortColumns([{ column_index: 0, ascending: true }]);

        assert.strictEqual(state.display_name, 'Extension table');
        assert.deepStrictEqual(requests.map(request => request.method), ['get_state', 'set_sort_columns']);
        assert.deepStrictEqual(requests[1].params, {
            sort_keys: [{ column_index: 0, ascending: true }],
        });

        let schemaUpdates = 0;
        backend.onDidSchemaUpdate(() => schemaUpdates++);
        eventEmitter.fire({ method: 'schema_update', uri: 'test-data:/other' });
        eventEmitter.fire({ method: 'schema_update', uri: 'test-data:/table' });
        assert.strictEqual(schemaUpdates, 1);

        backend.dispose();
        assert.strictEqual(disposed, true);
        registry.dispose();
        eventEmitter.dispose();
    });

    test('rejects duplicate provider registration and unsupported URIs', async () => {
        const registry = new DataExplorerBackendRegistry();
        const provider = {
            id: 'duplicate',
            canHandle: () => false,
            open: async () => { throw new Error('not called'); },
        };
        registry.registerProvider(provider);
        assert.throws(() => registry.registerProvider(provider), /already registered/);
        await assert.rejects(() => registry.open(vscode.Uri.parse('file:/data.unknown')), /No Data Explorer backend/);
        registry.dispose();
    });
});

function backendState() {
    return {
        display_name: 'Extension table',
        table_shape: { num_rows: 1, num_columns: 1 },
        table_unfiltered_shape: { num_rows: 1, num_columns: 1 },
        has_row_labels: false,
        column_filters: [],
        row_filters: [],
        sort_keys: [],
        supported_features: {
            search_schema: { support_status: SupportStatus.Unsupported, supported_types: [] },
            set_column_filters: { support_status: SupportStatus.Unsupported, supported_types: [] },
            set_row_filters: {
                support_status: SupportStatus.Unsupported,
                supports_conditions: SupportStatus.Unsupported,
                supported_types: [],
            },
            get_column_profiles: { support_status: SupportStatus.Unsupported, supported_types: [] },
            set_sort_columns: { support_status: SupportStatus.Unsupported },
            export_data_selection: { support_status: SupportStatus.Unsupported, supported_formats: [] },
            convert_to_code: { support_status: SupportStatus.Unsupported, code_syntaxes: [] },
        },
    };
}
