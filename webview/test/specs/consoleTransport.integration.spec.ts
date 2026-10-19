import { expect, test, type Page } from '@playwright/test';
import {
    ConsoleMethods,
    SessionMethods,
    createSession,
    registerConsoleDefaults,
} from '../harness/domains';
import { MockWebviewBackend } from '../harness/mockWebviewBackend';
import { TEST_BASE_URL } from '../harness/page';

async function openConsoleInPreloadFrame(page: Page) {
    const backend = await MockWebviewBackend.attach(page);
    backend.usePreloadFrame('#webview');
    registerConsoleDefaults(backend, { sessions: [] });
    await page.addInitScript(() => {
        if (window.name === 'supervisor-webview') {
            // Match VS Code's API preload before the console bundle loads.
            Reflect.set(window, 'parent', window);
            Reflect.set(window, 'top', window);
            Reflect.set(window, 'frameElement', null);
        }
    });
    await page.goto(`${TEST_BASE_URL}/test-pages/fixtures/console-preload.html`);
    const frame = page.frame({ name: 'supervisor-webview' });
    if (!frame) {
        throw new Error('Missing console content frame');
    }
    await expect.poll(() => backend.notificationCount(ConsoleMethods.ready)).toBeGreaterThan(0);
    expect(await frame.evaluate(() => window.parent === window)).toBe(true);
    return { backend, frame };
}

test('console receives startup notifications and RPC responses from its hidden preload parent', async ({
    page,
}) => {
    const { backend, frame } = await openConsoleInPreloadFrame(page);
    await expect(frame.getByText('Waiting for extensions...')).toBeVisible();

    await backend.notify(ConsoleMethods.runtimeStartupPhase, { phase: 'complete' });
    await expect(frame.getByText('Waiting for extensions...')).toHaveCount(0);
    await expect(frame.getByText('Start Session')).toBeVisible();
    // session/list is sent only after the console/getSettings response arrives.
    await expect.poll(() => backend.requestCount(SessionMethods.list)).toBe(1);

    const session = createSession({ id: 'session-preload', name: 'Preload Session' });
    await backend.notify(SessionMethods.info, { sessions: [session], activeSessionId: session.id });
    await backend.notify(ConsoleMethods.restoreState, {
        sessionId: session.id,
        syncSeq: 1,
        state: {
            version: 1,
            items: [
                {
                    type: 'started',
                    id: 'preload-started',
                    when: Date.now(),
                    sessionName: 'Preload Session',
                },
            ],
            inputHistory: [],
            trace: false,
            wordWrap: true,
            inputPrompt: '> ',
            continuationPrompt: '+ ',
            workingDirectory: '/workspace',
        },
    });
    await expect(frame.getByTestId('console-session-preload')).toBeVisible();
    await expect(frame.locator('.console-input .monaco-editor')).toBeVisible();
    await expect(frame.getByText('Start Session')).toHaveCount(0);
});

test('console rejects RPC messages with a foreign origin even when their source is otherwise trusted', async ({
    page,
}) => {
    const { backend, frame } = await openConsoleInPreloadFrame(page);
    await expect(frame.getByText('Waiting for extensions...')).toBeVisible();
    await frame.evaluate(async (method) => {
        window.dispatchEvent(
            new MessageEvent('message', {
                source: window,
                origin: 'https://untrusted.example',
                data: { jsonrpc: '2.0', method, params: { phase: 'complete' } },
            }),
        );
        await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
    }, ConsoleMethods.runtimeStartupPhase);
    await expect(frame.getByText('Waiting for extensions...')).toBeVisible();
    await expect(frame.getByText('Start Session')).toHaveCount(0);

    await backend.notify(ConsoleMethods.runtimeStartupPhase, { phase: 'complete' });
    await expect(frame.getByText('Start Session')).toBeVisible();
});

for (const nested of [false, true]) {
    test(`console rejects same-origin RPC from a ${nested ? 'nested' : 'direct'} preview frame`, async ({
        page,
    }) => {
        const { backend, frame } = await openConsoleInPreloadFrame(page);
        await expect(frame.getByText('Waiting for extensions...')).toBeVisible();
        const sender = await frame.evaluate(
            async ({ nested, method }) => {
                const marker = 'preview-spoof';
                const payload = JSON.stringify({
                    jsonrpc: '2.0',
                    method,
                    params: { phase: 'complete' },
                    marker,
                });
                const script = `<script>parent${nested ? '.parent' : ''}.postMessage(${payload}, '*')<\/script>`;
                const child = document.createElement('iframe');
                const observed = new Promise<{
                    fromSelf: boolean;
                    fromParent: boolean;
                    sameOrigin: boolean;
                }>((resolve) => {
                    const onMessage = (event: MessageEvent) => {
                        if (event.data?.marker !== marker) {
                            return;
                        }
                        window.removeEventListener('message', onMessage);
                        resolve({
                            fromSelf: event.source === window,
                            fromParent: event.source === window.parent,
                            sameOrigin: event.origin === window.origin,
                        });
                    };
                    window.addEventListener('message', onMessage);
                });
                child.srcdoc = nested
                    ? `<iframe srcdoc="${script.replaceAll('"', '&quot;')}"></iframe>`
                    : script;
                document.body.appendChild(child);
                const result = await observed;
                await new Promise<void>((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                );
                return result;
            },
            { nested, method: ConsoleMethods.runtimeStartupPhase },
        );
        expect(sender).toEqual({ fromSelf: false, fromParent: false, sameOrigin: true });
        await expect(frame.getByText('Waiting for extensions...')).toBeVisible();
        await expect(frame.getByText('Start Session')).toHaveCount(0);

        await backend.notify(ConsoleMethods.runtimeStartupPhase, { phase: 'complete' });
        await expect(frame.getByText('Start Session')).toBeVisible();
    });
}
