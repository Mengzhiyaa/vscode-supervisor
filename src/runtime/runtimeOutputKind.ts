import {
    LanguageRuntimeOutput,
    PositronOutputLocation,
    LanguageRuntimeResult,
    LanguageRuntimeUpdateOutput,
    RuntimeOutputKind,
} from '../internal/runtimeTypes';
export { RuntimeOutputKind } from '../internal/runtimeTypes';
import {
    RuntimeOutputMime,
    RuntimeOutputWebviewReplayMimeTypes,
} from './runtimeOutputContract';

/**
 * Message shape needed to infer output kind.
 */
export interface RuntimeOutputMessageLike {
    data?: Record<string, unknown>;
    output_location?: PositronOutputLocation;
}

const PreloadRules = [
    {
        conditions: [
            (html: string) => html.includes('<script type="esms-options">'),
            (html: string) => html.includes('[data-root-id]'),
            (html: string) => html.includes('.cell-output-ipywidget-background'),
            (html: string) => !/<(img|svg|canvas)/i.test(html),
        ],
    },
];

const HtmlDocumentLikePattern = /<(script|html|body|iframe|!DOCTYPE)/;

function getMessageData(message: RuntimeOutputMessageLike): Record<string, unknown> {
    const { data } = message;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return {};
    }
    return data;
}

function asString(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

function isWebviewPreloadMessage(htmlContent: string): boolean {
    return PreloadRules.some((rule) =>
        rule.conditions.every((condition) => condition(htmlContent)),
    );
}

function isWebviewReplayMessage(mimeTypesOrMsg: RuntimeOutputMessageLike | string[]): boolean {
    const mimeTypes = Array.isArray(mimeTypesOrMsg)
        ? mimeTypesOrMsg
        : Object.keys(getMessageData(mimeTypesOrMsg));
    return mimeTypes.some((mimeType) => RuntimeOutputWebviewReplayMimeTypes.has(mimeType));
}

/**
 * Infers the output kind from a runtime output-like message.
 * (1:1 Positron inferPositronOutputKind core routing logic)
 */
export function inferPositronOutputKind(message: RuntimeOutputMessageLike): RuntimeOutputKind {
    const data = getMessageData(message);
    const mimeTypes = Object.keys(data);

    // Special handling for outputs that must be replayed in webviews.
    if (isWebviewReplayMessage(message)) {
        return RuntimeOutputKind.WebviewPreload;
    }

    // Fast-path for the most common plain text output.
    if (mimeTypes.length === 1 && mimeTypes[0] === RuntimeOutputMime.textPlain) {
        return RuntimeOutputKind.Text;
    }

    // Fast-path for single static image outputs.
    if (mimeTypes.length === 1 && mimeTypes[0].startsWith('image/')) {
        return RuntimeOutputKind.StaticImage;
    }

    // Honor backend output location hints when present.
    if (Object.prototype.hasOwnProperty.call(message, 'output_location')) {
        switch (message.output_location) {
            case 'console':
                return RuntimeOutputKind.InlineHtml;
            case 'viewer':
                return RuntimeOutputKind.ViewerWidget;
            case 'plot':
                return RuntimeOutputKind.PlotWidget;
        }
    }

    // Explicit Positron/Jupyter rich-output MIME kinds.
    if (mimeTypes.includes(RuntimeOutputMime.positronViewer)) {
        return RuntimeOutputKind.ViewerWidget;
    }

    if (mimeTypes.includes(RuntimeOutputMime.positronDataExplorer)) {
        return RuntimeOutputKind.ViewerWidget;
    }

    if (mimeTypes.includes(RuntimeOutputMime.positronPlot)) {
        return RuntimeOutputKind.PlotWidget;
    }

    if (mimeTypes.includes(RuntimeOutputMime.widgetState) || mimeTypes.includes(RuntimeOutputMime.widgetView)) {
        return RuntimeOutputKind.IPyWidget;
    }

    // Positron checks notebook renderer availability here. Extension host code
    // doesn't have the same renderer service, so use MIME heuristics only.
    for (const mimeType of mimeTypes) {
        if (
            mimeType.startsWith('application/vnd.') ||
            mimeType === RuntimeOutputMime.textMarkdown ||
            mimeType.startsWith('text/x-')
        ) {
            if (mimeType.indexOf('table') >= 0 || mimeType.startsWith('text/')) {
                return RuntimeOutputKind.ViewerWidget;
            }
            return RuntimeOutputKind.PlotWidget;
        }
    }

    // Heuristic HTML routing (same idea as Positron):
    // - full documents/tables go to Viewer/Plots
    // - fragments stay inline in Console.
    if (mimeTypes.includes(RuntimeOutputMime.textHtml)) {
        const htmlContent = asString(data[RuntimeOutputMime.textHtml]);
        if (isWebviewPreloadMessage(htmlContent)) {
            return RuntimeOutputKind.WebviewPreload;
        }
        if (HtmlDocumentLikePattern.test(htmlContent)) {
            if (htmlContent.includes('<table') || htmlContent.includes('<!DOCTYPE')) {
                return RuntimeOutputKind.ViewerWidget;
            }
            return RuntimeOutputKind.PlotWidget;
        }
        return RuntimeOutputKind.InlineHtml;
    }

    // Fallback to static image if any image MIME exists.
    for (const mimeType of mimeTypes) {
        if (mimeType.startsWith('image/')) {
            return RuntimeOutputKind.StaticImage;
        }
    }

    // Last fallback to plain text if present.
    if (mimeTypes.includes(RuntimeOutputMime.textPlain)) {
        return RuntimeOutputKind.Text;
    }

    return RuntimeOutputKind.Unknown;
}

// ---------------------------------------------------------------------------
// Extended output types with inferred kind (used by session emitters)
// ---------------------------------------------------------------------------

/** LanguageRuntimeOutput with an attached `kind` field. */
export type LanguageRuntimeOutputWithKind = LanguageRuntimeOutput & { kind: RuntimeOutputKind };

/** LanguageRuntimeResult with an attached `kind` field. */
export type LanguageRuntimeResultWithKind = LanguageRuntimeResult & { kind: RuntimeOutputKind };

/** LanguageRuntimeUpdateOutput with an attached `kind` field. */
export type LanguageRuntimeUpdateOutputWithKind = LanguageRuntimeUpdateOutput & { kind: RuntimeOutputKind };
