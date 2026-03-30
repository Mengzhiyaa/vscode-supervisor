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
