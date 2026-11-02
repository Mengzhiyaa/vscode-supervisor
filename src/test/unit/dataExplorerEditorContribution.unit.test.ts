import * as assert from 'assert';
import * as vscode from 'vscode';
import { LanguageRuntimeSessionMode } from '../../api';
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
import {
    PositronDataExplorerClickToViewProvider,
    PositronDataExplorerCodeActionProvider,
    PositronDataExplorerEditorContribution,
} from '../../services/dataExplorer/positronDataExplorerEditorContribution';
import { viewVariableItem } from '../../services/dataExplorer/positronDataExplorerViewVariableItem';
import {
    escapeDataExplorerHtml,
    formatDataExplorerEditorTitle,
} from '../../services/dataExplorer/positronDataExplorerEditorProvider';
import { POSITRON_DATA_EXPLORER_CUSTOM_EDITOR_OPTIONS } from '../../services/dataExplorer/positronDataExplorerCustomEditorProvider';
import {
    createDefaultDataExplorerUiState,
    DataExplorerPreviewEnabled,
} from '../../services/dataExplorer/positronDataExplorerSummary';

function variablesInstance(sessionId: string, languageId: string, variableId: string) {
    return {
        session: {
            sessionId,
            runtimeMetadata: { languageId },
            sessionMetadata: { sessionMode: LanguageRuntimeSessionMode.Console },
        },
        variableItems: [
            {
                id: variableId,
                displayName: 'iris',
                path: ['iris'],
                hasViewer: true,
            },
        ],
    } as any;
}

function variablesService(instances: any[], activeInstance = instances[0]) {
    return {
        positronVariablesInstances: instances,
        activePositronVariablesInstance: activeInstance,
        getVariablesInstance: (sessionId: string) =>
            instances.find((instance) => instance.session.sessionId === sessionId),
    } as any;
}

function textDocument(languageId: string, content: string): vscode.TextDocument {
    const lines = content.split('\n');
    return {
        uri: vscode.Uri.parse('untitled:data-explorer-test'),
        version: 1,
        languageId,
        lineCount: lines.length,
        lineAt: (line: number) => ({ text: lines[line] }),
        getWordRangeAtPosition: (
            position: vscode.Position,
            pattern = /[A-Za-z_][A-Za-z0-9_]*/g,
        ) => {
            for (const match of lines[position.line].matchAll(pattern)) {
                const start = match.index ?? 0;
                const end = start + match[0].length;
                if (position.character >= start && position.character <= end) {
                    return new vscode.Range(position.line, start, position.line, end);
                }
            }
            return undefined;
        },
        getText: (range?: vscode.Range) =>
            range
                ? lines[range.start.line].slice(range.start.character, range.end.character)
                : content,
    } as unknown as vscode.TextDocument;
}

suite('[Unit] Data Explorer editor contribution', () => {
    test('round-trips model identifiers through editor resources', () => {
        const identifier = 'runtime:session-1:iris/a b';
        assert.strictEqual(
            getDataExplorerIdentifier(createDataExplorerEditorUri(identifier)),
            identifier,
        );
        assert.strictEqual(getDataExplorerIdentifier(vscode.Uri.file('/tmp/a.csv')), undefined);
    });

    test('matches runtime language and viewable cached variables only', () => {
        const document = textDocument('python', 'iris');
        const instance = variablesInstance('python-1', 'python', 'iris-1');
        const variable = instance.variableItems[0];
        const service = variablesService([instance]);
        const position = new vscode.Position(0, 1);
        const resolved = resolveDataFrameAtPosition(document, position, service);
        assert.strictEqual(resolved?.variable, variable);
        variable.hasViewer = false;
        assert.strictEqual(resolveDataFrameAtPosition(document, position, service), undefined);
        variable.hasViewer = true;
        instance.session.runtimeMetadata.languageId = 'r';
        assert.strictEqual(resolveDataFrameAtPosition(document, position, service), undefined);
        assert.strictEqual(isDocumentLanguageCompatible('quarto', 'r'), true);
        assert.strictEqual(isDocumentLanguageCompatible('r', 'python'), false);
    });

    test('does not use a notebook session to resolve script variables', () => {
        const instance = variablesInstance('python-notebook', 'python', 'iris-notebook');
        instance.session.sessionMetadata.sessionMode = LanguageRuntimeSessionMode.Notebook;

        assert.strictEqual(
            resolveDataFrameAtPosition(
                textDocument('python', 'iris'),
                new vscode.Position(0, 1),
                variablesService([instance]),
            ),
            undefined,
        );
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
        const document = textDocument(
            'quarto',
            ['iris in prose', '```{r}', 'iris', '"iris"', '# iris', '```'].join('\n'),
        );
        const rInstance = variablesInstance('r-1', 'r', 'r-iris');
        const resolved = resolveDataFrameAtPosition(
            document,
            new vscode.Position(2, 2),
            variablesService([rInstance]),
            { getConsoleSessionForLanguage: () => rInstance.session } as any,
        );

        assert.strictEqual(
            getDataExplorerLanguageIdAtPosition(document, new vscode.Position(0, 2)),
            undefined,
        );
        assert.strictEqual(
            getDataExplorerLanguageIdAtPosition(document, new vscode.Position(2, 2)),
            'r',
        );
        assert.strictEqual(resolved?.sessionId, 'r-1');
        assert.deepStrictEqual(
            findDataExplorerIdentifierRanges(document)
                .map((range) => document.getText(range))
                .filter((identifier) => identifier === 'iris'),
            ['iris'],
        );
    });

    test('does not create identifier candidates inside multiline Python strings', () => {
        const document = textDocument('python', ['"""', 'iris', '"""', 'iris'].join('\n'));

        assert.deepStrictEqual(
            findDataExplorerIdentifierRanges(document)
                .filter((range) => document.getText(range) === 'iris')
                .map((range) => range.start.line),
            [3],
        );
    });

    test('resolves Unicode Python identifiers and dotted R identifiers', () => {
        for (const [languageId, name] of [
            ['python', '数据_表'],
            ['r', 'my.data'],
            ['r', '.数据'],
        ]) {
            const document = textDocument(languageId, name);
            const instance = variablesInstance('session', languageId, 'variable');
            instance.variableItems[0].displayName = name;
            instance.variableItems[0].path = [name];

            const ranges = findDataExplorerIdentifierRanges(document);
            assert.deepStrictEqual(
                ranges.map((range) => document.getText(range)),
                [name],
            );
            assert.strictEqual(
                resolveDataFrameAtPosition(
                    document,
                    new vscode.Position(0, 1),
                    variablesService([instance]),
                )?.variable,
                instance.variableItems[0],
            );
        }
    });

    test('recognizes matching Quarto fences and ignores fenced examples', () => {
        const document = textDocument(
            'quarto',
            [
                '`````markdown',
                '```{r}',
                'iris',
                '```',
                '`````',
                '~~~{r}',
                'iris',
                '~~~',
                '````{python}',
                'iris',
                '```',
                '````',
                'iris in prose',
            ].join('\n'),
        );

        assert.strictEqual(
            getDataExplorerLanguageIdAtPosition(document, new vscode.Position(2, 0)),
            undefined,
        );
        assert.strictEqual(
            getDataExplorerLanguageIdAtPosition(document, new vscode.Position(6, 0)),
            'r',
        );
        assert.strictEqual(
            getDataExplorerLanguageIdAtPosition(document, new vscode.Position(9, 0)),
            'python',
        );
        assert.strictEqual(
            getDataExplorerLanguageIdAtPosition(document, new vscode.Position(12, 0)),
            undefined,
        );
        assert.deepStrictEqual(
            findDataExplorerIdentifierRanges(document)
                .filter((range) => document.getText(range) === 'iris')
                .map((range) => range.start.line),
            [6, 9],
        );
    });

    test('reuses existing variable and inline viewers before opening another comm', async () => {
        const instance = variablesInstance('python-1', 'python', 'iris');
        let opens = 0;
        let focuses = 0;
        instance.view = async () => {
            opens++;
            return 'new-viewer';
        };
        const existing = {
            identifier: 'inline-viewer',
            sessionId: 'python-1',
            requestFocus: () => {
                focuses++;
            },
        };
        const bindings: unknown[] = [];
        const service = {
            getInstanceForVar: () => existing,
            getInstanceForVariablePath: () => existing,
            setInstanceForVar: (...args: unknown[]) => bindings.push(args),
            setInstanceForVariablePath: (...args: unknown[]) => bindings.push(args),
        } as any;
        const item = instance.variableItems[0];

        assert.strictEqual(
            await viewVariableItem('python-1', item, instance, service),
            'inline-viewer',
        );
        service.getInstanceForVar = () => undefined;
        assert.strictEqual(
            await viewVariableItem('python-1', item, instance, service),
            'inline-viewer',
        );
        assert.strictEqual(opens, 0);
        assert.strictEqual(focuses, 2);

        service.getInstanceForVariablePath = () => undefined;
        assert.strictEqual(
            await viewVariableItem('python-1', item, instance, service),
            'new-viewer',
        );
        assert.strictEqual(opens, 1);
        assert.deepStrictEqual(bindings, [
            ['new-viewer', 'iris'],
            ['new-viewer', 'python-1', ['iris']],
        ]);
    });

    test('editor links resolve the foreground session when clicked and reject changed documents', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'python',
            content: 'iris',
        });
        const first = variablesInstance('python-1', 'python', 'iris-1');
        const second = variablesInstance('python-2', 'python', 'iris-2');
        const opened: string[] = [];
        first.view = async () => {
            opened.push('python-1');
            return undefined;
        };
        second.view = async () => {
            opened.push('python-2');
            return undefined;
        };
        const service = variablesService([first, second]);
        let foreground = first;
        const runtime = { getConsoleSessionForLanguage: () => foreground.session } as any;
        const links = new PositronDataExplorerClickToViewProvider(
            service,
            runtime,
        ).provideDocumentLinks(document);
        assert.strictEqual(links.length, 1);
        const [args] = JSON.parse(decodeURIComponent(links[0].target!.query));
        assert.strictEqual(args.sessionId, undefined);

        const contribution = Object.assign(
            Object.create(PositronDataExplorerEditorContribution.prototype),
            {
                _variablesService: service,
                _runtimeSessionService: runtime,
                _dataExplorerService: {
                    getInstanceForVar: () => undefined,
                    getInstanceForVariablePath: () => undefined,
                },
            },
        );
        foreground = second;
        await contribution._viewDataFrameAtCursor(args);
        await contribution._viewDataFrameAtCursor({
            ...args,
            documentVersion: document.version - 1,
        });
        assert.deepStrictEqual(opened, ['python-2']);
    });

    test('code actions carry stable session and variable identifiers', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'python',
            content: 'iris\n',
        });
        const instance = variablesInstance('python-2', 'python', 'iris-stable-id');
        const actions = new PositronDataExplorerCodeActionProvider(variablesService([instance]), {
            getConsoleSessionForLanguage: () => instance.session,
        } as any).provideCodeActions(document, new vscode.Range(0, 0, 0, 4));

        assert.deepStrictEqual(actions[0]?.command?.arguments, [
            {
                sessionId: 'python-2',
                variableId: 'iris-stable-id',
            },
        ]);
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

    test('supports split editors and retains hidden Data Explorer webviews', () => {
        assert.deepStrictEqual(POSITRON_DATA_EXPLORER_CUSTOM_EDITOR_OPTIONS, {
            supportsMultipleEditorsPerDocument: true,
            webviewOptions: {
                retainContextWhenHidden: true,
            },
        });
    });

    test('escapes untrusted status page content', () => {
        assert.strictEqual(
            escapeDataExplorerHtml(`<script>alert('x')</script>&"`),
            '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;&quot;',
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
