import { expect, test } from '@playwright/test';
import { PlotEditorMethods, SMALL_PNG_DATA_URI } from '../harness/domains';
import { clearClipboardRecords, getClipboardRecords, installClipboardMock } from '../harness/browser';
import { openWebviewPage } from '../harness/page';

test('plot editor notifies readiness, requests renders, and displays render results', async ({ page }) => {
    const backend = await openWebviewPage(page, 'plotEditor');

    await expect.poll(() => backend.notificationCount(PlotEditorMethods.ready)).toBeGreaterThan(0);

    await expect.poll(() => backend.notificationCount(PlotEditorMethods.render)).toBeGreaterThan(0);
    const initialRender = backend.notifications(PlotEditorMethods.render)[0];
    expect(initialRender.params).toEqual(
        expect.objectContaining({
            format: 'png',
        }),
    );

    const rerender = backend.waitForNextNotification(PlotEditorMethods.render);
    await backend.notify(PlotEditorMethods.setImage, {
        data: SMALL_PNG_DATA_URI,
    });
    expect((await rerender).params).toEqual(
        expect.objectContaining({
            format: 'png',
        }),
    );

    await backend.notify(PlotEditorMethods.renderResult, {
        data: SMALL_PNG_DATA_URI,
        mimeType: 'image/png',
    });
    await expect(page.locator('img.plot')).toHaveAttribute('src', SMALL_PNG_DATA_URI);
});

test('plot editor sends save, copy fallback, and close notifications', async ({ page }) => {
    const backend = await openWebviewPage(page, 'plotEditor');

    await expect.poll(() => backend.notificationCount(PlotEditorMethods.ready)).toBeGreaterThan(0);

    const save = backend.waitForNextNotification(PlotEditorMethods.save);
    await page.getByLabel('Save plot').click();
    await save;

    const copy = backend.waitForNextNotification(PlotEditorMethods.copy);
    await page.getByLabel('Copy plot to clipboard').click();
    await copy;

    const close = backend.waitForNextNotification(PlotEditorMethods.close);
    await page.keyboard.press('Control+w');
    await close;
});

test('plot editor updates zoom UI and uses the browser clipboard when available', async ({ page }) => {
    await installClipboardMock(page);
    const backend = await openWebviewPage(page, 'plotEditor');

    await expect.poll(() => backend.notificationCount(PlotEditorMethods.ready)).toBeGreaterThan(0);
    await backend.notify(PlotEditorMethods.renderResult, {
        data: SMALL_PNG_DATA_URI,
        mimeType: 'image/png',
    });
    await expect(page.locator('img.plot')).toHaveAttribute('src', SMALL_PNG_DATA_URI);

    await page.getByLabel('Set the plot zoom').click();
    await page.getByText('200%').click();
    await expect(page.getByLabel('Set the plot zoom')).toContainText('200%');

    await clearClipboardRecords(page);
    const copyCountBefore = backend.notificationCount(PlotEditorMethods.copy);
    await page.getByLabel('Copy plot to clipboard').click();

    await expect.poll(() => backend.notificationCount(PlotEditorMethods.copy)).toBe(copyCountBefore);
    await expect.poll(() => getClipboardRecords(page)).toEqual([
        {
            kind: 'write',
            itemCount: 1,
        },
    ]);
});

test('plot editor suppresses duplicate renders and re-renders after real resize changes', async ({ page }) => {
    const backend = await openWebviewPage(page, 'plotEditor');

    await expect.poll(() => backend.notificationCount(PlotEditorMethods.ready)).toBeGreaterThan(0);
    await expect.poll(() => backend.notificationCount(PlotEditorMethods.render)).toBeGreaterThan(0);

    const initialRenderCount = backend.notificationCount(PlotEditorMethods.render);
    const initialRender = backend.notifications(PlotEditorMethods.render)[initialRenderCount - 1];
    const initialParams = initialRender.params as { width: number; height: number };

    await page.evaluate(() => {
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(300);
    expect(backend.notificationCount(PlotEditorMethods.render)).toBe(initialRenderCount);

    await page.setViewportSize({ width: 1200, height: 900 });
    await expect.poll(() => backend.notificationCount(PlotEditorMethods.render)).toBe(initialRenderCount + 1);

    const resizedRender = backend.notifications(PlotEditorMethods.render)[initialRenderCount]
        .params as { width: number; height: number };
    expect(resizedRender.width).not.toBe(initialParams.width);
    expect(resizedRender.height).not.toBe(initialParams.height);
});
