import { expect, test, type Page } from '@playwright/test';
import { openWebviewPage } from '../harness/page';
import { PlotEditorMethods, PlotsMethods, SessionMethods, createSession, registerPlotsDefaults } from '../harness/domains';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><text>中文 + 50%</text></svg>';
type ImageRecord = { mime: string; bytes: number[] };

async function installClipboard(page: Page, mode: 'svg' | 'png' | 'denied' | 'unavailable') {
    await page.addInitScript(({ mode }) => {
        const records: { mime: string; bytes: number[] }[] = [];
        Object.assign(window, { __plotClipboardImages: records });
        class Item {
            constructor(readonly items: Record<string, Blob>) { }
            static supports(type: string) { return type === 'image/png' || (mode === 'svg' && type === 'image/svg+xml'); }
        }
        Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: mode === 'unavailable' ? undefined : Item });
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                async write(items: Item[]) {
                    if (mode === 'denied') throw new DOMException('Permission denied', 'NotAllowedError');
                    for (const item of items) {
                        for (const [mime, blob] of Object.entries(item.items)) {
                            records.push({ mime, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
                        }
                    }
                },
                async writeText() { throw new Error('Image must not be copied as text'); },
            },
        });
    }, { mode });
}

async function records(page: Page): Promise<ImageRecord[]> {
    return page.evaluate(() => (window as unknown as { __plotClipboardImages: ImageRecord[] }).__plotClipboardImages);
}

async function openPlot(page: Page, domain: 'plots' | 'plotEditor', data: string) {
    const backend = await openWebviewPage(page, domain, {
        configure(mock) {
            if (domain === 'plots') {
                registerPlotsDefaults(mock, {
                    plots: [{ id: 'plot-1', sessionId: 'session-1', kind: 'static', initialData: data }],
                    selectedPlotId: 'plot-1',
                });
                mock.onRequest(PlotsMethods.copy, () => ({ success: false, error: 'Image clipboard unavailable' }));
            }
        },
    });
    if (domain === 'plots') {
        await expect.poll(() => backend.notificationCount(PlotsMethods.ready)).toBeGreaterThan(0);
        await backend.notify(SessionMethods.info, { sessions: [createSession()], activeSessionId: 'session-1' });
    } else {
        await expect.poll(() => backend.notificationCount(PlotEditorMethods.ready)).toBeGreaterThan(0);
        await backend.notify(PlotEditorMethods.renderResult, { data, mimeType: 'image/svg+xml' });
    }
    await expect(page.locator('img.plot')).toHaveAttribute('src', data);
    return backend;
}

for (const domain of ['plots', 'plotEditor'] as const) {
    for (const [name, data] of [
        ['utf8', `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`],
        ['charset', `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`],
        ['base64', `data:image/svg+xml;charset=UTF-8;base64,${Buffer.from(svg).toString('base64')}`],
    ]) {
        test(`${domain} copies ${name} SVG as the original Unicode bytes`, async ({ page }) => {
            await installClipboard(page, 'svg');
            await openPlot(page, domain, data);
            await page.getByLabel('Copy plot to clipboard').click();
            await expect.poll(() => records(page)).toEqual([{ mime: 'image/svg+xml', bytes: Array.from(Buffer.from(svg)) }]);
        });
    }

    test(`${domain} converts SVG to real PNG bytes when clipboard only accepts PNG`, async ({ page }) => {
        await installClipboard(page, 'png');
        await openPlot(page, domain, `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
        await page.getByLabel('Copy plot to clipboard').click();
        await expect.poll(async () => (await records(page)).length).toBe(1);
        const [image] = await records(page);
        expect(image.mime).toBe('image/png');
        expect(image.bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        // PNG IHDR stores the rasterized image dimensions at byte offsets 16 and 20.
        expect(Buffer.from(image.bytes).readUInt32BE(16)).toBe(32);
        expect(Buffer.from(image.bytes).readUInt32BE(20)).toBe(24);
    });

    for (const mode of ['denied', 'unavailable'] as const) {
        test(`${domain} reports ${mode} image clipboard and keeps Save available`, async ({ page }) => {
            await installClipboard(page, mode);
            const backend = await openPlot(page, domain, `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
            await page.getByLabel('Copy plot to clipboard').click();
            await expect(page.getByText('Image could not be copied. Use Save Plot to export it.')).toBeVisible();
            await expect(page.getByLabel('Save plot')).toBeEnabled();
            await expect.poll(() => domain === 'plots'
                ? backend.requestCount(PlotsMethods.copy)
                : backend.notificationCount(PlotEditorMethods.copy)).toBe(1);
            expect(await records(page)).toEqual([]);
        });
    }
}
