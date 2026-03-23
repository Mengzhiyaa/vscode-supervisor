/*---------------------------------------------------------------------------------------------
 *  Data Explorer URI helpers
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const PLAINTEXT_BACKING_EXTENSIONS = [
    '.csv',
    '.tsv',
];

/**
 * Parse the backing URI encoded in a DuckDB-backed data explorer identifier.
 */
export function getDataExplorerBackingUri(identifier: string): vscode.Uri | undefined {
    if (!identifier.startsWith('duckdb:')) {
        return undefined;
    }

    const rawUri = identifier.slice('duckdb:'.length);
    if (!rawUri) {
        return undefined;
    }

    try {
        return vscode.Uri.parse(rawUri, true);
    } catch {
        return undefined;
    }
}

/**
 * Whether the backing URI should be treated as a plain text file.
 */
export function isPlaintextDataExplorerIdentifier(identifier: string): boolean {
    const backingUri = getDataExplorerBackingUri(identifier);
    if (!backingUri) {
        return false;
    }

    const normalizedPath = backingUri.path.toLowerCase();
    return PLAINTEXT_BACKING_EXTENSIONS.some(extension => normalizedPath.endsWith(extension));
}
