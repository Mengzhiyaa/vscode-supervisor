import * as assert from 'assert';
import * as vscode from 'vscode';
import type { MessageConnection } from 'vscode-jsonrpc';
import {
    SupportStatus,
    type ColumnSelection,
} from '../../runtime/comms/positronDataExplorerComm';
import {
    DataExplorerWebviewBridge,
    type DataExplorerDataRequest,
} from '../../services/dataExplorer/dataExplorerWebviewBridge';
import { DataExplorerClientStatus } from '../../services/dataExplorer/languageRuntimeDataExplorerClient';
import type { IPositronDataExplorerInstance } from '../../services/dataExplorer/positronDataExplorerService';

interface SentNotification {
    method: string;
    params: unknown;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(currentResolve => {
        resolve = currentResolve;
    });
    return { promise, resolve };
}

type TestRowFilter = {
    filter_id: string;
    filter_type: string;
    column_schema: {
        column_name: string;
        column_index: number;
        type_name: string;
        type_display: string;
    };
    condition: string;
};

function createConnection() {
    const handlers = new Map<string, (params?: any) => Promise<void> | void>();
    const notifications: SentNotification[] = [];
    const connection = {
        onNotification: (type: { method: string }, handler: (params?: any) => Promise<void> | void) => {
            handlers.set(type.method, handler);
            return { dispose: () => handlers.delete(type.method) };
        },
        sendNotification: (type: { method: string }, params?: unknown) => {
            notifications.push({ method: type.method, params });
        },
    } as unknown as MessageConnection;
    return { connection, handlers, notifications };
}

function backendState(rows: number, columns: number) {
    return {
        display_name: 'P0 table',
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

function createBridge(options: {
    rows: number;
    columns: number;
    status?: DataExplorerClientStatus;
    getDataValues?: () => Promise<{ columns: Array<Array<number | string>> }>;
    setRowFilters?: (filters: TestRowFilter[]) => Promise<{
        selected_num_rows: number;
        had_errors?: boolean;
    }>;
    updateBackendState?: () => Promise<void>;
    openAsSpreadsheet?: () => Promise<void>;
}) {
    const rpc = createConnection();
    const logs: Array<{ level: string; message: string }> = [];
    let dataRequests = 0;
    let dataSelections: ColumnSelection[] = [];
    let generation = 0;
    let lastDataRequest: DataExplorerDataRequest | undefined;
    let mutationQueue = Promise.resolve();
    const state = backendState(options.rows, options.columns);
    const backendStateListeners = new Set<(value: typeof state) => void>();
    const backendStateEvent = ((listener: (value: typeof state) => void) => {
        backendStateListeners.add(listener);
        return {
            dispose: () => backendStateListeners.delete(listener),
        };
    }) as vscode.Event<typeof state>;
    const noopEvent = (() => ({ dispose: () => undefined })) as vscode.Event<any>;
    const instance = {
        identifier: 'p0-table',
        displayName: 'P0 table',
        languageName: 'Python',
        backendState: state,
        supportsFileOptions: false,
        uiState: { layout: 'SummaryOnLeft', summaryCollapsed: false, summaryWidth: 350 },
        get dataGeneration() { return generation; },
        get lastDataRequest() { return lastDataRequest; },
        onDidChangeUiState: noopEvent,
        onDidClose: noopEvent,
        onDidUpdateBackendState: backendStateEvent,
        onDidChangeForegroundLoading: noopEvent,
        onDidInvalidateData: noopEvent,
        onDidChangeSelection: noopEvent,
        selection: undefined,
        runWithForegroundLoading: <T>(task: () => Promise<T>) => task(),
        runDataMutation: (task: () => Promise<void>) => {
            const run = async () => {
                generation += 1;
                await task();
            };
            const queued = mutationQueue.then(run, run);
            mutationQueue = queued.then(() => undefined, () => undefined);
            return queued;
        },
        invalidateData: () => ++generation,
        setLastDataRequest: (request: DataExplorerDataRequest) => {
            lastDataRequest = request;
        },
        setSelection: () => undefined,
        clientInstance: {
            status: options.status ?? DataExplorerClientStatus.Idle,
            updateBackendState: async () => {
                await options.updateBackendState?.();
                backendStateListeners.forEach(listener => listener(state));
                return state;
            },
            getBackendState: async () => state,
            getDataValues: async (columns: ColumnSelection[]) => {
                dataRequests += 1;
                dataSelections = columns;
                return options.getDataValues?.() ?? { columns: [['value']] };
            },
            getRowLabels: async () => ({ row_labels: [[]] }),
            setRowFilters: async (filters: TestRowFilter[]) => {
                if (options.setRowFilters) {
                    const result = await options.setRowFilters(filters);
                    state.row_filters = filters as never[];
                    return result;
                }
                state.row_filters = filters as never[];
                return {
                    selected_num_rows: state.table_shape.num_rows,
                    had_errors: false,
                };
            },
        },
        getSchema: async (columnIndices: number[]) => ({
            columns: columnIndices.map(columnIndex => ({
                column_name: `column_${columnIndex}`,
                column_index: columnIndex,
                type_name: 'string',
                type_display: 'string',
            })),
        }),
        getDataValues: async (columns: ColumnSelection[]) => {
            dataRequests += 1;
            dataSelections = columns;
            return options.getDataValues?.() ?? { columns: [['value']] };
        },
    } as unknown as IPositronDataExplorerInstance;
    const bridge = new DataExplorerWebviewBridge({
        connection: rpc.connection,
        panel: { active: false, visible: true, dispose: () => undefined } as unknown as vscode.WebviewPanel,
        instance,
        logChannel: {
            debug: (message: string) => logs.push({ level: 'debug', message }),
            info: (message: string) => logs.push({ level: 'info', message }),
            warn: (message: string) => logs.push({ level: 'warn', message }),
            error: (message: string) => logs.push({ level: 'error', message }),
        } as unknown as vscode.LogOutputChannel,
        isInstanceActive: () => false,
        isInstanceInNewWindow: () => false,
        onSyncActiveContexts: () => undefined,
        onMoveToNewWindow: async () => undefined,
        openAsPlaintext: async () => undefined,
        openAsSpreadsheet: options.openAsSpreadsheet ?? (async () => undefined),
    });
    return {
        bridge,
        instance,
        ...rpc,
        logs,
        get dataRequests() { return dataRequests; },
        get dataSelections() { return dataSelections; },
    };
}

suite('[Unit] Data Explorer webview bridge P0 protocol', () => {
    test('ready initializes metadata without fetching table data', async () => {
        const fixture = createBridge({ rows: 1_000_000, columns: 100 });
        fixture.bridge.registerNotificationHandlers();

        await fixture.handlers.get('dataExplorer/ready')?.();

        assert.strictEqual(fixture.dataRequests, 0);
        assert.ok(fixture.notifications.some(({ method }) => method === 'dataExplorer/initialize'));
        assert.ok(!fixture.notifications.some(({ method }) => method === 'dataExplorer/data'));
        fixture.bridge.dispose();
    });

    test('ready logs the real backend state error and still initializes', async () => {
        let attempts = 0;
        const fixture = createBridge({
            rows: 10,
            columns: 2,
            updateBackendState: async () => {
                attempts += 1;
                if (attempts === 1) {
                    throw Object.assign(new Error('RPC timed out'), {
                        code: -32603,
                    });
                }
            },
        });
        fixture.bridge.registerNotificationHandlers();

        await fixture.handlers.get('dataExplorer/ready')?.();

        assert.strictEqual(attempts, 1);
        assert.ok(fixture.logs.some(({ level, message }) =>
            level === 'error' &&
            message.includes('Backend state update failed: Error: RPC timed out')));
        assert.ok(fixture.notifications.some(({ method }) =>
            method === 'dataExplorer/initialize'));
        fixture.bridge.dispose();
    });

    test('zero-row requests publish visible schema without requesting values', async () => {
        const fixture = createBridge({ rows: 0, columns: 2 });
        const request: DataExplorerDataRequest = {
            startRow: 0,
            endRow: 0,
            columns: [0, 1],
            requestId: 7,
            generation: 0,
        };

        await fixture.bridge.sendData(request);

        assert.strictEqual(fixture.dataRequests, 0);
        const data = fixture.notifications.find(({ method }) => method === 'dataExplorer/data');
        assert.deepStrictEqual(data?.params, {
            columns: [[], []],
            schema: [
                { column_name: 'column_0', column_index: 0, type_name: 'string', type_display: 'string' },
                { column_name: 'column_1', column_index: 1, type_name: 'string', type_display: 'string' },
            ],
            startRow: 0,
            endRow: 0,
            rowIndices: undefined,
            columnIndices: [0, 1],
            rowLabels: undefined,
            totalRows: 0,
            totalColumns: 2,
            requestId: 7,
            generation: 0,
        });
        fixture.bridge.dispose();
    });

    test('preserves sparse overscan row indices through the host request and response', async () => {
        const fixture = createBridge({
            rows: 20,
            columns: 1,
            getDataValues: async () => ({
                columns: [['row-2', 'row-8', 'row-13']],
            }),
        });
        const request: DataExplorerDataRequest = {
            startRow: 2,
            endRow: 14,
            rowIndices: [13, 2, 8],
            columns: [0],
            requestId: 8,
            generation: 0,
        };

        await fixture.bridge.sendData(request);

        assert.deepStrictEqual(fixture.dataSelections, [
            {
                column_index: 0,
                spec: { indices: [2, 8, 13] },
            },
        ]);
        const data = fixture.notifications.find(
            ({ method }) => method === 'dataExplorer/data',
        );
        assert.deepStrictEqual(data?.params, {
            columns: [['row-2', 'row-8', 'row-13']],
            schema: [
                {
                    column_name: 'column_0',
                    column_index: 0,
                    type_name: 'string',
                    type_display: 'string',
                },
            ],
            startRow: 2,
            endRow: 14,
            rowIndices: [2, 8, 13],
            columnIndices: [0],
            rowLabels: undefined,
            totalRows: 20,
            totalColumns: 1,
            requestId: 8,
            generation: 0,
        });
        fixture.bridge.dispose();
    });

    test('does not publish an in-flight response after generation invalidation', async () => {
        const result = deferred<{ columns: Array<Array<number | string>> }>();
        const fixture = createBridge({
            rows: 1,
            columns: 1,
            getDataValues: () => result.promise,
        });
        const request: DataExplorerDataRequest = {
            startRow: 0,
            endRow: 1,
            columns: [0],
            requestId: 1,
            generation: 0,
        };

        const pending = fixture.bridge.sendData(request);
        await Promise.resolve();
        fixture.bridge.invalidateData(false);
        result.resolve({ columns: [['stale']] });
        await pending;

        assert.ok(!fixture.notifications.some(({ method }) => method === 'dataExplorer/data'));
        fixture.bridge.dispose();
    });

    test('coalesces rapid viewport updates with latest-wins publication', async () => {
        const firstResult = deferred<{ columns: Array<Array<number | string>> }>();
        let requestCount = 0;
        const fixture = createBridge({
            rows: 100,
            columns: 1,
            getDataValues: () => {
                requestCount += 1;
                return requestCount === 1
                    ? firstResult.promise
                    : Promise.resolve({ columns: [['latest']] });
            },
        });
        fixture.bridge.registerNotificationHandlers();
        const handler = fixture.handlers.get('dataExplorer/requestData')!;

        const first = handler({
            startRow: 0,
            endRow: 1,
            columns: [0],
            requestId: 1,
            generation: 0,
        });
        await Promise.resolve();
        await Promise.resolve();
        const second = handler({
            startRow: 20,
            endRow: 21,
            columns: [0],
            requestId: 2,
            generation: 0,
        });
        firstResult.resolve({ columns: [['stale']] });
        await Promise.all([first, second]);

        const published = fixture.notifications.filter(
            ({ method }) => method === 'dataExplorer/data',
        );
        assert.deepStrictEqual(
            published.map(({ params }) => (params as { requestId: number }).requestId),
            [2],
        );
        assert.strictEqual(fixture.dataRequests, 2);
        fixture.bridge.dispose();
    });

    test('coordinates latest viewport publication across surfaces for the same instance', async () => {
        const firstResult = deferred<{ columns: Array<Array<number | string>> }>();
        let requestCount = 0;
        const fixture = createBridge({
            rows: 100,
            columns: 1,
            getDataValues: () => {
                requestCount += 1;
                return requestCount === 1
                    ? firstResult.promise
                    : Promise.resolve({ columns: [['latest-surface']] });
            },
        });
        const secondRpc = createConnection();
        const secondBridge = new DataExplorerWebviewBridge({
            connection: secondRpc.connection,
            panel: { active: false, visible: true, dispose: () => undefined } as any,
            instance: fixture.instance,
            logChannel: { debug: () => undefined } as any,
            isInstanceActive: () => false,
            isInstanceInNewWindow: () => false,
            onSyncActiveContexts: () => undefined,
            onMoveToNewWindow: async () => undefined,
            openAsPlaintext: async () => undefined,
            openAsSpreadsheet: async () => undefined,
        });
        fixture.bridge.registerNotificationHandlers();
        secondBridge.registerNotificationHandlers();

        const first = fixture.handlers.get('dataExplorer/requestData')!({
            startRow: 0,
            endRow: 1,
            columns: [0],
            requestId: 10,
            generation: 0,
        });
        await Promise.resolve();
        await Promise.resolve();
        const second = secondRpc.handlers.get('dataExplorer/requestData')!({
            startRow: 50,
            endRow: 51,
            columns: [0],
            requestId: 11,
            generation: 0,
        });
        firstResult.resolve({ columns: [['stale-surface']] });
        await Promise.all([first, second]);

        assert.strictEqual(
            fixture.notifications.filter(({ method }) => method === 'dataExplorer/data').length,
            0,
        );
        assert.deepStrictEqual(
            secondRpc.notifications
                .filter(({ method }) => method === 'dataExplorer/data')
                .map(({ params }) => (params as { requestId: number }).requestId),
            [11],
        );
        assert.strictEqual(fixture.dataRequests, 2);
        secondBridge.dispose();
        fixture.bridge.dispose();
    });

    test('routes Open as Spreadsheet through the host surface action', async () => {
        let openCount = 0;
        const fixture = createBridge({
            rows: 1,
            columns: 1,
            openAsSpreadsheet: async () => { openCount += 1; },
        });
        fixture.bridge.registerNotificationHandlers();

        await fixture.handlers.get('dataExplorer/openAsSpreadsheet')?.();

        assert.strictEqual(openCount, 1);
        fixture.bridge.dispose();
    });

    test('derives rapid row-filter mutations from the latest serialized Ark state', async () => {
        const appliedFilters: TestRowFilter[][] = [];
        const fixture = createBridge({
            rows: 10,
            columns: 1,
            setRowFilters: async (filters) => {
                appliedFilters.push(filters);
                return { selected_num_rows: 10, had_errors: false };
            },
        });
        fixture.bridge.registerNotificationHandlers();
        const addFilter = fixture.handlers.get('dataExplorer/addFilter');
        const firstFilter: TestRowFilter = {
            filter_id: 'first',
            filter_type: 'not_null',
            column_schema: {
                column_name: 'column_0',
                column_index: 0,
                type_name: 'string',
                type_display: 'string',
            },
            condition: 'and',
        };
        const secondFilter = { ...firstFilter, filter_id: 'second' };

        await Promise.all([
            addFilter?.({ filter: firstFilter }),
            addFilter?.({ filter: secondFilter }),
        ]);

        assert.deepStrictEqual(
            appliedFilters.map(filters => filters.map(filter => filter.filter_id)),
            [['first'], ['first', 'second']],
        );
        const backendStateUpdates = fixture.notifications.filter(
            ({ method }) => method === 'dataExplorer/backendState',
        );
        assert.strictEqual(backendStateUpdates.length, 2);
        assert.deepStrictEqual(
            (
                backendStateUpdates.at(-1)?.params as {
                    state?: { row_filters?: TestRowFilter[] };
                }
            ).state?.row_filters?.map(filter => filter.filter_id),
            ['first', 'second'],
        );
        fixture.bridge.dispose();
    });

    test('projects client disconnection without a duplicate model lifecycle', () => {
        const fixture = createBridge({
            rows: 1,
            columns: 1,
            status: DataExplorerClientStatus.Disconnected,
        });

        fixture.bridge.sendBackendStateUpdate();

        const notification = fixture.notifications.find(
            ({ method }) => method === 'dataExplorer/backendState',
        );
        const state = (
            notification?.params as {
                state?: { connected?: boolean; error_message?: string };
            }
        )?.state;
        assert.strictEqual(
            state?.connected,
            false,
        );
        assert.strictEqual(state?.error_message, undefined);
        fixture.bridge.dispose();
    });
});
