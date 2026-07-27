import { RuntimeOutputKind } from '../internal/runtimeTypes';

/** Canonical MIME identifiers used for runtime output classification and routing. */
export const RuntimeOutputMime = {
    textPlain: 'text/plain',
    textHtml: 'text/html',
    textMarkdown: 'text/markdown',
    positronPlot: 'application/vnd.positron.plot+json',
    positronViewer: 'application/vnd.positron.viewer+json',
    positronDataExplorer: 'application/vnd.positron.dataExplorer+json',
    widgetState: 'application/vnd.jupyter.widget-state+json',
    widgetView: 'application/vnd.jupyter.widget-view+json',
    holoviewsLoad: 'application/vnd.holoviews_load.v0+json',
    holoviewsExec: 'application/vnd.holoviews_exec.v0+json',
    bokehExec: 'application/vnd.bokehjs_exec.v0+json',
    bokehLoad: 'application/vnd.bokehjs_load.v0+json',
    positronWebviewFlag: 'application/positron-webview-load.v0+json',
} as const;

export const RuntimeOutputWebviewReplayMimeTypes: ReadonlySet<string> = new Set([
    RuntimeOutputMime.holoviewsLoad,
    RuntimeOutputMime.holoviewsExec,
    RuntimeOutputMime.bokehExec,
    RuntimeOutputMime.bokehLoad,
    RuntimeOutputMime.positronWebviewFlag,
]);

export type RuntimeOutputConsumerId =
    | 'console'
    | 'plots'
    | 'viewer'
    | 'data-explorer'
    | 'notebook-inline-data-explorer'
    | 'rich-output-router'
    | 'renderer'
    | 'viewer-fallback';

/**
 * Exhaustive consumer ownership contract. Adding a RuntimeOutputKind fails
 * compilation until its normal consumer or explicit fallback is declared.
 */
export const RuntimeOutputConsumers: Record<RuntimeOutputKind, readonly RuntimeOutputConsumerId[]> = {
    [RuntimeOutputKind.Text]: ['console'],
    [RuntimeOutputKind.StaticImage]: ['console', 'plots'],
    [RuntimeOutputKind.InlineHtml]: ['console'],
    [RuntimeOutputKind.ViewerWidget]: ['rich-output-router', 'renderer', 'viewer', 'data-explorer', 'notebook-inline-data-explorer'],
    [RuntimeOutputKind.PlotWidget]: ['rich-output-router', 'renderer', 'plots'],
    [RuntimeOutputKind.IPyWidget]: ['rich-output-router', 'renderer', 'viewer-fallback'],
    [RuntimeOutputKind.WebviewPreload]: ['rich-output-router', 'renderer', 'viewer-fallback'],
    [RuntimeOutputKind.Unknown]: ['console'],
};

export const RoutedRichOutputKinds: ReadonlySet<RuntimeOutputKind> = new Set([
    RuntimeOutputKind.ViewerWidget,
    RuntimeOutputKind.PlotWidget,
    RuntimeOutputKind.IPyWidget,
    RuntimeOutputKind.WebviewPreload,
]);
