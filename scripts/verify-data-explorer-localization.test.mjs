import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { collectHostLocalizationKeys } from './webview-localization.mjs';

test('extracts quoted and unquoted localization property names', () => {
    const source = `
        export function createWebviewLocalizationMessages() {
            return {
                'positron.cancel': vscode.l10n.t('Cancel'),
                "positronOK": vscode.l10n.t('OK'),
                positronEmpty: vscode.l10n.t('Empty'),
            };
        }
    `;

    assert.deepEqual(collectHostLocalizationKeys(source), new Set([
        'positron.cancel', 'positronOK', 'positronEmpty',
    ]));
});

test('extracts keys independently of comments, line breaks and property layout', () => {
    const source = `
        const messages = { positronCancel: vscode.l10n.t('Cancel'), positronOK: vscode.l10n.t('OK'),
            positronEmpty /* label */ :
                vscode
                    .l10n
                    .t(
                        'Empty',
                    ),
        };
    `;

    assert.deepEqual(collectHostLocalizationKeys(source), new Set([
        'positronCancel', 'positronOK', 'positronEmpty',
    ]));
});

test('does not count comments, strings, dynamic names or unrelated calls as payload entries', () => {
    const source = `
        // 'commentedOut': vscode.l10n.t('Comment'),
        /*
        'blockComment': vscode.l10n.t('Comment'),
        */
        const example = "'stringContent': vscode.l10n.t('Example')";
        const messages = {
            valid: vscode.l10n.t('Valid'),
            plainText: 'Plain text',
            otherCall: other.l10n.t('Other'),
            otherMethod: vscode.l10n.other('Other'),
            otherNamespace: vscode.other.t('Other'),
            reference: vscode.l10n.t,
            [dynamicKey]: vscode.l10n.t('Dynamic'),
        };
    `;

    assert.deepEqual(collectHostLocalizationKeys(source), new Set(['valid']));
});

test('preserves detected keys when Prettier removes property quotes and wraps calls', async () => {
    const source = `
        const messages = {
            'positronCancel': vscode.l10n.t('Cancel'),
            'positronOK': vscode.l10n.t('OK'),
            'positron.longMessage': vscode.l10n.t('A long localization message that wraps across multiple lines after formatting with the project configuration.'),
        };
    `;
    const sourcePath = fileURLToPath(new URL('../src/webview/webviewLocalization.ts', import.meta.url));
    const config = await prettier.resolveConfig(sourcePath);
    const formatted = await prettier.format(source, { ...config, filepath: sourcePath });
    const expected = new Set(['positronCancel', 'positronOK', 'positron.longMessage']);

    assert.match(formatted, /\bpositronCancel:/);
    assert.match(formatted, /vscode\.l10n\.t\(\n/);
    assert.deepEqual(collectHostLocalizationKeys(source), expected);
    assert.deepEqual(collectHostLocalizationKeys(formatted), expected);
});
