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

const sizingTooltip = "Set how the plot's shape and size are determined";
const dynamicContent = {
    kind: 'image',
    data: SMALL_PNG_DATA_URI,
    selectedSizingPolicyId: 'landscape',
    sizingPolicies: [
        { id: 'auto', name: 'Auto' },
        { id: 'fill', name: 'Fill' },
        { id: 'landscape', name: 'Landscape' },
    ],
};

test('plot editor inherits sizing and rerenders at the same viewport after each policy change', async ({ page }) => {
    const backend = await openWebviewPage(page, 'plotEditor', {
        configure: backend => backend.onRequest(PlotEditorMethods.selectSizingPolicy, request => request.params),
    });
    await expect.poll(() => backend.notificationCount(PlotEditorMethods.ready)).toBeGreaterThan(0);
    await backend.notify(PlotEditorMethods.setContent, dynamicContent);
    const menu = page.getByLabel(sizingTooltip);
    await expect(menu).toContainText('Landscape');
    await expect.poll(() => backend.notificationCount(PlotEditorMethods.render)).toBeGreaterThan(0);
    await page.waitForTimeout(250);

    for (const policy of dynamicContent.sizingPolicies) {
        const before = backend.notificationCount(PlotEditorMethods.render);
        const previous = backend.notifications(PlotEditorMethods.render).at(-1)!.params;
        await menu.click();
        await page.getByRole('menuitemcheckbox', { name: policy.name, exact: true }).click();
        await expect(menu).toContainText(policy.name);
        await expect.poll(() => backend.notificationCount(PlotEditorMethods.render)).toBe(before + 1);
        expect(backend.requests(PlotEditorMethods.selectSizingPolicy).at(-1)!.params).toEqual({ policyId: policy.id });
        expect(backend.notifications(PlotEditorMethods.render).at(-1)!.params).toEqual(previous);
    }

    // Keyboard access and focus restoration remain available in a narrow window.
    await page.setViewportSize({ width: 320, height: 600 });
    await menu.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitemcheckbox', { name: 'Auto', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toContainText('Auto');
    await expect(menu).toBeFocused();
});

for (const outcome of ['success', 'failure'] as const) {
    test(`plot editor retains keyboard focus during a pending sizing change (${outcome})`, async ({ page }) => {
        let complete!: () => void;
        const response = new Promise<{ policyId: string }>((resolve, reject) => {
            complete = () => outcome === 'success'
                ? resolve({ policyId: 'auto' })
                : reject(new Error('Plot closed'));
        });
        const backend = await openWebviewPage(page, 'plotEditor', {
            configure: backend => backend.onRequest(PlotEditorMethods.selectSizingPolicy, () => response),
        });
        await expect.poll(() => backend.notificationCount(PlotEditorMethods.ready)).toBeGreaterThan(0);
        await backend.notify(PlotEditorMethods.setContent, dynamicContent);
        const menu = page.getByLabel(sizingTooltip);
        await menu.focus();
        await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('menuitemcheckbox', { name: 'Auto', exact: true })).toBeFocused();
        await page.keyboard.press('Enter');
        await expect.poll(() => backend.requestCount(PlotEditorMethods.selectSizingPolicy)).toBe(1);

        // Hold the RPC open so focus restoration cannot depend on response timing.
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(menu).toBeFocused();
        await page.keyboard.press('ArrowDown');
        for (const policy of dynamicContent.sizingPolicies) {
            await expect(page.getByRole('menuitemcheckbox', { name: policy.name, exact: true })).toBeDisabled();
        }
        expect(backend.requestCount(PlotEditorMethods.selectSizingPolicy)).toBe(1);
        await page.keyboard.press('Escape');
        await expect(menu).toBeFocused();

        complete();
        if (outcome === 'failure') {
            await expect(page.getByRole('status')).toContainText('Failed to change plot size.');
        }
        await expect(menu).toContainText(outcome === 'success' ? 'Auto' : 'Landscape');
        await expect(menu).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('menuitemcheckbox', { name: 'Fill', exact: true })).toBeEnabled();
    });
}

test('plot editor preserves its policy and reports a rejected sizing change', async ({ page }) => {
    const backend = await openWebviewPage(page, 'plotEditor', {
        configure: backend => backend.onRequest(PlotEditorMethods.selectSizingPolicy, () => {
            throw new Error('Plot closed');
        }),
    });
    await expect.poll(() => backend.notificationCount(PlotEditorMethods.ready)).toBeGreaterThan(0);
    await backend.notify(PlotEditorMethods.setContent, dynamicContent);
    await page.getByLabel(sizingTooltip).click();
    await page.getByRole('menuitemcheckbox', { name: 'Fill', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Failed to change plot size.');
    await expect(page.getByLabel(sizingTooltip)).toContainText('Landscape');
    await expect(page.getByLabel(sizingTooltip)).toBeEnabled();
});

test('plot editor hides sizing for static images and HTML content', async ({ page }) => {
    const backend = await openWebviewPage(page, 'plotEditor');
    await expect.poll(() => backend.notificationCount(PlotEditorMethods.ready)).toBeGreaterThan(0);
    await backend.notify(PlotEditorMethods.setContent, { kind: 'image', data: SMALL_PNG_DATA_URI });
    await expect(page.locator('img.plot')).toBeVisible();
    await expect(page.getByLabel(sizingTooltip)).toHaveCount(0);
    await expect(page.getByLabel('Set the plot zoom')).toBeVisible();
    await backend.notify(PlotEditorMethods.setContent, { kind: 'html', uri: 'about:blank' });
    await expect(page.locator('iframe')).toBeVisible();
    await expect(page.getByLabel(sizingTooltip)).toHaveCount(0);
    await expect(page.getByLabel('Set the plot zoom')).toHaveCount(0);
});
