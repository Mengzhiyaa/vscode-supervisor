/*---------------------------------------------------------------------------------------------
 *  Data Explorer URI helpers
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const DataExplorerEditorScheme = 'supervisor-data-explorer';

export function createDataExplorerEditorUri(identifier: string): vscode.Uri {
    return vscode.Uri.from({
        scheme: DataExplorerEditorScheme,
        path: `/${encodeURIComponent(identifier)}`,
    });
}

export function getDataExplorerIdentifier(uri: vscode.Uri): string | undefined {
    if (uri.scheme !== DataExplorerEditorScheme || uri.path.length <= 1) {
        return undefined;
    }
    try {
        return decodeURIComponent(uri.path.slice(1));
    } catch {
        return undefined;
    }
}

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

/** Whether the backing file exposes configurable import options. */
export function supportsDataExplorerFileOptions(identifier: string): boolean {
    const backingUri = getDataExplorerBackingUri(identifier);
    if (!backingUri) {
        return false;
    }
    const normalizedPath = backingUri.path.toLowerCase();
    return isPlaintextDataExplorerIdentifier(identifier) || normalizedPath.endsWith('.xlsx');
}

export function isSpreadsheetDataExplorerIdentifier(identifier: string): boolean {
    return getDataExplorerBackingUri(identifier)?.path.toLowerCase().endsWith('.xlsx') ?? false;
}
