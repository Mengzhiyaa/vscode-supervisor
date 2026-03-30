import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const configDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    testDir: './specs',
    timeout: 30_000,
    fullyParallel: true,
    expect: {
        timeout: 5_000,
    },
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 2 : undefined,
    use: {
        baseURL: 'http://127.0.0.1:4173',
        headless: true,
        viewport: { width: 1440, height: 960 },
    },
    webServer: {
        command: 'node server.mjs',
        port: 4173,
        reuseExistingServer: !process.env.CI,
        cwd: configDir,
        timeout: 30_000,
    },
});
