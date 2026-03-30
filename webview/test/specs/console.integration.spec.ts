import { expect, test } from '@playwright/test';
import { ConsoleMethods, SessionMethods, createSession, registerConsoleDefaults } from '../harness/domains';
import { openWebviewPage } from '../harness/page';

function createConsoleState(outputText: string) {
    return {
        version: 1 as const,
        items: [
            {
                type: 'started' as const,
                id: 'runtime-started',
                when: Date.now(),
                sessionName: 'Console',
            },
            {
                type: 'activity' as const,
                parentId: 'activity-1',
                items: [
                    {
                        type: 'input' as const,
                        id: 'input-1',
                        parentId: 'activity-1',
                        when: Date.now(),
                        state: 'completed' as const,
                        inputPrompt: '> ',
                        continuationPrompt: '+ ',
                        code: '1 + 1',
                    },
                    {
                        type: 'output' as const,
                        id: 'output-1',
                        parentId: 'activity-1',
                        when: Date.now(),
                        data: {
                            'text/plain': outputText,
                        },
                    },
                ],
            },
        ],
        inputHistory: ['1 + 1'],
        trace: false,
        wordWrap: true,
        inputPrompt: '> ',
        continuationPrompt: '+ ',
        workingDirectory: '/workspace',
    };
}

function createConsoleStateWithItems(
    items: unknown[],
    overrides: Partial<ReturnType<typeof createConsoleState>> = {},
) {
    return {
        version: 1 as const,
        items,
        inputHistory: overrides.inputHistory ?? [],
        trace: overrides.trace ?? false,
        wordWrap: overrides.wordWrap ?? true,
        inputPrompt: overrides.inputPrompt ?? '> ',
        continuationPrompt: overrides.continuationPrompt ?? '+ ',
        workingDirectory: overrides.workingDirectory ?? '/workspace',
    };
}

test('console restores state and switches sessions through the sidebar', async ({ page }) => {
    const sessions = [
        createSession({ id: 'session-1', name: 'Primary' }),
        createSession({ id: 'session-2', name: 'Analytics', runtimeName: 'Python', languageId: 'python' }),
    ];
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions,
                activeSessionId: 'session-1',
            });
        },
    });
    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);

    await backend.notify(SessionMethods.info, {
        sessions,
        activeSessionId: 'session-1',
    });
    await backend.notify('console/restoreState', {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleState('session-one output'),
    });
    await backend.notify('console/restoreState', {
        sessionId: 'session-2',
        syncSeq: 1,
        state: createConsoleState('session-two output'),
    });

    await expect(page.getByText('session-one output')).toBeVisible();

    const switchRequest = backend.waitForNextRequest(SessionMethods.switch);
    await page.getByText('Analytics').click();
    const request = await switchRequest;

    expect(request.params).toEqual({ sessionId: 'session-2' });
    await backend.notify(SessionMethods.info, {
        sessions,
        activeSessionId: 'session-2',
    });
    await expect(page.getByRole('tab', { name: 'Analytics' })).toHaveAttribute(
        'aria-selected',
        'true',
    );
    await expect(page.getByText('session-two output')).toBeVisible();
});

test('console requests a full-state refresh when runtime change sync gaps appear', async ({ page }) => {
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                onRequestFullState: async (request) => {
                    await mockBackend.notify('console/restoreState', {
                        sessionId: request.sessionId,
                        syncSeq: 4,
                        state: createConsoleState('recovered output'),
                    });
                },
            });
        },
    });
    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify('console/restoreState', {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleState('initial output'),
    });

    const requestFullState = backend.waitForNextRequest(ConsoleMethods.requestFullState);
    await backend.notify('console/runtimeChanges', {
        sessionId: 'session-1',
        syncSeq: 3,
        changes: [
            {
                kind: 'appendActivityItem',
                parentId: 'activity-1',
                activityItem: {
                    type: 'stream',
                    id: 'stream-2',
                    parentId: 'activity-1',
                    when: Date.now(),
                    streamType: 'output',
                    text: 'late output',
                },
            },
        ],
    });

    const refreshRequest = await requestFullState;
    expect(refreshRequest.params).toEqual({
        sessionId: 'session-1',
        reason: 'seq gap on runtimeChanges: local=1, received=3',
    });
    await expect(page.getByText('recovered output')).toBeVisible();
});

test('console clear action sends the matching extension request', async ({ page }) => {
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend);
        },
    });
    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify('console/restoreState', {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleState('clear-me'),
    });

    const clearRequest = backend.waitForNextRequest(ConsoleMethods.clearConsole);
    await page.getByLabel('Clear Console').click();
    await expect.poll(async () => (await clearRequest).params).toEqual({ sessionId: 'session-1' });
});

test('console toolbar actions stay aligned with extension-side requests', async ({ page }) => {
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend);
        },
    });
    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    const traceEnabledState = createConsoleState('toolbar-actions');
    traceEnabledState.trace = true;
    await backend.notify('console/restoreState', {
        sessionId: 'session-1',
        syncSeq: 1,
        state: traceEnabledState,
    });

    const restartRequest = backend.waitForNextRequest(SessionMethods.restart);
    await page.getByLabel('Restart Session').click();
    await expect.poll(async () => (await restartRequest).params).toEqual({ sessionId: 'session-1' });

    const traceRequest = backend.waitForNextRequest(ConsoleMethods.toggleTrace);
    await page.getByLabel('Toggle Trace').click();
    await expect.poll(async () => (await traceRequest).params).toEqual({ sessionId: 'session-1' });

    const wrapRequest = backend.waitForNextRequest(ConsoleMethods.toggleWordWrap);
    await page.getByLabel('Toggle Word Wrap').click();
    await expect.poll(async () => (await wrapRequest).params).toEqual({ sessionId: 'session-1' });

    const openInEditorRequest = backend.waitForNextRequest('console/openInEditor');
    await page.getByLabel('Open in Editor').click();
    await expect.poll(async () => (await openInEditorRequest).params).toEqual(
        expect.objectContaining({ sessionId: 'session-1' }),
    );

    const stopRequest = backend.waitForNextRequest(SessionMethods.stop);
    await page.getByLabel('Delete Session').click();
    await expect.poll(async () => (await stopRequest).params).toEqual({ sessionId: 'session-1' });
});

test('console shows startup progress and can create a new session from the empty state', async ({ page }) => {
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [],
            });
            mockBackend.onRequest(SessionMethods.create, () => ({
                session: createSession({
                    id: 'session-new',
                    name: 'Fresh Session',
                }),
            }));
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await expect(page.getByText('Starting up...')).toBeVisible();

    await backend.notify(ConsoleMethods.runtimeStartupPhase, {
        phase: 'discovering',
        discoveredCount: 2,
    });
    await expect(page.getByText('Discovering interpreters (2)...')).toBeVisible();

    await backend.notify(ConsoleMethods.runtimeStartupPhase, {
        phase: 'complete',
    });
    await expect(page.getByText('Start Session')).toBeVisible();

    const createRequest = backend.waitForNextRequest(SessionMethods.create);
    await page.getByText('Start Session').click();
    expect((await createRequest).params).toEqual({ showRuntimePicker: true });
    await expect(page.getByText('Start Session')).toHaveCount(0);
});

test('console applies metadata updates and keeps rename and interrupt requests aligned with session tabs', async ({ page }) => {
    const sessions = [
        createSession({ id: 'session-1', name: 'Primary', state: 'busy' }),
        createSession({ id: 'session-2', name: 'Analytics' }),
    ];
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions,
                activeSessionId: 'session-1',
            });
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions,
        activeSessionId: 'session-1',
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleState('primary output'),
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-2',
        syncSeq: 1,
        state: createConsoleState('analytics output'),
    });

    await backend.notify(ConsoleMethods.sessionMetadataChanged, {
        sessionId: 'session-1',
        syncSeq: 2,
        trace: true,
        wordWrap: false,
        workingDirectory: '/workspace/updated',
        inputPrompt: '$ ',
        continuationPrompt: '+ ',
    });
    await expect(page.getByLabel('Current Working Directory')).toContainText('/workspace/updated');

    const interruptRequest = backend.waitForNextRequest(ConsoleMethods.interrupt);
    await page.getByLabel('Interrupt Execution').click();
    expect((await interruptRequest).params).toEqual({ sessionId: 'session-1' });

    const renameRequest = backend.waitForNextRequest(SessionMethods.rename);
    await page.getByRole('tab', { name: 'Analytics' }).click({ button: 'right' });
    await page.getByText('Rename...').click();
    await page.locator('.session-name-input').fill('Analytics Renamed');
    await page.keyboard.press('Enter');
    expect((await renameRequest).params).toEqual({
        sessionId: 'session-2',
        newName: 'Analytics Renamed',
    });
});

test('console executes pending, pasted, and history-driven input and supports select-all and clear shortcuts', async ({ page }) => {
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [
                    createSession({
                        promptActive: false,
                    }),
                ],
            });
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleState('existing output'),
    });
    await expect(page.locator('.console-input')).toBeVisible();
    const monacoInput = page.locator('.console-input textarea').last();
    await expect(monacoInput).toHaveCount(1);

    await backend.notify(ConsoleMethods.selectAll, {
        sessionId: 'session-1',
    });
    await expect.poll(async () => {
        return page.evaluate(() => window.getSelection()?.toString() ?? '');
    }).toContain('existing output');

    await backend.notify(ConsoleMethods.clear, {
        sessionId: 'session-1',
        reason: 'user',
    });
    await backend.notify(ConsoleMethods.focusInput, {
        sessionId: 'session-1',
    });
    await monacoInput.focus();
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: '1 + 1',
    });
    await page.waitForTimeout(200);

    const executePendingCode = backend.waitForNextRequest(ConsoleMethods.execute);
    await monacoInput.press('Enter');
    await expect.poll(async () => (await executePendingCode).params).toEqual(
        expect.objectContaining({
            sessionId: 'session-1',
            code: '1 + 1',
        }),
    );

    await backend.notify(ConsoleMethods.pasteText, {
        sessionId: 'session-1',
        text: '2 + 2',
    });
    await page.waitForTimeout(200);
    const executePastedCode = backend.waitForNextRequest(ConsoleMethods.execute);
    await monacoInput.press('Enter');
    await expect.poll(async () => (await executePastedCode).params).toEqual(
        expect.objectContaining({
            sessionId: 'session-1',
            code: '2 + 2',
        }),
    );

    await backend.notify(ConsoleMethods.historyAdd, {
        sessionId: 'session-1',
        input: 'x <- 1',
    });
    await backend.notify(ConsoleMethods.historyAdd, {
        sessionId: 'session-1',
        input: 'y <- 2',
    });
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: '',
    });
    await backend.notify(ConsoleMethods.historyNavigateUp, {
        sessionId: 'session-1',
        usingPrefixMatch: false,
    });
    await backend.notify(ConsoleMethods.historyNavigateUp, {
        sessionId: 'session-1',
        usingPrefixMatch: false,
    });
    await backend.notify(ConsoleMethods.historyNavigateDown, {
        sessionId: 'session-1',
    });
    await page.waitForTimeout(200);

    const executeHistoryCode = backend.waitForNextRequest(ConsoleMethods.execute);
    await monacoInput.press('Enter');
    await expect.poll(async () => (await executeHistoryCode).params).toEqual(
        expect.objectContaining({
            sessionId: 'session-1',
            code: 'y <- 2',
        }),
    );

    const clearRequest = backend.waitForNextRequest(ConsoleMethods.clearConsole);
    await monacoInput.press(process.platform === 'darwin' ? 'Meta+l' : 'Control+l');
    expect((await clearRequest).params).toEqual({ sessionId: 'session-1' });
});

test('console bridges prompt replies, execution reveal, output links, width updates, and output channels', async ({ page }) => {
    const sessions = [
        createSession({
            promptActive: false,
            runtimePath: '/opt/r/bin/R',
            runtimeVersion: '4.4.1',
        }),
    ];
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions,
                activeSessionId: 'session-1',
            });
            mockBackend.onRequest(SessionMethods.listOutputChannels, () => ({
                channels: ['console', 'kernel'],
            }));
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions,
        activeSessionId: 'session-1',
    });

    const now = Date.now();
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleStateWithItems([
            {
                type: 'started' as const,
                id: 'runtime-started',
                when: now,
                sessionName: 'Console',
            },
            {
                type: 'activity' as const,
                parentId: 'activity-1',
                items: [
                    {
                        type: 'input' as const,
                        id: 'input-1',
                        parentId: 'activity-1',
                        when: now + 1,
                        state: 'completed' as const,
                        inputPrompt: '> ',
                        continuationPrompt: '+ ',
                        code: 'browse()',
                    },
                    {
                        type: 'output' as const,
                        id: 'output-1',
                        parentId: 'activity-1',
                        when: now + 2,
                        data: {
                            'text/plain': 'See https://example.com/docs for details',
                        },
                    },
                ],
            },
            {
                type: 'activity' as const,
                parentId: 'activity-2',
                items: [
                    {
                        type: 'prompt' as const,
                        id: 'prompt-1',
                        parentId: 'activity-2',
                        when: now + 3,
                        prompt: 'Interrupt me: ',
                        password: false,
                        state: 'Unanswered',
                    },
                ],
            },
            {
                type: 'activity' as const,
                parentId: 'activity-3',
                items: [
                    {
                        type: 'prompt' as const,
                        id: 'prompt-2',
                        parentId: 'activity-3',
                        when: now + 4,
                        prompt: 'Reply here: ',
                        password: false,
                        state: 'Unanswered',
                    },
                ],
            },
        ]),
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.setWidthInChars)).toBeGreaterThan(0);
    await expect(page.locator('.output-hyperlink')).toHaveText('https://example.com/docs');

    const openExternal = backend.waitForNextNotification(ConsoleMethods.openExternal);
    await page.locator('.output-hyperlink').click();
    expect((await openExternal).params).toEqual({ url: 'https://example.com/docs' });

    await backend.notify(ConsoleMethods.revealExecution, {
        sessionId: 'session-1',
        executionId: 'activity-1',
    });
    await expect(page.locator('[data-execution-id="activity-1"] .activity-input')).toHaveClass(/revealed/);

    const promptInputs = page.locator('.prompt-input');
    await expect(promptInputs).toHaveCount(2);

    const interruptPrompt = backend.waitForNextRequest(ConsoleMethods.interrupt);
    await promptInputs.first().press('Control+c');
    expect((await interruptPrompt).params).toEqual({ sessionId: 'session-1' });

    const replyPrompt = backend.waitForNextRequest(ConsoleMethods.replyPrompt);
    await promptInputs.nth(1).fill('42');
    await promptInputs.nth(1).press('Enter');
    expect((await replyPrompt).params).toEqual({
        id: 'prompt-2',
        value: '42',
        sessionId: 'session-1',
    });

    const listOutputChannels = backend.waitForNextRequest(SessionMethods.listOutputChannels);
    await page.getByLabel('Console Information').click();
    expect((await listOutputChannels).params).toEqual({ sessionId: 'session-1' });

    const showOutputChannel = backend.waitForNextRequest(SessionMethods.showOutputChannel);
    await page.getByText('Show Kernel Output Channel').click();
    expect((await showOutputChannel).params).toEqual({
        sessionId: 'session-1',
        channel: 'kernel',
    });
});

test('console respects isComplete results for incomplete, invalid, unknown, and failing fragments', async ({ page }) => {
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [createSession({ promptActive: false })],
            });
            mockBackend.onRequest(ConsoleMethods.isComplete, (request) => {
                const code = String((request.params as { code?: string }).code ?? '');
                if (code.includes('needs-more')) {
                    return { status: 'incomplete' };
                }
                if (code.includes('invalid-fragment')) {
                    return { status: 'invalid' };
                }
                if (code.includes('unknown-fragment')) {
                    return { status: 'unknown' };
                }
                if (code.includes('failing-fragment')) {
                    throw new Error('completeness unavailable');
                }
                return { status: 'complete' };
            });
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleState('existing output'),
    });

    const monacoInput = page.locator('.console-input textarea').last();
    await expect(monacoInput).toHaveCount(1);
    await monacoInput.focus();

    const initialExecuteCount = backend.requestCount(ConsoleMethods.execute);

    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'needs-more',
    });
    await page.waitForTimeout(200);
    await monacoInput.press('Enter');
    await page.waitForTimeout(200);
    expect(backend.requestCount(ConsoleMethods.execute)).toBe(initialExecuteCount);

    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'invalid-fragment',
    });
    await page.waitForTimeout(200);
    const invalidExecute = backend.waitForNextRequest(ConsoleMethods.execute);
    await monacoInput.press('Enter');
    await expect.poll(async () => (await invalidExecute).params).toEqual(
        expect.objectContaining({
            sessionId: 'session-1',
            code: 'invalid-fragment',
        }),
    );

    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'unknown-fragment',
    });
    await page.waitForTimeout(200);
    const unknownExecute = backend.waitForNextRequest(ConsoleMethods.execute);
    await monacoInput.press('Enter');
    await expect.poll(async () => (await unknownExecute).params).toEqual(
        expect.objectContaining({
            sessionId: 'session-1',
            code: 'unknown-fragment',
        }),
    );

    const executedAfterUnknown = backend.requestCount(ConsoleMethods.execute);
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'failing-fragment',
    });
    await page.waitForTimeout(200);
    await monacoInput.press('Enter');
    await page.waitForTimeout(200);
    expect(backend.requestCount(ConsoleMethods.execute)).toBe(executedAfterUnknown);
    expect(backend.requestCount(ConsoleMethods.isComplete)).toBeGreaterThanOrEqual(4);
});

test('console updates pending input, resource usage, and language assets from extension notifications', async ({ page }) => {
    const sessions = [
        createSession({ id: 'session-1', name: 'Primary', promptActive: false }),
        createSession({ id: 'session-2', name: 'Analytics' }),
    ];
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions,
                activeSessionId: 'session-1',
            });
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions,
        activeSessionId: 'session-1',
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleState('primary output'),
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-2',
        syncSeq: 1,
        state: createConsoleState('analytics output'),
    });

    await backend.notify(ConsoleMethods.pendingInputChanged, {
        sessionId: 'session-1',
        code: 'queued <- 1',
        inputPrompt: '$ ',
    });
    await expect(page.locator('.pending-input')).toContainText('queued <- 1');

    await backend.notify(ConsoleMethods.pendingInputChanged, {
        sessionId: 'session-1',
        code: '',
        inputPrompt: '$ ',
    });
    await expect(page.locator('.pending-input')).toHaveCount(0);

    await backend.notify(ConsoleMethods.resourceUsage, {
        sessionId: 'session-1',
        usage: {
            cpu_percent: 25,
            memory_bytes: 1_048_576,
        },
    });
    await expect(page.getByTestId('console-tab-session-1')).toContainText('CPU');
    await expect(page.getByTestId('console-tab-session-1')).toContainText('25%');
    await expect(page.getByTestId('console-tab-session-1')).toContainText('MEM');

    await backend.notify(ConsoleMethods.languageSupportAssetsChanged, {
        modules: {
            python: '/fixtures/python-support.js',
        },
        grammars: {
            python: {
                scopeName: 'source.python',
                grammarUrl: '/fixtures/python.tmLanguage.json',
            },
        },
    });
    await expect
        .poll(() => page.evaluate(() => {
            return {
                modules: (globalThis as typeof globalThis & {
                    __arkLanguageMonacoSupportModules?: Record<string, string>;
                }).__arkLanguageMonacoSupportModules,
                grammars: (globalThis as typeof globalThis & {
                    __arkLanguageTextMateGrammars?: Record<string, {
                        scopeName: string;
                        grammarUrl: string;
                    }>;
                }).__arkLanguageTextMateGrammars,
            };
        }))
        .toEqual({
            modules: {
                python: '/fixtures/python-support.js',
            },
            grammars: {
                python: {
                    scopeName: 'source.python',
                    grammarUrl: '/fixtures/python.tmLanguage.json',
                },
            },
        });
});
