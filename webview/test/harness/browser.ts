import type { Page } from '@playwright/test';

type ClipboardMode = 'supported' | 'unsupported';

export async function installClipboardMock(
    page: Page,
    mode: ClipboardMode = 'supported',
): Promise<void> {
    await page.addInitScript(({ clipboardMode }) => {
        type ClipboardRecord =
            | { kind: 'writeText'; text: string }
            | { kind: 'write'; itemCount: number };

        const records: ClipboardRecord[] = [];

        const clipboard = {
            writeText: async (text: string) => {
                records.push({
                    kind: 'writeText',
                    text,
                });
            },
            write: async (items: unknown[]) => {
                records.push({
                    kind: 'write',
                    itemCount: Array.isArray(items) ? items.length : 0,
                });
            },
        };

        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: clipboard,
        });

        if (clipboardMode === 'supported') {
            class ClipboardItemMock {
                static supports(_type: string) {
                    return true;
                }

                constructor(
                    public readonly items: Record<string, Blob>,
                ) {}
            }

            Object.defineProperty(window, 'ClipboardItem', {
                configurable: true,
                value: ClipboardItemMock,
            });
        } else {
            Object.defineProperty(window, 'ClipboardItem', {
                configurable: true,
                value: undefined,
            });
        }

        (
            globalThis as typeof globalThis & {
                __arkClipboardRecords?: ClipboardRecord[];
            }
        ).__arkClipboardRecords = records;
    }, { clipboardMode: mode });
}

export async function clearClipboardRecords(page: Page): Promise<void> {
    await page.evaluate(() => {
        const records = (
            globalThis as typeof globalThis & {
                __arkClipboardRecords?: unknown[];
            }
        ).__arkClipboardRecords;
        records?.splice(0, records.length);
    });
}

export async function getClipboardRecords(page: Page): Promise<Array<{
    kind: 'writeText' | 'write';
    text?: string;
    itemCount?: number;
}>> {
    return page.evaluate(() => {
        return (
            globalThis as typeof globalThis & {
                __arkClipboardRecords?: Array<{
                    kind: 'writeText' | 'write';
                    text?: string;
                    itemCount?: number;
                }>;
            }
        ).__arkClipboardRecords ?? [];
    });
}
