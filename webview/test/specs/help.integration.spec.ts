import { expect, test, type Frame, type Page } from '@playwright/test';
import { HelpMethods, createHelpFixtureUrl } from '../harness/domains';
import { openWebviewPage } from '../harness/page';

async function getHelpFrame(page: Page) {
    await expect.poll(() => page.frame({ url: /help-frame\.html$/ }) !== null).toBe(true);
    return page.frame({ url: /help-frame\.html$/ })!;
}

async function consumeFrameMessages(frame: Frame) {
    return frame.evaluate(() => {
        return (
            window as Window & {
                __helpFixture: {
                    consumeMessages: () => Array<{ id: string; findValue?: string }>;
                };
            }
        ).__helpFixture.consumeMessages();
    });
}

test('help sends theme styles and routes welcome-page navigation through the backend', async ({ page }) => {
    const backend = await openWebviewPage(page, 'help');

    await expect.poll(() => backend.notificationCount(HelpMethods.styles)).toBeGreaterThan(0);
    const stylesNotification = backend.notifications(HelpMethods.styles)[0];
    expect(stylesNotification.params).toMatchObject({
        styles: expect.objectContaining({
            'vscode-editor-background': '#ffffff',
        }),
    });

    const navigateNotification = backend.waitForNextNotification(HelpMethods.navigate);
    await page.getByText('Positron Documentation').click();
    const navigate = await navigateNotification;

    expect(navigate.params).toEqual({
        url: 'https://positron.posit.co/',
    });
});

test('help re-sends styles on theme changes and resets find state for welcome pages', async ({ page }) => {
    const backend = await openWebviewPage(page, 'help');
    const iframeUrl = createHelpFixtureUrl();

    await expect.poll(() => backend.notificationCount(HelpMethods.styles)).toBeGreaterThan(0);
    const initialStylesCount = backend.notificationCount(HelpMethods.styles);

    await backend.notify(HelpMethods.state, {
        entry: {
            sourceUrl: iframeUrl,
            targetUrl: iframeUrl,
            title: 'Fixture Help Topic',
            scrollX: 0,
            scrollY: 0,
        },
        history: [],
        canNavigateBackward: false,
        canNavigateForward: false,
    });

    await backend.notify(HelpMethods.find);
    await expect(page.locator('#help-find-input')).toBeVisible();

    await backend.notify(HelpMethods.state, {
        entry: {
            sourceUrl: 'positron-help://welcome',
            targetUrl: 'positron-help://welcome',
            title: 'Welcome',
            isWelcome: true,
        },
        history: [],
        canNavigateBackward: false,
        canNavigateForward: false,
    });
    await expect(page.locator('#help-find-input')).toHaveCount(0);

    await backend.notify(HelpMethods.find);
    await expect(page.locator('#help-find-input')).toHaveCount(0);

    await backend.notify(HelpMethods.themeChanged);
    await expect.poll(() => backend.notificationCount(HelpMethods.styles)).toBe(initialStylesCount + 1);
});

test('help bridges iframe lifecycle, scroll, find, copy, and execute-command events', async ({ page }) => {
    const backend = await openWebviewPage(page, 'help');
    const iframeUrl = createHelpFixtureUrl();
    const completeNotification = backend.waitForNextNotification(HelpMethods.complete);
    const scrollNotification = backend.waitForNextNotification(HelpMethods.scroll);

    await backend.notify(HelpMethods.state, {
        entry: {
            sourceUrl: iframeUrl,
            targetUrl: iframeUrl,
            title: 'Fixture Help Topic',
            scrollX: 12,
            scrollY: 34,
        },
        history: [
            {
                sourceUrl: iframeUrl,
                targetUrl: iframeUrl,
                title: 'Fixture Help Topic',
            },
        ],
        canNavigateBackward: true,
        canNavigateForward: false,
    });

    expect((await completeNotification).params).toEqual({ title: 'Fixture Help Topic' });

    expect((await scrollNotification).params).toEqual({ scrollX: 12, scrollY: 34 });

    await backend.notify(HelpMethods.find);
    await expect(page.locator('#help-find-input')).toBeVisible();
    await page.locator('#help-find-input').fill('missing');
    await page.locator('#help-find-input').press('Enter');
    await expect(page.getByText('No results')).toBeVisible();

    const frame = await getHelpFrame(page);

    const copySelection = backend.waitForNextNotification(HelpMethods.copySelection);
    await frame.evaluate(() => {
        (window as Window & { __helpFixture: { triggerCopyShortcut: () => void } }).__helpFixture.triggerCopyShortcut();
    });
    const copyNotification = await copySelection;
    expect(copyNotification.params).toEqual({ selection: 'fixture selection' });

    const executeCommand = backend.waitForNextNotification(HelpMethods.executeCommand);
    await frame.evaluate(() => {
        (
            window as Window & {
                __helpFixture: { triggerExecuteCommand: (command: string) => void };
            }
        ).__helpFixture.triggerExecuteCommand('workbench.action.findInFiles');
    });
    const executeNotification = await executeCommand;
    expect(executeNotification.params).toEqual({ command: 'workbench.action.findInFiles' });
});

test('help proxies iframe navigation events and drives iframe find commands', async ({ page }) => {
    const backend = await openWebviewPage(page, 'help');
    const iframeUrl = createHelpFixtureUrl();

    await backend.notify(HelpMethods.state, {
        entry: {
            sourceUrl: iframeUrl,
            targetUrl: iframeUrl,
            title: 'Fixture Help Topic',
            scrollX: 0,
            scrollY: 0,
        },
        history: [],
        canNavigateBackward: true,
        canNavigateForward: true,
    });

    const frame = await getHelpFrame(page);
    await consumeFrameMessages(frame);

    const navigate = backend.waitForNextNotification(HelpMethods.navigate);
    await frame.evaluate(() => {
        (
            window as Window & {
                __helpFixture: { triggerNavigate: (url: string) => void };
            }
        ).__helpFixture.triggerNavigate('https://example.com/article');
    });
    expect((await navigate).params).toEqual({ url: 'https://example.com/article' });

    const navigateBackward = backend.waitForNextNotification(HelpMethods.navigateBackward);
    await frame.evaluate(() => {
        (
            window as Window & {
                __helpFixture: { triggerBackward: () => void };
            }
        ).__helpFixture.triggerBackward();
    });
    await navigateBackward;

    const navigateForward = backend.waitForNextNotification(HelpMethods.navigateForward);
    await frame.evaluate(() => {
        (
            window as Window & {
                __helpFixture: { triggerForward: () => void };
            }
        ).__helpFixture.triggerForward();
    });
    await navigateForward;

    await backend.notify(HelpMethods.find);
    const findInput = page.locator('#help-find-input');
    await expect(findInput).toBeVisible();

    await consumeFrameMessages(frame);
    await findInput.fill('topic');
    await expect.poll(async () => {
        const messages = await consumeFrameMessages(frame);
        return messages.some((message) => message.id === 'positron-help-update-find' && message.findValue === 'topic');
    }).toBe(true);

    await consumeFrameMessages(frame);
    await page.getByLabel('Previous Match').click();
    await expect.poll(async () => {
        const messages = await consumeFrameMessages(frame);
        return messages.some((message) => message.id === 'positron-help-find-previous' && message.findValue === 'topic');
    }).toBe(true);

    await consumeFrameMessages(frame);
    await page.getByLabel('Next Match').click();
    await expect.poll(async () => {
        const messages = await consumeFrameMessages(frame);
        return messages.some((message) => message.id === 'positron-help-find-next' && message.findValue === 'topic');
    }).toBe(true);

    await consumeFrameMessages(frame);
    await findInput.press('Escape');
    await expect(page.locator('#help-find-input')).toHaveCount(0);
    await expect.poll(async () => {
        const messages = await consumeFrameMessages(frame);
        return messages.some((message) => message.id === 'positron-help-update-find' && message.findValue === undefined);
    }).toBe(true);
});

test('help sends history and navigation actions back to the extension host', async ({ page }) => {
    const backend = await openWebviewPage(page, 'help');
    const iframeUrl = createHelpFixtureUrl();

    await backend.notify(HelpMethods.state, {
        entry: {
            sourceUrl: iframeUrl,
            targetUrl: iframeUrl,
            title: 'Fixture Help Topic',
            scrollX: 0,
            scrollY: 0,
        },
        history: [
            {
                sourceUrl: 'https://example.com/older',
                targetUrl: 'https://example.com/older',
                title: 'Older Topic',
            },
            {
                sourceUrl: iframeUrl,
                targetUrl: iframeUrl,
                title: 'Fixture Help Topic',
            },
        ],
        canNavigateBackward: true,
        canNavigateForward: true,
    });

    const navigateBackward = backend.waitForNextNotification(HelpMethods.navigateBackward);
    await page.getByLabel('Previous topic').click();
    await navigateBackward;

    const navigateForward = backend.waitForNextNotification(HelpMethods.navigateForward);
    await page.getByLabel('Next topic').click();
    await navigateForward;

    const openHistory = backend.waitForNextNotification(HelpMethods.openHistory);
    await page.getByLabel('Help history').click();
    await page.getByText('Older Topic').click();
    expect((await openHistory).params).toEqual({ index: 0 });

    const showWelcome = backend.waitForNextNotification(HelpMethods.showWelcome);
    await page.getByLabel('Show help home').click();
    await showWelcome;
});
