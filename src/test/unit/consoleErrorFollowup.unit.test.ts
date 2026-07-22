import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    ConsoleErrorFollowupService,
    MissingPackageErrorProvider,
    extractMissingPackageName,
} from '../../services/console/consoleErrorFollowup';

const error = {
    sessionId: 'session-1',
    languageId: 'python',
    name: 'ModuleNotFoundError',
    message: "No module named 'pandas.core'",
    traceback: [],
};

suite('[Unit] Console error follow-up', () => {
    test('extracts top-level Python and R package names', () => {
        assert.strictEqual(extractMissingPackageName(error), 'pandas');
        assert.strictEqual(extractMissingPackageName({
            languageId: 'r',
            message: "there is no package called ‘dplyr’",
        }), 'dplyr');
    });

    test('isolates provider failures and keeps valid suggestions', async () => {
        const service = new ConsoleErrorFollowupService();
        service.registerProvider({ provideSuggestions: async () => { throw new Error('failed'); } });
        service.registerProvider({
            provideSuggestions: async () => [{ id: 'valid', iconId: 'lightbulb', label: 'Valid', run: async () => undefined }],
        });
        const suggestions = await service.getSuggestions(error, new vscode.CancellationTokenSource().token);
        assert.deepStrictEqual(suggestions.map(item => item.id), ['valid']);
        service.dispose();
    });

    test('offers only an exact repository match and runs the real install operation', async () => {
        const installed: unknown[] = [];
        const provider = new MissingPackageErrorProvider({
            getInstance: () => ({
                packages: [],
                searchPackages: async () => [{ name: 'pandas', displayName: 'pandas' } as any],
                installPackages: async packages => { installed.push(...packages); },
            }),
        });
        const suggestions = await provider.provideSuggestions(error, new vscode.CancellationTokenSource().token);
        assert.strictEqual(suggestions.length, 1);
        await suggestions[0].run();
        assert.deepStrictEqual(installed, [{ name: 'pandas' }]);
    });
});
