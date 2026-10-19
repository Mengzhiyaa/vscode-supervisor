import * as vscode from 'vscode';
import { decodeImageDataUri, imageExtension, imageFileName } from '../shared/imageDataUri';
import type { PlotClientInstance } from './PlotClientInstance';
import { PlotRenderFormat } from './comms/positronPlotComm';
import { decodeImageDataUrl } from './imageDataUrl';

/** Export settings never change the plot's display sizing policy or cached image. */
export async function saveDynamicPlot(plot: PlotClientInstance): Promise<vscode.Uri | undefined> {
    const format = await vscode.window.showQuickPick(
        [
            { label: 'PNG', format: PlotRenderFormat.Png },
            { label: 'SVG', format: PlotRenderFormat.Svg },
            { label: 'JPEG', format: PlotRenderFormat.Jpeg },
            { label: 'PDF', format: PlotRenderFormat.Pdf },
            { label: 'TIFF', format: PlotRenderFormat.Tiff },
        ],
        {
            title: vscode.l10n.t('Export Plot'),
            placeHolder: vscode.l10n.t('Select the export format'),
        },
    );
    if (!format) {
        return undefined;
    }
    const intrinsic = await plot.getIntrinsicSize();
    const sizeMode = intrinsic
        ? await vscode.window.showQuickPick(
              [
                  { label: vscode.l10n.t('Custom dimensions'), intrinsic: false },
                  { label: vscode.l10n.t('Intrinsic size'), intrinsic: true },
              ],
              { title: vscode.l10n.t('Export Plot') },
          )
        : { intrinsic: false };
    if (!sizeMode) {
        return undefined;
    }
    let size: { width: number; height: number } | undefined;
    if (!sizeMode.intrinsic) {
        const dimensions = await vscode.window.showInputBox({
            title: vscode.l10n.t('Export Plot'),
            prompt: vscode.l10n.t('Width x height in logical pixels'),
            value: `${plot.lastRender?.size?.width ?? 800} x ${plot.lastRender?.size?.height ?? 600}`,
            validateInput: (value) =>
                /^\s*[1-9]\d*\s*[x×]\s*[1-9]\d*\s*$/.test(value) &&
                value.split(/[x×]/).every((part) => Number.isSafeInteger(Number(part)))
                    ? undefined
                    : vscode.l10n.t('Enter positive integer dimensions, for example 800 x 600.'),
        });
        if (dimensions === undefined) {
            return undefined;
        }
        const [width, height] = dimensions.split(/[x×]/).map(Number);
        size = { width, height };
    }
    const ratio = await vscode.window.showInputBox({
        title: vscode.l10n.t('Export Plot'),
        prompt: vscode.l10n.t('Pixel ratio (1 is standard resolution)'),
        value: String(plot.lastRender?.pixel_ratio ?? 1),
        validateInput: (value) =>
            Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 10
                ? undefined
                : vscode.l10n.t('Enter a pixel ratio greater than 0 and no greater than 10.'),
    });
    if (ratio === undefined) {
        return undefined;
    }
    const rendered = await plot.renderForExport(size, Number(ratio), format.format);
    if (format.format !== PlotRenderFormat.Pdf) {
        return savePlotImage(rendered.uri, `plot-${plot.id}`, plot.metadata.suggested_file_name);
    }
    const pdf = decodeImageDataUrl(rendered.uri);
    if (pdf.mimeType !== 'application/pdf') {
        throw new Error(vscode.l10n.t('The runtime did not return a PDF plot.'));
    }
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
            imageFileName('image/pdf', `plot-${plot.id}`, plot.metadata.suggested_file_name),
        ),
        filters: { PDF: ['pdf'] },
    });
    if (uri) {
        await vscode.workspace.fs.writeFile(uri, pdf.bytes);
    }
    return uri;
}

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
    if ((await vscode.window.showWarningMessage(message, action)) === action) {
        await save();
    }
    return message;
}
