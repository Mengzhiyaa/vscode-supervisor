import * as assert from 'assert';
import * as vscode from 'vscode';
import type {
    BackendState,
    ColumnSelection,
    TableData,
} from '../../runtime/comms/positronDataExplorerComm';
import { SupportStatus } from '../../runtime/comms/positronDataExplorerComm';
import { PositronDataExplorerInstance } from '../../services/dataExplorer/positronDataExplorerInstance';
import type { DataExplorerClientInstance } from '../../services/dataExplorer/languageRuntimeDataExplorerClient';
import { PositronDataExplorerService } from '../../services/dataExplorer/positronDataExplorerService';
import { TableDataCache } from '../../services/dataExplorer/common/tableDataCache';
import { TableSummaryCache } from '../../services/dataExplorer/common/tableSummaryCache';

function createBackendState(rows = 2, columns = 2): BackendState {
    return {
        display_name: 'Lifecycle table',
        table_shape: { num_rows: rows, num_columns: columns },
        table_unfiltered_shape: { num_rows: rows, num_columns: columns },
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

function selectionRows(selection: ColumnSelection): number[] {
    const spec = selection.spec;
    if ('indices' in spec) {
        return spec.indices;
    }
    return Array.from(
        { length: spec.last_index - spec.first_index + 1 },
        (_, offset) => spec.first_index + offset,
    );
}

function createClient(
    clientId = 'lifecycle-client',
    rows = 2,
    columns = 2,
) {
    const closeEmitter = new vscode.EventEmitter<void>();
    const schemaEmitter = new vscode.EventEmitter<{}>();
    const dataEmitter = new vscode.EventEmitter<{}>();
    const backendEmitter = new vscode.EventEmitter<BackendState>();
    const state = createBackendState(rows, columns);
    let dataRequests = 0;
    let disposed = false;
    const client = {
        clientId,
        cachedBackendState: state,
        onDidClose: closeEmitter.event,
        onDidSchemaUpdate: schemaEmitter.event,
        onDidDataUpdate: dataEmitter.event,
        onDidUpdateBackendState: backendEmitter.event,
        getSchema: async (indices: number[]) => ({
            columns: indices.map(column_index => ({
                column_index,
                column_name: `column_${column_index}`,
                type_name: 'string',
                type_display: 'string',
            })),
        }),
        getDataValues: async (selections: ColumnSelection[]): Promise<TableData> => {
            dataRequests++;
            return {
                columns: selections.map(selection => selectionRows(selection).map(row => {
                    if (selection.column_index === 0 && row === 0) {
                        return 0;
                    }
                    return `${selection.column_index}:${row}`;
                })),
            };
        },
        requestColumnProfiles: async () => [],
        setDatasetImportOptions: async () => ({}),
        dispose: () => { disposed = true; },
    } as unknown as DataExplorerClientInstance;
    return {
        client,
        close: () => closeEmitter.fire(),
        get dataRequests() { return dataRequests; },
        get disposed() { return disposed; },
        dispose: () => {
            closeEmitter.dispose();
            schemaEmitter.dispose();
            dataEmitter.dispose();
            backendEmitter.dispose();
        },
    };
}

suite('[Unit] Positron Data Explorer model lifecycle', () => {
    test('coalesces overlapping host viewport requests', async () => {
        let resolveRequest: ((value: TableData) => void) | undefined;
        let requests = 0;
        const client = {
            getDataValues: async () => {
                requests++;
                return new Promise<TableData>(resolve => {
                    resolveRequest = resolve;
                });
            },
        } as unknown as DataExplorerClientInstance;
        const cache = new TableDataCache(client);
        const selection: ColumnSelection[] = [{
            column_index: 0,
            spec: { first_index: 0, last_index: 2 },
        }];

        const first = cache.getDataValues(selection, 0);
        const second = cache.getDataValues(selection, 0);
        assert.strictEqual(requests, 1);
        resolveRequest?.({ columns: [['a', 'b', 'c']] });

        assert.deepStrictEqual(await first, { columns: [['a', 'b', 'c']] });
        assert.deepStrictEqual(await second, { columns: [['a', 'b', 'c']] });
        assert.strictEqual(requests, 1);
    });

    test('chunks profile fetches and serves them from the shared cache', async () => {
        const chunkSizes: number[] = [];
        const client = {
            requestColumnProfiles: async (requests: Array<{ column_index: number }>) => {
                chunkSizes.push(requests.length);
                return requests.map(request => ({ null_count: request.column_index }));
            },
        } as unknown as DataExplorerClientInstance;
        const cache = new TableSummaryCache(client);
        const requests = Array.from({ length: 17 }, (_, column_index) => ({
            column_index,
            profiles: [],
        }));

        const first = await cache.requestColumnProfiles(requests, 0);
        const second = await cache.requestColumnProfiles(requests, 0);

        assert.deepStrictEqual(chunkSizes, [8, 8, 1]);
        assert.strictEqual(first.length, 17);
        assert.deepStrictEqual(second, first);
    });

    test('owns UI, visibility and foreground loading state', async () => {
        const fixture = createClient();
        const instance = new PositronDataExplorerInstance(fixture.client, 'Python');
        const loadingStates: boolean[] = [];
        instance.onDidChangeForegroundLoading(loading => loadingStates.push(loading));

        instance.setLayout('SummaryOnRight');
        instance.setSummaryCollapsed(true);
        instance.setSummaryWidth(420);
        instance.setSelection({
            selectionType: 'cell',
            columnIndex: 1,
            rowIndex: 1,
        });
        const firstLease = instance.acquireVisibility('editor');
        const secondLease = instance.acquireVisibility('inline');
        firstLease.dispose();
        secondLease.dispose();

        await instance.runWithForegroundLoading(async () => undefined);

        assert.deepStrictEqual(instance.uiState, {
            layout: 'SummaryOnRight',
            summaryCollapsed: true,
            summaryWidth: 420,
        });
        assert.deepStrictEqual(instance.selection, {
            selectionType: 'cell',
            columnIndex: 1,
            rowIndex: 1,
        });
        assert.deepStrictEqual(loadingStates, [true, false]);
        instance.dispose();
        fixture.dispose();
    });

    test('keeps the model and UI state across backend close and rebind', async () => {
        const first = createClient();
        const second = createClient();
        const instance = new PositronDataExplorerInstance(first.client, 'Python');
        instance.setLayout('SummaryOnRight');
        const visibilityLease = instance.acquireVisibility('editor');
        let closeCount = 0;
        instance.onDidClose(() => closeCount++);

        first.close();
        assert.strictEqual(closeCount, 1);

        instance.rebindClientInstance(second.client);
        assert.strictEqual(instance.clientInstance, second.client);
        assert.strictEqual(instance.uiState.layout, 'SummaryOnRight');
        assert.strictEqual(first.disposed, true);

        visibilityLease.dispose();
        instance.dispose();
        first.dispose();
        second.dispose();
    });

    test('shares cached values and invalidates them by generation', async () => {
        const fixture = createClient();
        const instance = new PositronDataExplorerInstance(fixture.client, 'Python');
        const selection: ColumnSelection[] = [{
            column_index: 1,
            spec: { first_index: 0, last_index: 1 },
        }];

        await instance.getDataValues(selection, instance.dataGeneration);
        await instance.getDataValues(selection, instance.dataGeneration);
        assert.strictEqual(fixture.dataRequests, 1);

        instance.invalidateData(false);
        await instance.getDataValues(selection, instance.dataGeneration);
        assert.strictEqual(fixture.dataRequests, 2);
        instance.dispose();
        fixture.dispose();
    });

    test('pages full table fallback and decodes protocol sentinel values', async () => {
        const fixture = createClient('lifecycle-client', 101, 2);
        const instance = new PositronDataExplorerInstance(fixture.client, 'Python');
        const progress: number[] = [];

        const tsv = await instance.getTableDataTsv(undefined, completed => progress.push(completed));

        assert.ok(tsv.startsWith('NULL\t1:0\n0:1\t1:1'));
        assert.strictEqual(tsv.split('\n').length, 101);
        assert.deepStrictEqual(progress, [100, 101]);
        assert.strictEqual(fixture.dataRequests, 2);
        instance.dispose();
        fixture.dispose();
    });

    test('cancels full table fallback before requesting another page', async () => {
        const fixture = createClient('lifecycle-client', 101, 2);
        const instance = new PositronDataExplorerInstance(fixture.client, 'Python');
        const tokenSource = new vscode.CancellationTokenSource();
        tokenSource.cancel();

        await assert.rejects(
            () => instance.getTableDataTsv(tokenSource.token),
            error => error instanceof vscode.CancellationError,
        );
        assert.strictEqual(fixture.dataRequests, 0);
        tokenSource.dispose();
        instance.dispose();
        fixture.dispose();
    });

    test('service reuses a disconnected model when the backend identity reconnects', async () => {
        const first = createClient();
        const second = createClient();
        const service = new PositronDataExplorerService(
            { sessions: [] } as any,
            {
                debug: () => undefined,
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
            } as unknown as vscode.LogOutputChannel,
        );
        const original = await service.createInstance(first.client, 'Python');
        original.setSummaryCollapsed(true);
        first.close();

        const reconnected = await service.createInstance(second.client, 'Python');

        assert.strictEqual(reconnected, original);
        assert.strictEqual(reconnected.uiState.summaryCollapsed, true);
        assert.strictEqual(service.instances.size, 1);
        service.dispose();
        first.dispose();
        second.dispose();
    });
});
