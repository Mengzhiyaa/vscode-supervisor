import * as vscode from 'vscode';

export type CancellationToken = vscode.CancellationToken;
export const CancellationToken = {
    None: {
        isCancellationRequested: false,
        onCancellationRequested: () => new vscode.Disposable(() => {}),
    } as vscode.CancellationToken,
};
export const CancellationTokenSource = vscode.CancellationTokenSource;
export type CancellationTokenSource = vscode.CancellationTokenSource;
export const CancellationError = vscode.CancellationError;

export function isCancellationError(error: unknown): boolean {
    return (
        error instanceof vscode.CancellationError ||
        (error instanceof Error &&
            (error.name === 'Canceled' || error.name === 'CancellationError'))
    );
}

export async function raceCancellationError<T>(
    promise: Promise<T>,
    token: CancellationToken,
): Promise<T> {
    if (token.isCancellationRequested) {
        throw new CancellationError();
    }
    let subscription: vscode.Disposable | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                subscription = token.onCancellationRequested(() => reject(new CancellationError()));
                if (token.isCancellationRequested) {
                    reject(new CancellationError());
                }
            }),
        ]);
    } finally {
        subscription?.dispose();
    }
}

export async function raceTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<undefined>((resolve) => {
                timer = setTimeout(() => resolve(undefined), Math.max(0, timeoutMs));
            }),
        ]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}
