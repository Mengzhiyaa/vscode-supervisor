import * as vscode from 'vscode';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { createGunzip } from 'zlib';

const MiB = 1024 * 1024;

export function throwIfImportCancelled(token?: vscode.CancellationToken): void {
    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
}

function getLimit(name: string, defaultMB: number): number {
    const value = vscode.workspace.getConfiguration('dataExplorer').get<number>(name, defaultMB);
    return (Number.isFinite(value) && value >= 1 ? Math.min(value, 1024) : defaultMB) * MiB;
}

function checkSize(size: number, limit: number, setting: string): void {
    if (size > limit) {
        throw new Error(
            `Data import exceeds the ${limit / MiB} MB limit. ` +
            `Choose a smaller file or increase dataExplorer.${setting}.`,
        );
    }
}

async function collect(
    stream: Readable,
    limit: number,
    setting: string,
    token: vscode.CancellationToken,
    progress: vscode.Progress<{ message?: string }>,
): Promise<Uint8Array> {
    const cancellation = token.onCancellationRequested(() => {
        stream.destroy(new vscode.CancellationError());
    });
    const chunks: Buffer[] = [];
    let total = 0;
    let lastReport = 0;
    try {
        throwIfImportCancelled(token);
        for await (const chunk of stream) {
            throwIfImportCancelled(token);
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += bytes.byteLength;
            checkSize(total, limit, setting);
            chunks.push(bytes);
            if (Date.now() - lastReport > 200) {
                progress.report({ message: `${(total / MiB).toFixed(1)} MB` });
                lastReport = Date.now();
            }
        }
        throwIfImportCancelled(token);
        return Buffer.concat(chunks, total);
    } finally {
        cancellation.dispose();
        stream.destroy();
    }
}

/** Read local files incrementally; enforce limits before allocating and while decompressing. */
export async function readImportFile(
    uri: vscode.Uri,
    gzipped: boolean,
    token: vscode.CancellationToken,
    progress: vscode.Progress<{ message?: string }>,
): Promise<Uint8Array> {
    const fileLimit = getLimit('maxImportFileSizeMB', 256);
    const unpackedLimit = getLimit('maxDecompressedFileSizeMB', 512);
    throwIfImportCancelled(token);
    const stat = await vscode.workspace.fs.stat(uri);
    throwIfImportCancelled(token);
    checkSize(stat.size, fileLimit, 'maxImportFileSizeMB');

    progress.report({ message: 'Reading file…' });
    let data: Uint8Array;
    if (uri.scheme === 'file') {
        data = await collect(createReadStream(uri.fsPath), fileLimit, 'maxImportFileSizeMB', token, progress);
    } else {
        // VS Code file-system providers expose whole-file reads, without cancellation.
        data = await vscode.workspace.fs.readFile(uri);
        throwIfImportCancelled(token);
        checkSize(data.byteLength, fileLimit, 'maxImportFileSizeMB');
    }

    if (!gzipped) {
        return data;
    }
    progress.report({ message: 'Decompressing file…' });
    const input = Readable.from([data]);
    const decompressor = createGunzip();
    try {
        input.pipe(decompressor);
        return await collect(decompressor, unpackedLimit, 'maxDecompressedFileSizeMB', token, progress);
    } finally {
        input.destroy();
        decompressor.destroy();
    }
}
