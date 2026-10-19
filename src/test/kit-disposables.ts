import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { createUniqueId, normalizePath } from './kit';
import { delay } from './kit-util';

/**
 * Utility to wrap a cleanup function as a vscode.Disposable.
 */
export function toDisposable(fn: () => void | Promise<void>): vscode.Disposable {
    return { dispose: fn };
}

/**
 * Drains the array in LIFO order, awaiting every cleanup and reporting all failures.
 */
export async function disposeAll(disposables: vscode.Disposable[]) {
    const errors: unknown[] = [];
    while (disposables.length > 0) {
        const disposable = disposables.pop()!;
        try {
            await disposable.dispose();
        } catch (error) {
            errors.push(error);
        }
    }
    if (errors.length > 0) {
        throw new AggregateError(errors, 'Failed to dispose test resources');
    }
}

/**
 * Runs a closure with a disposables array, ensuring all disposables are disposed in reverse order after execution.
 */
export async function withDisposables<T>(
    fn: (disposables: vscode.Disposable[]) => Promise<T> | T,
): Promise<T> {
    const disposables: vscode.Disposable[] = [];
    const errors: unknown[] = [];
    let result!: T;
    try {
        result = await fn(disposables);
    } catch (error) {
        errors.push(error);
    }
    try {
        await disposeAll(disposables);
    } catch (error) {
        if (error instanceof AggregateError) {
            errors.push(...error.errors);
        } else {
            errors.push(error);
        }
    }
    if (errors.length === 1) {
        throw errors[0];
    }
    if (errors.length > 1) {
        throw new AggregateError(errors, 'Test body or resource cleanup failed');
    }
    return result;
}

/**
 * Create a unique temporary directory and return its path along with a disposable that deletes it.
 */
export function makeTempDir(component: string): [string, vscode.Disposable] {
    const uniqueId = createUniqueId();
    const dir = path.join(os.tmpdir(), `${component}-${uniqueId}`);

    const normalizedDir = normalizePath(dir);
    fs.mkdirSync(normalizedDir, { recursive: true });

    const disposable = toDisposable(async () => await retryRm(normalizedDir));

    return [normalizedDir, disposable];
}

/**
 * Retries async rm for a directory if EBUSY, with delay.
 */
export async function retryRm(dir: string, retries = 30, delayMs = 20) {
    for (let i = 0; i < retries; i++) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
            return;
        } catch (err: any) {
            if (err.code === 'EBUSY' && i < retries - 1) {
                await delay(delayMs);
            } else {
                throw err;
            }
        }
    }
}
