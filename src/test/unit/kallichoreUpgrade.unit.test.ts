import * as assert from 'assert';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { AxiosError } from 'axios';
import { HandshakeSocket } from '../../supervisor/HandshakeSocket';
import { isServerIdentityStale, isUnauthorizedError } from '../../supervisor/KallichoreAdapterApi';
import { KallichoreServerState } from '../../supervisor/ServerState';

const SAMPLE_PAYLOAD: KallichoreServerState = {
    transport: 'tcp' as KallichoreServerState['transport'],
    port: 49213,
    base_path: 'http://127.0.0.1:49213',
    server_path: '/path/to/kcserver',
    server_pid: 1234,
    bearer_token: 'secret-token',
    log_path: '/path/to/log',
    server_id: 'server-a',
};

function uniqueName(): string {
    return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function reportIn(socketPath: string, payload: KallichoreServerState): void {
    const client = net.connect(socketPath, () => {
        client.end(`${JSON.stringify(payload)}\n`);
    });
}

suite('[Unit] Kallichore 0.1.67 upgrade', () => {
    test('receives connection details over the client-owned handshake socket', async () => {
        const handshake = await HandshakeSocket.create(`test-${uniqueName()}`);
        try {
            reportIn(handshake.socketPath, SAMPLE_PAYLOAD);
            assert.deepStrictEqual(await handshake.payload(5000), SAMPLE_PAYLOAD);
        } finally {
            handshake.dispose();
        }
    });

    test('rejects an invalid handshake payload', async () => {
        const handshake = await HandshakeSocket.create(`test-${uniqueName()}`);
        try {
            const client = net.connect(handshake.socketPath, () => client.end('{}'));
            await assert.rejects(() => handshake.payload(5000), /payload has no transport address/);
        } finally {
            handshake.dispose();
        }
    });

    test('reads connection details replayed by a broker socket', async () => {
        const brokerPath = os.platform() === 'win32'
            ? `\\\\.\\pipe\\kc-test-${uniqueName()}`
            : path.join(os.tmpdir(), `kc-test-${uniqueName()}.sock`);
        const broker = net.createServer(socket => socket.end(`${JSON.stringify(SAMPLE_PAYLOAD)}\n`));
        await new Promise<void>(resolve => broker.listen(brokerPath, resolve));
        try {
            assert.deepStrictEqual(await HandshakeSocket.connect(brokerPath, 5000), SAMPLE_PAYLOAD);
        } finally {
            broker.close();
            if (os.platform() !== 'win32') {
                fs.rmSync(brokerPath, { force: true });
            }
        }
    });

    test('detects when persisted state points to a different server instance', () => {
        assert.strictEqual(isServerIdentityStale('server-a', 'server-b'), true);
        assert.strictEqual(isServerIdentityStale('server-a', 'server-a'), false);
        assert.strictEqual(isServerIdentityStale(undefined, 'server-b'), false);
        assert.strictEqual(isServerIdentityStale('server-a', undefined), false);
    });

    test('detects both Axios 401 representations used by session recovery', () => {
        const responseError = new AxiosError('Unauthorized');
        // Axios fills this field on actual HTTP failures.
        responseError.response = { status: 401 } as typeof responseError.response;
        assert.strictEqual(isUnauthorizedError(responseError), true);

        const statusError = new AxiosError('Unauthorized');
        statusError.status = 401;
        assert.strictEqual(isUnauthorizedError(statusError), true);
    });
});
