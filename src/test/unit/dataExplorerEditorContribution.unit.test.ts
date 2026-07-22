import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    createDataExplorerEditorUri,
    getDataExplorerIdentifier,
    isSpreadsheetDataExplorerIdentifier,
} from '../../services/dataExplorer/dataExplorerUri';
import {
    findDataExplorerIdentifierRanges,
    getDataExplorerLanguageIdAtPosition,
    isDocumentLanguageCompatible,
    resolveDataFrameAtPosition,
} from '../../services/dataExplorer/positronDataExplorerResolveDataFrame';
import { PositronDataExplorerCodeActionProvider } from '../../services/dataExplorer/positronDataExplorerEditorContribution';
import { formatDataExplorerEditorTitle } from '../../services/dataExplorer/positronDataExplorerEditorProvider';
import {
    createDefaultDataExplorerUiState,
    DataExplorerPreviewEnabled,
} from '../../services/dataExplorer/positronDataExplorerSummary';

function variablesInstance(sessionId: string, languageId: string, variableId: string) {
    return {
        session: {
            sessionId,
            runtimeMetadata: { languageId },
        },
        variableItems: [{
            id: variableId,
            displayName: 'iris',
            path: ['iris'],
            hasViewer: true,
        }],
    } as any;
}

function variablesService(instances: any[], activeInstance = instances[0]) {
    return {
        positronVariablesInstances: instances,
        activePositronVariablesInstance: activeInstance,
        getVariablesInstance: (sessionId: string) =>
            instances.find(instance => instance.session.sessionId === sessionId),
    } as any;
}

function textDocument(languageId: string, content: string): vscode.TextDocument {
    const lines = content.split('\n');
    return {
        languageId,
        lineCount: lines.length,
        lineAt: (line: number) => ({ text: lines[line] }),
        getWordRangeAtPosition: (position: vscode.Position) => {
            for (const match of lines[position.line].matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
                const start = match.index ?? 0;
                const end = start + match[0].length;
                if (position.character >= start && position.character <= end) {
                    return new vscode.Range(position.line, start, position.line, end);
                }
            }
            return undefined;
        },
        getText: (range?: vscode.Range) => range
            ? lines[range.start.line].slice(range.start.character, range.end.character)
            : content,
    } as unknown as vscode.TextDocument;
}

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

    test('uses the console session identity for same-named variables', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'python',
            content: 'iris\n',
        });
        const first = variablesInstance('python-1', 'python', 'iris-1');
        const second = variablesInstance('python-2', 'python', 'iris-2');
        const resolved = resolveDataFrameAtPosition(
            document,
            new vscode.Position(0, 2),
            variablesService([first, second], first),
            {
                getConsoleSessionForLanguage: () => second.session,
            } as any,
        );

        assert.strictEqual(resolved?.sessionId, 'python-2');
        assert.strictEqual(resolved?.variable.id, 'iris-2');
    });

    test('resolves Quarto embedded languages and ignores prose, strings, and comments', async () => {
        const document = textDocument('quarto', [
            'iris in prose',
            '```{r}',
            'iris',
            '"iris"',
            '# iris',
            '```',
        ].join('\n'));
        const rInstance = variablesInstance('r-1', 'r', 'r-iris');
        const resolved = resolveDataFrameAtPosition(
            document,
            new vscode.Position(2, 2),
            variablesService([rInstance]),
            { getConsoleSessionForLanguage: () => rInstance.session } as any,
        );

        assert.strictEqual(getDataExplorerLanguageIdAtPosition(document, new vscode.Position(0, 2)), undefined);
        assert.strictEqual(getDataExplorerLanguageIdAtPosition(document, new vscode.Position(2, 2)), 'r');
        assert.strictEqual(resolved?.sessionId, 'r-1');
        assert.deepStrictEqual(
            findDataExplorerIdentifierRanges(document)
                .map(range => document.getText(range))
                .filter(identifier => identifier === 'iris'),
            ['iris'],
        );
    });

    test('does not create identifier candidates inside multiline Python strings', () => {
        const document = textDocument('python', [
            '"""',
            'iris',
            '"""',
            'iris',
        ].join('\n'));

        assert.deepStrictEqual(
            findDataExplorerIdentifierRanges(document)
                .filter(range => document.getText(range) === 'iris')
                .map(range => range.start.line),
            [3],
        );
    });

    test('code actions carry stable session and variable identifiers', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'python',
            content: 'iris\n',
        });
        const instance = variablesInstance('python-2', 'python', 'iris-stable-id');
        const actions = new PositronDataExplorerCodeActionProvider(
            variablesService([instance]),
            { getConsoleSessionForLanguage: () => instance.session } as any,
        ).provideCodeActions(document, new vscode.Range(0, 0, 0, 4));

        assert.deepStrictEqual(actions[0]?.command?.arguments, [{
            sessionId: 'python-2',
            variableId: 'iris-stable-id',
        }]);
    });

    test('uses Positron-compatible configuration defaults and editor titles', () => {
        const values = new Map<string, unknown>([
            ['dataExplorer.summaryCollapsed', true],
            ['dataExplorer.summaryLayout', 'right'],
            ['dataExplorer.enablePreview', true],
        ]);
        const configuration = {
            get: <T>(key: string, fallback?: T) => (values.get(key) ?? fallback) as T,
        };

        assert.deepStrictEqual(createDefaultDataExplorerUiState(configuration), {
            layout: 'SummaryOnRight',
            summaryCollapsed: true,
            summaryWidth: 350,
        });
        assert.strictEqual(DataExplorerPreviewEnabled(configuration), true);
        assert.strictEqual(formatDataExplorerEditorTitle('iris'), 'Data: iris');
        assert.strictEqual(
            formatDataExplorerEditorTitle('a'.repeat(31)),
            `Data: ${'a'.repeat(27)}...`,
        );
    });

    test('recognizes only Excel-backed Data Explorer resources as spreadsheets', () => {
        assert.strictEqual(
            isSpreadsheetDataExplorerIdentifier('duckdb:file:///tmp/report.xlsx'),
            true,
        );
        assert.strictEqual(
            isSpreadsheetDataExplorerIdentifier('duckdb:file:///tmp/report.csv'),
            false,
        );
    });
});
