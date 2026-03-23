import type {
    LanguageRuntimeOutput,
    LanguageRuntimeResult,
    LanguageRuntimeUpdateOutput,
} from '../positronTypes';

/**
 * Output kind classification for runtime messages.
 * (1:1 Positron RuntimeOutputKind)
 *
 * Used to classify Output/Result/UpdateOutput messages based on their
 * MIME content, enabling consumers (Console, Plots, Viewer) to filter
 * by kind rather than re-parsing MIME types themselves.
 */
export enum RuntimeOutputKind {
    /** Plain text output. */
    Text = 'text',
    /** Static image output (PNG/JPEG/SVG/etc.). */
    StaticImage = 'static_image',
    /** Inline HTML fragment output for the console. */
    InlineHtml = 'inline_html',
    /** Output intended for the Viewer pane. */
    ViewerWidget = 'viewer_widget',
    /** Output intended for the Plots pane. */
    PlotWidget = 'plot',
    /** Jupyter widget output. */
    IPyWidget = 'ipywidget',
    /** Webview preload/replay message. */
    WebviewPreload = 'webview_preload',
    /** Unrecognized output type. */
    Unknown = 'unknown',
}

/**
 * Message shape needed to infer output kind.
 */
export interface RuntimeOutputMessageLike {
    data?: Record<string, unknown>;
    output_location?: unknown;
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

const MIME_TYPE_TEXT_PLAIN = 'text/plain';
const MIME_TYPE_TEXT_HTML = 'text/html';
const MIME_TYPE_TEXT_MARKDOWN = 'text/markdown';
const MIME_TYPE_POSITRON_PLOT = 'application/vnd.positron.plot+json';
const MIME_TYPE_POSITRON_VIEWER = 'application/vnd.positron.viewer+json';
const MIME_TYPE_WIDGET_STATE = 'application/vnd.jupyter.widget-state+json';
const MIME_TYPE_WIDGET_VIEW = 'application/vnd.jupyter.widget-view+json';
const MIME_TYPE_HOLOVIEWS_LOAD = 'application/vnd.holoviews_load.v0+json';
const MIME_TYPE_HOLOVIEWS_EXEC = 'application/vnd.holoviews_exec.v0+json';
const MIME_TYPE_BOKEH_EXEC = 'application/vnd.bokehjs_exec.v0+json';
const MIME_TYPE_BOKEH_LOAD = 'application/vnd.bokehjs_load.v0+json';
const MIME_TYPE_POSITRON_WEBVIEW_FLAG = 'application/positron-webview-load.v0+json';

const WebviewReplayMimeTypes = new Set<string>([
    MIME_TYPE_HOLOVIEWS_LOAD,
    MIME_TYPE_HOLOVIEWS_EXEC,
    MIME_TYPE_BOKEH_EXEC,
    MIME_TYPE_BOKEH_LOAD,
    MIME_TYPE_POSITRON_WEBVIEW_FLAG,
]);

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
    return mimeTypes.some((mimeType) => WebviewReplayMimeTypes.has(mimeType));
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
    if (mimeTypes.length === 1 && mimeTypes[0] === MIME_TYPE_TEXT_PLAIN) {
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
    if (mimeTypes.includes(MIME_TYPE_POSITRON_VIEWER)) {
        return RuntimeOutputKind.ViewerWidget;
    }

    if (mimeTypes.includes(MIME_TYPE_POSITRON_PLOT)) {
        return RuntimeOutputKind.PlotWidget;
    }

    if (mimeTypes.includes(MIME_TYPE_WIDGET_STATE) || mimeTypes.includes(MIME_TYPE_WIDGET_VIEW)) {
        return RuntimeOutputKind.IPyWidget;
    }

    // Positron checks notebook renderer availability here. Extension host code
    // doesn't have the same renderer service, so use MIME heuristics only.
    for (const mimeType of mimeTypes) {
        if (
            mimeType.startsWith('application/vnd.') ||
            mimeType === MIME_TYPE_TEXT_MARKDOWN ||
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
    if (mimeTypes.includes(MIME_TYPE_TEXT_HTML)) {
        const htmlContent = asString(data[MIME_TYPE_TEXT_HTML]);
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
    if (mimeTypes.includes(MIME_TYPE_TEXT_PLAIN)) {
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
