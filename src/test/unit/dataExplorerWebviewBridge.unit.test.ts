import * as assert from 'assert';
import * as vscode from 'vscode';
import type { MessageConnection } from 'vscode-jsonrpc';
import { SupportStatus } from '../../runtime/comms/positronDataExplorerComm';
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
    openAsSpreadsheet?: () => Promise<void>;
}) {
    const rpc = createConnection();
    let dataRequests = 0;
    let generation = 0;
    let lastDataRequest: DataExplorerDataRequest | undefined;
    const state = backendState(options.rows, options.columns);
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
        onDidChangeForegroundLoading: noopEvent,
        onDidInvalidateData: noopEvent,
        onDidChangeSelection: noopEvent,
        selection: undefined,
        runWithForegroundLoading: <T>(task: () => Promise<T>) => task(),
        runDataMutation: async (task: () => Promise<void>) => {
            generation += 1;
            await task();
        },
        invalidateData: () => ++generation,
        setLastDataRequest: (request: DataExplorerDataRequest) => {
            lastDataRequest = request;
        },
        setSelection: () => undefined,
        clientInstance: {
            status: options.status ?? DataExplorerClientStatus.Idle,
            updateBackendState: async () => state,
            getBackendState: async () => state,
            getDataValues: async () => {
                dataRequests += 1;
                return options.getDataValues?.() ?? { columns: [['value']] };
            },
            getRowLabels: async () => ({ row_labels: [[]] }),
        },
        getSchema: async (columnIndices: number[]) => ({
            columns: columnIndices.map(columnIndex => ({
                column_name: `column_${columnIndex}`,
                column_index: columnIndex,
                type_name: 'string',
                type_display: 'string',
            })),
        }),
        getDataValues: async () => {
            dataRequests += 1;
            return options.getDataValues?.() ?? { columns: [['value']] };
        },
    } as unknown as IPositronDataExplorerInstance;
    const bridge = new DataExplorerWebviewBridge({
        connection: rpc.connection,
        panel: { active: false, visible: true, dispose: () => undefined } as unknown as vscode.WebviewPanel,
        instance,
        logChannel: {
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
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
        ...rpc,
        get dataRequests() { return dataRequests; },
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
            columnIndices: [0, 1],
            rowLabels: undefined,
            totalRows: 0,
            totalColumns: 2,
            requestId: 7,
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
        assert.strictEqual(
            (notification?.params as { state?: { connected?: boolean } })?.state?.connected,
            false,
        );
        fixture.bridge.dispose();
    });
});
