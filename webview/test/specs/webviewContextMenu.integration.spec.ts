import { expect, test } from '@playwright/test';
import { openWebviewPage } from '../harness/page';

type WebviewDomain = Parameters<typeof openWebviewPage>[1];

const webviewDomains: WebviewDomain[] = [
    'console',
    'variables',
    'plots',
    'plotEditor',
    'packages',
    'viewer',
    'help',
    'dataExplorer',
];

for (const domain of webviewDomains) {
    test(`${domain} prevents the VS Code default webview context menu`, async ({ page }) => {
        await openWebviewPage(page, domain);

        const eventWasCancelled = await page.evaluate(() => {
            const event = new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
            });

            document.body.dispatchEvent(event);
            return event.defaultPrevented;
        });

        expect(eventWasCancelled).toBe(true);
    });
}
