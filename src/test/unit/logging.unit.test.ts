import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    formatLogContext,
    formatRawSupervisorLine,
    redactLogMessage,
    truncateStructuredMessage,
} from '../../logging/logSinks';
import {
    LogOutputChannelFormatted,
    OutputChannelFormatted,
} from '../../supervisor/OutputChannelFormatted';
import { splitLogicalLines } from '../../supervisor/LogStreamer';

function recordingOutputChannel(): { channel: vscode.OutputChannel; read: () => string } {
    let output = '';
    const channel = {
        name: 'recording-output',
        append: (value: string) => { output += value; },
        appendLine: (value: string) => { output += `${value}\n`; },
        replace: (value: string) => { output = value; },
        clear: () => { output = ''; },
        show: () => undefined,
        hide: () => undefined,
        dispose: () => undefined,
    } as vscode.OutputChannel;
    return { channel, read: () => output };
}

suite('[Unit] Logging sinks', () => {
    test('raw supervisor lines own their final timestamp, source, and severity', () => {
        assert.strictEqual(
            formatRawSupervisorLine(
                'connection failed',
                vscode.LogLevel.Error,
                new Date('2026-08-12T05:10:04.552Z'),
            ),
            '05:10:04 [Supervisor Extension] [error] connection failed',
        );
    });

    test('structured truncation does not affect short messages', () => {
        assert.strictEqual(truncateStructuredMessage('kernel ready'), 'kernel ready');
        assert.strictEqual(truncateStructuredMessage('abcdef', 3), 'abc... (truncated)');
    });

    test('redacts credentials and home paths at the sink boundary', () => {
        const home = require('os').homedir();
        assert.strictEqual(
            redactLogMessage(
                `Authorization: Bearer abc123 bearer_token=xyz --password hunter2 ` +
                `--access-token=access123 --api_key key123 ${home}/project`,
            ),
            'Authorization: Bearer <redacted> bearer_token=<redacted> --password <redacted> ' +
            '--access-token=<redacted> --api_key <redacted> <home>/project',
        );
    });

    test('formats searchable structured context', () => {
        assert.strictEqual(
            formatLogContext('RuntimeSession', 'Starting LSP', {
                session: 'r-session-1',
                operation: 'start',
            }),
            'component=RuntimeSession session=r-session-1 operation=start Starting LSP',
        );
    });

    test('formatted structured sink preserves Error stacks', () => {
        let captured = '';
        const channel = {
            error: (message: string | Error) => { captured = String(message); },
        } as vscode.LogOutputChannel;
        const formatted = new LogOutputChannelFormatted(channel, message => `session-1 ${message}`);
        const error = new Error('kernel failed');
        error.stack = 'Error: kernel failed\n    at startKernel (kernel.ts:1:1)';

        formatted.error(error);

        assert.ok(captured.includes('session-1 kernel failed'));
        assert.ok(captured.includes('at startKernel (kernel.ts:1:1)'));
    });

    test('logical line splitting preserves blank and unterminated final lines', () => {
        assert.deepStrictEqual(splitLogicalLines('first\r\n\r\nlast'), ['first', '', 'last']);
        assert.deepStrictEqual(splitLogicalLines('first\n\n'), ['first', '']);
        assert.deepStrictEqual(splitLogicalLines(''), []);
    });

    test('raw formatter prefixes every logical line across chunks and normalizes CRLF', () => {
        const recording = recordingOutputChannel();
        const formatted = new OutputChannelFormatted(recording.channel, () => 'session-1 ');

        formatted.append('first\r');
        formatted.append('\nsecond');
        formatted.appendLine(' line\r\n');
        formatted.appendLine('');

        assert.strictEqual(
            recording.read(),
            'session-1 first\nsession-1 second line\nsession-1 \nsession-1 \n',
        );
    });
});
