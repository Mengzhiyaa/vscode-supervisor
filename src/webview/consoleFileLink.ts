import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

export interface ConsoleFileLocation {
    path: string;
    line: number;
    column?: number;
}

/** Resolve output paths on the extension host, never relative to its process cwd. */
export function resolveConsoleFileUri(filePath: string, workingDirectory?: string): vscode.Uri {
    if (typeof filePath !== 'string' || !filePath || /[\x00-\x1f\x7f]/.test(filePath)) {
        throw new Error('Invalid console file path');
    }
    if (/^file:/i.test(filePath)) {
        const uri = vscode.Uri.parse(filePath, true);
        if (!uri.path.startsWith('/')) {
            throw new Error('Expected an absolute file URI');
        }
        return uri.with({ query: '', fragment: '' });
    }
    const windowsPath = /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\');
    if (windowsPath && process.platform !== 'win32') {
        throw new Error('Windows file path cannot be opened on this host');
    }
    if (!windowsPath && /^[A-Za-z][A-Za-z\d+.-]*:/.test(filePath)) {
        throw new Error('Only file paths are supported');
    }
    if (/^~[\\/]/.test(filePath)) {
        filePath = path.join(os.homedir(), filePath.slice(2));
    }
    if (path.isAbsolute(filePath)) {
        return vscode.Uri.file(path.normalize(filePath));
    }
    if (!workingDirectory || !path.isAbsolute(workingDirectory)) {
        throw new Error('Console working directory is unavailable');
    }
    return vscode.Uri.file(path.resolve(workingDirectory, filePath));
}

export async function openConsoleFile(location: ConsoleFileLocation, workingDirectory?: string): Promise<void> {
    if (!Number.isSafeInteger(location.line) || location.line < 1 ||
        (location.column !== undefined && (!Number.isSafeInteger(location.column) || location.column < 1))) {
        throw new Error('Invalid console file position');
    }
    const uri = resolveConsoleFileUri(location.path, workingDirectory);
    const document = await vscode.workspace.openTextDocument(uri);
    const position = document.validatePosition(new vscode.Position(location.line - 1, (location.column ?? 1) - 1));
    await vscode.window.showTextDocument(document, {
        selection: new vscode.Selection(position, position),
        preview: true,
        preserveFocus: false,
    });
}
