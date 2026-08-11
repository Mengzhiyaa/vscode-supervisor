import * as assert from 'assert';
import { resolveConsoleAppearance } from '../../webview/consoleSettings';

suite('[Unit] console appearance settings', () => {
    test('supports inherited, multiplier, and absolute-pixel line heights', () => {
        const inherited = resolveConsoleAppearance({
            editorFontSize: 20,
            editorLineHeight: 30,
            configuredLineHeight: 0,
            configuredLineHeightInspection: { workspaceValue: 0 },
        });
        assert.strictEqual(inherited.lineHeight, 1.5);

        const multiplier = resolveConsoleAppearance({
            configuredFontSize: 16,
            configuredFontSizeInspection: { workspaceValue: 16 },
            configuredLineHeight: 1.75,
            configuredLineHeightInspection: { workspaceValue: 1.75 },
        });
        assert.strictEqual(multiplier.lineHeight, 1.75);

        const pixels = resolveConsoleAppearance({
            configuredFontSize: 20,
            configuredFontSizeInspection: { workspaceValue: 20 },
            configuredLineHeight: 32,
            configuredLineHeightInspection: { workspaceValue: 32 },
        });
        assert.strictEqual(pixels.lineHeight, 1.6);
    });

    test('clamps the Positron console font-size range to 6 through 100', () => {
        assert.strictEqual(resolveConsoleAppearance({
            configuredFontSize: 2,
            configuredFontSizeInspection: { workspaceValue: 2 },
        }).fontSize, 6);
        assert.strictEqual(resolveConsoleAppearance({
            configuredFontSize: 200,
            configuredFontSizeInspection: { workspaceValue: 200 },
        }).fontSize, 100);
    });
});
