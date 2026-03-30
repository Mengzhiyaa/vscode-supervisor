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
    await page.getByLabel('Restart Session').click();
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

    const executeCountBeforeReady = backend.requestCount(ConsoleMethods.execute);
    await monacoInput.press('Enter');
    await page.waitForTimeout(200);
    expect.soft(backend.requestCount(ConsoleMethods.execute)).toBe(
        executeCountBeforeReady,
    );

    await backend.notify(SessionMethods.info, {
        sessions: [readySession],
        activeSessionId: readySession.id,
    });
    await page.waitForTimeout(300);

    expect.soft(backend.requestCount(ConsoleMethods.execute)).toBe(
        executeCountBeforeReady + 1,
    );
    expect
        .soft(backend.requests(ConsoleMethods.execute).at(-1)?.params)
        .toEqual(
            expect.objectContaining({
                sessionId: readySession.id,
                code: 'value <- 1',
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

    const executeRequest = backend.waitForNextRequest(ConsoleMethods.execute);
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

    const executeRequest = backend.waitForNextRequest(ConsoleMethods.execute);
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

    const executeRequest = backend.waitForNextRequest(ConsoleMethods.execute);
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

    const executeRequest = backend.waitForNextRequest(ConsoleMethods.execute);
    await monacoInput.press('Enter');
    await expect.poll(async () => (await executeRequest).params).toEqual(
        expect.objectContaining({
            sessionId: 'session-1',
            code: 'print("hello")',
        }),
    );

    // Wait for history entry to be added (addHistoryEntry is called in submitCodeEditorWidgetCode)
    await page.waitForTimeout(200);

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
    await page.getByLabel('Delete Session').click();
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

    const executeCountBefore = backend.requestCount(ConsoleMethods.execute);
    await monacoInput.press('Enter');
    await page.waitForTimeout(200);
    expect.soft(backend.requestCount(ConsoleMethods.execute)).toBe(executeCountBefore);

    // Session-2 finishes restarting and becomes ready
    const session2Ready = { ...session2Restarting, state: 'ready' as const };
    await backend.notify(SessionMethods.info, {
        sessions: [session1, session2Ready],
        activeSessionId: 'session-2',
    });
    await page.waitForTimeout(300);

    // The deferred execute should now fire
    expect.soft(backend.requestCount(ConsoleMethods.execute)).toBe(executeCountBefore + 1);
    expect
        .soft(backend.requests(ConsoleMethods.execute).at(-1)?.params)
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
