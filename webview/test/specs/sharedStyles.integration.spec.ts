import { expect, test } from '@playwright/test';
import { openWebviewPage } from '../harness/page';

const domains = [
    'console', 'variables', 'plots', 'plotEditor',
    'packages', 'viewer', 'help', 'dataExplorer',
] as const;

for (const domain of domains) {
    test(`${domain} loads shared icon styles and external fonts`, async ({ page }) => {
        const failedResources: string[] = [];
        const fontUrls = new Set<string>();
        page.on('response', response => {
            const url = response.url();
            if (url.includes('/dist/') && response.status() >= 400) {
                failedResources.push(url);
            }
            if (response.request().resourceType() === 'font') {
                fontUrls.add(url);
            }
        });
        page.on('requestfailed', request => {
            if (request.url().includes('/dist/')) {
                failedResources.push(request.url());
            }
        });

        await openWebviewPage(page, domain);
        await expect(page.locator('link[href="../dist/common/index.css"]')).toHaveCount(1);

        const icons = await page.evaluate(async () => {
            const container = document.createElement('div');
            container.innerHTML = '<span class="codicon codicon-add"></span>' +
                '<span class="codicon codicon-positron-save"></span>';
            document.body.append(container);

            const standard = await document.fonts.load('16px codicon', '\uea60');
            const positron = await document.fonts.load('16px codicon-positron', '\uf232');
            await document.fonts.ready;

            const glyphs = [...container.children].map(element => ({
                fontFamily: getComputedStyle(element).fontFamily,
                content: getComputedStyle(element, '::before').content,
            }));
            container.remove();
            return {
                glyphs,
                standardLoaded: standard.some(font => font.status === 'loaded'),
                positronLoaded: positron.some(font => font.status === 'loaded'),
                stylesheets: [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
                    .map(link => link.getAttribute('href')),
            };
        });

        expect(icons.standardLoaded).toBe(true);
        expect(icons.positronLoaded).toBe(true);
        expect(icons.glyphs[0].fontFamily).toBe('codicon');
        expect(icons.glyphs[0].content).toBe('"\uea60"');
        expect(icons.glyphs[1].fontFamily).toBe('codicon-positron');
        expect(icons.glyphs[1].content).toBe('"\uf232"');
        expect(icons.stylesheets.indexOf('../dist/common/index.css')).toBeLessThan(
            icons.stylesheets.indexOf(`../dist/${domain}/index.css`),
        );
        if (domain === 'console' || domain === 'dataExplorer') {
            expect(icons.stylesheets.indexOf('../dist/setup/index.css')).toBeLessThan(
                icons.stylesheets.indexOf('../dist/common/index.css'),
            );
        }
        expect([...fontUrls].filter(url => /\/dist\/assets\/.*\.ttf(?:\?|$)/.test(url)).length)
            .toBeGreaterThanOrEqual(2);
        expect(failedResources).toEqual([]);

        const entryCss = await page.request.get(`/dist/${domain}/index.css`);
        expect(entryCss.ok()).toBe(true);
        expect(await entryCss.text()).not.toContain('@font-face');
        const sharedCss = await page.request.get('/dist/common/index.css');
        expect(sharedCss.ok()).toBe(true);
        expect(await sharedCss.text()).not.toMatch(/data:font\/[^;]+;base64,/);
    });
}
