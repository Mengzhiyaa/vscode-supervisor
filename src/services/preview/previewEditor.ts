import * as vscode from 'vscode';

/** Shared editor-backed browser route for runtime events and Viewer actions. */
export async function openPreviewInEditor(
    uri: vscode.Uri,
    outputChannel: vscode.LogOutputChannel,
): Promise<boolean> {
    try {
        await vscode.commands.executeCommand('simpleBrowser.api.open', uri, {
            preserveFocus: false,
            viewColumn: vscode.ViewColumn.Active,
        });
        return true;
    } catch (error) {
        outputChannel.debug(`[PreviewEditor] simpleBrowser.api.open failed for ${uri}: ${error}`);
    }

    try {
        await vscode.commands.executeCommand('simpleBrowser.show', uri.toString(true));
        return true;
    } catch (error) {
        outputChannel.warn(`[PreviewEditor] Failed to open ${uri} in an editor: ${error}`);
        return false;
    }
}
