import * as assert from 'assert';
import * as vscode from 'vscode';
import { PassiveLanguageAssetCatalog } from '../../languageRegistry/passiveLanguageAssetCatalog';

const noExtensionChanges: vscode.Event<void> = () => new vscode.Disposable(() => undefined);

function extension(id: string, languageId: string, modulePath = './webview/index.js') {
    return {
        id,
        extensionUri: vscode.Uri.file(`/extensions/${id}`),
        packageJSON: {
            supervisor: {
                languageAssetsVersion: 1,
                languages: [{
                    languageId,
                    assets: {
                        localResourceRoots: ['./webview', './syntaxes'],
                        monacoSupportModule: modulePath,
                        textMateGrammar: {
                            scopeName: `source.${languageId}`,
                            path: `./syntaxes/${languageId}.tmGrammar.json`,
                        },
                    },
                }],
            },
        },
    };
}

suite('[Unit] passive language asset catalog', () => {
    test('reads assets from package manifests without activating extensions', () => {
        let activationCalls = 0;
        const source = { ...extension('publisher.r', 'r'), activate: () => { activationCalls += 1; } };
        const catalog = new PassiveLanguageAssetCatalog(() => [source], noExtensionChanges);

        assert.strictEqual(activationCalls, 0);
        assert.strictEqual(catalog.snapshot.entries.length, 1);
        assert.strictEqual(catalog.snapshot.entries[0].languageId, 'r');
        assert.strictEqual(
            catalog.snapshot.entries[0].assets.monacoSupportModule?.fsPath,
            '/extensions/publisher.r/webview/index.js',
        );
        catalog.dispose();
    });

    test('rejects traversal paths', () => {
        const catalog = new PassiveLanguageAssetCatalog(
            () => [extension('publisher.r', 'r', '../outside.js')],
            noExtensionChanges,
        );

        assert.strictEqual(catalog.snapshot.entries.length, 1);
        assert.strictEqual(catalog.snapshot.entries[0].assets.monacoSupportModule, undefined);
        assert.ok(catalog.snapshot.diagnostics.some(entry => entry.message.includes('relative path')));
        catalog.dispose();
    });

    test('uses stable owner ordering for duplicate manifest declarations', () => {
        const catalog = new PassiveLanguageAssetCatalog(
            () => [extension('publisher.z', 'r'), extension('publisher.a', 'r')],
            noExtensionChanges,
        );
        assert.strictEqual(catalog.snapshot.entries[0].ownerExtensionId, 'publisher.a');
        assert.ok(catalog.snapshot.diagnostics.some(entry => entry.message.includes('Multiple manifest owners')));
        catalog.dispose();
    });

    test('rebuilds an immutable generation when extensions change', () => {
        let sources = [extension('publisher.r', 'r')];
        const emitter = new vscode.EventEmitter<void>();
        const catalog = new PassiveLanguageAssetCatalog(() => sources, emitter.event);
        const firstGeneration = catalog.snapshot.generation;

        sources = [extension('publisher.python', 'python')];
        emitter.fire();

        assert.ok(catalog.snapshot.generation > firstGeneration);
        assert.deepStrictEqual(catalog.snapshot.entries.map(entry => entry.languageId), ['python']);
        catalog.dispose();
        emitter.dispose();
    });

    test('deduplicates Monaco modules and TextMate scopes by stable owner', () => {
        const first = extension('publisher.a', 'r');
        const second = extension('publisher.b', 'python');
        second.extensionUri = first.extensionUri;
        second.packageJSON.supervisor.languages[0].assets.textMateGrammar.scopeName = 'source.r';
        const catalog = new PassiveLanguageAssetCatalog(() => [second, first], noExtensionChanges);
        const python = catalog.snapshot.entries.find(entry => entry.languageId === 'python');

        assert.strictEqual(python?.assets.monacoSupportModule, undefined);
        assert.strictEqual(python?.assets.textMateGrammar, undefined);
        assert.ok(catalog.snapshot.diagnostics.some(entry => entry.message.includes('Monaco module conflicts')));
        assert.ok(catalog.snapshot.diagnostics.some(entry => entry.message.includes("TextMate scope 'source.r'")));
        catalog.dispose();
    });
});
