import * as assert from 'assert';
import {
    flattenTokenColors,
    type RawTokenColor,
} from '../../webview/consoleThemeProvider';

suite('[Unit] Console theme provider', () => {
    test('expands comma-separated TextMate scope selectors for Monaco', () => {
        const tokenColors: RawTokenColor[] = [
            {
                scope: [
                    'entity.name.class, entity.name.type, entity.name.namespace',
                    'source.r meta.function-call entity.name.function',
                ],
                settings: {
                    foreground: '#4EC9B0',
                    fontStyle: 'bold',
                },
            },
        ];

        assert.deepStrictEqual(flattenTokenColors(tokenColors), [
            {
                token: 'entity.name.class',
                foreground: '4EC9B0',
                background: undefined,
                fontStyle: 'bold',
            },
            {
                token: 'entity.name.type',
                foreground: '4EC9B0',
                background: undefined,
                fontStyle: 'bold',
            },
            {
                token: 'entity.name.namespace',
                foreground: '4EC9B0',
                background: undefined,
                fontStyle: 'bold',
            },
            {
                token: 'source.r meta.function-call entity.name.function',
                foreground: '4EC9B0',
                background: undefined,
                fontStyle: 'bold',
            },
        ]);
    });
});
