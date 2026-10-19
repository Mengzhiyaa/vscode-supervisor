import * as assert from 'assert';
import * as vscode from 'vscode';
import { ConsoleViewProvider } from '../../webview/consoleProvider';
import { PositronDataExplorerEditorProvider } from '../../services/dataExplorer/positronDataExplorerEditorProvider';

function stylesheetHrefs(html: string): string[] {
    const hrefs: string[] = [];
    for (const tag of html.matchAll(/<link\b([^>]*)>/giu)) {
        const attributes = new Map(
            [...tag[1].matchAll(/\b(href|rel)\s*=\s*(["'])(.*?)\2/giu)].map((match) => [
                match[1].toLowerCase(),
                match[3],
            ]),
        );
        if (attributes.get('rel') === 'stylesheet') {
            hrefs.push(attributes.get('href') ?? '');
        }
    }
    return hrefs;
}

suite('[Unit] Webview HTML stylesheets', () => {
    for (const [domain, prototype, method] of [
        ['console', ConsoleViewProvider.prototype, '_getHtmlContent'],
        ['dataExplorer', PositronDataExplorerEditorProvider.prototype, '_getHtmlForWebview'],
    ] as const) {
        test(`${domain} emits shared styles as link elements before page styles`, () => {
            // Exercise the real HTML renderer without registering commands or listeners.
            const provider = Object.assign(Object.create(prototype) as object, {
                _extensionUri: vscode.Uri.file('/extension'),
                _getLanguageMonacoSupportModuleUris: () => ({}),
                _getLanguageTextMateGrammarDefinitions: () => ({}),
            });
            const webview = {
                cspSource: 'webview-test:',
                asWebviewUri: (uri: vscode.Uri) => uri.with({ scheme: 'webview-test' }),
            } as vscode.Webview;
            const render = Reflect.get(prototype, method) as (webview: vscode.Webview) => string;
            const html = render.call(provider, webview);

            assert.deepStrictEqual(stylesheetHrefs(html), [
                'webview-test:/extension/webview/dist/setup/index.css',
                'webview-test:/extension/webview/dist/common/index.css',
                `webview-test:/extension/webview/dist/${domain}/index.css`,
            ]);
        });
    }
});
