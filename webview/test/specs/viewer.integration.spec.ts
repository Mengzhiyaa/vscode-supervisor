import { expect, test } from '@playwright/test';
import { ViewerMethods, createPreviewFixtureUrl } from '../harness/domains';
import { openWebviewPage } from '../harness/page';

test('viewer renders placeholder content and then shows URL previews', async ({ page }) => {
    const backend = await openWebviewPage(page, 'viewer');

    await expect(page.getByText('No preview to display')).toBeVisible();

    await backend.notify(ViewerMethods.show, {
        url: createPreviewFixtureUrl(),
        title: 'Sample Preview',
        kind: 'url',
    });
    await backend.notify(ViewerMethods.updateNavState, {
        canNavigateBack: true,
        canNavigateForward: false,
    });

    await expect(page.locator('iframe.viewer-frame')).toHaveAttribute('src', createPreviewFixtureUrl());
    await expect(page.getByRole('textbox', { name: 'The current URL' })).toHaveValue(
        createPreviewFixtureUrl(),
    );
    await expect(page.getByLabel('Navigate back to the previous URL')).toBeEnabled();
    await expect(page.getByLabel('Navigate back to the next URL')).toBeDisabled();
});

test('viewer sends navigation and open/clear actions back to the extension host', async ({ page }) => {
    const backend = await openWebviewPage(page, 'viewer');

    await backend.notify(ViewerMethods.show, {
        url: createPreviewFixtureUrl(),
        title: 'Sample Preview',
        kind: 'url',
        sessionId: 'session-1',
    });
    await backend.notify(ViewerMethods.updateNavState, {
        canNavigateBack: true,
        canNavigateForward: true,
    });

    const navigateBack = backend.waitForNextNotification(ViewerMethods.navigateBack);
    await page.getByLabel('Navigate back to the previous URL').click();
    await navigateBack;

    const reload = backend.waitForNextNotification(ViewerMethods.reload);
    await page.getByLabel('Reload the current URL').click();
    await reload;

    const openInBrowser = backend.waitForNextNotification(ViewerMethods.openInBrowser);
    await page.getByLabel('Open the current URL in the default browser').click();
    await openInBrowser;

    const openInEditor = backend.waitForNextNotification(ViewerMethods.openInEditor);
    await page.getByLabel('Open the content in an editor tab').click();
    await openInEditor;

    const interrupt = backend.waitForNextNotification(ViewerMethods.interrupt);
    await page.getByLabel('Interrupt execution').click();
    await interrupt;

    const navigate = backend.waitForNextNotification(ViewerMethods.navigate);
    const urlInput = page.getByRole('textbox', { name: 'The current URL' });
    await urlInput.fill(`${createPreviewFixtureUrl()}?next=1`);
    await urlInput.press('Enter');
    const navigateMessage = await navigate;
    expect(navigateMessage.params).toEqual({
        url: `${createPreviewFixtureUrl()}?next=1`,
    });

    const clear = backend.waitForNextNotification(ViewerMethods.clear);
    await page.getByLabel('Clear the current URL').click();
    await clear;
    await expect(page.getByText('No preview to display')).toBeVisible();
});

test('viewer supports html and basic preview action bars', async ({ page }) => {
    const backend = await openWebviewPage(page, 'viewer');

    await backend.notify(ViewerMethods.show, {
        url: createPreviewFixtureUrl(),
        title: 'HTML Preview',
        kind: 'html',
    });

    const openInNewWindow = backend.waitForNextNotification(ViewerMethods.openInNewWindow);
    await page.getByLabel('Open the content in a new window').click();
    await openInNewWindow;

    const clearHtml = backend.waitForNextNotification(ViewerMethods.clear);
    await page.getByLabel('Clear the content').click();
    await clearHtml;
    await expect(page.getByText('No preview to display')).toBeVisible();

    await backend.notify(ViewerMethods.show, {
        url: createPreviewFixtureUrl(),
        title: 'Basic Preview',
        kind: 'basic',
    });

    await expect(page.getByText('Basic Preview')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'The current URL' })).toHaveCount(0);

    const clearBasic = backend.waitForNextNotification(ViewerMethods.clear);
    await page.getByLabel('Clear the content').click();
    await clearBasic;
});

test('viewer resets interrupt state and applies iframe title and height on new previews', async ({ page }) => {
    const backend = await openWebviewPage(page, 'viewer');

    await backend.notify(ViewerMethods.show, {
        url: createPreviewFixtureUrl(),
        title: 'Interruptible Preview',
        kind: 'url',
    });
    await backend.notify(ViewerMethods.updateNavState, {
        canNavigateBack: true,
        canNavigateForward: true,
    });

    const interrupt = backend.waitForNextNotification(ViewerMethods.interrupt);
    await page.getByLabel('Interrupt execution').click();
    await interrupt;
    await expect(page.getByLabel('Interrupt execution')).toBeDisabled();

    await backend.notify(ViewerMethods.show, {
        url: `${createPreviewFixtureUrl()}?refresh=1`,
        title: 'Sized Preview',
        kind: 'url',
        height: 420,
    });

    await expect(page.getByLabel('Interrupt execution')).toBeEnabled();
    await expect(page.locator('iframe.viewer-frame')).toHaveAttribute('src', `${createPreviewFixtureUrl()}?refresh=1`);
    await expect(page.locator('iframe.viewer-frame')).toHaveAttribute('title', 'Sized Preview');
    await expect(page.locator('iframe.viewer-frame')).toHaveAttribute('style', /height: 420px;/);
});

test('viewer routes html preview browser and editor actions through the backend', async ({ page }) => {
    const backend = await openWebviewPage(page, 'viewer');

    await backend.notify(ViewerMethods.show, {
        url: createPreviewFixtureUrl(),
        title: 'HTML Preview',
        kind: 'html',
    });

    const reload = backend.waitForNextNotification(ViewerMethods.reload);
    await page.getByLabel('Reload the content').click();
    await reload;

    const openInBrowser = backend.waitForNextNotification(ViewerMethods.openInBrowser);
    await page.getByLabel('Open the content in the default browser').click();
    await openInBrowser;

    const openInEditor = backend.waitForNextNotification(ViewerMethods.openInEditor);
    await page.getByLabel('Open the content in an editor tab').click();
    await openInEditor;
});
