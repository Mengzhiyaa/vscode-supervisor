import { expect, test } from '@playwright/test';
import {
    PlotsMethods,
    SMALL_PNG_DATA_URI,
    SessionMethods,
    createPreviewFixtureUrl,
    createSession,
    registerPlotsDefaults,
} from '../harness/domains';
import {
    clearClipboardRecords,
    getClipboardRecords,
    installClipboardMock,
} from '../harness/browser';
import { openWebviewPage } from '../harness/page';

test('plots loads initial history and renders a static plot', async ({ page }) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-1',
                        sessionId: 'session-1',
                        kind: 'static',
                        initialData: SMALL_PNG_DATA_URI,
                        name: 'Cars Plot',
                    },
                ],
            });
        },
    });
    await expect.poll(() => backend.notificationCount(PlotsMethods.ready)).toBeGreaterThan(0);

    await backend.notify(SessionMethods.info, {
        sessions: [createSession({ name: 'Exploration' })],
        activeSessionId: 'session-1',
    });

    await expect(page.locator('img.plot')).toBeVisible();
    await expect(page.getByText('Exploration')).toBeVisible();
    await expect(page.getByText('Cars Plot', { exact: true })).toBeVisible();
});

test('plots emits HTML lifecycle events and clear requests for HTML plots', async ({ page }) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-html',
                        sessionId: 'session-1',
                        kind: 'html',
                        htmlUri: createPreviewFixtureUrl(),
                        name: 'HTML Plot',
                    },
                ],
            });
        },
    });
    await expect.poll(() => backend.notificationCount(PlotsMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [createSession()],
        activeSessionId: 'session-1',
    });

    await expect.poll(() => backend.requestCount(PlotsMethods.claimHtmlPlot)).toBeGreaterThan(0);
    const claimRequest = backend.requests(PlotsMethods.claimHtmlPlot)[0];
    expect(claimRequest.params).toEqual({ plotId: 'plot-html' });

    await expect
        .poll(() => backend.notificationCount(PlotsMethods.layoutHtmlPlot))
        .toBeGreaterThan(0);
    const layoutNotification = backend.notifications(PlotsMethods.layoutHtmlPlot)[0];
    expect(layoutNotification.params).toMatchObject({
        plotId: 'plot-html',
    });

    await backend.notify(PlotsMethods.htmlPlotStateChanged, {
        plotId: 'plot-html',
        active: true,
    });
    await expect(page.locator('iframe.plot-html-frame')).toBeVisible();
    await backend.notify(PlotsMethods.htmlPlotStateChanged, {
        plotId: 'plot-html',
        active: false,
    });
    await expect(page.locator('iframe.plot-html-frame')).toHaveCount(0);
    await expect(page.getByText('Activating interactive plot…')).toBeVisible();

    const clearRequest = backend.waitForNextRequest(PlotsMethods.clear);
    await page.getByLabel('Clear all plots').click();
    await expect.poll(async () => (await clearRequest).method).toBe(PlotsMethods.clear);
});

test('plots requests initial preferences and uses the preferred editor target from the backend', async ({
    page,
}) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-1',
                        sessionId: 'session-1',
                        kind: 'static',
                        initialData: SMALL_PNG_DATA_URI,
                        name: 'Cars Plot',
                    },
                ],
                selectedPlotId: 'plot-1',
            });
            mockBackend.onRequest(PlotsMethods.getHistoryState, () => ({
                policy: 'always',
                position: 'right',
            }));
            mockBackend.onRequest(PlotsMethods.getDarkFilterMode, () => ({
                mode: 'off',
            }));
            mockBackend.onRequest(PlotsMethods.getPreferredEditorTarget, () => ({
                target: 'sideGroup',
            }));
        },
    });

    await expect.poll(() => backend.notificationCount(PlotsMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [createSession({ name: 'Exploration' })],
        activeSessionId: 'session-1',
    });

    await expect.poll(() => backend.requestCount(PlotsMethods.getHistoryState)).toBeGreaterThan(0);
    await expect
        .poll(() => backend.requestCount(PlotsMethods.getDarkFilterMode))
        .toBeGreaterThan(0);
    await expect
        .poll(() => backend.requestCount(PlotsMethods.getPreferredEditorTarget))
        .toBeGreaterThan(0);
    await expect(page.locator('.plots-container')).toHaveClass(/history-right/);
    await expect(page.locator('.plots-container')).toHaveClass(/dark-filter-off/);

    await page.getByRole('button', { name: 'Select where to open plot', exact: true }).click();
    const sideTarget = page.getByRole('menuitemcheckbox', {
        name: 'Open in editor tab to the Side',
        exact: true,
    });
    await expect(sideTarget).toBeChecked();
    const menuStyle = await page.getByRole('menu').evaluate((element) => {
        const style = getComputedStyle(element);
        return { position: style.position, borderStyle: style.borderStyle, padding: style.padding };
    });
    expect(menuStyle.position).toBe('fixed');
    expect(menuStyle.borderStyle).toBe('solid');
    expect(menuStyle.padding).toBe('4px');
    await expect(
        page.getByRole('menuitemcheckbox', { name: 'Open in editor tab', exact: true }),
    ).not.toBeChecked();

    const openInEditor = backend.waitForNextRequest(PlotsMethods.openInEditor);
    await sideTarget.click();
    expect((await openInEditor).params).toEqual({
        plotId: 'plot-1',
        viewColumn: 'beside',
    });

    const repeatOpenInEditor = backend.waitForNextRequest(PlotsMethods.openInEditor);
    await page.getByRole('button', { name: 'Open in...', exact: true }).click();
    expect((await repeatOpenInEditor).params).toEqual({
        plotId: 'plot-1',
        viewColumn: 'beside',
    });
    await expect(page.getByRole('menu')).toHaveCount(0);
});

test('plots keeps split controls on one row and moves overflowing actions into submenus', async ({
    page,
}) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-1',
                        sessionId: 'session-1',
                        kind: 'static',
                        initialData: SMALL_PNG_DATA_URI,
                        name: 'Cars Plot',
                    },
                ],
                selectedPlotId: 'plot-1',
            });
        },
    });
    await expect.poll(() => backend.notificationCount(PlotsMethods.ready)).toBeGreaterThan(0);

    const split = page.locator('.menu-button-container.split');
    await expect(split.getByRole('button')).toHaveCount(2);
    await expect
        .poll(() =>
            split.evaluate((element) => {
                const bounds = element.getBoundingClientRect();
                const buttons = [...element.querySelectorAll('button')].map((button) =>
                    button.getBoundingClientRect(),
                );
                return buttons.length === 2 &&
                    Math.abs(buttons[0].top - buttons[1].top) <= 1 &&
                    Math.abs(buttons[0].bottom - buttons[1].bottom) <= 1 &&
                    buttons[0].right <= buttons[1].left + 1 &&
                    buttons[1].right <= bounds.right + 1;
            }),
        )
        .toBe(true);

    // Keep the browser wide enough for menus while narrowing the panel itself.
    const panel = page.locator('.positron-plots-container');
    await panel.evaluate((element) => (element.style.width = '256px'));
    const overflow = page.getByRole('button', { name: 'More actions', exact: true });
    await expect(overflow).toBeVisible();
    await expect
        .poll(() =>
            overflow.locator('.codicon').evaluate((icon) => getComputedStyle(icon, '::before').content),
        )
        .toBe('"\uea7c"');
    await expect(page.getByRole('button', { name: 'Set the plot zoom', exact: true })).toHaveCount(0);
    await expect(
        page.getByRole('button', {
            name: 'Set whether a dark filter is applied to plots.',
            exact: true,
        }),
    ).toHaveCount(0);

    await overflow.click();
    await expect(page.getByRole('menuitem', { name: 'Dark Filter', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Zoom', exact: true }).click();
    const zoomRequest = backend.waitForNextRequest(PlotsMethods.selectZoom);
    await page.getByRole('menuitemcheckbox', { name: '50%', exact: true }).click();
    expect((await zoomRequest).params).toEqual({ plotId: 'plot-1', zoomLevel: 0.5 });

    await panel.evaluate((element) => (element.style.width = '64px'));
    await expect(page.getByRole('button', { name: 'Open in...', exact: true })).toHaveCount(0);
    await overflow.click();
    await page.getByRole('menuitem', { name: 'Open in...', exact: true }).click();
    const openRequest = backend.waitForNextRequest(PlotsMethods.openInEditor);
    await page
        .getByRole('menuitemcheckbox', { name: 'Open in editor tab to the Side', exact: true })
        .click();
    expect((await openRequest).params).toEqual({ plotId: 'plot-1', viewColumn: 'beside' });

    await panel.evaluate((element) => element.style.removeProperty('width'));
    await expect(overflow).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open in...', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set the plot zoom', exact: true })).toBeVisible();
});

test('plots sends save, editor, gallery, and code action requests', async ({ page }) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-1',
                        sessionId: 'session-1',
                        kind: 'static',
                        initialData: SMALL_PNG_DATA_URI,
                        name: 'Cars Plot',
                        code: 'plot(cars)',
                        languageId: 'r',
                        originUri: 'file:///workspace/plots.R',
                    },
                ],
                selectedPlotId: 'plot-1',
            });
        },
    });
    await expect.poll(() => backend.notificationCount(PlotsMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [createSession({ name: 'Exploration' })],
        activeSessionId: 'session-1',
    });

    const saveRequest = backend.waitForNextRequest(PlotsMethods.save);
    await page.getByLabel('Save plot').click();
    await expect.poll(async () => (await saveRequest).params).toEqual({ plotId: 'plot-1' });

    const openInEditorRequest = backend.waitForNextRequest(PlotsMethods.openInEditor);
    await page.getByRole('button', { name: 'Open in...', exact: true }).click();
    await expect
        .poll(async () => (await openInEditorRequest).params)
        .toEqual({
            plotId: 'plot-1',
            viewColumn: 'active',
        });

    const openInNewWindowRequest = backend.waitForNextRequest(PlotsMethods.openInNewWindow);
    await page.getByRole('button', { name: 'Select where to open plot', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Open in new window', exact: true }).click();
    await expect
        .poll(async () => (await openInNewWindowRequest).params)
        .toEqual({
            plotId: 'plot-1',
        });

    const runCodeAgainRequest = backend.waitForNextRequest(PlotsMethods.runCodeAgain);
    await page.getByLabel('Plot code actions').click();
    await page.getByText('Run Code Again').click();
    await expect
        .poll(async () => (await runCodeAgainRequest).params)
        .toEqual({
            plotId: 'plot-1',
            code: 'plot(cars)',
            sessionId: 'session-1',
            languageId: 'r',
        });

    const openOriginFileRequest = backend.waitForNextRequest(PlotsMethods.openOriginFile);
    await page.getByLabel('Plot code actions').click();
    await page.getByText('Open Source File').click();
    await expect
        .poll(async () => (await openOriginFileRequest).params)
        .toEqual({
            plotId: 'plot-1',
        });

    const galleryRequest = backend.waitForNextRequest(PlotsMethods.openGalleryInNewWindow);
    await page.getByRole('button', { name: 'Select where to open plot', exact: true }).click();
    await expect(
        page.getByRole('menuitemcheckbox', { name: 'Open in new window', exact: true }),
    ).toBeChecked();
    await page
        .getByRole('menuitemcheckbox', { name: 'Open plots gallery in new window', exact: true })
        .click();
    await galleryRequest;

    await page.getByRole('button', { name: 'Select where to open plot', exact: true }).click();
    await expect(
        page.getByRole('menuitemcheckbox', {
            name: 'Open plots gallery in new window',
            exact: true,
        }),
    ).toBeChecked();
    await expect(
        page.getByRole('menuitemcheckbox', { name: 'Open in new window', exact: true }),
    ).not.toBeChecked();
    await page.keyboard.press('Escape');

    const repeatGalleryRequest = backend.waitForNextRequest(PlotsMethods.openGalleryInNewWindow);
    await page.getByRole('button', { name: 'Open in...', exact: true }).click();
    await repeatGalleryRequest;
    await expect(page.getByRole('menu')).toHaveCount(0);
});

test('plots releases html plot claims when switching away and applies sizing policy change notifications', async ({
    page,
}) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-html',
                        sessionId: 'session-1',
                        kind: 'html',
                        htmlUri: createPreviewFixtureUrl(),
                        name: 'HTML Plot',
                    },
                    {
                        id: 'plot-dynamic',
                        sessionId: 'session-1',
                        kind: 'dynamic',
                        thumbnail: SMALL_PNG_DATA_URI,
                        name: 'Dynamic Plot',
                    },
                ],
                selectedPlotId: 'plot-html',
            });
        },
    });

    await expect.poll(() => backend.notificationCount(PlotsMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [createSession({ name: 'Exploration' })],
        activeSessionId: 'session-1',
    });
    await expect.poll(() => backend.requestCount(PlotsMethods.claimHtmlPlot)).toBeGreaterThan(0);

    const selectDynamicPlot = backend.waitForNextRequest(PlotsMethods.select);
    const releaseHtmlPlot = backend.waitForNextRequest(PlotsMethods.releaseHtmlPlot);
    await page.locator('[data-plot-id="plot-dynamic"]').click();
    expect((await selectDynamicPlot).params).toEqual({ plotId: 'plot-dynamic' });
    expect((await releaseHtmlPlot).params).toEqual({ plotId: 'plot-html' });

    await backend.notify(PlotsMethods.selectedChanged, {
        plotId: 'plot-dynamic',
        selectedSizingPolicyId: 'auto',
        sizingPolicies: [
            { id: 'auto', name: 'Auto' },
            { id: 'fill', name: 'Fill' },
            { id: 'custom', name: 'Custom' },
        ],
        hasIntrinsicSize: true,
        zoomLevel: 1,
    });
    await backend.notify(PlotsMethods.sizingPolicyChanged, {
        plotId: 'plot-dynamic',
        policyId: 'fill',
        policies: [
            { id: 'auto', name: 'Auto' },
            { id: 'fill', name: 'Fill' },
            { id: 'custom', name: 'Custom' },
        ],
        customSize: { width: 640, height: 480 },
    });
    await expect(page.getByLabel("Set how the plot's shape and size are determined")).toContainText(
        'Fill',
    );
});

test('plots keeps notification-driven state in sync for selection, history, render, and removal', async ({
    page,
}) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-static',
                        sessionId: 'session-1',
                        kind: 'static',
                        initialData: SMALL_PNG_DATA_URI,
                        name: 'Static Plot',
                    },
                ],
                selectedPlotId: 'plot-static',
            });
        },
    });

    await expect.poll(() => backend.notificationCount(PlotsMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [createSession({ name: 'Exploration' })],
        activeSessionId: 'session-1',
    });
    await expect(page.getByText('Static Plot', { exact: true })).toBeVisible();

    await backend.notify(PlotsMethods.added, {
        plotId: 'plot-dynamic',
        sessionId: 'session-1',
        kind: 'dynamic',
        name: 'Dynamic Plot',
        thumbnail: SMALL_PNG_DATA_URI,
        renderVersion: 1,
        parentId: 'exec-1',
    });
    await expect(page.locator('.plot-thumbnail')).toHaveCount(2);

    await backend.notify(PlotsMethods.selectedChanged, {
        plotId: 'plot-dynamic',
        zoomLevel: 2,
        selectedSizingPolicyId: 'fill',
        sizingPolicies: [
            { id: 'auto', name: 'Auto' },
            { id: 'fill', name: 'Fill' },
            { id: 'custom', name: 'Custom' },
        ],
        hasIntrinsicSize: true,
    });
    await expect(page.getByLabel('Set the plot zoom')).toContainText('200%');

    await backend.notify(PlotsMethods.zoomChanged, {
        plotId: 'plot-dynamic',
        zoomLevel: 0.5,
    });
    await expect(page.getByLabel('Set the plot zoom')).toContainText('50%');

    await backend.notify(PlotsMethods.updated, {
        plotId: 'plot-dynamic',
        name: 'Renamed Plot',
    });
    await expect(page.locator('.plot-name')).toHaveText('Renamed Plot');

    await backend.notify(PlotsMethods.darkFilterModeChanged, {
        mode: 'off',
    });
    await expect(page.locator('.plots-container')).toHaveClass(/dark-filter-off/);

    await backend.notify(PlotsMethods.historyPositionChanged, {
        position: 'right',
    });
    await expect(page.locator('.plots-container')).toHaveClass(/history-right/);

    await backend.notify(PlotsMethods.historyPolicyChanged, {
        policy: 'always',
    });

    await backend.notify(PlotsMethods.plotStateChanged, {
        plotId: 'plot-dynamic',
        state: 'rendering',
    });

    await backend.notify(PlotsMethods.renderCompleted, {
        plotId: 'plot-dynamic',
        uri: SMALL_PNG_DATA_URI,
        renderTimeMs: 10,
        renderVersion: 2,
    });
    await expect(page.locator('.selected-plot img.plot')).toHaveAttribute(
        'src',
        SMALL_PNG_DATA_URI,
    );

    await backend.notify(PlotsMethods.removed, {
        plotIds: ['plot-static'],
        sessionId: 'session-1',
    });
    await expect(
        page.locator('.plot-thumbnail-name-text').filter({ hasText: 'Static Plot' }),
    ).toHaveCount(0);

    await backend.notify(PlotsMethods.cleared);
    await expect(page.locator('.plot-thumbnail')).toHaveCount(0);
});

test('plots applies the host auto fallback when intrinsic size is unavailable', async ({
    page,
}) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-intrinsic',
                        sessionId: 'session-1',
                        kind: 'dynamic',
                        thumbnail: SMALL_PNG_DATA_URI,
                        name: 'Intrinsic Plot',
                        sizingPolicyId: 'intrinsic',
                    },
                ],
                selectedPlotId: 'plot-intrinsic',
            });
            // Intrinsic lookup and fallback now happen inside the host render
            // handler; the webview receives the resulting policy notification.
            mockBackend.onRequest(PlotsMethods.render, async (request) => {
                const { plotId } = request.params as { plotId: string };
                await mockBackend.notify(PlotsMethods.sizingPolicyChanged, {
                    plotId,
                    policyId: 'auto',
                });
                return { data: SMALL_PNG_DATA_URI, mimeType: 'image/png', renderVersion: 1 };
            });
        },
    });

    await expect.poll(() => backend.requestCount(PlotsMethods.render)).toBeGreaterThan(0);
    await expect(page.getByLabel("Set how the plot's shape and size are determined")).toContainText(
        'Auto',
    );
    await expect(page.locator('.selected-plot img.plot')).toBeVisible();

    const renderFlow = backend
        .requests()
        .filter((request) =>
            [
                PlotsMethods.getIntrinsicSize,
                PlotsMethods.selectSizingPolicy,
                PlotsMethods.render,
            ].includes(request.method),
        )
        .map((request) => ({ method: request.method, params: request.params }));

    expect(renderFlow.slice(0, 1)).toEqual([
        {
            method: PlotsMethods.render,
            params: expect.objectContaining({ plotId: 'plot-intrinsic' }),
        },
    ]);
    expect(backend.requestCount(PlotsMethods.getIntrinsicSize)).toBe(0);
    expect(backend.requestCount(PlotsMethods.selectSizingPolicy)).toBe(0);
});

test('plots keeps host-provided intrinsic sizing while rendering', async ({ page }) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-intrinsic',
                        sessionId: 'session-1',
                        kind: 'dynamic',
                        thumbnail: SMALL_PNG_DATA_URI,
                        name: 'Intrinsic Plot',
                        sizingPolicyId: 'intrinsic',
                        hasIntrinsicSize: true,
                    },
                ],
                selectedPlotId: 'plot-intrinsic',
            });
        },
    });

    await expect.poll(() => backend.requestCount(PlotsMethods.render)).toBeGreaterThan(0);
    await expect(page.getByLabel("Set how the plot's shape and size are determined")).toContainText(
        'Intrinsic',
    );
    await expect(page.locator('.selected-plot img.plot')).toBeVisible();

    const renderFlow = backend
        .requests()
        .filter((request) =>
            [
                PlotsMethods.getIntrinsicSize,
                PlotsMethods.selectSizingPolicy,
                PlotsMethods.render,
            ].includes(request.method),
        )
        .map((request) => request.method);

    expect(renderFlow.slice(0, 1)).toEqual([PlotsMethods.render]);
    expect(backend.requestCount(PlotsMethods.getIntrinsicSize)).toBe(0);
    expect(backend.requestCount(PlotsMethods.selectSizingPolicy)).toBe(0);
});

test('plots surfaces intrinsic size failures returned by host rendering', async ({ page }) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-intrinsic',
                        sessionId: 'session-1',
                        kind: 'dynamic',
                        name: 'Intrinsic Plot',
                        sizingPolicyId: 'intrinsic',
                    },
                ],
                selectedPlotId: 'plot-intrinsic',
            });
            mockBackend.onRequest(PlotsMethods.render, () => {
                throw new Error('intrinsic size failed');
            });
        },
    });

    await expect(page.getByText('Error rendering plot: intrinsic size failed')).toBeVisible();
    expect(backend.requestCount(PlotsMethods.selectSizingPolicy)).toBe(0);
    expect(backend.requestCount(PlotsMethods.getIntrinsicSize)).toBe(0);
    expect(backend.requestCount(PlotsMethods.render)).toBeGreaterThan(0);
});

test('plots surfaces dynamic render failures instead of using cached data', async ({ page }) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-dynamic',
                        sessionId: 'session-1',
                        kind: 'dynamic',
                        name: 'Dynamic Plot',
                        sizingPolicyId: 'auto',
                    },
                ],
                selectedPlotId: 'plot-dynamic',
            });
            mockBackend.onRequest(PlotsMethods.render, () => {
                throw new Error('plot render failed');
            });
        },
    });

    await expect(page.getByText('Error rendering plot: plot render failed')).toBeVisible();
    expect(backend.requestCount(PlotsMethods.render)).toBeGreaterThan(0);
});

test('plots sends zoom, dark filter, sizing, custom size, source navigation, delete, and viewport messages', async ({
    page,
}) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-1',
                        sessionId: 'session-1',
                        kind: 'dynamic',
                        thumbnail: SMALL_PNG_DATA_URI,
                        name: 'Dynamic Plot',
                        code: 'plot(cars)',
                        languageId: 'r',
                        parentId: 'exec-1',
                        originUri: 'file:///workspace/plots.R',
                    },
                    {
                        id: 'plot-2',
                        sessionId: 'session-2',
                        kind: 'dynamic',
                        thumbnail: SMALL_PNG_DATA_URI,
                        name: 'Secondary Plot',
                        code: 'plot(mtcars)',
                        languageId: 'r',
                    },
                ],
                selectedPlotId: 'plot-1',
            });
        },
    });

    await expect.poll(() => backend.notificationCount(PlotsMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [
            createSession({ id: 'session-1', name: 'Exploration' }),
            createSession({ id: 'session-2', name: 'Secondary' }),
        ],
        activeSessionId: 'session-1',
    });
    await backend.notify(PlotsMethods.selectedChanged, {
        plotId: 'plot-1',
        selectedSizingPolicyId: 'auto',
        sizingPolicies: [
            { id: 'auto', name: 'Auto' },
            { id: 'landscape', name: 'Landscape' },
            { id: 'custom', name: 'Custom' },
        ],
        customSize: { width: 900, height: 600 },
        hasIntrinsicSize: true,
        zoomLevel: 1,
    });

    await expect
        .poll(() => backend.notificationCount(PlotsMethods.viewportChanged))
        .toBeGreaterThan(0);

    const zoomRequest = backend.waitForNextRequest(PlotsMethods.selectZoom);
    await page.getByLabel('Set the plot zoom').click();
    await page.getByText('200%').click();
    expect((await zoomRequest).params).toEqual({
        plotId: 'plot-1',
        zoomLevel: 2,
    });

    const darkFilterRequest = backend.waitForNextRequest(PlotsMethods.selectDarkFilterMode);
    await page.getByLabel('Set whether a dark filter is applied to plots.').click();
    await page.getByText('No Filter').click();
    expect((await darkFilterRequest).params).toEqual({ mode: 'off' });

    const openSettingsRequest = backend.waitForNextRequest(PlotsMethods.openDarkFilterSettings);
    await page.getByLabel('Set whether a dark filter is applied to plots.').click();
    await page.getByText('Change Default in Settings...').click();
    await openSettingsRequest;

    const sizingRequest = backend.waitForNextRequest(PlotsMethods.selectSizingPolicy);
    await page.getByLabel("Set how the plot's shape and size are determined").click();
    await page.getByText('Landscape').click();
    expect((await sizingRequest).params).toEqual({ policyId: 'landscape' });

    const customSizeRequest = backend.waitForNextRequest(PlotsMethods.setCustomSize);
    await page.getByLabel("Set how the plot's shape and size are determined").click();
    await page.getByText(/Custom Size/).click();
    await page.getByText('1024 × 768').click();
    await page.getByRole('button', { name: 'Apply' }).click();
    expect((await customSizeRequest).params).toEqual({
        width: 1024,
        height: 768,
    });

    const revealRequest = backend.waitForNextRequest(PlotsMethods.revealInConsole);
    await page.getByLabel('Plot code actions').click();
    await page.getByText('Reveal Code in Console').click();
    expect((await revealRequest).params).toEqual({
        sessionId: 'session-1',
        executionId: 'exec-1',
    });

    const activateSessionRequest = backend.waitForNextRequest(PlotsMethods.activateConsoleSession);
    await backend.notify(PlotsMethods.selectedChanged, {
        plotId: 'plot-2',
        zoomLevel: 1,
    });
    await page.locator('.plot-session-name').click();
    expect((await activateSessionRequest).params).toEqual({
        sessionId: 'session-2',
    });

    const deleteRequest = backend.waitForNextRequest(PlotsMethods.delete);
    await page.locator('[data-plot-id="plot-1"]').focus();
    await page.keyboard.press('Delete');
    expect((await deleteRequest).params).toEqual({ plotId: 'plot-1' });
});

test('plots rerenders when an existing custom size changes without resizing the viewport', async ({
    page,
}) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-custom',
                        sessionId: 'session-1',
                        kind: 'dynamic',
                        sizingPolicyId: 'custom',
                        customSize: { width: 640, height: 480 },
                        initialData: SMALL_PNG_DATA_URI,
                        initialRenderSettings: { width: 640, height: 480, pixelRatio: 1 },
                    },
                ],
                selectedPlotId: 'plot-custom',
            });
        },
    });
    await expect(page.locator('img.plot')).toBeVisible();
    const viewport = await page.locator('.selected-plot').boundingBox();

    for (const size of [
        { width: 1400, height: 400 },
        { width: 1000, height: 500 },
        { width: 640, height: 480 },
    ]) {
        await page.getByLabel("Set how the plot's shape and size are determined").click();
        await page.getByText(/Custom Size/).click();
        await page.getByLabel('Width (px)', { exact: true }).fill(String(size.width));
        await page.getByLabel('Height (px)', { exact: true }).fill(String(size.height));
        const changedSize = backend.waitForNextRequest(PlotsMethods.setCustomSize);
        const render = backend.waitForNextRequest(PlotsMethods.render);
        await page.getByLabel('Height (px)', { exact: true }).press('Enter');
        expect((await changedSize).params).toEqual(size);
        expect((await render).params).toMatchObject({ plotId: 'plot-custom', ...size });
        expect(await page.locator('.selected-plot').boundingBox()).toEqual(viewport);
    }

    // Host notifications must also redraw a custom policy whose ID is unchanged.
    const render = backend.waitForNextRequest(PlotsMethods.render);
    await backend.notify(PlotsMethods.sizingPolicyChanged, {
        plotId: 'plot-custom',
        policyId: 'custom',
        customSize: { width: 1200, height: 600 },
    });
    expect((await render).params).toMatchObject({ width: 1200, height: 600 });
});

test('plots converts physical custom size units and preserves size when switching units', async ({
    page,
}) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) =>
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-units',
                        kind: 'dynamic',
                        sizingPolicyId: 'custom',
                        customSize: { width: 960, height: 480 },
                    },
                ],
                selectedPlotId: 'plot-units',
            }),
    });
    await expect(page.locator('img.plot')).toBeVisible();
    await page.getByLabel("Set how the plot's shape and size are determined").click();
    await page.getByText(/Custom Size/).click();
    const dialog = page.getByRole('dialog');
    for (const [unit, width, height] of [
        ['in', 10, 5],
        ['cm', 25.4, 12.7],
        ['mm', 254, 127],
    ] as const) {
        await dialog.getByLabel('Unit', { exact: true }).selectOption(unit);
        await expect
            .poll(async () =>
                Number(await dialog.getByLabel(`Width (${unit})`, { exact: true }).inputValue()),
            )
            .toBeCloseTo(width, 6);
        await expect
            .poll(async () =>
                Number(await dialog.getByLabel(`Height (${unit})`, { exact: true }).inputValue()),
            )
            .toBeCloseTo(height, 6);
        await expect(dialog.getByText('Render size: 960 × 480 px')).toBeVisible();
    }
    await dialog.getByLabel('Unit', { exact: true }).selectOption('px');
    await expect(dialog.getByLabel('Width (px)', { exact: true })).toHaveValue('960');
    await dialog.getByLabel('Unit', { exact: true }).selectOption('in');
    await dialog.getByLabel('Width (in)', { exact: true }).fill('6.5');
    await dialog.getByLabel('Height (in)', { exact: true }).fill('4.25');
    await dialog.getByLabel('Pixels per inch (px/in)', { exact: true }).fill('100');
    await expect(dialog.getByText('Render size: 650 × 425 px')).toBeVisible();
    const request = backend.waitForNextRequest(PlotsMethods.setCustomSize);
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    expect((await request).params).toEqual({ width: 650, height: 425 });

    await page.getByLabel("Set how the plot's shape and size are determined").click();
    await page.getByText(/Custom Size/).click();
    await expect(dialog.getByLabel('Unit', { exact: true })).toHaveValue('in');
    await expect(dialog.getByLabel('Width (in)', { exact: true })).toHaveValue('6.5');
    await dialog.getByRole('button', { name: '800 × 600', exact: true }).click();
    await expect(dialog.getByLabel('Width (in)', { exact: true })).toHaveValue('8');
    await expect(dialog.getByLabel('Height (in)', { exact: true })).toHaveValue('6');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('plots rejects invalid custom sizes and resets cancelled edits on reopening', async ({
    page,
}) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) =>
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-validation',
                        kind: 'dynamic',
                        sizingPolicyId: 'custom',
                        customSize: { width: 800, height: 600 },
                    },
                ],
                selectedPlotId: 'plot-validation',
            }),
    });
    await expect(page.locator('img.plot')).toBeVisible();
    await page.getByLabel("Set how the plot's shape and size are determined").click();
    await page.getByText(/Custom Size/).click();
    const dialog = page.getByRole('dialog');
    const apply = dialog.getByRole('button', { name: 'Apply', exact: true });
    for (const width of ['', '0', '99', '4097']) {
        await dialog.getByLabel('Width (px)', { exact: true }).fill(width);
        await expect(apply).toBeDisabled();
    }
    await dialog.getByLabel('Width (px)', { exact: true }).fill('1000');
    await expect(apply).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.getByLabel("Set how the plot's shape and size are determined").click();
    await page.getByText(/Custom Size/).click();
    await expect(dialog.getByLabel('Width (px)', { exact: true })).toHaveValue('800');
    await expect(dialog.getByLabel('Unit', { exact: true })).toBeFocused();
    await dialog.getByLabel('Unit', { exact: true }).selectOption('in');
    await dialog.getByLabel('Pixels per inch (px/in)', { exact: true }).fill('0');
    await expect(apply).toBeDisabled();
    expect(backend.requestCount(PlotsMethods.setCustomSize)).toBe(0);
});

test('plots prefers the browser clipboard when available and falls back to extension copy when unavailable', async ({
    page,
    browserName,
}) => {
    void browserName;
    await installClipboardMock(page);
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-1',
                        sessionId: 'session-1',
                        kind: 'static',
                        initialData: SMALL_PNG_DATA_URI,
                        name: 'Cars Plot',
                    },
                ],
                selectedPlotId: 'plot-1',
            });
        },
    });

    await expect.poll(() => backend.notificationCount(PlotsMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [createSession()],
        activeSessionId: 'session-1',
    });

    await clearClipboardRecords(page);
    const copyCountBefore = backend.requestCount(PlotsMethods.copy);
    await page.getByLabel('Copy plot to clipboard').click();
    await expect.poll(() => backend.requestCount(PlotsMethods.copy)).toBe(copyCountBefore);
    await expect
        .poll(() => getClipboardRecords(page))
        .toEqual([
            {
                kind: 'write',
                itemCount: 1,
            },
        ]);
});

test('plots falls back to extension copy and supports closing gallery auxiliary windows', async ({
    page,
}) => {
    await installClipboardMock(page, 'unsupported');
    await page.addInitScript(() => {
        (
            window as Window & {
                __ARK_PLOTS_GALLERY_EDITOR__?: boolean;
            }
        ).__ARK_PLOTS_GALLERY_EDITOR__ = true;
    });

    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-1',
                        sessionId: 'session-1',
                        kind: 'static',
                        initialData: SMALL_PNG_DATA_URI,
                        name: 'Cars Plot',
                    },
                ],
                selectedPlotId: 'plot-1',
            });
        },
    });

    await expect.poll(() => backend.notificationCount(PlotsMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [createSession()],
        activeSessionId: 'session-1',
    });

    const copyRequest = backend.waitForNextRequest(PlotsMethods.copy);
    await page.getByLabel('Copy plot to clipboard').click();
    expect((await copyRequest).params).toEqual({ plotId: 'plot-1' });

    const closeAuxPanel = backend.waitForNextRequest(PlotsMethods.closeAuxPanel);
    await page.keyboard.press('Control+w');
    await closeAuxPanel;
});

test('plots correctly associates plots with sessions and updates on session removal', async ({
    page,
}) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-s1',
                        sessionId: 'session-1',
                        kind: 'static',
                        initialData: SMALL_PNG_DATA_URI,
                        name: 'S1 Plot',
                    },
                    {
                        id: 'plot-s2',
                        sessionId: 'session-2',
                        kind: 'static',
                        initialData: SMALL_PNG_DATA_URI,
                        name: 'S2 Plot',
                    },
                ],
                selectedPlotId: 'plot-s2',
            });
        },
    });

    await expect.poll(() => backend.notificationCount(PlotsMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [
            createSession({ id: 'session-1', name: 'Primary' }),
            createSession({ id: 'session-2', name: 'Analytics' }),
        ],
        activeSessionId: 'session-1',
    });

    await expect(page.locator('.plot-thumbnail')).toHaveCount(2);

    // Add a new plot from session-1 dynamically
    await backend.notify(PlotsMethods.added, {
        plotId: 'plot-s1b',
        sessionId: 'session-1',
        kind: 'static',
        name: 'S1 Plot B',
        thumbnail: SMALL_PNG_DATA_URI,
        renderVersion: 1,
    });
    await expect(page.locator('.plot-thumbnail')).toHaveCount(3);

    // Remove the dynamically-added session-1 plot
    await backend.notify(PlotsMethods.removed, {
        plotIds: ['plot-s1b'],
        sessionId: 'session-1',
    });

    // Should go back to 2 thumbnails
    await expect(page.locator('.plot-thumbnail')).toHaveCount(2);

    // Remove the other session-1 plot
    await backend.notify(PlotsMethods.removed, {
        plotIds: ['plot-s1'],
        sessionId: 'session-1',
    });

    // Only 1 plot remains — the history panel auto-hides with a single plot
    await expect(page.locator('.plot-thumbnail')).toHaveCount(0);
    // But the selected plot (from session-2) should still render
    await expect(page.locator('img.plot')).toBeVisible();
});

test('plots routes code actions to the correct session for cross-session plots', async ({
    page,
}) => {
    const backend = await openWebviewPage(page, 'plots', {
        configure: (mockBackend) => {
            registerPlotsDefaults(mockBackend, {
                plots: [
                    {
                        id: 'plot-s1',
                        sessionId: 'session-1',
                        kind: 'dynamic',
                        thumbnail: SMALL_PNG_DATA_URI,
                        name: 'Primary Plot',
                        code: 'plot(iris)',
                        languageId: 'r',
                        parentId: 'exec-r1',
                    },
                    {
                        id: 'plot-s2',
                        sessionId: 'session-2',
                        kind: 'dynamic',
                        thumbnail: SMALL_PNG_DATA_URI,
                        name: 'Analytics Plot',
                        code: 'plot(mtcars)',
                        languageId: 'r',
                        parentId: 'exec-r2',
                    },
                ],
                selectedPlotId: 'plot-s1',
            });
        },
    });

    await expect.poll(() => backend.notificationCount(PlotsMethods.ready)).toBeGreaterThan(0);
    await backend.notify(SessionMethods.info, {
        sessions: [
            createSession({ id: 'session-1', name: 'Primary' }),
            createSession({ id: 'session-2', name: 'Analytics' }),
        ],
        activeSessionId: 'session-1',
    });

    // Select session-2's plot
    const selectRequest = backend.waitForNextRequest(PlotsMethods.select);
    await page.locator('[data-plot-id="plot-s2"]').click();
    expect((await selectRequest).params).toEqual({ plotId: 'plot-s2' });

    await backend.notify(PlotsMethods.selectedChanged, {
        plotId: 'plot-s2',
        zoomLevel: 1,
        selectedSizingPolicyId: 'auto',
        sizingPolicies: [{ id: 'auto', name: 'Auto' }],
        hasIntrinsicSize: true,
    });

    // Run Code Again should route to session-2
    const runCodeAgain = backend.waitForNextRequest(PlotsMethods.runCodeAgain);
    await page.getByLabel('Plot code actions').click();
    await page.getByText('Run Code Again').click();
    expect((await runCodeAgain).params).toEqual({
        plotId: 'plot-s2',
        code: 'plot(mtcars)',
        sessionId: 'session-2',
        languageId: 'r',
    });

    // Reveal in Console should also route to session-2's execution
    const revealRequest = backend.waitForNextRequest(PlotsMethods.revealInConsole);
    await page.getByLabel('Plot code actions').click();
    await page.getByText('Reveal Code in Console').click();
    expect((await revealRequest).params).toEqual({
        sessionId: 'session-2',
        executionId: 'exec-r2',
    });
});
