import * as vscode from 'vscode';
import type {
    IRuntimeOutputRenderer,
    RuntimeClearOutputMessage,
    RuntimeOutputMessage,
    RuntimeRenderedOutput,
} from '../api';
import {
    RuntimeOutputKind,
    type LanguageRuntimeMessageIPyWidget,
    type LanguageRuntimeOutput,
} from '../internal/runtimeTypes';
import type {
    LanguageRuntimeOutputWithKind,
    LanguageRuntimeResultWithKind,
    LanguageRuntimeUpdateOutputWithKind,
} from './runtimeOutputKind';
import type { RuntimeSession } from './session';
import type { RuntimeSessionService } from './runtimeSession';
import type { PositronPlotsService } from './positronPlotsService';
import type { PositronPreviewService } from '../services/preview';
import {
    createSurfaceModelId,
    SurfaceLifecycleService,
    SurfaceKind,
    SurfaceModelKind,
    SurfaceSourceKind,
} from '../services/surfaces/surfaceLifecycleService';
import {
    RoutedRichOutputKinds,
    RuntimeOutputConsumers,
    RuntimeOutputMime,
    type RuntimeOutputConsumerId,
} from './runtimeOutputContract';
export {
    RuntimeOutputConsumers,
    type RuntimeOutputConsumerId,
} from './runtimeOutputContract';

const MaxRouteRecords = 200;

export type RichOutputMessage =
    | LanguageRuntimeOutputWithKind
    | LanguageRuntimeResultWithKind
    | LanguageRuntimeUpdateOutputWithKind;

export interface RichOutputRouteRecord {
    readonly sessionId: string;
    readonly messageId: string;
    readonly outputId?: string;
    readonly kind: RuntimeOutputKind;
    readonly consumer: RuntimeOutputConsumerId;
    readonly status: 'accepted' | 'instance-created' | 'surface-opened' | 'routed' | 'fallback' | 'failed';
    readonly phase?: 'accepted' | 'instance-created' | 'surface-opened';
    readonly rendererCompatible: boolean;
    readonly detail?: string;
    readonly timestamp: number;
}

interface RichPayload {
    readonly url?: string;
    readonly path?: string;
    readonly html?: string;
    readonly title?: string;
}

interface ManagedRichOutput {
    readonly session: RuntimeSession;
    message: RichOutputMessage;
    rendererId?: string;
}

function asString(value: unknown): string | undefined {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined || value === null) {
        return undefined;
    }
    try {
        return JSON.stringify(value, undefined, 2);
    } catch {
        return String(value);
    }
}

function parseRichPayload(value: unknown): RichPayload | undefined {
    let candidate = value;
    if (typeof candidate === 'string') {
        try {
            candidate = JSON.parse(candidate);
        } catch {
            return undefined;
        }
    }
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return undefined;
    }

    const record = candidate as Record<string, unknown>;
    return {
        url: typeof record.url === 'string' ? record.url : undefined,
        path: typeof record.path === 'string' ? record.path : undefined,
        html: typeof record.html === 'string' ? record.html : undefined,
        title: typeof record.title === 'string' ? record.title : undefined,
    };
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
    let candidate = value;
    if (typeof candidate === 'string') {
        try {
            candidate = JSON.parse(candidate);
        } catch {
            return undefined;
        }
    }
    return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? candidate as Record<string, unknown>
        : undefined;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function safePathSegment(value: string): string {
    const sanitized = value.replace(/[^A-Za-z0-9._-]/g, '_');
    return sanitized || 'output';
}

/** Routes rich runtime outputs that are intentionally omitted from Console. */
export class RichOutputRouter implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _sessionDisposables = new Map<string, vscode.Disposable[]>();
    private readonly _routeRecords: RichOutputRouteRecord[] = [];
    private readonly _routeChains = new Map<string, Promise<void>>();
    private readonly _reportedFailures = new Set<string>();
    private readonly _renderers = new Map<string, IRuntimeOutputRenderer>();
    private readonly _managedOutputs = new Map<string, ManagedRichOutput>();
    private readonly _pendingClears = new Set<string>();
    private readonly _onDidRouteOutputEmitter = new vscode.EventEmitter<RichOutputRouteRecord>();

    readonly onDidRouteOutput = this._onDidRouteOutputEmitter.event;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _plotsService: PositronPlotsService,
        private readonly _previewService: PositronPreviewService,
        private readonly _outputChannel: vscode.LogOutputChannel,
        private readonly _surfaceLifecycle?: SurfaceLifecycleService,
    ) {
        this._disposables.push(this._onDidRouteOutputEmitter);
    }

    initialize(): void {
        for (const session of this._sessionManager.sessions) {
            this._attachSession(session);
        }

        this._disposables.push(
            this._sessionManager.onDidCreateSession(session => this._attachSession(session)),
            this._sessionManager.onDidDeleteRuntimeSession(sessionId => {
                this._detachSession(sessionId);
                const outputDirectory = vscode.Uri.joinPath(
                    this._context.globalStorageUri,
                    'rich-output',
                    safePathSegment(sessionId),
                );
                void vscode.workspace.fs.delete(outputDirectory, { recursive: true, useTrash: false }).then(
                    () => undefined,
                    () => undefined,
                );
            }),
        );
    }

    getRouteRecords(sessionId?: string): readonly RichOutputRouteRecord[] {
        return sessionId
            ? this._routeRecords.filter(record => record.sessionId === sessionId)
            : [...this._routeRecords];
    }

    getConsumers(kind: RuntimeOutputKind): readonly RuntimeOutputConsumerId[] {
        return RuntimeOutputConsumers[kind];
    }

    registerRenderer(renderer: IRuntimeOutputRenderer): vscode.Disposable {
        if (!renderer.id.trim()) {
            throw new Error('Runtime output renderer id must not be empty.');
        }
        if (this._renderers.has(renderer.id)) {
            throw new Error(`Runtime output renderer '${renderer.id}' is already registered.`);
        }
        this._renderers.set(renderer.id, renderer);
        for (const managed of this._managedOutputs.values()) {
            if (!managed.rendererId) {
                this._replayWithRenderer(renderer, managed);
            }
        }
        return new vscode.Disposable(() => {
            if (this._renderers.get(renderer.id) === renderer) {
                this._renderers.delete(renderer.id);
                for (const managed of this._managedOutputs.values()) {
                    if (managed.rendererId === renderer.id) {
                        managed.rendererId = undefined;
                    }
                }
            }
        });
    }

    private _attachSession(session: RuntimeSession): void {
        if (this._sessionDisposables.has(session.sessionId)) {
            return;
        }

        const disposables = [
            session.onDidReceiveRuntimeMessageOutput(message => this._enqueue(session, message)),
            session.onDidReceiveRuntimeMessageResult(message => this._enqueue(session, message)),
            session.onDidReceiveRuntimeMessageUpdateOutput(message => this._enqueue(session, message)),
            session.onDidReceiveRuntimeMessageClearOutput(message => {
                this._handleClearOutput(session, message);
            }),
            session.onDidReceiveRuntimeMessageIPyWidget(message => {
                this._enqueue(session, this._toRichIPyWidgetMessage(message));
            }),
        ];
        this._sessionDisposables.set(session.sessionId, disposables);
    }

    private _detachSession(sessionId: string): void {
        this._sessionDisposables.get(sessionId)?.forEach(disposable => disposable.dispose());
        this._sessionDisposables.delete(sessionId);
        for (const key of this._routeChains.keys()) {
            if (key.startsWith(`${sessionId}:`)) {
                this._routeChains.delete(key);
            }
        }
        this._clearManagedOutputs(sessionId);
        for (const key of this._pendingClears) {
            if (key.startsWith(`${sessionId}:`)) {
                this._pendingClears.delete(key);
            }
        }
    }

    private _enqueue(session: RuntimeSession, message: RichOutputMessage): void {
        const pendingClearKey = `${session.sessionId}:${message.parent_id}`;
        if (this._pendingClears.delete(pendingClearKey)) {
            this._clearManagedOutputs(session.sessionId, message.parent_id);
        }
        if (!RoutedRichOutputKinds.has(message.kind)) {
            return;
        }

        const key = this._managedOutputKey(session.sessionId, message);
        if (
            message.kind === RuntimeOutputKind.IPyWidget ||
            message.kind === RuntimeOutputKind.WebviewPreload
        ) {
            const previousOutput = this._managedOutputs.get(key);
            this._managedOutputs.set(key, {
                session,
                message,
                rendererId: previousOutput?.rendererId,
            });
        }
        const previous = this._routeChains.get(key) ?? Promise.resolve();
        const current = previous
            .catch(() => undefined)
            .then(() => this._routeOutput(session, message))
            .catch(error => this._handleRouteFailure(session, message, error))
            .finally(() => {
                if (this._routeChains.get(key) === current) {
                    this._routeChains.delete(key);
                }
            });
        this._routeChains.set(key, current);
    }

    private _handleClearOutput(
        session: RuntimeSession,
        message: RuntimeClearOutputMessage,
    ): void {
        const key = `${session.sessionId}:${message.parent_id}`;
        if (message.wait) {
            this._pendingClears.add(key);
            return;
        }
        this._pendingClears.delete(key);
        this._clearManagedOutputs(session.sessionId, message.parent_id);
    }

    private _clearManagedOutputs(sessionId: string, parentId?: string): void {
        for (const [key, managed] of this._managedOutputs) {
            if (
                managed.session.sessionId !== sessionId ||
                (parentId !== undefined && managed.message.parent_id !== parentId)
            ) {
                continue;
            }
            this._managedOutputs.delete(key);
            const renderer = managed.rendererId
                ? this._renderers.get(managed.rendererId)
                : undefined;
            if (renderer?.disposeOutput) {
                void Promise.resolve()
                    .then(() => renderer.disposeOutput!(this._rendererContext(managed)))
                    .catch(error => this._outputChannel.warn(
                        `[RichOutputRouter] Renderer '${renderer.id}' failed to dispose output: ${error}`,
                    ));
            }
            this._surfaceLifecycle?.disposeModel(
                createSurfaceModelId(
                    SurfaceModelKind.Widget,
                    managed.session.sessionId,
                    managed.message.output_id ?? managed.message.id,
                ),
                'runtime-clear-output',
            );
        }
    }

    private _replayWithRenderer(
        renderer: IRuntimeOutputRenderer,
        managed: ManagedRichOutput,
    ): void {
        const key = this._managedOutputKey(managed.session.sessionId, managed.message);
        const previous = this._routeChains.get(key) ?? Promise.resolve();
        const current = previous
            .catch(() => undefined)
            .then(async () => {
                const latest = this._managedOutputs.get(key);
                if (latest !== managed || latest.rendererId) {
                    return;
                }
                await this._routeWithRenderer(renderer, latest.session, latest.message);
            })
            .catch(error => this._handleRouteFailure(managed.session, managed.message, error))
            .finally(() => {
                if (this._routeChains.get(key) === current) {
                    this._routeChains.delete(key);
                }
            });
        this._routeChains.set(key, current);
    }

    /**
     * Converts an intercepted IPyWidget message into the rich-output contract
     * without discarding the wrapped Jupyter message. A native widget manager
     * can consume original_message in the future; today the router provides an
     * explicit, inspectable fallback.
     */
    private _toRichIPyWidgetMessage(
        message: LanguageRuntimeMessageIPyWidget,
    ): LanguageRuntimeOutputWithKind {
        const original = message.original_message as Partial<LanguageRuntimeOutput>;
        const originalData = original.data;
        const data = originalData && typeof originalData === 'object' && !Array.isArray(originalData)
            ? originalData
            : {
                'application/vnd.vscode-supervisor.ipywidget-message+json':
                    message.original_message,
            };

        return {
            ...message,
            kind: RuntimeOutputKind.IPyWidget,
            data,
            output_id: typeof original.output_id === 'string'
                ? original.output_id
                : undefined,
            outputMetadata: original.outputMetadata,
        };
    }

    private async _routeOutput(session: RuntimeSession, message: RichOutputMessage): Promise<void> {
        if (await this._routeWithRegisteredRenderer(session, message)) {
            return;
        }

        switch (message.kind) {
            case RuntimeOutputKind.ViewerWidget:
                await this._routeViewerOutput(session, message);
                return;
            case RuntimeOutputKind.PlotWidget:
                await this._routePlotOutput(session, message);
                return;
            case RuntimeOutputKind.IPyWidget:
                this._registerWidgetModel(session, message);
                await this._routeFallback(
                    session,
                    message,
                    'IPyWidget rendering is not available in the extension host; the original output bundle is shown below.',
                );
                return;
            case RuntimeOutputKind.WebviewPreload:
                this._registerWidgetModel(session, message);
                await this._routeFallback(
                    session,
                    message,
                    'This output requires a notebook webview preload that is unavailable in the extension host.',
                );
                return;
        }
    }

    private async _routeWithRegisteredRenderer(
        session: RuntimeSession,
        message: RichOutputMessage,
    ): Promise<boolean> {
        for (const renderer of this._renderers.values()) {
            if (await this._routeWithRenderer(renderer, session, message)) {
                return true;
            }
        }
        return false;
    }

    private _rendererMatches(
        renderer: IRuntimeOutputRenderer,
        message: RichOutputMessage,
    ): boolean {
        const mimeTypes = Object.keys(message.data);
        return !(
            renderer.outputKinds?.length &&
            !renderer.outputKinds.includes(message.kind)
        ) && !(
            renderer.mimeTypes?.length &&
            !renderer.mimeTypes.some(mimeType => mimeTypes.includes(mimeType))
        );
    }

    private async _routeWithRenderer(
        renderer: IRuntimeOutputRenderer,
        session: RuntimeSession,
        message: RichOutputMessage,
    ): Promise<boolean> {
        if (!this._rendererMatches(renderer, message)) {
            return false;
        }

        let rendered: RuntimeRenderedOutput | undefined;
        try {
            rendered = await renderer.render(
                message as unknown as RuntimeOutputMessage,
                this._rendererContext({ session, message }),
            );
        } catch (error) {
            this._outputChannel.error(
                `[RichOutputRouter] Renderer '${renderer.id}' failed: ${error}`,
            );
            return false;
        }
        if (!rendered) {
            return false;
        }
        if (!rendered.uri && !rendered.html) {
            this._outputChannel.warn(
                `[RichOutputRouter] Renderer '${renderer.id}' returned no URI or HTML.`,
            );
            return false;
        }

        await this._showRenderedOutput(session, message, renderer.id, rendered);
        if (
            message.kind === RuntimeOutputKind.IPyWidget ||
            message.kind === RuntimeOutputKind.WebviewPreload
        ) {
            const managed = this._managedOutputs.get(
                this._managedOutputKey(session.sessionId, message),
            );
            if (managed) {
                managed.rendererId = renderer.id;
            }
            this._registerWidgetModel(session, message, true);
        }
        return true;
    }

    private _rendererContext(
        managed: Pick<ManagedRichOutput, 'session' | 'message'>,
    ) {
        return {
            session: managed.session,
            outputKind: managed.message.kind,
            outputId: managed.message.output_id ?? managed.message.id,
        };
    }

    private _managedOutputKey(sessionId: string, message: RichOutputMessage): string {
        return `${sessionId}:${message.output_id ?? message.id}`;
    }

    private async _showRenderedOutput(
        session: RuntimeSession,
        message: RichOutputMessage,
        rendererId: string,
        rendered: RuntimeRenderedOutput,
    ): Promise<void> {
        let uri = rendered.uri;
        let htmlFile: vscode.Uri | undefined;
        if (rendered.html) {
            htmlFile = await this._writeHtmlOutput(
                session.sessionId,
                message,
                rendered.html,
                undefined,
            );
            uri = await this._previewService.resolveRuntimeOutputHtmlUri(htmlFile);
        }

        if (rendered.target === 'plot') {
            this._plotsService.addHtmlOutputPlot(session.sessionId, {
                uri: uri!,
                title: rendered.title ?? 'Runtime Plot',
            }, message);
        } else if (htmlFile) {
            await this._previewService.showRuntimeOutputHtml(session.sessionId, htmlFile, {
                title: rendered.title ?? 'Runtime Viewer Output',
                outputId: message.output_id,
            });
        } else {
            await this._previewService.showRuntimeOutputUrl(
                session.sessionId,
                uri!.toString(),
                message.output_id,
            );
        }
        this._record(
            session,
            message,
            'renderer',
            'routed',
            `${rendererId}:${uri!.toString()}`,
        );
    }

    private async _routeViewerOutput(session: RuntimeSession, message: RichOutputMessage): Promise<void> {
        if (message.data[RuntimeOutputMime.positronDataExplorer] !== undefined) {
            const dataExplorerPayload = parseJsonRecord(message.data[RuntimeOutputMime.positronDataExplorer]);
            const commId = dataExplorerPayload?.comm_id;
            if (typeof commId === 'string' && commId.length > 0) {
                const isNotebook = session.sessionMetadata.sessionMode === 'notebook';
                if (!isNotebook) {
                    await this._routeDataExplorerOutput(session, message, commId);
                    return;
                }
                this._record(
                    session,
                    message,
                    isNotebook ? 'notebook-inline-data-explorer' : 'data-explorer',
                    'accepted',
                    commId,
                    'accepted',
                );
                return;
            }
        }

        const viewerPayload = parseRichPayload(message.data[RuntimeOutputMime.positronViewer]);
        if (viewerPayload?.url) {
            await this._previewService.showRuntimeOutputUrl(
                session.sessionId,
                viewerPayload.url,
                message.output_id,
            );
            this._record(session, message, 'viewer', 'routed', viewerPayload.url);
            return;
        }

        const html = viewerPayload?.html ?? asString(message.data[RuntimeOutputMime.textHtml]);
        if (html) {
            const fileUri = await this._writeHtmlOutput(
                session.sessionId,
                message,
                html,
                undefined,
            );
            await this._previewService.showRuntimeOutputHtml(session.sessionId, fileUri, {
                title: viewerPayload?.title ?? 'Runtime Viewer Output',
                outputId: message.output_id,
            });
            this._record(session, message, 'viewer', 'routed');
            return;
        }

        if (viewerPayload?.path) {
            const fileUri = vscode.Uri.file(viewerPayload.path);
            await this._previewService.showRuntimeOutputHtml(session.sessionId, fileUri, {
                title: viewerPayload.title ?? 'Runtime Viewer Output',
                outputId: message.output_id,
            });
            this._record(session, message, 'viewer', 'routed', viewerPayload.path);
            return;
        }

        const reason = message.data[RuntimeOutputMime.positronDataExplorer] !== undefined
            ? 'Inline Data Explorer output requires a dedicated inline surface; the payload is preserved here.'
            : 'No supported URL or HTML representation was present in the Viewer output.';
        await this._routeFallback(session, message, reason);
    }

    private async _routeDataExplorerOutput(
        session: RuntimeSession,
        message: RichOutputMessage,
        commId: string,
    ): Promise<void> {
        this._record(session, message, 'data-explorer', 'accepted', commId, 'accepted');

        if (!await this._waitForDataExplorerPhase(commId, 'instance-created')) {
            await this._routeFallback(
                session,
                message,
                `Data Explorer accepted comm '${commId}', but no surface model was created. ` +
                    'The original MIME bundle is preserved and is not considered renderer-compatible.',
            );
            return;
        }
        this._record(session, message, 'data-explorer', 'instance-created', commId, 'instance-created');

        if (!await this._waitForDataExplorerPhase(commId, 'surface-opened')) {
            await this._routeFallback(
                session,
                message,
                `Data Explorer instance '${commId}' was created, but its editor did not open. ` +
                    'The original MIME bundle is preserved and is not considered renderer-compatible.',
            );
            return;
        }
        this._record(session, message, 'data-explorer', 'surface-opened', commId, 'surface-opened');
    }

    private _waitForDataExplorerPhase(
        commId: string,
        phase: 'instance-created' | 'surface-opened',
        timeoutMs = 10_000,
    ): Promise<boolean> {
        const lifecycle = this._surfaceLifecycle;
        if (!lifecycle) {
            return Promise.resolve(false);
        }
        const modelId = createSurfaceModelId(SurfaceModelKind.DataExplorer, commId);
        const isSatisfied = () => {
            const model = lifecycle.getModel(modelId);
            if (!model) {
                return false;
            }
            return phase === 'instance-created' || model.attachments.some(
                attachment => attachment.kind === SurfaceKind.DataExplorerEditor,
            );
        };
        if (isSatisfied()) {
            return Promise.resolve(true);
        }

        return new Promise(resolve => {
            let settled = false;
            let listener: vscode.Disposable | undefined;
            let timer: NodeJS.Timeout | undefined;
            const finish = (result: boolean) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timer) {
                    clearTimeout(timer);
                }
                listener?.dispose();
                resolve(result);
            };
            listener = lifecycle.onDidChange(event => {
                if (event.model.id === modelId && isSatisfied()) {
                    finish(true);
                }
            });
            timer = setTimeout(() => finish(false), timeoutMs);
            // Close the getModel()/listener-registration race.
            if (isSatisfied()) {
                finish(true);
            }
        });
    }

    private async _routePlotOutput(session: RuntimeSession, message: RichOutputMessage): Promise<void> {
        const plotPayload = parseRichPayload(message.data[RuntimeOutputMime.positronPlot]);
        let uri: vscode.Uri | undefined;
        if (plotPayload?.url) {
            uri = vscode.Uri.parse(plotPayload.url);
        } else {
            const html = plotPayload?.html ?? asString(message.data[RuntimeOutputMime.textHtml]);
            if (html) {
                const fileUri = await this._writeHtmlOutput(session.sessionId, message, html, undefined);
                uri = await this._previewService.resolveRuntimeOutputHtmlUri(fileUri);
            }
        }

        if (uri) {
            this._plotsService.addHtmlOutputPlot(session.sessionId, {
                uri,
                title: plotPayload?.title ?? 'Runtime Plot',
            }, message);
            this._record(session, message, 'plots', 'routed', uri.toString());
            return;
        }

        await this._routeFallback(
            session,
            message,
            'This plot requires a notebook renderer that is unavailable in the extension host; the original output bundle is preserved here.',
        );
    }

    private async _routeFallback(
        session: RuntimeSession,
        message: RichOutputMessage,
        reason: string,
    ): Promise<void> {
        const html = this._buildFallbackHtml(message, reason);
        const fileUri = await this._writeHtmlOutput(session.sessionId, message, html, reason);
        await this._previewService.showRuntimeOutputHtml(session.sessionId, fileUri, {
            title: `${message.kind} output (fallback)`,
            outputId: message.output_id,
            fallbackReason: reason,
        });
        this._record(session, message, 'viewer-fallback', 'fallback', reason);
        this._outputChannel.warn(
            `[RichOutputRouter] ${message.kind} output ${message.output_id ?? message.id} used fallback: ${reason}`
        );
    }

    private _registerWidgetModel(
        session: RuntimeSession,
        message: RichOutputMessage,
        rendererAvailable = false,
    ): void {
        if (!this._surfaceLifecycle) {
            return;
        }
        const identity = message.output_id ?? message.id;
        this._surfaceLifecycle.upsertModel({
            id: createSurfaceModelId(SurfaceModelKind.Widget, session.sessionId, identity),
            kind: SurfaceModelKind.Widget,
            resourceId: identity,
            title: message.kind === RuntimeOutputKind.IPyWidget ? 'Notebook Widget' : 'Notebook Webview Output',
            source: {
                kind: SurfaceSourceKind.Runtime,
                id: session.sessionId,
                sessionId: session.sessionId,
                stop: async () => this._sessionManager.interruptSession(session.sessionId),
            },
            outputId: message.output_id,
            retention: 'retain-on-detach',
            payload: {
                messageId: message.id,
                executionId: message.parent_id,
                mimeTypes: Object.keys(message.data),
                rendererAvailable,
            },
        });
    }

    private async _writeHtmlOutput(
        sessionId: string,
        message: RichOutputMessage,
        content: string,
        fallbackReason: string | undefined,
    ): Promise<vscode.Uri> {
        const directory = vscode.Uri.joinPath(
            this._context.globalStorageUri,
            'rich-output',
            safePathSegment(sessionId),
        );
        await vscode.workspace.fs.createDirectory(directory);
        const fileUri = vscode.Uri.joinPath(
            directory,
            `${safePathSegment(message.output_id ?? message.id)}.html`,
        );
        const document = fallbackReason
            ? content
            : this._asHtmlDocument(content, message.kind);
        await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(document));
        return fileUri;
    }

    private _asHtmlDocument(content: string, kind: RuntimeOutputKind): string {
        if (/<!doctype|<html[\s>]/i.test(content)) {
            return content;
        }
        return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(kind)}</title></head>
<body>${content}</body>
</html>`;
    }

    private _buildFallbackHtml(message: RichOutputMessage, reason: string): string {
        const plainText = asString(message.data[RuntimeOutputMime.textPlain]);
        const entries = Object.entries(message.data).map(([mime, value]) => {
            const serialized = asString(value) ?? '';
            return `<details><summary>${escapeHtml(mime)}</summary><pre>${escapeHtml(serialized)}</pre></details>`;
        }).join('\n');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(message.kind)} output fallback</title>
<style>
body{font:13px system-ui,sans-serif;margin:0;padding:20px;color:#222;background:#fff}.notice{border-left:4px solid #b87900;background:#fff7df;padding:12px 16px;margin-bottom:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f3f3;padding:12px}details{margin:8px 0}summary{cursor:pointer;font-weight:600}@media(prefers-color-scheme:dark){body{color:#ddd;background:#1e1e1e}.notice{background:#332b16}pre{background:#2b2b2b}}
</style>
</head>
<body>
<div class="notice"><strong>Rich output fallback</strong><div>${escapeHtml(reason)}</div></div>
${plainText ? `<pre>${escapeHtml(plainText)}</pre>` : ''}
<h3>Original MIME bundle</h3>${entries || '<p>The runtime sent an empty output bundle.</p>'}
</body>
</html>`;
    }

    private _record(
        session: RuntimeSession,
        message: RichOutputMessage,
        consumer: RuntimeOutputConsumerId,
        status: RichOutputRouteRecord['status'],
        detail?: string,
        phase?: RichOutputRouteRecord['phase'],
    ): void {
        const record: RichOutputRouteRecord = {
            sessionId: session.sessionId,
            messageId: message.id,
            outputId: message.output_id,
            kind: message.kind,
            consumer,
            status,
            phase,
            rendererCompatible:
                status === 'routed' || status === 'surface-opened',
            detail,
            timestamp: Date.now(),
        };
        this._routeRecords.push(record);
        if (this._routeRecords.length > MaxRouteRecords) {
            this._routeRecords.splice(0, this._routeRecords.length - MaxRouteRecords);
        }
        this._onDidRouteOutputEmitter.fire(record);
    }

    private async _handleRouteFailure(
        session: RuntimeSession,
        message: RichOutputMessage,
        error: unknown,
    ): Promise<void> {
        const detail = error instanceof Error ? error.message : String(error);
        this._record(session, message, 'rich-output-router', 'failed', detail);
        this._outputChannel.error(
            `[RichOutputRouter] Failed to route ${message.kind} output ${message.output_id ?? message.id}: ${detail}`
        );

        const failureKey = `${session.sessionId}:${message.kind}`;
        if (!this._reportedFailures.has(failureKey)) {
            this._reportedFailures.add(failureKey);
            await vscode.window.showWarningMessage(
                `A ${message.kind} runtime output could not be displayed. See the Ark output log for details.`
            );
        }
    }

    dispose(): void {
        const sessionIds = new Set(
            [...this._managedOutputs.values()].map(output => output.session.sessionId),
        );
        sessionIds.forEach(sessionId => this._clearManagedOutputs(sessionId));
        for (const disposables of this._sessionDisposables.values()) {
            disposables.forEach(disposable => disposable.dispose());
        }
        this._sessionDisposables.clear();
        this._routeChains.clear();
        this._managedOutputs.clear();
        this._pendingClears.clear();
        this._renderers.clear();
        this._disposables.forEach(disposable => disposable.dispose());
    }
}
