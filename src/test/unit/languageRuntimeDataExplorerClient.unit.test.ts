import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    ColumnProfileType,
    type IDataExplorerComm,
    type ReturnColumnProfilesEvent,
} from '../../runtime/comms/positronDataExplorerComm';
import { DataExplorerClientInstance } from '../../services/dataExplorer/languageRuntimeDataExplorerClient';

suite('[Unit] Language runtime Data Explorer client', () => {
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
