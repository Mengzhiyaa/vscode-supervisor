import { expect, test } from '@playwright/test';
import { PlotsMethods, SMALL_PNG_DATA_URI, SessionMethods, createPreviewFixtureUrl, createSession, registerPlotsDefaults } from '../harness/domains';
import { clearClipboardRecords, getClipboardRecords, installClipboardMock } from '../harness/browser';
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
    await expect(page.getByText('Cars Plot')).toBeVisible();
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

    await expect.poll(() => backend.notificationCount(PlotsMethods.layoutHtmlPlot)).toBeGreaterThan(0);
    const layoutNotification = backend.notifications(PlotsMethods.layoutHtmlPlot)[0];
    expect(layoutNotification.params).toMatchObject({
        plotId: 'plot-html',
    });

    const clearRequest = backend.waitForNextRequest(PlotsMethods.clear);
    await page.getByLabel('Clear all plots').click();
    await expect.poll(async () => (await clearRequest).method).toBe(PlotsMethods.clear);
});

test('plots requests initial preferences and uses the preferred editor target from the backend', async ({ page }) => {
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
    await expect.poll(() => backend.requestCount(PlotsMethods.getDarkFilterMode)).toBeGreaterThan(0);
    await expect.poll(() => backend.requestCount(PlotsMethods.getPreferredEditorTarget)).toBeGreaterThan(0);
    await expect(page.locator('.plots-container')).toHaveClass(/history-right/);
    await expect(page.locator('.plots-container')).toHaveClass(/dark-filter-off/);

    const openInEditor = backend.waitForNextRequest(PlotsMethods.openInEditor);
    await page.getByLabel('Open in editor tab to the Side').click();
    expect((await openInEditor).params).toEqual({
        plotId: 'plot-1',
        viewColumn: 'beside',
    });
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
    await page.getByLabel('Open in editor tab').click();
    await expect.poll(async () => (await openInEditorRequest).params).toEqual({
        plotId: 'plot-1',
        viewColumn: 'active',
    });

    const openInNewWindowRequest = backend.waitForNextRequest(PlotsMethods.openInNewWindow);
    await page.getByTitle('Select where to open plot').click();
    await page.getByText('Open in new window').click();
    await expect.poll(async () => (await openInNewWindowRequest).params).toEqual({
        plotId: 'plot-1',
    });

    const runCodeAgainRequest = backend.waitForNextRequest(PlotsMethods.runCodeAgain);
    await page.getByLabel('Plot code actions').click();
    await page.getByText('Run Code Again').click();
    await expect.poll(async () => (await runCodeAgainRequest).params).toEqual({
        code: 'plot(cars)',
        sessionId: 'session-1',
        languageId: 'r',
    });

    const openOriginFileRequest = backend.waitForNextRequest(PlotsMethods.openOriginFile);
    await page.getByLabel('Plot code actions').click();
    await page.getByText('Open Source File').click();
    await expect.poll(async () => (await openOriginFileRequest).params).toEqual({
        plotId: 'plot-1',
    });

    const galleryRequest = backend.waitForNextRequest(PlotsMethods.openGalleryInNewWindow);
    await page.getByLabel('Open plots gallery in new window').click();
    await galleryRequest;
});

test('plots releases html plot claims when switching away and applies sizing policy change notifications', async ({ page }) => {
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
    await expect(page.getByLabel("Set how the plot's shape and size are determined")).toContainText('Fill');
});

test('plots keeps notification-driven state in sync for selection, history, render, and removal', async ({ page }) => {
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
    await expect(page.getByText('Static Plot')).toBeVisible();

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
    await expect(page.locator('.selected-plot img.plot')).toHaveAttribute('src', SMALL_PNG_DATA_URI);

    await backend.notify(PlotsMethods.removed, {
        plotIds: ['plot-static'],
        sessionId: 'session-1',
    });
    await expect(page.locator('.plot-thumbnail-name-text').filter({ hasText: 'Static Plot' })).toHaveCount(0);

    await backend.notify(PlotsMethods.cleared);
    await expect(page.locator('.plot-thumbnail')).toHaveCount(0);
});

test('plots sends zoom, dark filter, sizing, custom size, source navigation, delete, and viewport messages', async ({ page }) => {
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

    await expect.poll(() => backend.notificationCount(PlotsMethods.viewportChanged)).toBeGreaterThan(0);

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

test('plots prefers the browser clipboard when available and falls back to extension copy when unavailable', async ({ page, browserName }) => {
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
    await expect.poll(() => getClipboardRecords(page)).toEqual([
        {
            kind: 'write',
            itemCount: 1,
        },
    ]);
});

test('plots falls back to extension copy and supports closing gallery auxiliary windows', async ({ page }) => {
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

test('plots correctly associates plots with sessions and updates on session removal', async ({ page }) => {
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

test('plots routes code actions to the correct session for cross-session plots', async ({ page }) => {
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

