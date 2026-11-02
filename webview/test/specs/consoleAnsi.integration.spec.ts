import { expect, test, type Page } from '@playwright/test';
import { ConsoleMethods, registerConsoleDefaults } from '../harness/domains';
import { openWebviewPage } from '../harness/page';

const sessionId = 'session-1';
const parentId = 'ansi-activity';

function stream(id: string, text: string, streamType: 'output' | 'error' = 'output') {
    return { type: 'stream' as const, id, parentId, when: 1, streamType, text };
}

async function openConsoleOutput(
    page: Page,
    text: string,
    streamType: 'output' | 'error' = 'output',
) {
    const backend = await openWebviewPage(page, 'console', { configure: registerConsoleDefaults });
    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId,
        syncSeq: 1,
        state: {
            version: 1,
            items: [
                { type: 'activity', parentId, items: [stream('initial-stream', text, streamType)] },
            ],
            inputHistory: [],
            trace: false,
            wordWrap: true,
            inputPrompt: '> ',
            continuationPrompt: '+ ',
            workingDirectory: '/workspace',
        },
    });
    const activity = page.locator(`[data-execution-id="${parentId}"]`);
    await expect(activity).toBeAttached();
    return { backend, activity };
}

for (const streamType of ['output', 'error'] as const) {
    test(`ANSI ${streamType} retains color through fragmented CSI and restores the default color`, async ({
        page,
    }) => {
        const { backend, activity } = await openConsoleOutput(page, 'prefix ', streamType);
        await page.evaluate(() => {
            document.documentElement.style.setProperty(
                '--vscode-positronConsole-ansiRed',
                '#d02030',
            );
        });
        const prefix = activity.locator('.output-run').filter({ hasText: /^prefix $/ });
        await expect(prefix).toHaveCount(1);
        const defaultColor = await prefix.evaluate((node) => getComputedStyle(node).color);

        for (const [index, text] of ['\x1b[31', 'mred', 'der\x1b[0m plain'].entries()) {
            await backend.notify(ConsoleMethods.runtimeChanges, {
                sessionId,
                syncSeq: index + 2,
                changes: [
                    {
                        kind: 'appendActivityItem',
                        parentId,
                        activityItem: stream(`stream-${index}`, text, streamType),
                    },
                ],
            });
            if (index === 0) {
                await expect(activity.locator('.console-output-lines')).toHaveText('prefix');
            } else {
                const redText = index === 1 ? /^red$/ : /^redder$/;
                await expect(
                    activity.locator('.output-run').filter({ hasText: redText }),
                ).toHaveCSS('color', 'rgb(208, 32, 48)');
            }
        }
        await expect(activity.locator('.console-output-lines')).toHaveCount(1);
        await expect(activity.locator('.console-output-lines')).toHaveText('prefix redder plain');
        await expect(activity.locator('.output-run').filter({ hasText: /^ plain$/ })).toHaveCSS(
            'color',
            defaultColor,
        );
        expect(backend.requestCount(ConsoleMethods.requestFullState)).toBe(0);
    });
}

test('ANSI RGB foreground and background colors reach the rendered output', async ({ page }) => {
    const { activity } = await openConsoleOutput(
        page,
        '\x1b[38;2;12;34;56;48;2;70;80;90mRGB\x1b[0m plain',
    );
    const colored = activity.locator('.output-run').filter({ hasText: /^RGB$/ });
    await expect(colored).toHaveCSS('color', 'rgb(12, 34, 56)');
    await expect(colored).toHaveCSS('background-color', 'rgb(70, 80, 90)');
    await expect(activity.locator('.output-run').filter({ hasText: /^ plain$/ })).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
    );
});

test('ANSI OSC 8 file links open the parameter or URL position on the Host', async ({ page }) => {
    const cases = [
        {
            label: 'first location',
            params: 'line=12:col=3',
            url: 'file:///workspace/source.R',
            path: 'file:///workspace/source.R',
            line: 12,
            column: 3,
        },
        {
            label: 'second location',
            params: 'line=24:col=5',
            url: 'file:///workspace/source.R',
            path: 'file:///workspace/source.R',
            line: 24,
            column: 5,
        },
        {
            label: 'URL suffix',
            params: '',
            url: 'file:///workspace/other.R:7:2',
            path: 'file:///workspace/other.R',
            line: 7,
            column: 2,
        },
        {
            label: 'URL fragment',
            params: '',
            url: 'file:///workspace/fragment.R#9,4',
            path: 'file:///workspace/fragment.R',
            line: 9,
            column: 4,
        },
        {
            label: 'Windows path',
            params: 'line=6:col=2',
            url: 'file://C:\\work\\source.R',
            path: 'file:///C:/work/source.R',
            line: 6,
            column: 2,
        },
    ];
    const text = cases
        .map(({ params, url, label }) => `\x1b]8;${params};${url}\x1b\\${label}\x1b]8;;\x1b\\`)
        .join('');
    const { backend, activity } = await openConsoleOutput(page, text);
    await expect(activity.getByRole('link')).toHaveCount(cases.length);
    for (const { label, path, line, column } of cases) {
        const opened = backend.waitForNextNotification(ConsoleMethods.openFile);
        await activity.getByRole('link', { name: label, exact: true }).click();
        expect((await opened).params).toEqual({ sessionId, path, line, column });
    }
    expect(backend.notificationCount(ConsoleMethods.openExternal)).toBe(0);
    await expect(page).toHaveURL(/\/test-pages\/console\.html$/);
});

test('ANSI OSC 8 remains a working link when its URL and terminators arrive in separate messages', async ({
    page,
}) => {
    const { backend, activity } = await openConsoleOutput(page, 'prefix ');
    const chunks = [
        '\x1b]8;line=18:col=2;file:///workspace/',
        'split.R\x1b',
        '\\split source\x1b]8;;\x1b',
        '\\ plain',
    ];
    for (const [index, text] of chunks.entries()) {
        await backend.notify(ConsoleMethods.runtimeChanges, {
            sessionId,
            syncSeq: index + 2,
            changes: [
                {
                    kind: 'appendActivityItem',
                    parentId,
                    activityItem: stream(`osc-${index}`, text),
                },
            ],
        });
    }
    const link = activity.getByRole('link', { name: 'split source', exact: true });
    await expect(link).toBeVisible();
    const opened = backend.waitForNextNotification(ConsoleMethods.openFile);
    await link.click();
    expect((await opened).params).toEqual({
        sessionId,
        path: 'file:///workspace/split.R',
        line: 18,
        column: 2,
    });
    await expect(activity.locator('.console-output-lines')).toHaveText('prefix split source plain');
});

test('ANSI OSC 8 HTTP links use the Host external opener', async ({ page }) => {
    const { backend, activity } = await openConsoleOutput(
        page,
        '\x1b]8;;https://example.com/docs\x1b\\documentation\x1b]8;;\x1b\\',
    );
    const opened = backend.waitForNextNotification(ConsoleMethods.openExternal);
    await activity.getByRole('link', { name: 'documentation', exact: true }).click();
    expect((await opened).params).toEqual({ url: 'https://example.com/docs' });
    expect(backend.notificationCount(ConsoleMethods.openFile)).toBe(0);
    await expect(page).toHaveURL(/\/test-pages\/console\.html$/);
});
