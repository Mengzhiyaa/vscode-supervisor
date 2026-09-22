import * as vscode from 'vscode';
import { decodeImageDataUri, imageExtension, imageFileName } from '../shared/imageDataUri';

/** Cancellation returns undefined; decoding and filesystem errors reach the caller. */
export async function savePlotImage(
    data: string,
    fallbackName: string,
    suggestedFileName?: string,
): Promise<vscode.Uri | undefined> {
    const image = decodeImageDataUri(data);
    const extension = imageExtension(image.mimeType);
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(imageFileName(image.mimeType, fallbackName, suggestedFileName)),
        filters: { [`${extension.toUpperCase()} Image`]: [extension] },
    });
    if (uri) {
        await vscode.workspace.fs.writeFile(uri, image.bytes);
    }
    return uri;
}

/** The public VS Code clipboard API cannot write image bytes. */
export async function offerPlotImageExport(save: () => Promise<unknown>): Promise<string> {
    const message = vscode.l10n.t('Image clipboard is not available in this environment.');
    const action = vscode.l10n.t('Save Plot');
    if (await vscode.window.showWarningMessage(message, action) === action) {
        await save();
    }
    return message;
}
