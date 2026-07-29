import type { Page } from '@playwright/test';
import { MockWebviewBackend } from './mockWebviewBackend';

export const TEST_BASE_URL = 'http://127.0.0.1:4173';

export async function openWebviewPage(
    page: Page,
    domain:
        | 'console'
        | 'variables'
        | 'plots'
        | 'viewer'
        | 'help'
        | 'packages'
        | 'dataExplorer'
        | 'plotEditor',
    options: {
        initialState?: unknown;
        configure?: (backend: MockWebviewBackend) => void;
    } = {},
): Promise<MockWebviewBackend> {
    const backend = await MockWebviewBackend.attach(page, options.initialState);
    if (domain === 'viewer') {
        backend.onRequest('viewer/getDefaultOpenTarget', () => ({ target: 'browser' }));
        backend.onRequest('viewer/open', () => ({ success: true }));
    }
    if (domain === 'packages') {
        backend.onRequest('packages/getState', () => ({
            packages: [],
            busy: false,
            itemSize: 'card',
        }));
    }
    options.configure?.(backend);
    await page.goto(`${TEST_BASE_URL}/test-pages/${domain}.html`);
    return backend;
}
