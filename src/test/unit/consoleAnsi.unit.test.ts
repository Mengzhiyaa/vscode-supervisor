import * as assert from 'assert';
import * as vscode from 'vscode';
import { LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior } from '../../api';
import { PositronConsoleInstance } from '../../services/console/consoleInstance';
import { ANSIColor, ANSIOutput } from '../../shared/ansiOutput';
import type { SerializedActivityStream, SerializedConsoleState } from '../../shared/consoleState';

function createConsole(): PositronConsoleInstance {
    const noop = () => undefined;
    const log: vscode.LogOutputChannel = {
        name: 'console-ansi-test',
        logLevel: vscode.LogLevel.Trace,
        onDidChangeLogLevel: () => ({ dispose: noop }),
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
    return new PositronConsoleInstance(
        {
            sessionId: 'ansi-session',
            sessionName: 'ANSI Console',
            sessionMode: LanguageRuntimeSessionMode.Console,
            createdTimestamp: 1,
            startReason: 'unit-test',
        },
        {
            runtimeId: 'ansi-runtime',
            runtimeName: 'R',
            runtimePath: '/usr/bin/R',
            runtimeVersion: '4.4.0',
            runtimeShortName: 'R',
            runtimeSource: 'system',
            languageId: 'r',
            languageName: 'R',
            languageVersion: '4.4.0',
            startupBehavior: LanguageRuntimeStartupBehavior.Explicit,
        },
        log,
    );
}

function streams(state: SerializedConsoleState): SerializedActivityStream[] {
    return state.items.flatMap((item) =>
        item.type === 'activity'
            ? item.items.filter(
                  (child): child is SerializedActivityStream => child.type === 'stream',
              )
            : [],
    );
}

function restoredOutput(state: SerializedConsoleState): ANSIOutput {
    const output = new ANSIOutput();
    for (const stream of streams(state)) {
        output.processOutput(stream.text);
    }
    return output;
}

suite('[Unit] Console ANSI projection and retention', () => {
    let instance: PositronConsoleInstance;
    setup(() => {
        instance = createConsole();
    });
    teardown(() => {
        instance.dispose();
    });

    test('counts three fragments of one line as one scrollback line', () => {
        instance.setScrollbackSize(1);
        for (const text of ['a', 'b', 'c']) {
            instance.handleStreamOutput('exec-1', 'stdout', text);
        }
        assert.deepStrictEqual(
            streams(instance.serializeState()).map((stream) => stream.text),
            ['abc'],
        );
        assert.strictEqual(instance.getClipboardRepresentation('# '), '# abc');
    });

    test('keeps stdout and stderr as separate contiguous stream groups', () => {
        instance.handleStreamOutput('exec-1', 'stdout', 'out');
        instance.handleStreamOutput('exec-1', 'stderr', 'error');
        instance.handleStreamOutput('exec-1', 'stdout', 'next');
        assert.deepStrictEqual(
            streams(instance.serializeState()).map((stream) => [stream.streamType, stream.text]),
            [
                ['output', 'out'],
                ['error', 'error'],
                ['output', 'next'],
            ],
        );
    });

    test('exports the visible OSC 8 label with surrounding text', () => {
        instance.handleStreamOutput(
            'exec-1',
            'stdout',
            'prefix \x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\ suffix',
        );
        assert.strictEqual(instance.getClipboardRepresentation('# '), '# prefix link suffix');
    });

    for (const [name, input, expected] of [
        ['carriage return', 'abc\rX', '# Xbc'],
        ['backspace', 'abc\bX', '# abX'],
        ['clear to end of line', 'abcdef\r\x1b[2C\x1b[KX', '# abX   '],
    ]) {
        test(`exports the visible text after ${name}`, () => {
            instance.handleStreamOutput('exec-1', 'stdout', input);
            assert.strictEqual(instance.getClipboardRepresentation('# '), expected);
        });
    }

    test('preserves a fragmented SGR sequence in the serialized stream', () => {
        for (const text of ['prefix ', '\x1b[31', 'mred\x1b[0m plain']) {
            instance.handleStreamOutput('exec-1', 'stdout', text);
        }
        assert.deepStrictEqual(
            restoredOutput(instance.serializeState()).outputLines[0].outputRuns.map((run) => [
                run.text,
                run.format?.foregroundColor,
            ]),
            [
                ['prefix ', undefined],
                ['red', ANSIColor.Red],
                [' plain', undefined],
            ],
        );
    });

    test('restores trimmed color and cursor state before the next progress update', () => {
        instance.setScrollbackSize(2);
        instance.handleStreamOutput('exec-1', 'stdout', 'old\n\x1b[31mred\n');
        instance.handleStreamOutput('exec-1', 'stdout', 'tail');
        const snapshot = instance.serializeState();
        const restored = createConsole();
        try {
            restored.setScrollbackSize(2);
            restored.restoreState(snapshot);
            for (const target of [instance, restored]) {
                target.handleStreamOutput('exec-1', 'stdout', '\rNEXT\x1b[0m');
            }
            assert.strictEqual(restored.getClipboardRepresentation('# '), '# red\n# NEXT');
            assert.strictEqual(
                restored.getClipboardRepresentation('# '),
                instance.getClipboardRepresentation('# '),
            );
            assert.deepStrictEqual(
                restoredOutput(restored.serializeState()).outputLines.map((line) =>
                    line.outputRuns.map((run) => [run.text, run.format?.foregroundColor]),
                ),
                [[['red', ANSIColor.Red]], [['NEXT', ANSIColor.Red]]],
            );
        } finally {
            restored.dispose();
        }
    });

    test('retains a cursor above the tail even when the line budget is smaller', () => {
        instance.setScrollbackSize(1);
        instance.handleStreamOutput('exec-1', 'stdout', 'a\nb\nc\x1b[2A\r');
        instance.handleStreamOutput('exec-1', 'stdout', 'X');
        assert.strictEqual(instance.getClipboardRepresentation('# '), '# X\n# b\n# c');
        assert.deepStrictEqual(
            restoredOutput(instance.serializeState()).outputLines.map((line) =>
                line.outputRuns.map((run) => run.text).join(''),
            ),
            ['X', 'b', 'c'],
        );
    });
});
