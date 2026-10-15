import { expect, test, type Page } from '@playwright/test';
import type * as Monaco from 'monaco-editor/editor';
import { ConsoleMethods, SessionMethods, createSession, registerConsoleDefaults } from '../harness/domains';
import { openWebviewPage } from '../harness/page';
import { LspTunnelMethods, type LspTunnelOpenParams, type LspTunnelMessage, type LspTunnelKey } from '../harness/protocol';

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
            editor.getDomNode()?.closest('.console-input') && editor.getModel() &&
            editor.getAction('console.submit'),
        ) ?? false;
    })).toBe(true);
    return backend;
}

async function readConsoleInput(page: Page): Promise<string> {
    return page.evaluate(() => {
        const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
        return monaco.editor.getEditors().find(editor =>
            editor.getDomNode()?.closest('.console-input'),
        )!.getValue();
    });
}

test('Console submits consecutive typed expressions with Enter using default editor settings', async ({ page }) => {
    const backend = await openConsole(page);
    await page.locator('.console-input .monaco-editor').getByRole('textbox', {
        name: 'Editor content', exact: true,
    }).focus();
    const expressions = ['1 + 1', '2 + 2'];
    for (const [index, code] of expressions.entries()) {
        await page.keyboard.type(code);
        await expect.poll(() => readConsoleInput(page)).toBe(code);
        await page.keyboard.press('Enter');
        await expect.poll(() => backend.requestCount(ConsoleMethods.submitCode)).toBe(index + 1);
        expect(backend.requests(ConsoleMethods.submitCode)[index].params).toEqual({
            sessionId: 'session-1', code, checkCompleteness: true,
        });
        await expect.poll(() => readConsoleInput(page)).toBe('');
    }
});

for (const suggestions of ['hidden', 'loading', 'empty', 'unfocused', 'enter-disabled'] as const) {
    test(`Console submits complete code with Enter when suggestions are ${suggestions}`, async ({ page }) => {
        const backend = await openConsole(page);
        await backend.notify(ConsoleMethods.restoreState, {
            sessionId: 'session-1',
            syncSeq: 1,
            state: {
                version: 1,
                items: [],
                inputHistory: [],
                trace: false,
                wordWrap: true,
                inputPrompt: '> ',
                continuationPrompt: '+ ',
                workingDirectory: '/workspace',
            },
        });
        const code = suggestions === 'hidden' ? '1 + 1' : 'pi';
        await page.evaluate(({ suggestions, code }) => {
            const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
            const editor = monaco.editor.getEditors().find(editor =>
                editor.getDomNode()?.closest('.console-input'),
            )!;
            editor.updateOptions({
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                wordBasedSuggestions: 'off',
                acceptSuggestionOnEnter: suggestions === 'enter-disabled' ? 'off' : 'on',
                suggest: { selectionMode: suggestions === 'unfocused' ? 'never' : 'always' },
            });
            monaco.languages.registerCompletionItemProvider(editor.getModel()!.getLanguageId(), {
                provideCompletionItems: async (_model, position, _context, token) => {
                    if (suggestions === 'loading') {
                        // Keep the actual provider pending until Console dismisses it.
                        await new Promise<void>(resolve => {
                            token.onCancellationRequested(() => resolve());
                        });
                        return { suggestions: [] };
                    }
                    if (suggestions === 'empty') {
                        return { suggestions: [] };
                    }
                    return { suggestions: [{
                        label: 'pi_completion',
                        kind: monaco.languages.CompletionItemKind.Constant,
                        insertText: 'pi_completion',
                        range: new monaco.Range(position.lineNumber, 1, position.lineNumber, position.column),
                    }] };
                },
            });
            editor.setValue(code);
            editor.setPosition({ lineNumber: 1, column: code.length + 1 });
            editor.focus();
            if (suggestions !== 'hidden') {
                // Monaco applies selectionMode only to automatic suggestions.
                // Loading/empty widgets need a manual trigger to remain visible.
                editor.trigger('test', 'editor.action.triggerSuggest', {
                    auto: suggestions === 'unfocused',
                });
            }
        }, { suggestions, code });

        const widget = page.locator('.console-input .monaco-editor .suggest-widget');
        if (suggestions === 'hidden') {
            await expect(widget).not.toBeVisible();
        } else {
            await expect(widget).toHaveClass(/\bvisible\b/);
            if (suggestions === 'loading' || suggestions === 'empty') {
                await expect(widget).toContainText(suggestions === 'loading' ? 'Loading...' : 'No suggestions.');
            } else {
                await expect(widget.getByText('pi_completion', { exact: true })).toBeVisible();
            }
            await expect(widget.locator('.monaco-list-row.focused'))
                .toHaveCount(suggestions === 'enter-disabled' ? 1 : 0);
        }

        // Exercise native keyboard dispatch, not the Console action directly.
        await page.keyboard.press('Enter');
        await expect.poll(() => backend.requestCount(ConsoleMethods.submitCode)).toBe(1);
        expect(backend.requests(ConsoleMethods.submitCode)[0].params).toEqual({
            sessionId: 'session-1',
            code,
            checkCompleteness: true,
        });
        await expect.poll(() => readConsoleInput(page)).toBe('');
        await expect(widget).not.toBeVisible();

        const output = suggestions === 'hidden' ? '[1] 2' : '[1] 3.141593';
        const when = Date.now();
        await backend.notify(ConsoleMethods.runtimeChanges, {
            sessionId: 'session-1',
            syncSeq: 2,
            changes: [{
                kind: 'appendRuntimeItem',
                runtimeItem: {
                    type: 'activity',
                    parentId: 'enter-execution',
                    items: [{
                        type: 'input',
                        id: 'enter-input',
                        parentId: 'enter-execution',
                        when,
                        state: 'completed',
                        inputPrompt: '> ',
                        continuationPrompt: '+ ',
                        code,
                    }, {
                        type: 'output',
                        id: 'enter-output',
                        parentId: 'enter-execution',
                        when,
                        data: { 'text/plain': output },
                    }],
                },
            }],
        });
        await expect(page.getByTestId('console-session-1').getByText(output, { exact: true })).toBeVisible();
        expect(backend.requestCount(ConsoleMethods.submitCode)).toBe(1);
    });
}

test('Console inserts a newline with Shift+Enter and submits the complete multiline code with Enter', async ({ page }) => {
    const backend = await openConsole(page);
    await page.evaluate(() => {
        const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
        const editor = monaco.editor.getEditors().find(editor =>
            editor.getDomNode()?.closest('.console-input'),
        )!;
        editor.updateOptions({ quickSuggestions: false, suggestOnTriggerCharacters: false });
        editor.focus();
    });
    await page.keyboard.type('value <- 1');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('value + 1');
    const code = 'value <- 1\nvalue + 1';
    await expect.poll(() => readConsoleInput(page)).toBe(code);
    expect(backend.requestCount(ConsoleMethods.submitCode)).toBe(0);

    await page.keyboard.press('Enter');
    await expect.poll(() => backend.requestCount(ConsoleMethods.submitCode)).toBe(1);
    expect(backend.requests(ConsoleMethods.submitCode)[0].params).toEqual({
        sessionId: 'session-1', code, checkCompleteness: true,
    });
    await expect.poll(() => readConsoleInput(page)).toBe('');
});

test('Console accepts a history match with Enter and submits it only on the next Enter', async ({ page }) => {
    const backend = await openConsole(page);
    const code = 'value <- 1';
    await backend.notify(ConsoleMethods.historyAdd, { sessionId: 'session-1', input: code });
    await page.evaluate(() => {
        const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
        const editor = monaco.editor.getEditors().find(editor =>
            editor.getDomNode()?.closest('.console-input'),
        )!;
        editor.updateOptions({ quickSuggestions: false, suggestOnTriggerCharacters: false });
        editor.focus();
    });
    await page.keyboard.type('value');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+ArrowUp');
    const history = page.getByRole('listbox', { name: 'History browser' });
    await expect(history).toBeVisible();
    await expect(history).toContainText(code);
    await page.keyboard.press('Enter');
    await expect(history).not.toBeVisible();
    await expect.poll(() => readConsoleInput(page)).toBe(code);
    expect(backend.requestCount(ConsoleMethods.submitCode)).toBe(0);

    await page.keyboard.press('Enter');
    await expect.poll(() => backend.requestCount(ConsoleMethods.submitCode)).toBe(1);
    expect(backend.requests(ConsoleMethods.submitCode)[0].params).toEqual({
        sessionId: 'session-1', code, checkCompleteness: true,
    });
    await expect.poll(() => readConsoleInput(page)).toBe('');
});

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

for (const explicitRange of [false, true]) {
    test(`Console automatically shows delayed completions while a word grows (${explicitRange ? 'LSP range' : 'default range'})`, async ({ page }) => {
        const pending: LspTunnelMessage[] = [];
        const backend = await openWebviewPage(page, 'console', {
            configure: mockBackend => {
                registerConsoleDefaults(mockBackend, { sessions: [createSession({ promptActive: false })] });
                mockBackend.onRequest(LspTunnelMethods.open, () => ({
                    supported: true, tunnelId: 'completion-test', epoch: 1,
                    configuration: { kernelCompletionFallback: false },
                }));
                mockBackend.onRequest(LspTunnelMethods.send, async request => {
                    const params = request.params as LspTunnelMessage;
                    if (params.message.method === 'initialize') {
                        await mockBackend.notify(LspTunnelMethods.message, { ...params,
                            message: { jsonrpc: '2.0', id: params.message.id, result: { capabilities: {
                                textDocumentSync: { openClose: true, change: 1 }, completionProvider: {},
                            } } },
                        });
                    } else if (params.message.method === 'textDocument/completion') {
                        // Acknowledge the outer RPC while delaying the actual LSP response.
                        pending.push(params);
                    }
                });
            },
        });
        await expect.poll(() => backend.requests(LspTunnelMethods.send).some(request =>
            (request.params as LspTunnelMessage).message.method === 'textDocument/didOpen')).toBe(true);
        await page.evaluate(() => {
            const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
            monaco.editor.getEditors().find(editor => editor.getDomNode()?.closest('.console-input'))!.focus();
        });
        await page.keyboard.type('g');
        await expect.poll(() => pending.length).toBeGreaterThan(0);
        const request = pending[0];
        await page.keyboard.type('gpl');
        const editRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
        await backend.notify(LspTunnelMethods.message, { ...request,
            message: { jsonrpc: '2.0', id: request.message.id, result: [
                { label: 'ggplot', insertText: 'ggplot',
                    ...(explicitRange ? { textEdit: { range: editRange, newText: 'ggplot' } } : {}),
                    command: { title: 'Parameter hints', command: 'editor.action.triggerParameterHints' } },
                { label: 'ggplot_requires_edit', additionalTextEdits: [{ range: editRange, newText: 'library(ggplot2)' }] },
            ] },
        });
        const widget = page.locator('.suggest-widget');
        await expect(widget.getByText('ggplot', { exact: true })).toBeVisible();
        await expect(widget.getByText('ggplot_requires_edit', { exact: true })).not.toBeVisible();
        // The popup must appear before Tab, and acceptance must replace the whole typed prefix.
        await page.keyboard.press('Tab');
        await expect.poll(() => page.evaluate(() => {
            const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
            return monaco.editor.getEditors().find(editor => editor.getDomNode()?.closest('.console-input'))!.getValue();
        })).toBe('ggplot');
    });
}

for (const key of ['Tab', 'Enter']) {
    test(`Console accepts a displayed completion with ${key} before its visible class appears`, async ({ page }) => {
        const backend = await openConsole(page);
        await page.evaluate(() => {
            const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
            const editor = monaco.editor.getEditors().find(editor =>
                editor.getDomNode()?.closest('.console-input'),
            )!;
            const model = editor.getModel()!;
            monaco.languages.registerCompletionItemProvider(model.getLanguageId(), {
                provideCompletionItems: (_model, position) => ({ suggestions: [{
                    label: 'probe_completion',
                    kind: monaco.languages.CompletionItemKind.Function,
                    insertText: 'probe_completion',
                    range: new monaco.Range(position.lineNumber, 1, position.lineNumber, position.column),
                }] }),
            });
            editor.setValue('probe_');
            editor.setPosition({ lineNumber: 1, column: 7 });
            editor.focus();
            editor.trigger('test', 'editor.action.triggerSuggest', null);
        });
        const widget = page.locator('.console-input .suggest-widget');
        await expect(widget.getByText('probe_completion', { exact: true })).toBeVisible();
        await expect(widget.locator('.monaco-list-row.focused')).toBeVisible();
        await widget.evaluate(node => {
            // Hold the presentation class absent so the 100ms startup window
            // remains reproducible even on a slow test runner.
            const observer = new MutationObserver(() => {
                if (node.classList.contains('visible')) {
                    node.classList.remove('visible');
                }
            });
            node.classList.remove('visible');
            observer.observe(node, { attributes: true, attributeFilter: ['class'] });
            // The page owns the observer; it is discarded when this test closes.
        });
        await expect(widget).not.toHaveClass(/\bvisible\b/);
        await page.keyboard.press(key);
        await expect.poll(() => page.evaluate(() => {
            const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
            return monaco.editor.getEditors().find(editor =>
                editor.getDomNode()?.closest('.console-input'),
            )!.getValue();
        })).toBe('probe_completion');
        expect(backend.requestCount(ConsoleMethods.submitCode)).toBe(0);

        // Accepting a completion must leave the next Enter available to submit it.
        await expect(widget).not.toBeVisible();
        await page.keyboard.press('Enter');
        await expect.poll(() => backend.requestCount(ConsoleMethods.submitCode)).toBe(1);
        expect(backend.requests(ConsoleMethods.submitCode)[0].params).toEqual({
            sessionId: 'session-1', code: 'probe_completion', checkCompleteness: true,
        });
        await expect.poll(() => readConsoleInput(page)).toBe('');
    });
}

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

test('Monaco scores selectors against session URI, scheme, and language through the editor-only entry', async ({ page }) => {
    await openConsole(page);
    const matches = await page.evaluate(() => {
        const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
        const selector = { language: 'r', scheme: 'inmemory', pattern: '**/session-1.r' };
        const score = (uri: string, language: string) =>
            monaco.languages.score(selector, monaco.Uri.parse(uri), language) > 0;
        return {
            ownSession: score('inmemory://console/session-1.r', 'r'),
            otherSession: score('inmemory://console/session-2.r', 'r'),
            otherScheme: score('file:///console/session-1.r', 'r'),
            otherLanguage: score('inmemory://console/session-1.r', 'python'),
        };
    });
    expect(matches).toEqual({
        ownSession: true,
        otherSession: false,
        otherScheme: false,
        otherLanguage: false,
    });
});

test('Console owns native LSP clients without language provider modules and closes deleted sessions', async ({ page }) => {
    await page.addInitScript(() => {
        (globalThis as typeof globalThis & {
            __arkLanguageMonacoSupportModules: Record<string, string>;
        }).__arkLanguageMonacoSupportModules = {};
    });
    const sessions = [
        createSession({ promptActive: false }),
        createSession({ id: 'session-2', name: 'Analytics', promptActive: false }),
    ];
    const backend = await openWebviewPage(page, 'console', {
        configure: mockBackend => {
            registerConsoleDefaults(mockBackend, { sessions, activeSessionId: 'session-1' });
            mockBackend.onRequest(LspTunnelMethods.open, request => {
                const params = request.params as LspTunnelOpenParams;
                return { supported: true, tunnelId: params.sessionId, epoch: 1 };
            });
            mockBackend.onRequest(LspTunnelMethods.send, async request => {
                const params = request.params as LspTunnelMessage;
                if (params.message.method === 'initialize') {
                    await mockBackend.notify(LspTunnelMethods.message, {
                        tunnelId: params.tunnelId, epoch: params.epoch,
                        message: { jsonrpc: '2.0', id: params.message.id,
                            result: { capabilities: { textDocumentSync: { openClose: true, change: 1 } } } },
                    });
                }
                return undefined;
            });
        },
    });
    const opened = () => backend.requests(LspTunnelMethods.send)
        .map(request => request.params as LspTunnelMessage)
        .filter(params => params.message.method === 'textDocument/didOpen');
    await expect.poll(() => opened().map(params => params.tunnelId).sort()).toEqual(['session-1', 'session-2']);
    await expect(page.locator('.console-input .monaco-editor')).toBeVisible();

    await backend.notify(SessionMethods.info, { sessions: [sessions[0]], activeSessionId: 'session-1' });
    await expect.poll(() => backend.requests(LspTunnelMethods.close)
        .some(request => (request.params as LspTunnelKey).tunnelId === 'session-2')).toBe(true);
    await expect.poll(() => page.evaluate(() => {
        const monaco = (globalThis as typeof globalThis & { monaco: typeof Monaco }).monaco;
        return Boolean(monaco.editor.getModel(monaco.Uri.parse('inmemory://console/session-session-2.r')));
    })).toBe(false);
    expect(backend.requests(LspTunnelMethods.close)
        .some(request => (request.params as LspTunnelKey).tunnelId === 'session-1')).toBe(false);
});
