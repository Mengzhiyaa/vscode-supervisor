import { expect, test, type Page } from '@playwright/test';
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

function createLongPlainTextOutput(lineCount: number, prefix = 'line') {
    return Array.from({ length: lineCount }, (_, index) => `${prefix} ${index + 1}`).join('\n');
}

function createScrollableConsoleState(lineCount = 240) {
    return createConsoleState(createLongPlainTextOutput(lineCount));
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

async function readConsoleInputPrompts(page: Page): Promise<string[]> {
    return page.locator('.console-input .monaco-editor .line-numbers').evaluateAll((nodes) =>
        nodes
            .map((node) => node.textContent?.trim() ?? '')
            .filter((text) => text.length > 0),
    );
}

async function readConsoleScrollMetrics(
    page: Page,
    sessionId = 'session-1',
): Promise<{
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    distanceFromBottom: number;
}> {
    return page.getByTestId(`console-${sessionId}`).evaluate((node) => {
        const element = node as HTMLDivElement;
        return {
            scrollTop: element.scrollTop,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
            distanceFromBottom:
                element.scrollHeight - element.clientHeight - element.scrollTop,
        };
    });
}

async function setConsoleScrollTop(
    page: Page,
    scrollTop: number,
    sessionId = 'session-1',
): Promise<void> {
    await page.getByTestId(`console-${sessionId}`).evaluate((node, nextScrollTop) => {
        const element = node as HTMLDivElement;
        element.scrollTop = nextScrollTop as number;
        element.dispatchEvent(new Event('scroll'));
    }, scrollTop);
}

async function scrollConsoleToBottom(page: Page, sessionId = 'session-1'): Promise<void> {
    const metrics = await readConsoleScrollMetrics(page, sessionId);
    await setConsoleScrollTop(
        page,
        Math.max(0, metrics.scrollHeight - metrics.clientHeight),
        sessionId,
    );
}

async function scrollConsoleUp(
    page: Page,
    offset: number,
    sessionId = 'session-1',
): Promise<void> {
    const metrics = await readConsoleScrollMetrics(page, sessionId);
    await setConsoleScrollTop(page, Math.max(0, metrics.scrollTop - offset), sessionId);
}

function createExecutionRuntimeChange(
    executionId: string,
    code: string,
    outputText: string,
) {
    const now = Date.now();
    return {
        kind: 'appendRuntimeItem' as const,
        runtimeItem: {
            type: 'activity' as const,
            parentId: executionId,
            items: [
                {
                    type: 'input' as const,
                    id: `${executionId}-input`,
                    parentId: executionId,
                    when: now,
                    state: 'completed' as const,
                    inputPrompt: '> ',
                    continuationPrompt: '+ ',
                    code,
                },
                {
                    type: 'output' as const,
                    id: `${executionId}-output`,
                    parentId: executionId,
                    when: now + 1,
                    data: {
                        'text/plain': outputText,
                    },
                },
            ],
        },
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

test('console loads shared Monaco styles and colorizes activity input through the public API', async ({ page }) => {
    const sessions = [createSession()];
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
        state: createConsoleState('colorized output'),
    });

    await expect(page.locator('link[href="../dist/setup/index.css"]')).toHaveCount(1);
    const colorizedInput = page.locator(
        '[data-execution-id="activity-1"] .activity-input .code.colorized',
    );
    await expect(colorizedInput).toBeVisible();
    await expect.poll(() => colorizedInput.innerHTML()).toMatch(/class="mtk\d+"/u);
});

test('console copies output and copies or cuts Monaco selections before treating Ctrl+C as interrupt', async ({ page }) => {
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [createSession()],
                activeSessionId: 'session-1',
            });
        },
    });
    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);

    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleState('copy this output'),
    });
    await expect(page.getByText('copy this output')).toBeVisible();

    await page.getByTestId('console-session-1').evaluate((consoleNode) => {
        const outputNode = Array.from(
            consoleNode.querySelectorAll<HTMLElement>('*'),
        ).find((node) => node.textContent === 'copy this output');
        if (!outputNode) {
            throw new Error('Expected output node');
        }

        (consoleNode as HTMLElement).focus();
        const range = document.createRange();
        range.selectNodeContents(outputNode);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    });

    await page.keyboard.press('Control+c');
    await expect
        .poll(() => backend.requestCount(ConsoleMethods.writeClipboardText))
        .toBe(1);
    expect(
        backend.requests(ConsoleMethods.writeClipboardText).at(-1)?.params,
    ).toEqual({ text: 'copy this output' });
    expect(backend.requestCount(ConsoleMethods.interrupt)).toBe(0);

    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'alpha + beta',
    });
    await expect(page.locator('.console-input .view-lines')).toContainText(
        'alpha + beta',
    );
    await page.locator('.console-input .view-lines').click();
    await page.keyboard.press('Control+a');

    await page.keyboard.press('Control+c');
    await expect
        .poll(() => backend.requestCount(ConsoleMethods.writeClipboardText))
        .toBe(2);
    expect(
        backend.requests(ConsoleMethods.writeClipboardText).at(-1)?.params,
    ).toEqual({ text: 'alpha + beta' });
    expect(backend.requestCount(ConsoleMethods.interrupt)).toBe(0);

    await page.keyboard.press('Control+x');
    await expect
        .poll(() => backend.requestCount(ConsoleMethods.writeClipboardText))
        .toBe(3);
    expect(
        backend.requests(ConsoleMethods.writeClipboardText).at(-1)?.params,
    ).toEqual({ text: 'alpha + beta' });
    await expect(page.locator('.console-input .view-lines')).not.toContainText(
        'alpha + beta',
    );

    const interruptRequest = backend.waitForNextRequest(
        ConsoleMethods.interrupt,
    );
    await page.keyboard.press('Control+c');
    expect((await interruptRequest).params).toEqual({
        sessionId: 'session-1',
    });
});

test('console execution and runtime indicators keep semantic non-black colors', async ({ page }) => {
    const sessions = [
        createSession({ id: 'session-1', name: 'Primary', state: 'busy' }),
        createSession({
            id: 'session-2',
            name: 'Secondary',
            runtimeName: 'Python',
            languageId: 'python',
        }),
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
        state: createConsoleStateWithItems([
            {
                type: 'activity',
                parentId: 'activity-executing',
                items: [
                    {
                        type: 'input',
                        id: 'input-executing',
                        parentId: 'activity-executing',
                        when: Date.now(),
                        state: 'executing',
                        inputPrompt: '> ',
                        continuationPrompt: '+ ',
                        code: 'Sys.sleep(1)',
                    },
                ],
            },
        ]),
    });

    const executionIndicator = page.locator(
        '[data-execution-id="activity-executing"] .activity-input.executing .progress-bar',
    );
    await expect(executionIndicator).toBeVisible();
    await expect.poll(() => executionIndicator.evaluate(
        element => getComputedStyle(element).backgroundColor,
    )).toBe('rgb(46, 183, 124)');

    const runtimeStatusIcon = page
        .getByTestId('console-tab-session-1')
        .locator('.runtime-status-icon');
    await expect(runtimeStatusIcon).toBeVisible();
    await expect.poll(() => runtimeStatusIcon.evaluate(
        element => getComputedStyle(element).color,
    )).toBe('rgb(58, 121, 178)');
});

test('console follows the backend foreground session when a new session is added', async ({ page }) => {
    const initialSessions = [
        createSession({ id: 'session-1', name: 'Primary' }),
    ];
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: initialSessions,
                activeSessionId: 'session-1',
            });
        },
    });
    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);

    await backend.notify(SessionMethods.info, {
        sessions: initialSessions,
        activeSessionId: 'session-1',
    });
    await backend.notify('console/restoreState', {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleState('session-one output'),
    });
    await expect(page.getByText('session-one output')).toBeVisible();

    const nextSessions = [
        ...initialSessions,
        createSession({
            id: 'session-2',
            name: 'Fresh Session',
            runtimeName: 'Python',
            languageId: 'python',
        }),
    ];
    await backend.notify(SessionMethods.info, {
        sessions: nextSessions,
        activeSessionId: 'session-2',
    });
    await backend.notify('console/restoreState', {
        sessionId: 'session-2',
        syncSeq: 1,
        state: createConsoleState('fresh session output'),
    });

    await expect(page.getByRole('tab', { name: 'Fresh Session' })).toHaveAttribute(
        'aria-selected',
        'true',
    );
    await expect(page.getByText('fresh session output')).toBeVisible();
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

test('console renders an actionable error follow-up and sends its stable identifiers', async ({ page }) => {
    const backend = await openWebviewPage(page, 'console', {
        configure: registerConsoleDefaults,
    });
    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    const state = createConsoleState('before error');
    const activity = state.items[1];
    if (activity.type !== 'activity') { throw new Error('Expected activity state'); }
    activity.items.push({
        type: 'errorSuggestion',
        id: 'suggestion-item-1',
        parentId: 'activity-1',
        when: Date.now(),
        available: true,
        suggestions: [{ id: 'install-package:pandas', iconId: 'lightbulb', label: 'Install pandas' }],
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-1',
        syncSeq: 1,
        state,
    });

    const request = backend.waitForNextRequest(ConsoleMethods.runErrorSuggestion);
    await page.getByRole('button', { name: 'Install pandas' }).click();
    expect((await request).params).toEqual({
        sessionId: 'session-1',
        itemId: 'suggestion-item-1',
        suggestionId: 'install-package:pandas',
    });
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
    await page.getByLabel('Restart R').click();
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

test('console restart repro keeps the prompt visible and defers execute until the session is ready', async ({ page }) => {
    const readySession = createSession({
        id: 'session-1',
        name: 'Primary',
        promptActive: false,
        runtimeAttached: true,
        state: 'ready',
    });
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [readySession],
                activeSessionId: readySession.id,
            });
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [readySession],
        activeSessionId: readySession.id,
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: readySession.id,
        syncSeq: 1,
        state: createConsoleState('before restart output'),
    });

    const monacoInput = page.locator('.console-input textarea').last();
    await expect(page.locator('.console-input')).toBeVisible();
    await expect.poll(() => readConsoleInputPrompts(page)).toContain('>');

    const restartRequest = backend.waitForNextRequest(SessionMethods.restart);
    await page.getByLabel('Restart R').click();
    await expect.poll(async () => (await restartRequest).params).toEqual({
        sessionId: readySession.id,
    });

    const restartingSession = {
        ...readySession,
        state: 'restarting' as const,
    };
    await backend.notify(SessionMethods.info, {
        sessions: [restartingSession],
        activeSessionId: restartingSession.id,
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: restartingSession.id,
        syncSeq: 2,
        state: createConsoleStateWithItems([
            {
                type: 'started' as const,
                id: 'runtime-restarted',
                when: Date.now(),
                sessionName: 'Primary restarted.',
            },
            {
                type: 'startup' as const,
                id: 'runtime-banner',
                when: Date.now() + 1,
                banner: 'R version 4.4.1 (restart banner)',
                version: '4.4.1',
            },
        ]),
    });

    await expect(page.getByText('R version 4.4.1 (restart banner)')).toBeVisible();
    await expect(page.locator('.console-input')).toBeVisible();
    await page.waitForTimeout(200);
    expect.soft(await readConsoleInputPrompts(page)).toContain('>');

    await monacoInput.focus();
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: restartingSession.id,
        code: 'value <- 1',
    });
    await page.waitForTimeout(200);

    const executeCountBeforeReady = backend.requestCount(ConsoleMethods.submitCode);
    await monacoInput.press('Enter');
    await page.waitForTimeout(200);
    expect.soft(backend.requestCount(ConsoleMethods.submitCode)).toBe(
        executeCountBeforeReady,
    );

    await backend.notify(SessionMethods.info, {
        sessions: [readySession],
        activeSessionId: readySession.id,
    });
    await page.waitForTimeout(300);

    expect.soft(backend.requestCount(ConsoleMethods.submitCode)).toBe(
        executeCountBeforeReady + 1,
    );
    expect
        .soft(backend.requests(ConsoleMethods.submitCode).at(-1)?.params)
        .toEqual(
            expect.objectContaining({
                sessionId: readySession.id,
                code: 'value <- 1',
            }),
        );
});

test('console restart repro recovers after a detached runtime frame', async ({ page }) => {
    const readySession = createSession({
        id: 'session-1',
        name: 'Primary',
        promptActive: false,
        runtimeAttached: true,
        state: 'ready',
    });
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [readySession],
                activeSessionId: readySession.id,
            });
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [readySession],
        activeSessionId: readySession.id,
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: readySession.id,
        syncSeq: 1,
        state: createConsoleState('before detached restart output'),
    });

    const monacoInput = page.locator('.console-input textarea').last();
    await expect(page.locator('.console-input')).toBeVisible();
    await expect.poll(() => readConsoleInputPrompts(page)).toContain('>');

    const restartRequest = backend.waitForNextRequest(SessionMethods.restart);
    await page.getByLabel('Restart R').click();
    await expect.poll(async () => (await restartRequest).params).toEqual({
        sessionId: readySession.id,
    });

    const detachedSession = {
        ...readySession,
        state: 'exited' as const,
        runtimeAttached: false,
    };
    await backend.notify(SessionMethods.info, {
        sessions: [detachedSession],
    });

    await expect(page.locator('.console-input')).toBeHidden();

    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: detachedSession.id,
        syncSeq: 2,
        state: createConsoleStateWithItems([
            {
                type: 'started' as const,
                id: 'runtime-restarted-detached',
                when: Date.now(),
                sessionName: 'Primary restarted.',
            },
            {
                type: 'startup' as const,
                id: 'runtime-banner-detached',
                when: Date.now() + 1,
                banner: 'R version 4.4.1 (detached restart banner)',
                version: '4.4.1',
            },
        ]),
    });

    await expect(page.getByText('R version 4.4.1 (detached restart banner)')).toBeVisible();

    const startingAttachedSession = {
        ...readySession,
        state: 'starting' as const,
    };
    await backend.notify(SessionMethods.info, {
        sessions: [startingAttachedSession],
        activeSessionId: startingAttachedSession.id,
    });

    await expect(page.locator('.console-input')).toBeVisible();
    await expect.poll(() => readConsoleInputPrompts(page)).toContain('>');

    await monacoInput.focus();
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: startingAttachedSession.id,
        code: 'value <- 2',
    });
    await page.waitForTimeout(200);

    const executeCountBeforeReady = backend.requestCount(ConsoleMethods.submitCode);
    await monacoInput.press('Enter');
    await page.waitForTimeout(200);
    expect.soft(backend.requestCount(ConsoleMethods.submitCode)).toBe(
        executeCountBeforeReady,
    );

    await backend.notify(SessionMethods.info, {
        sessions: [readySession],
        activeSessionId: readySession.id,
    });
    await page.waitForTimeout(300);

    expect.soft(backend.requestCount(ConsoleMethods.submitCode)).toBe(
        executeCountBeforeReady + 1,
    );
    expect
        .soft(backend.requests(ConsoleMethods.submitCode).at(-1)?.params)
        .toEqual(
            expect.objectContaining({
                sessionId: readySession.id,
                code: 'value <- 2',
            }),
        );
});

test('console session switch repro keeps the selected tab when another session finishes restarting', async ({ page }) => {
    const primaryReady = createSession({
        id: 'session-1',
        name: 'Primary',
        promptActive: false,
        runtimeAttached: true,
        state: 'ready',
    });
    const restartingSession = createSession({
        id: 'session-2',
        name: 'Restarting Session',
        promptActive: false,
        runtimeAttached: true,
        state: 'restarting',
    });

    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [primaryReady, restartingSession],
                activeSessionId: restartingSession.id,
            });
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [primaryReady, restartingSession],
        activeSessionId: restartingSession.id,
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: primaryReady.id,
        syncSeq: 1,
        state: createConsoleState('primary output'),
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: restartingSession.id,
        syncSeq: 1,
        state: createConsoleState('restarting session output'),
    });

    await expect(page.getByRole('tab', { name: 'Restarting Session' })).toHaveAttribute(
        'aria-selected',
        'true',
    );
    await expect(page.getByText('restarting session output')).toBeVisible();

    const switchRequest = backend.waitForNextRequest(SessionMethods.switch);
    await page.getByRole('tab', { name: 'Primary' }).click();
    await expect.poll(async () => (await switchRequest).params).toEqual({
        sessionId: primaryReady.id,
    });

    await expect(page.getByRole('tab', { name: 'Primary' })).toHaveAttribute(
        'aria-selected',
        'true',
    );
    await expect(page.getByText('primary output')).toBeVisible();

    const restartedReady = {
        ...restartingSession,
        state: 'ready' as const,
    };
    await backend.notify(SessionMethods.info, {
        sessions: [primaryReady, restartedReady],
        activeSessionId: restartedReady.id,
    });
    await page.waitForTimeout(300);

    await expect(page.getByRole('tab', { name: 'Primary' })).toHaveAttribute(
        'aria-selected',
        'true',
    );
    await expect(page.getByText('primary output')).toBeVisible();
});

test('console ready-session repro keeps the standard input visible when no prompt item is active', async ({ page }) => {
    const readySession = createSession({
        id: 'session-1',
        name: 'Primary',
        promptActive: false,
        runtimeAttached: true,
        state: 'ready',
    });

    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [readySession],
                activeSessionId: readySession.id,
            });
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [readySession],
        activeSessionId: readySession.id,
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: readySession.id,
        syncSeq: 1,
        state: createConsoleState('ready output'),
    });

    await expect(page.locator('.prompt-input')).toHaveCount(0);
    await expect(page.locator('.console-input')).toBeVisible();
    await expect.poll(() => readConsoleInputPrompts(page)).toContain('>');

    const readyButPromptStuck = {
        ...readySession,
        promptActive: true,
    };
    await backend.notify(SessionMethods.info, {
        sessions: [readyButPromptStuck],
        activeSessionId: readySession.id,
    });
    await page.waitForTimeout(300);

    await expect(page.locator('.prompt-input')).toHaveCount(0);
    await expect(page.locator('.console-input')).toBeVisible();
    await expect.poll(() => readConsoleInputPrompts(page)).toContain('>');
});

test('console keeps the current position when a tall input grows after the user scrolls up', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 720 });

    const readySession = createSession({
        id: 'session-1',
        name: 'Primary',
        promptActive: false,
        runtimeAttached: true,
        state: 'ready',
    });
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [readySession],
                activeSessionId: readySession.id,
            });
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [readySession],
        activeSessionId: readySession.id,
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: readySession.id,
        syncSeq: 1,
        state: createScrollableConsoleState(),
    });

    await expect(page.locator('.console-input')).toBeVisible();
    const monacoInput = page.locator('.console-input textarea').last();
    await monacoInput.focus();

    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: readySession.id,
        code: createLongPlainTextOutput(40, 'input'),
    });
    await page.waitForTimeout(200);
    await scrollConsoleToBottom(page, readySession.id);

    await scrollConsoleUp(page, 320, readySession.id);
    const lockedMetrics = await readConsoleScrollMetrics(page, readySession.id);

    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: readySession.id,
        code: createLongPlainTextOutput(80, 'expanded'),
    });
    await page.waitForTimeout(200);

    const afterGrowth = await readConsoleScrollMetrics(page, readySession.id);
    expect(Math.abs(afterGrowth.scrollTop - lockedMetrics.scrollTop)).toBeLessThanOrEqual(4);
    expect(afterGrowth.distanceFromBottom).toBeGreaterThan(120);
});

test('console stays unlocked after Enter before the first execution output arrives', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 720 });

    const readySession = createSession({
        id: 'session-1',
        name: 'Primary',
        promptActive: false,
        runtimeAttached: true,
        state: 'ready',
    });
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [readySession],
                activeSessionId: readySession.id,
            });
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [readySession],
        activeSessionId: readySession.id,
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: readySession.id,
        syncSeq: 1,
        state: createScrollableConsoleState(),
    });

    await expect(page.locator('.console-input')).toBeVisible();
    await scrollConsoleToBottom(page, readySession.id);
    await expect
        .poll(async () => (await readConsoleScrollMetrics(page, readySession.id)).distanceFromBottom)
        .toBeLessThanOrEqual(12);

    const monacoInput = page.locator('.console-input textarea').last();
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: readySession.id,
        code: 'value <- 1',
    });
    await page.waitForTimeout(200);

    const executeRequest = backend.waitForNextRequest(ConsoleMethods.submitCode);
    await monacoInput.focus();
    await monacoInput.press('Enter');
    await expect.poll(async () => (await executeRequest).params).toEqual(
        expect.objectContaining({
            sessionId: readySession.id,
            code: 'value <- 1',
        }),
    );

    await expect
        .poll(async () => (await backend.getState<{ scrollLocked?: Record<string, boolean> }>())
            ?.scrollLocked?.[readySession.id] ?? false)
        .toBe(false);
});

test('console follows the first execution output while the user stays at the bottom', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 720 });

    const readySession = createSession({
        id: 'session-1',
        name: 'Primary',
        promptActive: false,
        runtimeAttached: true,
        state: 'ready',
    });
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [readySession],
                activeSessionId: readySession.id,
            });
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [readySession],
        activeSessionId: readySession.id,
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: readySession.id,
        syncSeq: 1,
        state: createScrollableConsoleState(),
    });

    await expect(page.locator('.console-input')).toBeVisible();
    await scrollConsoleToBottom(page, readySession.id);
    await expect
        .poll(async () => (await readConsoleScrollMetrics(page, readySession.id)).distanceFromBottom)
        .toBeLessThanOrEqual(12);

    const monacoInput = page.locator('.console-input textarea').last();
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: readySession.id,
        code: 'value <- 1',
    });
    await page.waitForTimeout(200);

    const executeRequest = backend.waitForNextRequest(ConsoleMethods.submitCode);
    await monacoInput.focus();
    await monacoInput.press('Enter');
    await expect.poll(async () => (await executeRequest).params).toEqual(
        expect.objectContaining({
            sessionId: readySession.id,
            code: 'value <- 1',
        }),
    );

    await backend.notify(ConsoleMethods.runtimeChanges, {
        sessionId: readySession.id,
        syncSeq: 2,
        changes: [
            createExecutionRuntimeChange(
                'activity-exec-follow',
                'value <- 1',
                createLongPlainTextOutput(80, 'result'),
            ),
        ],
    });

    await expect
        .poll(async () => (await readConsoleScrollMetrics(page, readySession.id)).distanceFromBottom)
        .toBeLessThanOrEqual(12);
});

test('console does not force execution output back into view after the user scrolls up', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 720 });

    const readySession = createSession({
        id: 'session-1',
        name: 'Primary',
        promptActive: false,
        runtimeAttached: true,
        state: 'ready',
    });
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [readySession],
                activeSessionId: readySession.id,
            });
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [readySession],
        activeSessionId: readySession.id,
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: readySession.id,
        syncSeq: 1,
        state: createScrollableConsoleState(),
    });

    await expect(page.locator('.console-input')).toBeVisible();
    await scrollConsoleToBottom(page, readySession.id);

    const monacoInput = page.locator('.console-input textarea').last();
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: readySession.id,
        code: 'value <- 2',
    });
    await page.waitForTimeout(200);

    const executeRequest = backend.waitForNextRequest(ConsoleMethods.submitCode);
    await monacoInput.focus();
    await monacoInput.press('Enter');
    await expect.poll(async () => (await executeRequest).params).toEqual(
        expect.objectContaining({
            sessionId: readySession.id,
            code: 'value <- 2',
        }),
    );

    await scrollConsoleUp(page, 320, readySession.id);
    const lockedMetrics = await readConsoleScrollMetrics(page, readySession.id);

    await backend.notify(ConsoleMethods.runtimeChanges, {
        sessionId: readySession.id,
        syncSeq: 2,
        changes: [
            createExecutionRuntimeChange(
                'activity-exec-locked',
                'value <- 2',
                createLongPlainTextOutput(80, 'locked'),
            ),
        ],
    });
    await page.waitForTimeout(200);

    const afterOutput = await readConsoleScrollMetrics(page, readySession.id);
    expect(Math.abs(afterOutput.scrollTop - lockedMetrics.scrollTop)).toBeLessThanOrEqual(4);
    expect(afterOutput.distanceFromBottom).toBeGreaterThan(120);
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
    await expect(page.getByText('Waiting for extensions...')).toBeVisible();
    await expect(page.getByTestId('startup-progress-bar')).toBeVisible();

    await backend.notify(ConsoleMethods.runtimeStartupPhase, {
        phase: 'discovering',
        discoveredCount: 2,
        expectedCount: 4,
        latestRuntimePath: 'C:\\Python312\\python.exe',
    });
    await expect(page.getByText(/Discovering interpreters\s*\.\.\./u)).toBeVisible();
    await expect(page.getByText('C:\\Python312\\python.exe')).toBeVisible();
    await expect(page.locator('.progress-bar')).toHaveAttribute('style', /50%/u);

    await backend.notify(ConsoleMethods.runtimeStartupPhase, {
        phase: 'awaitingTrust',
    });
    await expect(page.getByText('Cannot start consoles in Restricted Mode.')).toBeVisible();
    await expect(page.getByTestId('startup-progress-bar')).toHaveCount(0);
    await expect(page.getByText('C:\\Python312\\python.exe')).toHaveCount(0);
    const trustRequest = backend.waitForNextRequest(ConsoleMethods.requestWorkspaceTrust);
    await page.getByRole('button', { name: 'Trust this folder' }).click();
    await trustRequest;

    await backend.notify(ConsoleMethods.runtimeStartupPhase, { phase: 'starting' });
    await expect(page.getByText('Starting...')).toBeVisible();

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

    await backend.notify(ConsoleMethods.sessionMetadataChanged, {
        sessionId: 'session-1',
        syncSeq: 3,
        workingDirectory: 'C:\\Users\\me\\project',
    });
    const workingDirectory = page.getByLabel('Current Working Directory');
    await expect(workingDirectory).toContainText('C:/Users/me/project');
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async (text: string) => {
                    (globalThis as typeof globalThis & { __copiedCwd?: string })
                        .__copiedCwd = text;
                },
            },
        });
    });
    await workingDirectory.press('Enter');
    await expect
        .poll(() => page.evaluate(() =>
            (globalThis as typeof globalThis & { __copiedCwd?: string }).__copiedCwd,
        ))
        .toBe('C:\\Users\\me\\project');

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

    const executePendingCode = backend.waitForNextRequest(ConsoleMethods.submitCode);
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
    const executePastedCode = backend.waitForNextRequest(ConsoleMethods.submitCode);
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

    const executeHistoryCode = backend.waitForNextRequest(ConsoleMethods.submitCode);
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
            {
                type: 'activity' as const,
                parentId: 'activity-4',
                items: [
                    {
                        type: 'prompt' as const,
                        id: 'prompt-3',
                        parentId: 'activity-4',
                        when: now + 5,
                        prompt: 'Password: ',
                        password: true,
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

    const promptInputs = page.locator('.activity-prompt textarea.inputarea');
    await expect(promptInputs).toHaveCount(2);

    await promptInputs.first().fill('copy-me');
    await promptInputs.first().press('Control+a');
    const interruptCountBeforeCopy = backend.requestCount(ConsoleMethods.interrupt);
    await promptInputs.first().press('Control+c');
    await page.waitForTimeout(100);
    expect(backend.requestCount(ConsoleMethods.interrupt)).toBe(interruptCountBeforeCopy);

    await promptInputs.first().press('ArrowRight');
    const interruptPrompt = backend.waitForNextRequest(ConsoleMethods.interrupt);
    await promptInputs.first().press('Control+c');
    expect((await interruptPrompt).params).toEqual({ sessionId: 'session-1' });

    const replyPrompt = backend.waitForNextRequest(ConsoleMethods.replyPrompt);
    await promptInputs.nth(1).fill('base');
    await promptInputs.nth(1).evaluate((element) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', 'line-1\nline-2');
        element.dispatchEvent(
            new ClipboardEvent('paste', {
                bubbles: true,
                composed: true,
                clipboardData,
            }),
        );
    });
    await expect(
        page.locator('.activity-prompt .view-lines').nth(1),
    ).toContainText('baseline-1 line-2');
    await promptInputs.nth(1).press('Control+z');
    await promptInputs.nth(1).press('Enter');
    expect((await replyPrompt).params).toEqual({
        id: 'prompt-2',
        value: 'base',
        sessionId: 'session-1',
    });

    const passwordInput = page.locator('.activity-prompt .password-input');
    const passwordReply = backend.waitForNextRequest(ConsoleMethods.replyPrompt);
    await passwordInput.fill('secret-value');
    await passwordInput.press('Enter');
    expect((await passwordReply).params).toEqual({
        id: 'prompt-3',
        value: 'secret-value',
        sessionId: 'session-1',
    });
    await expect(page.getByText('secret-value')).toHaveCount(0);

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

test('console respects host-owned submission results for incomplete, executed, and failing fragments', async ({ page }) => {
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [createSession({ promptActive: false })],
            });
            mockBackend.onRequest(ConsoleMethods.submitCode, (request) => {
                const code = String((request.params as { code?: string }).code ?? '');
                if (code.includes('needs-more')) {
                    return { status: 'incomplete' };
                }
                if (code.includes('failing-fragment') || code.includes('rejected-fragment')) {
                    return { status: 'failed' };
                }
                return { status: 'executed' };
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

    const initialExecuteCount = backend.requestCount(ConsoleMethods.submitCode);

    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'needs-more',
    });
    await page.waitForTimeout(200);
    await monacoInput.press('Enter');
    await page.waitForTimeout(200);
    expect(backend.requestCount(ConsoleMethods.submitCode)).toBe(initialExecuteCount + 1);

    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'invalid-fragment',
    });
    await page.waitForTimeout(200);
    const invalidExecute = backend.waitForNextRequest(ConsoleMethods.submitCode);
    await monacoInput.press('Enter');
    await expect.poll(async () => (await invalidExecute).params).toEqual(
        expect.objectContaining({
            sessionId: 'session-1',
            code: 'invalid-fragment',
        }),
    );
    expect((await invalidExecute).params).not.toHaveProperty('allowIncomplete');

    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'unknown-fragment',
    });
    await page.waitForTimeout(200);
    const unknownExecute = backend.waitForNextRequest(ConsoleMethods.submitCode);
    await monacoInput.press('Enter');
    await expect.poll(async () => (await unknownExecute).params).toEqual(
        expect.objectContaining({
            sessionId: 'session-1',
            code: 'unknown-fragment',
        }),
    );

    const executedAfterUnknown = backend.requestCount(ConsoleMethods.submitCode);
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'failing-fragment',
    });
    await page.waitForTimeout(200);
    await monacoInput.press('Enter');
    await page.waitForTimeout(200);
    expect(backend.requestCount(ConsoleMethods.submitCode)).toBe(executedAfterUnknown + 1);

    const getEditorValue = () =>
        page.evaluate(() => {
            const editors = (globalThis as any).monaco?.editor?.getEditors?.();
            if (editors && editors.length > 0) {
                return editors[0].getValue();
            }
            return null;
        });

    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'rejected-fragment',
    });
    await page.waitForTimeout(200);
    const executeCountBeforeRejection =
        backend.requestCount(ConsoleMethods.submitCode);
    await monacoInput.press('Enter');

    await expect
        .poll(() => backend.requestCount(ConsoleMethods.submitCode))
        .toBe(executeCountBeforeRejection + 1);
    await expect.poll(getEditorValue).toBe('rejected-fragment');
});

test('console preserves type-ahead and shows delayed submission feedback with a transcript placeholder', async ({ page }) => {
    let resolveSubmission!: (result: { status: 'executed' }) => void;
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [createSession({ promptActive: false })],
            });
            mockBackend.onRequest(
                ConsoleMethods.submitCode,
                () => new Promise<{ status: 'executed' }>((resolve) => {
                    resolveSubmission = resolve;
                }),
            );
        },
    });
    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleState('existing output'),
    });

    const input = page.locator('.console-input textarea').last();
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'slow_call()',
    });
    const submissionRequest = backend.waitForNextRequest(ConsoleMethods.submitCode);
    await input.press('Enter');
    await submissionRequest;
    await backend.notify(ConsoleMethods.runtimeChanges, {
        sessionId: 'session-1',
        syncSeq: 2,
        changes: [{
            kind: 'appendRuntimeItem',
            runtimeItem: {
                type: 'pendingInput',
                id: 'submitting-1',
                when: Date.now(),
                inputPrompt: '> ',
                code: 'slow_call()',
                submitting: true,
            },
        }],
    });

    await expect(page.getByLabel('Submitting code')).toBeVisible();
    await expect(page.getByTestId('console-submitting-overlay')).toHaveCount(0);
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'type_ahead <- 1',
    });
    await expect(page.getByTestId('console-submitting-overlay')).toBeVisible({ timeout: 2_500 });
    resolveSubmission({ status: 'executed' });
    await expect(page.getByTestId('console-submitting-overlay')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() =>
        (globalThis as any).monaco?.editor?.getEditors?.()[0]?.getValue() ?? null,
    )).toBe('type_ahead <- 1');
});

test('console cancels a slow host submission and restores submitted code before type-ahead', async ({ page }) => {
    let resolveSubmission!: (result: { status: 'cancelled' }) => void;
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [createSession({ promptActive: false })],
            });
            mockBackend.onRequest(
                ConsoleMethods.submitCode,
                () => new Promise<{ status: 'cancelled' }>((resolve) => {
                    resolveSubmission = resolve;
                }),
            );
            mockBackend.onRequest(ConsoleMethods.cancelSubmission, () => {
                resolveSubmission({ status: 'cancelled' });
            });
        },
    });
    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleState('existing output'),
    });

    const input = page.locator('.console-input textarea').last();
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'slow_call()',
    });
    await input.press('Enter');
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'type_ahead <- 1',
    });
    await expect(page.getByTestId('console-submitting-overlay')).toBeVisible({ timeout: 2_500 });
    const cancelRequest = backend.waitForNextRequest(ConsoleMethods.cancelSubmission);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await cancelRequest;
    await expect(page.getByTestId('console-submitting-overlay')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() =>
        (globalThis as any).monaco?.editor?.getEditors?.()[0]?.getValue() ?? null,
    )).toBe('slow_call()\ntype_ahead <- 1');
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

    const runtimeIcon = page
        .getByTestId('console-tab-session-1')
        .locator('.language-icon');
    await backend.notify(ConsoleMethods.themeChanged, {
        theme: {
            base: 'vs-dark',
            rules: [],
            fileIconThemeSettingsId: 'vs-seti',
        },
    });
    await expect(runtimeIcon).toHaveClass(/seti-icon-theme-active/);
    await backend.notify(ConsoleMethods.themeChanged, {
        theme: {
            base: 'vs-dark',
            rules: [],
            fileIconThemeSettingsId: 'material-icon-theme',
        },
    });
    await expect(runtimeIcon).not.toHaveClass(/seti-icon-theme-active/);

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

test('console aligns single-session resource usage with the red interrupt action and persists its context toggle', async ({ page }) => {
    const session = createSession({
        id: 'session-1',
        name: 'Primary',
        state: 'busy',
    });
    const backend = await openWebviewPage(page, 'console', {
        configure: mockBackend => {
            registerConsoleDefaults(mockBackend, {
                sessions: [session],
                activeSessionId: session.id,
                settings: {
                    scrollbackSize: 1000,
                    fontFamily: 'var(--vscode-editor-font-family)',
                    fontSize: 13,
                    lineHeight: 1.4,
                    showResourceMonitor: true,
                },
            });
            mockBackend.onRequest(ConsoleMethods.setShowResourceMonitor, () => undefined);
        },
    });

    await backend.notify(SessionMethods.info, {
        sessions: [session],
        activeSessionId: session.id,
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: session.id,
        syncSeq: 1,
        state: createConsoleState('primary output'),
    });
    await backend.notify(ConsoleMethods.resourceUsage, {
        sessionId: session.id,
        usage: { cpu_percent: 42, memory_bytes: 2_097_152 },
    });

    const monitor = page.locator('.console-resource-monitor');
    const interrupt = page.getByLabel('Interrupt Execution');
    await expect(monitor).toHaveAttribute(
        'aria-label',
        'Runtime resource usage: CPU 42%, memory 2097152 bytes',
    );
    await expect(monitor).toContainText('2.00MB');
    await expect(interrupt).toBeVisible();


    const actionPositions = await page.evaluate(() => {
        const interruptElement = document.querySelector(
            '[aria-label="Interrupt Execution"]',
        );
        const monitorElement = document.querySelector(
            '.console-resource-monitor',
        );
        const restartElement = document.querySelector(
            '[aria-label="Restart R"]',
        );
        if (!interruptElement || !monitorElement || !restartElement) {
            throw new Error('Expected console action bar controls');
        }
        const interruptRect = interruptElement.getBoundingClientRect();
        const monitorRect = monitorElement.getBoundingClientRect();
        const restartRect = restartElement.getBoundingClientRect();
        return {
            interruptRight: interruptRect.right,
            monitorLeft: monitorRect.left,
            monitorRight: monitorRect.right,
            restartLeft: restartRect.left,
        };
    });
    expect(actionPositions.monitorLeft).toBeGreaterThanOrEqual(
        actionPositions.interruptRight,
    );
    expect(actionPositions.restartLeft).toBeGreaterThanOrEqual(
        actionPositions.monitorRight,
    );

    const interruptColors = await interrupt
        .locator('.action-bar-button-icon')
        .evaluate(element => {
            const expectedColorProbe = document.createElement('span');
            expectedColorProbe.style.color =
                'var(--vscode-errorForeground, #f44747)';
            document.body.append(expectedColorProbe);
            const colors = {
                actual: getComputedStyle(element, '::before').color,
                expected: getComputedStyle(expectedColorProbe).color,
            };
            expectedColorProbe.remove();
            return colors;
        });
    expect(interruptColors.actual).toBe(interruptColors.expected);

    const toggleRequest = backend.waitForNextRequest(ConsoleMethods.setShowResourceMonitor);
    await monitor.click({ button: 'right' });
    await page.getByText('Show Resource Monitor', { exact: true }).click();
    await expect.poll(async () => (await toggleRequest).params).toEqual({ visible: false });

    await backend.notify(ConsoleMethods.settingsChanged, {
        scrollbackSize: 1000,
        fontFamily: 'var(--vscode-editor-font-family)',
        fontSize: 13,
        lineHeight: 1.4,
        showResourceMonitor: false,
    });
    await expect(monitor).toHaveCount(0);
});

test('console find caps matches, handles regex edges, navigates in Positron direction, and resizes', async ({ page }) => {
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => registerConsoleDefaults(mockBackend),
    });
    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleState(createLongPlainTextOutput(1001, 'needle')),
    });

    const panel = page.getByTestId('console-session-1');
    await panel.focus();
    await panel.press('Control+f');
    const findInput = page.getByPlaceholder('Find');
    await findInput.fill('needle');
    await expect(page.getByText('1 of 1000+')).toBeVisible();
    await findInput.press('Shift+Enter');
    await expect(page.getByText('2 of 1000+')).toBeVisible();
    await findInput.press('Enter');
    await expect(page.getByText('1 of 1000+')).toBeVisible();

    await page.getByRole('button', { name: 'Use Regular Expression' }).click();
    await findInput.fill('(?=needle)');
    await expect(page.getByText('No results')).toBeVisible();
    await findInput.fill('[');
    await expect(page.getByText('Invalid regex')).toBeVisible();

    const shell = page.locator('.search-widget-shell');
    const before = await shell.boundingBox();
    const handle = page.getByRole('separator', { name: 'Resize Find' });
    const box = await handle.boundingBox();
    if (!before || !box) throw new Error('Find resize geometry unavailable');
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x - 80, box.y + 8);
    await page.mouse.up();
    await expect.poll(async () => (await shell.boundingBox())?.width ?? 0).toBeGreaterThan(before.width + 50);
    await findInput.press('Escape');
    await expect(findInput).toHaveCount(0);

    await backend.notify(ConsoleMethods.findCommand, { command: 'focus' });
    await expect(findInput).toBeVisible();
    await findInput.fill('needle');
    await expect(page.getByText('1 of 1000+')).toBeVisible();
    await backend.notify(ConsoleMethods.findCommand, { command: 'next' });
    await expect(page.getByText('2 of 1000+')).toBeVisible();
    await backend.notify(ConsoleMethods.findCommand, { command: 'previous' });
    await expect(page.getByText('1 of 1000+')).toBeVisible();
    await backend.notify(ConsoleMethods.findCommand, { command: 'close' });
    await expect(findInput).toHaveCount(0);
});

test('console splitter enforces the 60px minimum and one-fifth maximum with keyboard resizing', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    const sessions = [
        createSession({ id: 'session-1', createdTimestamp: 1 }),
        createSession({ id: 'session-2', name: 'Second', createdTimestamp: 2 }),
    ];
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => registerConsoleDefaults(mockBackend, {
            sessions,
            activeSessionId: 'session-1',
        }),
    });
    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, { sessions, activeSessionId: 'session-1' });

    const splitter = page.getByRole('button', { name: 'Resize console session list' });
    const tabs = page.getByRole('tablist');
    await splitter.press('Home');
    await expect.poll(async () => (await tabs.boundingBox())?.width ?? 0).toBeLessThanOrEqual(200);
    await expect.poll(async () => (await tabs.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(190);
    await splitter.press('End');
    await expect.poll(async () => (await tabs.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(59);
    await expect.poll(async () => (await tabs.boundingBox())?.width ?? 0).toBeLessThanOrEqual(70);
});

test('console navigates input history with ArrowUp and ArrowDown keyboard events', async ({ page }) => {
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

    // Restore state with NO inputHistory so only explicit historyAdd entries exist
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleStateWithItems([
            {
                type: 'started' as const,
                id: 'runtime-started',
                when: Date.now(),
                sessionName: 'Console',
            },
        ]),
    });
    await expect(page.locator('.console-input')).toBeVisible();
    const monacoInput = page.locator('.console-input textarea').last();
    await expect(monacoInput).toHaveCount(1);

    // Add history entries via RPC (simulating entries from previous executions)
    await backend.notify(ConsoleMethods.historyAdd, {
        sessionId: 'session-1',
        input: 'first_command <- 1',
    });
    await backend.notify(ConsoleMethods.historyAdd, {
        sessionId: 'session-1',
        input: 'second_command <- 2',
    });
    await backend.notify(ConsoleMethods.historyAdd, {
        sessionId: 'session-1',
        input: 'third_command <- 3',
    });
    await page.waitForTimeout(200);

    // Focus the Monaco editor
    await monacoInput.focus();
    await page.waitForTimeout(100);

    // Helper: read the current Monaco editor value
    const getEditorValue = () =>
        page.evaluate(() => {
            const editors = (globalThis as any).monaco?.editor?.getEditors?.();
            if (editors && editors.length > 0) {
                return editors[0].getValue();
            }
            return null;
        });

    // ArrowUp should show the most recent history entry (third_command)
    await monacoInput.press('ArrowUp');
    await expect.poll(getEditorValue).toBe('third_command <- 3');

    // ArrowUp again should show the second most recent (second_command)
    await monacoInput.press('ArrowUp');
    await expect.poll(getEditorValue).toBe('second_command <- 2');

    // ArrowUp again should show the oldest (first_command)
    await monacoInput.press('ArrowUp');
    await expect.poll(getEditorValue).toBe('first_command <- 1');

    // ArrowUp at the oldest should stay at the oldest
    await monacoInput.press('ArrowUp');
    await expect.poll(getEditorValue).toBe('first_command <- 1');

    // ArrowDown should go back to second_command
    await monacoInput.press('ArrowDown');
    await expect.poll(getEditorValue).toBe('second_command <- 2');

    // ArrowDown should go back to third_command
    await monacoInput.press('ArrowDown');
    await expect.poll(getEditorValue).toBe('third_command <- 3');

    // ArrowDown past the end should restore the empty input
    await monacoInput.press('ArrowDown');
    await expect.poll(getEditorValue).toBe('');
});

test('console navigates restored inputHistory entries with ArrowUp keyboard events', async ({ page }) => {
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

    // Restore state WITH inputHistory (simulating a reload that restores previous session history)
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleState('restored output'),
    });
    await expect(page.locator('.console-input')).toBeVisible();
    const monacoInput = page.locator('.console-input textarea').last();
    await expect(monacoInput).toHaveCount(1);

    // Wait for the async historySet command from restoreConsoleState
    await page.waitForTimeout(300);

    // Focus the Monaco editor
    await monacoInput.focus();
    await page.waitForTimeout(100);

    // Helper: read the current Monaco editor value
    const getEditorValue = () =>
        page.evaluate(() => {
            const editors = (globalThis as any).monaco?.editor?.getEditors?.();
            if (editors && editors.length > 0) {
                return editors[0].getValue();
            }
            return null;
        });

    // ArrowUp should show the inputHistory entry '1 + 1' from createConsoleState
    await monacoInput.press('ArrowUp');
    await expect.poll(getEditorValue).toBe('1 + 1');

    // ArrowDown past the end should restore the empty input
    await monacoInput.press('ArrowDown');
    await expect.poll(getEditorValue).toBe('');
});

test('console recalls executed code with ArrowUp after Enter execution', async ({ page }) => {
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
        state: createConsoleStateWithItems([
            {
                type: 'started' as const,
                id: 'runtime-started',
                when: Date.now(),
                sessionName: 'Console',
            },
        ]),
    });
    await expect(page.locator('.console-input')).toBeVisible();
    const monacoInput = page.locator('.console-input textarea').last();
    await expect(monacoInput).toHaveCount(1);

    const getEditorValue = () =>
        page.evaluate(() => {
            const editors = (globalThis as any).monaco?.editor?.getEditors?.();
            if (editors && editors.length > 0) {
                return editors[0].getValue();
            }
            return null;
        });

    // Type code and execute it
    await monacoInput.focus();
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-1',
        code: 'print("hello")',
    });
    await page.waitForTimeout(200);

    const executeRequest = backend.waitForNextRequest(ConsoleMethods.submitCode);
    await monacoInput.press('Enter');
    await expect.poll(async () => (await executeRequest).params).toEqual(
        expect.objectContaining({
            sessionId: 'session-1',
            code: 'print("hello")',
        }),
    );

    // The extension host is the history authority and notifies the webview only
    // after it accepts the execution.
    await backend.notify(ConsoleMethods.historyAdd, {
        sessionId: 'session-1',
        input: 'print("hello")',
    });

    // ArrowUp should recall the executed code
    await monacoInput.press('ArrowUp');
    await expect.poll(getEditorValue).toBe('print("hello")');

    // ArrowDown should go back to empty
    await monacoInput.press('ArrowDown');
    await expect.poll(getEditorValue).toBe('');
});

test('console handles complete session lifecycle: create → switch → destroy → fallback', async ({ page }) => {
    const session1 = createSession({ id: 'session-1', name: 'Primary' });
    const session2 = createSession({ id: 'session-2', name: 'Analytics', runtimeName: 'Python', languageId: 'python' });
    const session3 = createSession({ id: 'session-3', name: 'Modeling', runtimeName: 'Python', languageId: 'python' });

    // Start with all three sessions so switch handler knows about all of them
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [session1, session2, session3],
                activeSessionId: 'session-1',
            });
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [session1, session2, session3],
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
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-3',
        syncSeq: 1,
        state: createConsoleState('modeling output'),
    });
    await expect(page.getByText('primary output')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Primary' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Analytics' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Modeling' })).toBeVisible();

    // Phase 2: User switches to session-3
    const switchRequest = backend.waitForNextRequest(SessionMethods.switch);
    await page.getByRole('tab', { name: 'Modeling' }).click();
    expect((await switchRequest).params).toEqual({ sessionId: 'session-3' });
    await backend.notify(SessionMethods.info, {
        sessions: [session1, session2, session3],
        activeSessionId: 'session-3',
    });
    await expect(page.getByRole('tab', { name: 'Modeling' })).toHaveAttribute(
        'aria-selected',
        'true',
    );
    await expect(page.getByText('modeling output')).toBeVisible();

    // Phase 3: session-1 is destroyed — switch to it first, then use toolbar button
    const switch2 = backend.waitForNextRequest(SessionMethods.switch);
    await page.getByRole('tab', { name: 'Primary' }).click();
    expect((await switch2).params).toEqual({ sessionId: 'session-1' });
    await backend.notify(SessionMethods.info, {
        sessions: [session1, session2, session3],
        activeSessionId: 'session-1',
    });
    await expect(page.getByRole('tab', { name: 'Primary' })).toHaveAttribute(
        'aria-selected',
        'true',
    );

    const stopRequest = backend.waitForNextRequest(SessionMethods.stop);
    await page
        .getByRole('tab', { name: 'Primary' })
        .getByRole('button', { name: 'Delete Session' })
        .click();
    expect((await stopRequest).params).toEqual({ sessionId: 'session-1' });

    await backend.notify(SessionMethods.info, {
        sessions: [session2, session3],
        activeSessionId: 'session-3',
    });
    await page.waitForTimeout(300);

    // Verify session-1 tab is gone, remaining sessions are present
    await expect(page.getByRole('tab', { name: 'Primary' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Modeling' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Analytics' })).toBeVisible();
});

test('console input history is isolated between sessions', async ({ page }) => {
    const sessions = [
        createSession({ id: 'session-1', name: 'Primary', promptActive: false }),
        createSession({ id: 'session-2', name: 'Analytics', promptActive: false }),
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
        state: createConsoleStateWithItems([
            {
                type: 'started' as const,
                id: 'runtime-started-1',
                when: Date.now(),
                sessionName: 'Primary',
            },
        ], { inputHistory: ['session1_cmd_a', 'session1_cmd_b'] }),
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-2',
        syncSeq: 1,
        state: createConsoleStateWithItems([
            {
                type: 'started' as const,
                id: 'runtime-started-2',
                when: Date.now(),
                sessionName: 'Analytics',
            },
        ], { inputHistory: ['session2_cmd_x', 'session2_cmd_y'] }),
    });

    await expect(page.locator('.console-input')).toBeVisible();
    const monacoInput = page.locator('.console-input textarea').last();
    await expect(monacoInput).toHaveCount(1);
    await page.waitForTimeout(300);

    const getEditorValue = () =>
        page.evaluate(() => {
            const editors = (globalThis as any).monaco?.editor?.getEditors?.();
            if (editors && editors.length > 0) {
                return editors[0].getValue();
            }
            return null;
        });

    // Session-1 is active: ArrowUp should yield session-1's history
    await monacoInput.focus();
    await monacoInput.press('ArrowUp');
    await expect.poll(getEditorValue).toBe('session1_cmd_b');

    await monacoInput.press('ArrowUp');
    await expect.poll(getEditorValue).toBe('session1_cmd_a');

    // Go back to empty
    await monacoInput.press('ArrowDown');
    await monacoInput.press('ArrowDown');
    await expect.poll(getEditorValue).toBe('');

    // Switch to session-2
    const switchRequest = backend.waitForNextRequest(SessionMethods.switch);
    await page.getByRole('tab', { name: 'Analytics' }).click();
    expect((await switchRequest).params).toEqual({ sessionId: 'session-2' });
    await backend.notify(SessionMethods.info, {
        sessions,
        activeSessionId: 'session-2',
    });
    await page.waitForTimeout(300);

    // Session-2 is now active: ArrowUp should yield session-2's history
    const monacoInput2 = page.locator('.console-input textarea').last();
    await monacoInput2.focus();
    await monacoInput2.press('ArrowUp');
    await expect.poll(getEditorValue).toBe('session2_cmd_y');

    await monacoInput2.press('ArrowUp');
    await expect.poll(getEditorValue).toBe('session2_cmd_x');
});

test('console correctly renders active session when both sessions restore concurrently', async ({ page }) => {
    const sessions = [
        createSession({ id: 'session-1', name: 'Primary' }),
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

    // Send both restoreState notifications back-to-back without awaiting
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-2',
        syncSeq: 1,
        state: createConsoleState('session-two output'),
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-1',
        syncSeq: 1,
        state: createConsoleState('session-one output'),
    });

    // Active session is session-1, so its content should be visible
    await expect(page.getByText('session-one output')).toBeVisible();

    // Verify the correct tab is selected (session-1 = Primary)
    await expect(page.getByRole('tab', { name: 'Primary' })).toHaveAttribute(
        'aria-selected',
        'true',
    );
    // Session-2's tab should NOT be selected
    await expect(page.getByRole('tab', { name: 'Analytics' })).toHaveAttribute(
        'aria-selected',
        'false',
    );
});

test('console safely handles switching to a restarting session and defers execute', async ({ page }) => {
    const session1 = createSession({
        id: 'session-1',
        name: 'Primary',
        promptActive: false,
        runtimeAttached: true,
        state: 'ready',
    });
    const session2Restarting = createSession({
        id: 'session-2',
        name: 'Analytics',
        promptActive: false,
        runtimeAttached: true,
        state: 'restarting',
    });

    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions: [session1, session2Restarting],
                activeSessionId: 'session-1',
            });
        },
    });

    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [session1, session2Restarting],
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
        state: createConsoleStateWithItems([
            {
                type: 'started' as const,
                id: 'runtime-restarted',
                when: Date.now(),
                sessionName: 'Analytics restarting...',
            },
        ]),
    });
    await expect(page.getByText('primary output')).toBeVisible();

    // User switches to the restarting session
    const switchRequest = backend.waitForNextRequest(SessionMethods.switch);
    await page.getByRole('tab', { name: 'Analytics' }).click();
    expect((await switchRequest).params).toEqual({ sessionId: 'session-2' });
    await backend.notify(SessionMethods.info, {
        sessions: [session1, session2Restarting],
        activeSessionId: 'session-2',
    });
    await page.waitForTimeout(200);

    // The console input should still be visible even during restart
    await expect(page.locator('.console-input')).toBeVisible();
    const monacoInput = page.locator('.console-input textarea').last();

    // Try to execute code — it should be deferred because session is restarting
    await monacoInput.focus();
    await backend.notify(ConsoleMethods.setPendingCode, {
        sessionId: 'session-2',
        code: 'deferred_code <- 1',
    });
    await page.waitForTimeout(200);

    const executeCountBefore = backend.requestCount(ConsoleMethods.submitCode);
    await monacoInput.press('Enter');
    await page.waitForTimeout(200);
    expect.soft(backend.requestCount(ConsoleMethods.submitCode)).toBe(executeCountBefore);

    // Session-2 finishes restarting and becomes ready
    const session2Ready = { ...session2Restarting, state: 'ready' as const };
    await backend.notify(SessionMethods.info, {
        sessions: [session1, session2Ready],
        activeSessionId: 'session-2',
    });
    await page.waitForTimeout(300);

    // The deferred execute should now fire
    expect.soft(backend.requestCount(ConsoleMethods.submitCode)).toBe(executeCountBefore + 1);
    expect
        .soft(backend.requests(ConsoleMethods.submitCode).at(-1)?.params)
        .toEqual(
            expect.objectContaining({
                sessionId: 'session-2',
                code: 'deferred_code <- 1',
            }),
        );
});

test('console tracks syncSeq independently per session', async ({ page }) => {
    const sessions = [
        createSession({ id: 'session-1', name: 'Primary' }),
        createSession({ id: 'session-2', name: 'Analytics' }),
    ];
    const backend = await openWebviewPage(page, 'console', {
        configure: (mockBackend) => {
            registerConsoleDefaults(mockBackend, {
                sessions,
                activeSessionId: 'session-1',
                onRequestFullState: async (request) => {
                    await mockBackend.notify('console/restoreState', {
                        sessionId: request.sessionId,
                        syncSeq: 4,
                        state: createConsoleState(`recovered ${request.sessionId}`),
                    });
                },
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
        state: createConsoleState('session-1 output'),
    });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: 'session-2',
        syncSeq: 1,
        state: createConsoleState('session-2 output'),
    });

    // Send a sequential runtimeChanges for session-1 (syncSeq 2) — should be accepted normally
    await backend.notify('console/runtimeChanges', {
        sessionId: 'session-1',
        syncSeq: 2,
        changes: [
            {
                kind: 'appendActivityItem',
                parentId: 'activity-1',
                activityItem: {
                    type: 'stream',
                    id: 'stream-s1',
                    parentId: 'activity-1',
                    when: Date.now(),
                    streamType: 'output',
                    text: 'sequential update',
                },
            },
        ],
    });
    await page.waitForTimeout(200);

    // No fullState request should be triggered for session-1
    const fullStateRequests = backend.requests(ConsoleMethods.requestFullState);
    const session1FullStateRequests = fullStateRequests.filter(
        (r) => (r.params as { sessionId: string }).sessionId === 'session-1',
    );
    expect(session1FullStateRequests.length).toBe(0);

    // Now send a gap runtimeChanges for session-2 (syncSeq 3, skipping 2) — should trigger fullState
    const requestFullState = backend.waitForNextRequest(ConsoleMethods.requestFullState);
    await backend.notify('console/runtimeChanges', {
        sessionId: 'session-2',
        syncSeq: 3,
        changes: [
            {
                kind: 'appendActivityItem',
                parentId: 'activity-1',
                activityItem: {
                    type: 'stream',
                    id: 'stream-s2',
                    parentId: 'activity-1',
                    when: Date.now(),
                    streamType: 'output',
                    text: 'gap update',
                },
            },
        ],
    });

    const refreshRequest = await requestFullState;
    expect(refreshRequest.params).toEqual({
        sessionId: 'session-2',
        reason: 'seq gap on runtimeChanges: local=1, received=3',
    });
});
