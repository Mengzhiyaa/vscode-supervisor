import * as assert from 'assert';
import * as http from 'http';
import httpClient, { isAxiosError } from '../../supervisor/httpClient';
import { getAxiosErrorDiagnostics } from '../../supervisor/util';

suite('[Unit] supervisor HTTP client', () => {
    test('parses JSON startup errors without a JSON content type', async () => {
        const server = http.createServer((_request, response) => {
            response.statusCode = 500;
            response.statusMessage = 'Internal Server Error';
            response.end(JSON.stringify({
                error: {
                    code: 'KERNEL_START_FAILED',
                    message: 'The kernel process exited during startup.',
                    details: 'Failed to load libR.so.',
                },
                exit_code: 127,
                output: 'libR.so: cannot open shared object file',
            }));
        });

        try {
            const port = await listen(server);
            let caught: unknown;
            try {
                await httpClient.request({
                    method: 'post',
                    url: `http://127.0.0.1:${port}/sessions/session-1/start`,
                });
            } catch (error) {
                caught = error;
            }

            assert.ok(isAxiosError(caught));
            assert.deepStrictEqual(caught.response?.data, {
                error: {
                    code: 'KERNEL_START_FAILED',
                    message: 'The kernel process exited during startup.',
                    details: 'Failed to load libR.so.',
                },
                exit_code: 127,
                output: 'libR.so: cannot open shared object file',
            });

            const diagnostics = getAxiosErrorDiagnostics(caught);
            assert.deepStrictEqual(
                {
                    summary: diagnostics.summary,
                    exitCode: diagnostics.exitCode,
                    hasServerDetails: diagnostics.details.includes('Server details: Failed to load libR.so.'),
                    hasKernelOutput: diagnostics.details.includes('libR.so: cannot open shared object file'),
                },
                {
                    summary:
                        `HTTP 500 Internal Server Error for request POST ` +
                        `http://127.0.0.1:${port}/sessions/session-1/start: ` +
                        'The kernel process exited during startup.',
                    exitCode: 127,
                    hasServerDetails: true,
                    hasKernelOutput: true,
                },
            );
        } finally {
            await close(server);
        }
    });
});

function listen(server: http.Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('HTTP test server did not expose a TCP port.'));
                return;
            }
            resolve(address.port);
        });
    });
}

function close(server: http.Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}
