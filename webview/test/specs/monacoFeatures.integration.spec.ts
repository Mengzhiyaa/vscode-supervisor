import { expect, test, type Page } from '@playwright/test';
import type * as Monaco from 'monaco-editor/editor';
import { ConsoleMethods, SessionMethods, createSession, registerConsoleDefaults } from '../harness/domains';
import { openWebviewPage } from '../harness/page';

async function openConsole(page: Page) {
    const sessions = [createSession({ promptActive: false })];
    const backend = await openWebviewPage(page, 'console', {
        configure: mockBackend => registerConsoleDefaults(mockBackend, {
            sessions,
            activeSessionId: 'session-1',
        }),
    });
    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, { sessions, activeSessionId: 'session-1' });
    await expect(page.locator('.console-input')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
        const monaco = (globalThis as typeof globalThis & { monaco?: typeof Monaco }).monaco;
        return monaco?.editor.getEditors().some(editor =>
            editor.getDomNode()?.closest('.console-input') && editor.getModel(),
        ) ?? false;
    })).toBe(true);
}

test('Monaco retains required controllers and omits unused contributions', async ({ page }) => {
    await openConsole(page);
    const controllers = await page.evaluate(() => {
        const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
        const editor = monaco.editor.getEditors().find(editor =>
            editor.getDomNode()?.closest('.console-input'),
        )!;
        const has = (id: string) => Boolean(editor.getContribution(id));
        return {
            required: ['editor.contrib.suggestController', 'editor.contrib.contentHover',
                'editor.controller.parameterHints', 'snippetController2'].map(has),
            unused: ['store.contrib.stickyScrollController',
                'css.editor.codeLens', 'editor.contrib.colorDetector',
                'editor.contrib.InlayHints'].map(has),
            foldingEnabled: editor.getOption(monaco.editor.EditorOption.folding),
        };
    });
    expect(controllers.required).toEqual([true, true, true, true]);
    expect(controllers.unused).toEqual([false, false, false, false]);
    expect(controllers.foldingEnabled).toBe(false);
});

test('Monaco accepts provider completions and navigates snippet placeholders with Tab', async ({ page }) => {
    await openConsole(page);
    await page.evaluate(() => {
        const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
        const editor = monaco.editor.getEditors().find(editor =>
            editor.getDomNode()?.closest('.console-input'),
        )!;
        const model = editor.getModel()!;
        monaco.languages.registerCompletionItemProvider(model.getLanguageId(), {
            provideCompletionItems: (_model, position) => ({ suggestions: [{
                label: 'probe_snippet',
                kind: monaco.languages.CompletionItemKind.Function,
                insertText: 'sum(${1:values}, ${2:offset})$0',
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range: new monaco.Range(position.lineNumber, 1, position.lineNumber, position.column),
            }] }),
        });
        editor.setValue('probe_');
        editor.setPosition({ lineNumber: 1, column: 7 });
        editor.focus();
        editor.trigger('test', 'editor.action.triggerSuggest', null);
    });
    await expect(page.locator('.suggest-widget').getByText('probe_snippet', { exact: true })).toBeVisible();
    await expect(page.locator('.suggest-widget')).toHaveClass(/\bvisible\b/);
    await expect(page.locator('.suggest-widget .monaco-list-row.focused')).toBeVisible();
    await page.keyboard.press('Tab');
    const readSelection = () => page.evaluate(() => {
        const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
        const editor = monaco.editor.getEditors().find(editor =>
            editor.getDomNode()?.closest('.console-input'),
        )!;
        return {
            value: editor.getValue(),
            selected: editor.getModel()!.getValueInRange(editor.getSelection()!),
        };
    });
    await expect.poll(readSelection).toEqual({ value: 'sum(values, offset)', selected: 'values' });
    await page.keyboard.press('Tab');
    await expect.poll(readSelection).toEqual({ value: 'sum(values, offset)', selected: 'offset' });
});

test('Monaco shows documentation from a language hover provider', async ({ page }) => {
    await openConsole(page);
    await page.evaluate(async () => {
        const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
        const editor = monaco.editor.getEditors().find(editor =>
            editor.getDomNode()?.closest('.console-input'),
        )!;
        monaco.languages.registerHoverProvider(editor.getModel()!.getLanguageId(), {
            provideHover: () => ({
                range: new monaco.Range(1, 1, 1, 4),
                contents: [{ value: 'Probe hover documentation' }],
            }),
        });
        editor.setValue('sum');
        editor.setPosition({ lineNumber: 1, column: 2 });
        editor.focus();
        await editor.getAction('editor.action.showHover')!.run();
    });
    await expect(page.locator('.monaco-hover').getByText('Probe hover documentation', { exact: true }))
        .toBeVisible();
});

test('Monaco shows signature help from a language provider', async ({ page }) => {
    await openConsole(page);
    await page.evaluate(() => {
        const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
        const editor = monaco.editor.getEditors().find(editor =>
            editor.getDomNode()?.closest('.console-input'),
        )!;
        monaco.languages.registerSignatureHelpProvider(editor.getModel()!.getLanguageId(), {
            signatureHelpTriggerCharacters: ['('],
            provideSignatureHelp: () => ({
                value: {
                    signatures: [{ label: 'sum(values, offset)', parameters: [
                        { label: 'values' }, { label: 'offset' },
                    ] }],
                    activeSignature: 0,
                    activeParameter: 0,
                },
                dispose() {},
            }),
        });
        editor.setValue('sum(');
        editor.setPosition({ lineNumber: 1, column: 5 });
        editor.focus();
        editor.trigger('test', 'editor.action.triggerParameterHints', null);
    });
    await expect(page.locator('.parameter-hints-widget')).toBeVisible();
    await expect(page.locator('.parameter-hints-widget .signature')).toHaveText('sum(values, offset)');
});
