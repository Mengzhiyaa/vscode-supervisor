import { expect, test } from '@playwright/test';
import { SessionMethods, VariablesMethods, createSession, createVariablesInstance, registerVariablesDefaults } from '../harness/domains';
import { clearClipboardRecords, getClipboardRecords, installClipboardMock } from '../harness/browser';
import { openWebviewPage } from '../harness/page';

test('variables bootstraps an active session and shows the empty state', async ({ page }) => {
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => {
            registerVariablesDefaults(mockBackend, {
                entriesBySession: {
                    'session-1': [],
                },
            });
        },
    });
    await expect.poll(() => backend.notificationCount(VariablesMethods.ready)).toBeGreaterThan(0);

    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(SessionMethods.info, {
        sessions: [createSession()],
        activeSessionId: 'session-1',
    });

    await expect(page.getByText('No variables have been created.')).toBeVisible();
});

test('variables filter fills the secondary action bar and shrinks with the viewport', async ({ page }) => {
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => {
            registerVariablesDefaults(mockBackend, {
                entriesBySession: {
                    'session-1': [],
                },
            });
        },
    });
    await expect.poll(() => backend.notificationCount(VariablesMethods.ready)).toBeGreaterThan(0);

    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(SessionMethods.info, {
        sessions: [
            createSession({
                name: 'A very long variables session name that must truncate',
            }),
        ],
        activeSessionId: 'session-1',
    });
    await expect(page.getByPlaceholder('Filter')).toBeVisible();

    const measureFilter = () =>
        page.evaluate(() => {
            const actionBar = document.querySelector<HTMLElement>('.secondary');
            const filter = document.querySelector<HTMLElement>(
                '.secondary .action-bar-filter-container',
            );
            const leftRegion = document.querySelector<HTMLElement>(
                '.secondary .action-bar-region.left',
            );
            if (!actionBar || !filter || !leftRegion) {
                throw new Error(
                    'Missing variables secondary action bar, session menu, or filter',
                );
            }

            const actionBarRect = actionBar.getBoundingClientRect();
            const filterRect = filter.getBoundingClientRect();
            const leftRegionRect = leftRegion.getBoundingClientRect();
            return {
                actionBarRight: actionBarRect.right,
                filterLeft: filterRect.left,
                filterRight: filterRect.right,
                filterWidth: filterRect.width,
                leftRegionRight: leftRegionRect.right,
            };
        });

    await page.setViewportSize({ width: 640, height: 480 });
    const wide = await measureFilter();

    await page.setViewportSize({ width: 280, height: 480 });
    const narrow = await measureFilter();

    expect(wide.filterWidth).toBeGreaterThan(narrow.filterWidth);
    expect(wide.filterWidth).toBeGreaterThan(150);
    expect(narrow.filterWidth).toBeGreaterThan(0);
    expect(wide.filterRight).toBeLessThanOrEqual(wide.actionBarRight);
    expect(narrow.filterRight).toBeLessThanOrEqual(narrow.actionBarRight);
    expect(narrow.filterLeft).toBeGreaterThanOrEqual(0);
    expect(narrow.leftRegionRight).toBeLessThanOrEqual(narrow.filterLeft);
});

test('variables applies entry updates and sends refresh requests from the toolbar', async ({ page }) => {
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => {
            registerVariablesDefaults(mockBackend, {
                entriesBySession: {
                    'session-1': [
                        {
                            type: 'item',
                            id: 'var-1',
                            path: ['iris'],
                            displayName: 'iris',
                            displayValue: 'data.frame',
                            displayType: 'data.frame',
                            kind: 'table',
                            hasChildren: true,
                            hasViewer: true,
                            isExpanded: false,
                        },
                    ],
                },
            });
        },
    });
    await expect.poll(() => backend.notificationCount(VariablesMethods.ready)).toBeGreaterThan(0);
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(SessionMethods.info, {
        sessions: [createSession()],
        activeSessionId: 'session-1',
    });

    await expect(page.getByText('iris')).toBeVisible();

    await backend.notify(VariablesMethods.entriesChanged, {
        sessionId: 'session-1',
        entries: [
            {
                type: 'item',
                id: 'var-2',
                path: ['mtcars'],
                displayName: 'mtcars',
                displayValue: 'data.frame',
                displayType: 'data.frame',
                kind: 'table',
                hasChildren: true,
                hasViewer: true,
                isExpanded: false,
                isRecent: true,
            },
        ],
    });

    await expect(page.getByText('mtcars')).toBeVisible();

    const refreshRequest = backend.waitForNextRequest(VariablesMethods.refresh);
    await page.getByLabel('Refresh objects').click();
    await expect.poll(async () => (await refreshRequest).params).toEqual({ sessionId: 'session-1' });
});

test('variables sends grouping, sorting, highlight, and clear requests', async ({ page }) => {
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => {
            registerVariablesDefaults(mockBackend, {
                entriesBySession: {
                    'session-1': [
                        {
                            type: 'item',
                            id: 'var-1',
                            path: ['iris'],
                            displayName: 'iris',
                            displayValue: 'data.frame',
                            displayType: 'data.frame',
                            kind: 'table',
                            hasChildren: true,
                            hasViewer: true,
                            isExpanded: false,
                        },
                    ],
                },
            });
        },
    });
    await expect.poll(() => backend.notificationCount(VariablesMethods.ready)).toBeGreaterThan(0);

    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(SessionMethods.info, {
        sessions: [createSession()],
        activeSessionId: 'session-1',
    });
    await expect(page.getByText('iris')).toBeVisible();

    const groupingRequest = backend.waitForNextRequest(VariablesMethods.setGrouping);
    await page.getByLabel('Change how variables are grouped').click();
    await page.getByText('None').click();
    expect((await groupingRequest).params).toEqual({ grouping: 'none' });

    const sortingRequest = backend.waitForNextRequest(VariablesMethods.setSorting);
    await page.getByLabel('Change how variables are sorted').click();
    await page.getByText('Size').click();
    expect((await sortingRequest).params).toEqual({ sorting: 'size' });

    const highlightRequest = backend.waitForNextRequest(VariablesMethods.setHighlightRecent);
    await page.getByLabel('Change how variables are sorted').click();
    await page.getByText('Highlight recent values').click();
    expect((await highlightRequest).params).toEqual({ highlightRecent: false });

    const clearRequest = backend.waitForNextRequest(VariablesMethods.clear);
    await page.getByLabel('Delete all objects').click();
    await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Delete', exact: true })
        .click();
    expect((await clearRequest).params).toEqual({ sessionId: 'session-1' });
});

test('variables switches active sessions and reacts to lifecycle notifications', async ({ page }) => {
    const sessions = [
        createSession({ id: 'session-1', name: 'Primary' }),
        createSession({ id: 'session-2', name: 'Analytics' }),
    ];
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => {
            registerVariablesDefaults(mockBackend, {
                entriesBySession: {
                    'session-1': [
                        {
                            type: 'item',
                            id: 'var-1',
                            path: ['iris'],
                            displayName: 'iris',
                            displayValue: 'data.frame',
                            displayType: 'data.frame',
                            kind: 'table',
                            hasChildren: true,
                            hasViewer: true,
                            isExpanded: false,
                        },
                    ],
                    'session-2': [
                        {
                            type: 'item',
                            id: 'var-2',
                            path: ['mtcars'],
                            displayName: 'mtcars',
                            displayValue: 'data.frame',
                            displayType: 'data.frame',
                            kind: 'table',
                            hasChildren: true,
                            hasViewer: true,
                            isExpanded: false,
                        },
                    ],
                },
            });
        },
    });

    await expect.poll(() => backend.notificationCount(VariablesMethods.ready)).toBeGreaterThan(0);
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-2'),
    });
    await backend.notify(SessionMethods.info, {
        sessions,
        activeSessionId: 'session-1',
    });
    await expect(page.getByText('iris')).toBeVisible();

    const setActiveSession = backend.waitForNextRequest(VariablesMethods.setActiveSession);
    await page.getByLabel('Select session to view variables from').click();
    await page.getByText('Analytics').click();
    expect((await setActiveSession).params).toEqual({ sessionId: 'session-2' });

    await backend.notify(VariablesMethods.activeInstanceChanged, {
        sessionId: 'session-2',
    });
    await expect(page.getByText('mtcars')).toBeVisible();

    await backend.notify(VariablesMethods.instanceStopped, {
        sessionId: 'session-2',
    });
    await backend.notify(SessionMethods.info, {
        sessions,
        activeSessionId: 'session-1',
    });
    await expect(page.getByText('iris')).toBeVisible();
});

test('variables sends filter, expand-collapse, clipboard, and view requests', async ({ page }) => {
    await installClipboardMock(page);
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => {
            registerVariablesDefaults(mockBackend, {
                entriesBySession: {
                    'session-1': [
                        {
                            type: 'group',
                            id: 'group-1',
                            title: 'Tables',
                            isExpanded: false,
                        },
                        {
                            type: 'item',
                            id: 'var-1',
                            path: ['iris'],
                            indentLevel: 1,
                            displayName: 'iris',
                            displayValue: 'data.frame',
                            displayType: 'data.frame',
                            kind: 'table',
                            hasChildren: true,
                            hasViewer: true,
                            isExpanded: false,
                        },
                    ],
                },
            });
        },
    });

    await expect.poll(() => backend.notificationCount(VariablesMethods.ready)).toBeGreaterThan(0);
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(SessionMethods.info, {
        sessions: [createSession()],
        activeSessionId: 'session-1',
    });
    await expect(page.getByText('iris')).toBeVisible();

    const setFilter = backend.waitForNextRequest(VariablesMethods.setFilter);
    await page.getByPlaceholder('Filter').fill('ir');
    expect((await setFilter).params).toEqual({ filterText: 'ir' });

    const expandGroup = backend.waitForNextRequest(VariablesMethods.expandGroup);
    await page.locator('.variable-group .expand-collapse-area').click();
    expect((await expandGroup).params).toEqual({
        groupId: 'group-1',
        sessionId: 'session-1',
    });

    await backend.notify(VariablesMethods.entriesChanged, {
        sessionId: 'session-1',
        entries: [
            {
                type: 'group',
                id: 'group-1',
                title: 'Tables',
                isExpanded: true,
            },
            {
                type: 'item',
                id: 'var-1',
                path: ['iris'],
                indentLevel: 1,
                displayName: 'iris',
                displayValue: 'data.frame',
                displayType: 'data.frame',
                kind: 'table',
                hasChildren: true,
                hasViewer: true,
                isExpanded: false,
            },
        ],
    });

    const expandItem = backend.waitForNextRequest(VariablesMethods.expandItem);
    await page.locator('.variable-item .expand-collapse-area').click();
    expect((await expandItem).params).toEqual({
        path: ['iris'],
        sessionId: 'session-1',
    });

    await page.locator('.variable-item').filter({ hasText: 'iris' }).click({ button: 'right' });
    const copyAsText = backend.waitForNextRequest(VariablesMethods.formatForClipboard);
    await page.getByText('Copy as Text').click();
    expect((await copyAsText).params).toEqual({
        path: ['iris'],
        format: 'text/plain',
        sessionId: 'session-1',
    });

    await page.locator('.variable-item').filter({ hasText: 'iris' }).click({ button: 'right' });
    const copyAsHtml = backend.waitForNextRequest(VariablesMethods.formatForClipboard);
    await page.getByText('Copy as HTML').click();
    expect((await copyAsHtml).params).toEqual({
        path: ['iris'],
        format: 'text/html',
        sessionId: 'session-1',
    });

    await page.locator('.variable-item').filter({ hasText: 'iris' }).click({ button: 'right' });
    const viewRequest = backend.waitForNextRequest(VariablesMethods.view);
    await page.getByText('View Data Table').click();
    expect((await viewRequest).params).toEqual({
        path: ['iris'],
        sessionId: 'session-1',
    });
});

test('variables sends collapse requests and uses the browser clipboard for copy-name and copy-value actions', async ({ page }) => {
    await installClipboardMock(page);
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => {
            registerVariablesDefaults(mockBackend, {
                entriesBySession: {
                    'session-1': [
                        {
                            type: 'group',
                            id: 'group-1',
                            title: 'Tables',
                            isExpanded: true,
                        },
                        {
                            type: 'item',
                            id: 'var-1',
                            path: ['iris'],
                            indentLevel: 1,
                            displayName: 'iris',
                            displayValue: 'data.frame',
                            displayType: 'data.frame',
                            kind: 'table',
                            hasChildren: true,
                            hasViewer: true,
                            isExpanded: true,
                        },
                    ],
                },
            });
        },
    });

    await expect.poll(() => backend.notificationCount(VariablesMethods.ready)).toBeGreaterThan(0);
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(SessionMethods.info, {
        sessions: [createSession()],
        activeSessionId: 'session-1',
    });
    await expect(page.getByText('Tables')).toBeVisible();
    await expect(page.getByText('iris')).toBeVisible();

    const collapseGroup = backend.waitForNextRequest(VariablesMethods.collapseGroup);
    await page.locator('.variable-group').filter({ hasText: 'Tables' }).click({ button: 'right' });
    await page.getByText('Collapse').click();
    expect((await collapseGroup).params).toEqual({
        groupId: 'group-1',
        sessionId: 'session-1',
    });

    const collapseItem = backend.waitForNextRequest(VariablesMethods.collapseItem);
    await page.locator('.variable-item').filter({ hasText: 'iris' }).click({ button: 'right' });
    await page.getByText('Collapse').click();
    expect((await collapseItem).params).toEqual({
        path: ['iris'],
        sessionId: 'session-1',
    });

    await clearClipboardRecords(page);
    await page.locator('.variable-item').filter({ hasText: 'iris' }).click({ button: 'right' });
    await page.getByText('Copy Name').click();
    await expect.poll(() => getClipboardRecords(page)).toEqual([
        {
            kind: 'writeText',
            text: 'iris',
        },
    ]);

    await clearClipboardRecords(page);
    await page.locator('.variable-item').filter({ hasText: 'iris' }).click({ button: 'right' });
    await page.getByText('Copy Value').click();
    await expect.poll(() => getClipboardRecords(page)).toEqual([
        {
            kind: 'writeText',
            text: 'data.frame',
        },
    ]);
});

test('variables supports keyboard selection, toggling, and viewing', async ({ page }) => {
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => {
            registerVariablesDefaults(mockBackend, {
                entriesBySession: {
                    'session-1': [
                        {
                            type: 'group',
                            id: 'group-1',
                            title: 'Tables',
                            isExpanded: false,
                        },
                        {
                            type: 'item',
                            id: 'var-1',
                            path: ['iris'],
                            indentLevel: 1,
                            displayName: 'iris',
                            displayValue: 'data.frame',
                            displayType: 'data.frame',
                            kind: 'table',
                            hasChildren: true,
                            hasViewer: true,
                            isExpanded: false,
                        },
                    ],
                },
            });
        },
    });

    await expect.poll(() => backend.notificationCount(VariablesMethods.ready)).toBeGreaterThan(0);
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(SessionMethods.info, {
        sessions: [createSession()],
        activeSessionId: 'session-1',
    });

    await page.locator('.variables-container').focus();

    const toggleGroup = backend.waitForNextRequest(VariablesMethods.expandGroup);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect((await toggleGroup).params).toEqual({
        groupId: 'group-1',
        sessionId: 'session-1',
    });

    const viewRequest = backend.waitForNextRequest(VariablesMethods.view);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect((await viewRequest).params).toEqual({
        path: ['iris'],
        sessionId: 'session-1',
    });
});

test('variables ignores entriesChanged for inactive session', async ({ page }) => {
    const sessions = [
        createSession({ id: 'session-1', name: 'Primary' }),
        createSession({ id: 'session-2', name: 'Analytics' }),
    ];
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => {
            registerVariablesDefaults(mockBackend, {
                entriesBySession: {
                    'session-1': [
                        {
                            type: 'item',
                            id: 'var-1',
                            path: ['iris'],
                            displayName: 'iris',
                            displayValue: 'data.frame',
                            displayType: 'data.frame',
                            kind: 'table',
                            hasChildren: true,
                            hasViewer: true,
                            isExpanded: false,
                        },
                    ],
                    'session-2': [],
                },
            });
        },
    });

    await expect.poll(() => backend.notificationCount(VariablesMethods.ready)).toBeGreaterThan(0);
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-2'),
    });
    await backend.notify(SessionMethods.info, {
        sessions,
        activeSessionId: 'session-1',
    });
    await expect(page.getByText('iris')).toBeVisible();

    // Session-2 receives an entriesChanged notification while session-1 is active
    await backend.notify(VariablesMethods.entriesChanged, {
        sessionId: 'session-2',
        entries: [
            {
                type: 'item',
                id: 'var-2',
                path: ['mtcars'],
                displayName: 'mtcars',
                displayValue: 'data.frame',
                displayType: 'data.frame',
                kind: 'table',
                hasChildren: true,
                hasViewer: true,
                isExpanded: false,
                isRecent: true,
            },
        ],
    });
    await page.waitForTimeout(300);

    // Session-1's 'iris' should still be visible
    await expect(page.getByText('iris')).toBeVisible();
    // Session-2's 'mtcars' should NOT appear because session-2 is not active
    await expect(page.getByText('mtcars')).toHaveCount(0);

    // Now switch to session-2 and verify its variables appear
    const setActiveSession = backend.waitForNextRequest(VariablesMethods.setActiveSession);
    await page.getByLabel('Select session to view variables from').click();
    await page.getByText('Analytics').click();
    expect((await setActiveSession).params).toEqual({ sessionId: 'session-2' });

    await backend.notify(VariablesMethods.activeInstanceChanged, {
        sessionId: 'session-2',
    });
    await expect(page.getByText('mtcars')).toBeVisible();
    // Session-1's 'iris' should no longer be visible
    await expect(page.getByText('iris')).toHaveCount(0);
});

test('variables clears entries when session is destroyed and selects remaining session', async ({ page }) => {
    const sessions = [
        createSession({ id: 'session-1', name: 'Primary' }),
        createSession({ id: 'session-2', name: 'Analytics' }),
    ];
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => {
            registerVariablesDefaults(mockBackend, {
                entriesBySession: {
                    'session-1': [
                        {
                            type: 'item',
                            id: 'var-1',
                            path: ['iris'],
                            displayName: 'iris',
                            displayValue: 'data.frame',
                            displayType: 'data.frame',
                            kind: 'table',
                            hasChildren: true,
                            hasViewer: true,
                            isExpanded: false,
                        },
                    ],
                    'session-2': [
                        {
                            type: 'item',
                            id: 'var-2',
                            path: ['mtcars'],
                            displayName: 'mtcars',
                            displayValue: 'data.frame',
                            displayType: 'data.frame',
                            kind: 'table',
                            hasChildren: true,
                            hasViewer: true,
                            isExpanded: false,
                        },
                    ],
                },
            });
        },
    });

    await expect.poll(() => backend.notificationCount(VariablesMethods.ready)).toBeGreaterThan(0);
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-2'),
    });
    await backend.notify(SessionMethods.info, {
        sessions,
        activeSessionId: 'session-2',
    });

    // Session-2 is active, mtcars is visible
    await expect(page.getByText('mtcars')).toBeVisible();

    // Session-2 is destroyed
    await backend.notify(VariablesMethods.instanceStopped, {
        sessionId: 'session-2',
    });
    await backend.notify(SessionMethods.info, {
        sessions: [sessions[0]],
        activeSessionId: 'session-1',
    });

    // UI should fall back to session-1 and show its variables
    await expect(page.getByText('iris')).toBeVisible();
    // mtcars should no longer be visible
    await expect(page.getByText('mtcars')).toHaveCount(0);
});

test('variables debounces non-empty filters and clears immediately', async ({ page }) => {
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => registerVariablesDefaults(mockBackend, {
            entriesBySession: { 'session-1': [] },
        }),
    });
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(SessionMethods.info, {
        sessions: [createSession()],
        activeSessionId: 'session-1',
    });

    const input = page.getByPlaceholder('Filter');
    await input.fill('iris');
    await page.waitForTimeout(300);
    expect(backend.requestCount(VariablesMethods.setFilter)).toBe(0);
    await expect.poll(() => backend.requestCount(VariablesMethods.setFilter)).toBe(1);

    await input.fill('');
    await expect.poll(() => backend.requestCount(VariablesMethods.setFilter)).toBe(2);
});

test('variables virtualizes long lists and navigates the selection into view', async ({ page }) => {
    const entries = Array.from({ length: 10_000 }, (_, index) => ({
        type: 'item' as const,
        id: `var-${index}`,
        path: [`var_${index}`],
        displayName: `var_${index}`,
        displayValue: String(index),
        displayType: 'number',
        kind: 'number',
        hasChildren: false,
        hasViewer: false,
    }));
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => registerVariablesDefaults(mockBackend, {
            entriesBySession: { 'session-1': entries },
        }),
    });
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(SessionMethods.info, {
        sessions: [createSession()],
        activeSessionId: 'session-1',
    });

    await expect(page.getByText('var_0', { exact: true })).toBeVisible();
    expect(await page.locator('.variable-item').count()).toBeLessThan(80);
    await page.locator('.variables-container').focus();
    await page.keyboard.press('End');
    await expect(page.getByText('var_9999', { exact: true })).toBeVisible();
    await expect(page.locator('.variable-item.selected')).toContainText('var_9999');
    expect(await page.locator('.variable-item').count()).toBeLessThan(80);
});

test('variables resets the recent highlight deadline after repeated updates', async ({ page }) => {
    const entry = {
        type: 'item' as const,
        id: 'var-1',
        path: ['iris'],
        displayName: 'iris',
        displayValue: 'data.frame',
        displayType: 'data.frame',
        kind: 'table',
        hasChildren: false,
        hasViewer: true,
        isRecent: true,
        updatedTime: 1,
    };
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => registerVariablesDefaults(mockBackend, {
            entriesBySession: { 'session-1': [entry] },
        }),
    });
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(SessionMethods.info, {
        sessions: [createSession()],
        activeSessionId: 'session-1',
    });

    const row = page.locator('.variable-item');
    await expect(row).toHaveClass(/recent/);
    await page.waitForTimeout(1_200);
    await backend.notify(VariablesMethods.entriesChanged, {
        sessionId: 'session-1',
        entries: [{ ...entry, displayValue: 'updated', updatedTime: 2 }],
    });
    await page.waitForTimeout(1_200);
    await expect(row).toHaveClass(/recent/);
    await expect(row).not.toHaveClass(/recent/, { timeout: 2_000 });
});

test('variables delays busy progress and disables rows for a closed instance', async ({ page }) => {
    await installClipboardMock(page);
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => registerVariablesDefaults(mockBackend, {
            entriesBySession: {
                'session-1': [{
                    type: 'item',
                    id: 'var-1',
                    path: ['iris'],
                    displayName: 'iris',
                    displayValue: 'data.frame',
                    displayType: 'data.frame',
                    kind: 'table',
                    hasChildren: false,
                    hasViewer: true,
                }],
            },
        }),
    });
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(SessionMethods.info, {
        sessions: [createSession()],
        activeSessionId: 'session-1',
    });
    await expect(page.getByText('iris')).toBeVisible();

    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1', { status: 'busy' }),
    });
    await page.waitForTimeout(250);
    await expect(page.locator('.variables-progress')).toHaveCount(0);
    await expect(page.locator('.variables-progress')).toBeVisible();

    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1', { state: 'closed', status: 'disconnected' }),
    });
    await expect(page.locator('.variables-progress')).toHaveCount(0);
    await expect(page.locator('.variable-item')).toHaveClass(/disabled/);
    await page.locator('.variable-item').dblclick({ force: true });
    expect(backend.requestCount(VariablesMethods.view)).toBe(0);
    await page.locator('.variable-item').click({ button: 'right', force: true });
    await expect(page.getByText('View Data Table')).toHaveCount(0);
    await page.getByText('Copy Name').click();
    await expect.poll(() => getClipboardRecords(page)).toEqual([
        { kind: 'writeText', text: 'iris' },
    ]);
});

test('variables memory meter exposes usage and opens low-memory settings', async ({ page }) => {
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => registerVariablesDefaults(mockBackend),
    });
    await backend.notify(VariablesMethods.instanceStarted, {
        instance: createVariablesInstance('session-1'),
    });
    await backend.notify(SessionMethods.info, {
        sessions: [createSession()],
        activeSessionId: 'session-1',
    });
    await backend.notify(VariablesMethods.memoryUsageEnabledChanged, { enabled: true });
    await backend.notify(VariablesMethods.memoryUsageUpdated, {
        snapshot: {
            timestamp: Date.now(),
            totalSystemMemory: 1_000,
            freeSystemMemory: 200,
            kernelSessions: [{
                sessionId: 'session-1',
                sessionName: 'Primary',
                languageId: 'r',
                memoryBytes: 300,
            }],
            kernelTotalBytes: 300,
            supervisorOverheadBytes: 100,
            extensionHostOverheadBytes: 100,
            otherProcessesBytes: 300,
            source: { providerKind: 'local', machineId: 'local' },
            lowMemory: { unit: 'percent', threshold: 25, remaining: 20 },
        },
    });

    const meter = page.getByRole('meter', { name: 'Memory usage' });
    await expect(meter).toHaveAttribute('aria-valuenow', '80');
    await page.locator('.memory-usage-meter').click();
    const dialog = page.getByRole('dialog', { name: 'Memory usage' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Less than 25% memory remaining')).toBeVisible();
    const settingsRequest = backend.waitForNextRequest(VariablesMethods.openMemorySettings);
    await dialog.getByRole('button', { name: 'Configure' }).click();
    await settingsRequest;
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.memory-usage-meter')).toBeFocused();
});

test('variables restores selection and scroll offset per session', async ({ page }) => {
    const makeEntries = (prefix: string) => Array.from({ length: 200 }, (_, index) => ({
        type: 'item' as const,
        id: `${prefix}-${index}`,
        path: [`${prefix}_${index}`],
        displayName: `${prefix}_${index}`,
        displayValue: String(index),
        displayType: 'number',
        kind: 'number',
        hasChildren: false,
        hasViewer: false,
    }));
    const sessions = [
        createSession({ id: 'session-1', name: 'Primary' }),
        createSession({ id: 'session-2', name: 'Analytics' }),
    ];
    const backend = await openWebviewPage(page, 'variables', {
        configure: (mockBackend) => registerVariablesDefaults(mockBackend, {
            entriesBySession: {
                'session-1': makeEntries('alpha'),
                'session-2': makeEntries('beta'),
            },
        }),
    });
    for (const session of sessions) {
        await backend.notify(VariablesMethods.instanceStarted, {
            instance: createVariablesInstance(session.id),
        });
    }
    await backend.notify(SessionMethods.info, { sessions, activeSessionId: 'session-1' });
    const container = page.locator('.variables-container');
    await expect(page.getByText('alpha_0', { exact: true })).toBeVisible();
    const scrollMetrics = await container.evaluate((element) => {
        element.scrollTop = 1_560;
        element.dispatchEvent(new Event('scroll'));
        return {
            scrollTop: element.scrollTop,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
        };
    });
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
    expect(scrollMetrics.scrollTop).toBe(1_560);
    await expect(container).toHaveAttribute('data-saved-scroll-offset', '1560');
    await page.getByText('alpha_60', { exact: true }).click();

    await page.getByLabel('Select session to view variables from').click();
    await page.getByText('Analytics').click();
    await backend.notify(VariablesMethods.activeInstanceChanged, { sessionId: 'session-2' });
    await expect(page.getByText('beta_0', { exact: true })).toBeVisible();

    await page.getByLabel('Select session to view variables from').click();
    await page.getByText('Primary').click();
    await backend.notify(VariablesMethods.activeInstanceChanged, { sessionId: 'session-1' });
    await expect.poll(() => container.evaluate(element => element.scrollTop)).toBeGreaterThan(1_400);
    await expect(page.getByText('alpha_60', { exact: true })).toBeVisible();
    await expect(page.locator('.variable-item.selected')).toContainText('alpha_60');
});
