import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    SupportStatus,
    ColumnProfileType,
    type BackendState,
    type IDataExplorerComm,
    type ReturnColumnProfilesEvent,
} from '../../runtime/comms/positronDataExplorerComm';
import { DataExplorerClientInstance } from '../../services/dataExplorer/languageRuntimeDataExplorerClient';

suite('[Unit] Language runtime Data Explorer client', () => {
    function createStateClient(getState: () => Promise<BackendState>) {
        const schemaEmitter = new vscode.EventEmitter<{}>();
        const dataEmitter = new vscode.EventEmitter<{}>();
        const profilesEmitter = new vscode.EventEmitter<ReturnColumnProfilesEvent>();
        const closeEmitter = new vscode.EventEmitter<void>();
        const comm = {
            clientId: 'recovering-client',
            onDidSchemaUpdate: schemaEmitter.event,
            onDidDataUpdate: dataEmitter.event,
            onDidReturnColumnProfiles: profilesEmitter.event,
            onDidClose: closeEmitter.event,
            getState,
            closeClient: () => undefined,
            dispose: () => undefined,
        } as unknown as IDataExplorerComm;
        const logs: Array<{ level: string; message: string }> = [];
        const client = new DataExplorerClientInstance(
            comm,
            {
                debug: () => undefined,
                info: (message: string) => logs.push({ level: 'info', message }),
                warn: (message: string) => logs.push({ level: 'warn', message }),
                error: () => undefined,
            } as unknown as vscode.LogOutputChannel,
        );
        return {
            client,
            logs,
            dispose: () => {
                client.dispose();
                schemaEmitter.dispose();
                dataEmitter.dispose();
                profilesEmitter.dispose();
                closeEmitter.dispose();
            },
        };
    }

    const state: BackendState = {
        display_name: 'Recovered table',
        table_shape: { num_rows: 2, num_columns: 1 },
        table_unfiltered_shape: { num_rows: 2, num_columns: 1 },
        has_row_labels: false,
        column_filters: [],
        row_filters: [],
        sort_keys: [],
        supported_features: {
            search_schema: {
                support_status: SupportStatus.Unsupported,
                supported_types: [],
            },
            set_column_filters: {
                support_status: SupportStatus.Unsupported,
                supported_types: [],
            },
            set_row_filters: {
                support_status: SupportStatus.Unsupported,
                supports_conditions: SupportStatus.Unsupported,
                supported_types: [],
            },
            get_column_profiles: {
                support_status: SupportStatus.Unsupported,
                supported_types: [],
            },
            set_sort_columns: {
                support_status: SupportStatus.Unsupported,
            },
            export_data_selection: {
                support_status: SupportStatus.Unsupported,
                supported_formats: [],
            },
            convert_to_code: {
                support_status: SupportStatus.Unsupported,
                code_syntaxes: [],
            },
        },
    };

    test('retries a transient backend state failure within the shared request', async () => {
        let attempts = 0;
        const fixture = createStateClient(async () => {
            attempts += 1;
            if (attempts === 1) {
                throw new Error('RPC timed out');
            }
            return state;
        });

        assert.strictEqual(await fixture.client.updateBackendState(), state);
        assert.strictEqual(attempts, 2);
        assert.ok(fixture.logs.some(({ level, message }) =>
            level === 'warn' &&
            message.includes('attempt 1/2 failed: Error: RPC timed out; retrying.')));
        assert.ok(fixture.logs.some(({ level, message }) =>
            level === 'info' &&
            message.includes('recovered on attempt 2')));
        fixture.dispose();
    });

    test('can refresh backend state after all retry attempts fail', async () => {
        let attempts = 0;
        const fixture = createStateClient(async () => {
            attempts += 1;
            if (attempts <= 2) {
                throw new Error('RPC timed out');
            }
            return state;
        });

        await assert.rejects(
            fixture.client.updateBackendState(),
            /RPC timed out/,
        );
        assert.strictEqual(
            await fixture.client.updateBackendState(),
            state,
        );
        assert.strictEqual(attempts, 3);
        fixture.dispose();
    });

    test('cancels a pending profile request and ignores its late callback', async () => {
        const schemaEmitter = new vscode.EventEmitter<{}>();
        const dataEmitter = new vscode.EventEmitter<{}>();
        const profilesEmitter = new vscode.EventEmitter<ReturnColumnProfilesEvent>();
        const closeEmitter = new vscode.EventEmitter<void>();
        let callbackId: string | undefined;
        const comm = {
            clientId: 'profile-client',
            onDidSchemaUpdate: schemaEmitter.event,
            onDidDataUpdate: dataEmitter.event,
            onDidReturnColumnProfiles: profilesEmitter.event,
            onDidClose: closeEmitter.event,
            getColumnProfiles: async (currentCallbackId: string) => {
                callbackId = currentCallbackId;
            },
            closeClient: () => undefined,
            dispose: () => undefined,
        } as unknown as IDataExplorerComm;
        const client = new DataExplorerClientInstance(
            comm,
            {
                debug: () => undefined,
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
            } as unknown as vscode.LogOutputChannel,
        );
        const tokenSource = new vscode.CancellationTokenSource();

        const pending = client.requestColumnProfiles(
            [{
                column_index: 0,
                profiles: [{ profile_type: ColumnProfileType.NullCount }],
            }],
            tokenSource.token,
        );
        await Promise.resolve();
        assert.ok(callbackId);

        tokenSource.cancel();
        assert.deepStrictEqual(await pending, []);

        profilesEmitter.fire({
            callback_id: callbackId!,
            profiles: [{ null_count: 42 }],
        });
        client.dispose();
        tokenSource.dispose();
        schemaEmitter.dispose();
        dataEmitter.dispose();
        profilesEmitter.dispose();
        closeEmitter.dispose();
    });
});
