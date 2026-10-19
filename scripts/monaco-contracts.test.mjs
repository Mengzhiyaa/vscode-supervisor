import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function collectModuleSpecifiers(sourceText) {
    const source = ts.createSourceFile('source.ts', sourceText, ts.ScriptTarget.Latest, true);
    const paths = new Set();
    function visit(node) {
        let specifier;
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            specifier = node.moduleSpecifier;
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
            specifier = node.argument.literal;
        } else if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword
        ) {
            specifier = node.arguments[0];
        }
        if (specifier && ts.isStringLiteral(specifier)) {
            paths.add(specifier.text);
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    return paths;
}

function readSource(relativePath) {
    return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('module checks recognize real imports and exports independently of formatting', () => {
    const source = `
        import * as monaco from 'monaco-editor/editor';
        import "./features";
        import {
            register,
        } from /* feature */ "monaco-editor/features/codeEditor/register";
        export { value } from 'exported-module';
        type Editor = import('editor-types').Editor;
        const lazy = import('lazy-module');
        // import 'monaco-editor/features/register.all';
        /* import 'monaco-editor/features/folding/register'; */
        const example = "import 'monaco-editor/features/gpu/register';";
    `;
    assert.deepEqual(
        collectModuleSpecifiers(source),
        new Set([
            'monaco-editor/editor',
            './features',
            'monaco-editor/features/codeEditor/register',
            'exported-module',
            'editor-types',
            'lazy-module',
        ]),
    );
});

test('Monaco setup imports the public editor, language registrations and worker', () => {
    const imports = collectModuleSpecifiers(readSource('webview/src/lib/monaco/setup.ts'));
    for (const modulePath of [
        'monaco-editor/editor',
        './features',
        'monaco-editor/languages/definitions/r/register',
        'monaco-editor/languages/definitions/python/register',
        'monaco-editor/editor/editor.worker?worker&url',
    ]) {
        assert.ok(imports.has(modulePath), `Expected setup import of ${modulePath}`);
    }
});

test('Monaco explicitly registers required editor features', () => {
    const imports = collectModuleSpecifiers(readSource('webview/src/lib/monaco/features.ts'));
    for (const feature of [
        'codeEditor',
        'clipboard',
        'hover',
        'suggest',
        'inlineCompletions',
        'parameterHints',
        'snippet',
        'tokenization',
    ]) {
        const modulePath = `monaco-editor/features/${feature}/register`;
        assert.ok(imports.has(modulePath), `Expected feature import of ${modulePath}`);
    }
});

test('Monaco omits unused editor feature registrations', () => {
    const imports = collectModuleSpecifiers(readSource('webview/src/lib/monaco/features.ts'));
    for (const feature of [
        'diffEditor',
        'diffEditorBreadcrumbs',
        'folding',
        'stickyScroll',
        'gpu',
        'codelens',
        'colorPicker',
        'inlayHints',
        'inspectTokens',
        'sectionHeaders',
    ]) {
        const modulePath = `monaco-editor/features/${feature}/register`;
        assert.ok(!imports.has(modulePath), `Unexpected feature import of ${modulePath}`);
    }
});

test('Monaco integrations avoid private entrypoints and register.all', () => {
    for (const file of [
        'webview/src/lib/monaco/setup.ts',
        'webview/src/lib/monaco/features.ts',
        'webview/src/lib/monaco/activityInputColorizer.ts',
        'webview/vite.config.ts',
    ]) {
        for (const modulePath of collectModuleSpecifiers(readSource(file))) {
            assert.doesNotMatch(modulePath, /^monaco-editor\/(?:min|esm)\//, file);
            assert.doesNotMatch(modulePath, /edcore\.main/, file);
            assert.notEqual(modulePath, 'monaco-editor/features/register.all', file);
        }
    }
});
