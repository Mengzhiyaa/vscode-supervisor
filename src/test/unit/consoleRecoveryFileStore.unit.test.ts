import * as assert from 'assert';
import { mkdtemp, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConsoleRecoveryFileStore } from '../../services/console/consoleRecoveryFileStore';
import type { SerializedConsoleState } from '../../shared/consoleState';

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });
    return {
        name: 'console-recovery-file-store-test',
        logLevel: vscode.LogLevel.Trace,
        onDidChangeLogLevel: event,
        trace: noop,
        debug: noop,
        info: noop,
        warn: noop,
        error: noop,
        append: noop,
        appendLine: noop,
        replace: noop,
        clear: noop,
        show: noop,
        hide: noop,
        dispose: noop,
    };
}

function state(revision: number, text: string): SerializedConsoleState {
    return {
        version: 3,
        generation: 'generation-1',
        revision,
        items: [{
            type: 'trace',
            id: `trace-${revision}`,
            when: Date.now(),
            trace: text,
        }],
        inputHistory: [],
        trace: false,
        wordWrap: true,
    };
}

suite('[Unit] ConsoleRecoveryFileStore', () => {
    let temporaryDirectory: string;

    setup(async () => {
        temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'supervisor-console-recovery-'));
    });

    teardown(async () => {
        await rm(temporaryDirectory, { recursive: true, force: true });
    });

    test('atomically persists and reloads checkpoints and active session', async () => {
        const storageUri = vscode.Uri.file(temporaryDirectory);
        const first = new ConsoleRecoveryFileStore(storageUri, makeNoopLogChannel());
        await first.initialize();
        await first.write('session-1', state(1, 'first'));
        await first.write('session-1', state(2, 'second'));
        await first.setActiveSessionId('session-1');

        const restored = new ConsoleRecoveryFileStore(storageUri, makeNoopLogChannel());
        await restored.initialize();

        assert.strictEqual(restored.getActiveSessionId(), 'session-1');
        assert.strictEqual(restored.get('session-1')?.revision, 2);
        assert.strictEqual((restored.get('session-1')?.items[0] as any).trace, 'second');
    });

    test('delete commits the manifest before recovered state disappears', async () => {
        const storageUri = vscode.Uri.file(temporaryDirectory);
        const first = new ConsoleRecoveryFileStore(storageUri, makeNoopLogChannel());
        await first.initialize();
        await first.write('session-1', state(1, 'retained'));
        await first.setActiveSessionId('session-1');
        await first.delete('session-1');

        const restored = new ConsoleRecoveryFileStore(storageUri, makeNoopLogChannel());
        await restored.initialize();
        assert.strictEqual(restored.get('session-1'), undefined);
        assert.strictEqual(restored.getActiveSessionId(), undefined);
    });
});
