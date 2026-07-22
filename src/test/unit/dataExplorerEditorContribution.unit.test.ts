import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    createDataExplorerEditorUri,
    getDataExplorerIdentifier,
} from '../../services/dataExplorer/dataExplorerUri';
import {
    isDocumentLanguageCompatible,
    resolveDataFrameAtPosition,
} from '../../services/dataExplorer/positronDataExplorerResolveDataFrame';

suite('[Unit] Data Explorer editor contribution', () => {
    test('round-trips model identifiers through editor resources', () => {
        const identifier = 'runtime:session-1:iris/a b';
        assert.strictEqual(getDataExplorerIdentifier(createDataExplorerEditorUri(identifier)), identifier);
        assert.strictEqual(getDataExplorerIdentifier(vscode.Uri.file('/tmp/a.csv')), undefined);
    });

    test('matches runtime language and viewable cached variables only', () => {
        const range = new vscode.Range(0, 0, 0, 4);
        const document = {
            languageId: 'python',
            getWordRangeAtPosition: () => range,
            getText: () => 'iris',
        } as unknown as vscode.TextDocument;
        const variable = { displayName: 'iris', path: ['iris'], hasViewer: true };
        const instance = {
            session: { runtimeMetadata: { languageId: 'python' } },
            variableItems: [variable],
        };
        const resolved = resolveDataFrameAtPosition(document, new vscode.Position(0, 1), {
            activePositronVariablesInstance: instance,
        } as any);
        assert.strictEqual(resolved?.variable, variable);
        assert.strictEqual(isDocumentLanguageCompatible('quarto', 'r'), true);
        assert.strictEqual(isDocumentLanguageCompatible('r', 'python'), false);
    });
});
