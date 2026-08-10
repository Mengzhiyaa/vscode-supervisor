import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    buildRuntimeQuickPickItems,
    type RuntimeQuickPickCandidate,
} from '../../runtime/runtimeQuickPick';

function candidate(
    languageId: string,
    runtimeName: string,
    runtimePath: string,
    overrides: Partial<RuntimeQuickPickCandidate> = {},
): RuntimeQuickPickCandidate {
    return {
        languageId,
        languageName: languageId === 'r' ? 'R' : 'Python',
        languageVersion: languageId === 'r' ? '4.5.0' : '3.13.0',
        runtimeName,
        runtimePath,
        runtimeSource: 'System',
        installation: { path: runtimePath },
        preferred: false,
        active: false,
        ...overrides,
    };
}

suite('[Unit] Runtime quick pick', () => {
    test('shows one suggested runtime for every registered language', () => {
        const items = buildRuntimeQuickPickItems([
            candidate('python', 'Python 3.13', '/usr/bin/python3', { preferred: true }),
            candidate('r', 'R 4.5', '/usr/bin/R', { preferred: true }),
        ]);

        assert.deepStrictEqual(
            items.map(item => item.kind === vscode.QuickPickItemKind.Separator
                ? `[${item.label}]`
                : `${item.languageId}:${item.label}`),
            ['[Suggested]', 'python:Python 3.13', 'r:R 4.5'],
        );
    });

    test('does not duplicate preferred runtimes and groups alternates by source', () => {
        const items = buildRuntimeQuickPickItems([
            candidate('python', 'Python 3.13', '/usr/bin/python3', { preferred: true }),
            candidate('python', 'Python 3.12', '/opt/python3.12', {
                languageVersion: '3.12.0',
                runtimeSource: 'Conda',
            }),
            candidate('python', 'Python 3.11', '/opt/python3.11', {
                languageVersion: '3.11.0',
                runtimeSource: 'Conda',
            }),
        ]);

        assert.deepStrictEqual(
            items.map(item => item.kind === vscode.QuickPickItemKind.Separator
                ? `[${item.label}]`
                : item.label),
            ['[Suggested]', 'Python 3.13', '[Conda]', 'Python 3.12', 'Python 3.11'],
        );
        assert.strictEqual(items.filter(item => item.label === 'Python 3.13').length, 1);
    });
});
