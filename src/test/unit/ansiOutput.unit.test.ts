import * as assert from 'assert';
import { ANSIColor, ANSIOutput, type ANSIOutputLine } from '../../shared/ansiOutput';

function textLines(output: ANSIOutput): string[] {
    return output.outputLines.map((line) => line.outputRuns.map((run) => run.text).join(''));
}

/** Compare visible characters and their formatting without depending on run IDs or boundaries. */
function projection(lines: readonly ANSIOutputLine[]) {
    return lines.map((line) =>
        line.outputRuns.flatMap((run) =>
            Array.from(run.text, (text) => ({
                text,
                styles: [...(run.format?.styles ?? [])].sort(),
                foreground: run.format?.foregroundColor,
                background: run.format?.backgroundColor,
                underline: run.format?.underlinedColor,
                font: run.format?.font,
                hyperlink: run.hyperlink
                    ? {
                          url: run.hyperlink.url,
                          params: Array.from(run.hyperlink.params ?? []).sort(),
                      }
                    : undefined,
            })),
        ),
    );
}

suite('[Unit] ANSI output streaming and replay', () => {
    test('continues an SGR sequence split across three messages and resets its color', () => {
        const output = new ANSIOutput();
        for (const chunk of ['prefix ', '\x1b[31', 'mred\x1b[0m plain']) {
            output.processOutput(chunk);
        }
        assert.deepStrictEqual(
            output.outputLines[0].outputRuns.map((run) => ({
                text: run.text,
                foreground: run.format?.foregroundColor,
            })),
            [
                { text: 'prefix ', foreground: undefined },
                { text: 'red', foreground: ANSIColor.Red },
                { text: ' plain', foreground: undefined },
            ],
        );
    });

    test('continues an OSC 8 URL and split ST terminators across messages', () => {
        const output = new ANSIOutput();
        for (const chunk of [
            '\x1b]8;line=12:col=3;file:///workspace/',
            'source.R\x1b',
            '\\source\x1b]8;;\x1b',
            '\\ plain',
        ]) {
            output.processOutput(chunk);
        }
        assert.deepStrictEqual(
            output.outputLines[0].outputRuns.map((run) => ({
                text: run.text,
                url: run.hyperlink?.url,
                line: run.hyperlink?.params?.get('line'),
                column: run.hyperlink?.params?.get('col'),
            })),
            [
                { text: 'source', url: 'file:///workspace/source.R', line: '12', column: '3' },
                { text: ' plain', url: undefined, line: undefined, column: undefined },
            ],
        );
    });

    test('keeps distinct positions for adjacent links targeting the same file', () => {
        const output = new ANSIOutput();
        output.processOutput(
            '\x1b]8;line=12;file:///workspace/source.R\x1b\\first\x1b]8;;\x1b\\' +
                '\x1b]8;line=24;file:///workspace/source.R\x1b\\second\x1b]8;;\x1b\\',
        );
        assert.deepStrictEqual(
            output.outputLines[0].outputRuns.map((run) => [
                run.text,
                run.hyperlink?.params?.get('line'),
            ]),
            [
                ['first', '12'],
                ['second', '24'],
            ],
        );
    });

    for (const { name, input, expected } of [
        { name: 'carriage return', input: 'abc\rX', expected: 'Xbc' },
        { name: 'backspace', input: 'abc\bX', expected: 'abX' },
        { name: 'erase to end of line', input: 'abcdef\r\x1b[2C\x1b[KX', expected: 'abX   ' },
    ]) {
        test(`applies ${name} to the visible text`, () => {
            const output = new ANSIOutput();
            output.processOutput(input);
            assert.deepStrictEqual(textLines(output), [expected]);
        });
    }

    test('does not trim the cursor line or lines below it', () => {
        const output = new ANSIOutput();
        output.processOutput('a\nb\nc\x1b[2A\r');
        assert.strictEqual(output.dropTop(20), 0);
        output.processOutput('X');
        assert.deepStrictEqual(textLines(output), ['X', 'b', 'c']);
    });

    test('drops only the lines above a cursor positioned in the middle', () => {
        const output = new ANSIOutput();
        output.processOutput('a\nb\nc\x1b[1A\r');
        assert.strictEqual(output.dropTop(20), 1);
        output.processOutput('X');
        assert.deepStrictEqual(textLines(output), ['X', 'c']);
    });

    for (const scenario of [
        { name: 'SGR and reset', initial: 'old\n\x1b[1;31mred', next: '\x1b[0m plain' },
        { name: 'pending newline', initial: 'old\nkeep\n', next: 'next' },
        {
            name: 'cursor above the retained tail',
            initial: 'old\nalpha\nbeta\x1b[2;3H',
            next: '\x1b[KX',
        },
        { name: 'incomplete ESC', initial: 'old\nkeep\x1b', next: '[31mred\x1b[0m' },
        {
            name: 'incomplete true-color CSI',
            initial: 'old\nkeep\x1b[38;2;12;',
            next: '34;56mRGB\x1b[0m',
        },
        {
            name: 'incomplete OSC 8',
            initial: 'old\nkeep\x1b]8;line=12:col=3;file:///work/a',
            next: '.R\x1b\\open\x1b]8;;\x1b\\',
        },
        {
            name: 'active hyperlink',
            initial: 'old\n\x1b]8;line=12:col=3;file:///work/a.R\x1b\\source',
            next: ' link\x1b]8;;\x1b\\ plain',
        },
        {
            name: 'indexed, RGB and underline colors',
            initial: 'old\n\x1b[38;5;196;48;2;1;2;3;58;5;1;4mstyled',
            next: '\x1b[0m plain',
        },
        {
            name: 'reverse video and later color changes',
            initial: 'old\n\x1b[31;47;7mreverse',
            next: '\x1b[32mnext\x1b[27mplain',
        },
        {
            name: 'alternative font and text styles',
            initial: 'old\n\x1b[2;3;9;11;73mstyled',
            next: '\x1b[0m plain',
        },
    ]) {
        test(`replays ${scenario.name} after trimming and accepts subsequent output`, () => {
            const original = new ANSIOutput();
            original.processOutput(scenario.initial);
            assert.strictEqual(original.dropTop(1), 1);

            const restored = new ANSIOutput();
            restored.processOutput(original.getReplayText());
            assert.deepStrictEqual(
                projection(restored.outputLines),
                projection(original.outputLines),
            );

            original.processOutput(scenario.next);
            restored.processOutput(scenario.next);
            assert.deepStrictEqual(
                projection(restored.outputLines),
                projection(original.outputLines),
            );
        });
    }
});
