/*---------------------------------------------------------------------------------------------
 *  PositronPreviewService Implementation
 *  Handles runtime UI events and routes them to viewer/plots/editor.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RuntimeSessionService } from '../../runtime/runtimeSession';
import { PositronPlotsService } from '../../runtime/positronPlotsService';
import { HtmlProxyService } from './htmlProxyService';
import {
    ShowHtmlFileDestination,
    ShowHtmlFileEvent,
    type PreviewSource,
    ShowUrlEvent,
    UiFrontendEvent,
} from '../../runtime/comms/positronUiComm';
import type { ILanguageRuntimeGlobalEvent } from '../../runtime/runtimeEvents';
import { RuntimeState } from '../../internal/runtimeTypes';
import { shouldOpenUrlInViewer } from './previewUrlPolicy';
import {
    createSurfaceModelId,
    SurfaceKind,
    SurfaceLifecycleService,
    SurfaceModelKind,
    SurfaceSourceKind,
    type SurfaceAttachmentLease,
} from '../surfaces/surfaceLifecycleService';

export interface PreviewItem {
    type: 'url' | 'html';
    uri: vscode.Uri;
    title?: string;
    height?: number;
    sessionId: string;
    outputId?: string;
    source?: 'ui-client' | 'runtime-output' | 'fallback';
    fallbackReason?: string;
    /** Stable model identity shared by Viewer, editor, and future surfaces. */
    modelId?: string;
    /** Original URI used to rebuild proxy/external URIs after restoration. */
    restoreUri?: vscode.Uri;
    /** Runtime/terminal source supplied by the producer, independent of UI route origin. */
    sourceIdentity?: PreviewSource;
}

export interface PreviewInterruptState {
    readonly interruptible: boolean;
    readonly interrupting: boolean;
}

export type PreviewOpenTarget = 'browser' | 'editorTab' | 'newWindow';

const DefaultOpenTargetStorageKey = 'positronPreview.defaultOpenTarget';

/**
 * PositronPreviewService class (aligned with Positron pattern).
 * Manages preview routing for runtime UI events.
 */
export class PositronPreviewService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _proxyService: HtmlProxyService;
    private readonly _executingTerminals = new Set<vscode.Terminal>();

    private readonly _onDidShowPreviewEmitter = new vscode.EventEmitter<PreviewItem>();
    private readonly _onDidChangePreviewInterruptStateEmitter = new vscode.EventEmitter<void>();
    private _nextPreviewId = 0;
    readonly onDidShowPreview = this._onDidShowPreviewEmitter.event;
    readonly onDidChangePreviewInterruptState = this._onDidChangePreviewInterruptStateEmitter.event;

    constructor(
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _plotsService: PositronPlotsService,
        private readonly _outputChannel: vscode.LogOutputChannel,
        private readonly _surfaceLifecycle?: SurfaceLifecycleService,
        private readonly _workspaceState?: vscode.Memento,
    ) {
        this._proxyService = new HtmlProxyService(_outputChannel);
    }

    getDefaultOpenTarget(): PreviewOpenTarget {
        const target = this._workspaceState?.get<PreviewOpenTarget>(DefaultOpenTargetStorageKey);
        return target === 'editorTab' || target === 'newWindow' ? target : 'browser';
    }

    async setDefaultOpenTarget(target: PreviewOpenTarget): Promise<void> {
        await this._workspaceState?.update(DefaultOpenTargetStorageKey, target);
    }

    initialize(): void {
        this._outputChannel.debug('[PositronPreviewService] Initializing...');

        this._disposables.push(
            this._sessionManager.onDidReceiveRuntimeEvent((runtimeEvent) => {
                void this._handleRuntimeEvent(runtimeEvent);
            }),
            this._sessionManager.onDidChangeRuntimeState(() => {
                this._onDidChangePreviewInterruptStateEmitter.fire();
            }),
            vscode.window.onDidOpenTerminal(() => {
                this._onDidChangePreviewInterruptStateEmitter.fire();
            }),
            vscode.window.onDidCloseTerminal(terminal => {
                this._executingTerminals.delete(terminal);
                this._onDidChangePreviewInterruptStateEmitter.fire();
            }),
            vscode.window.onDidStartTerminalShellExecution(event => {
                this._executingTerminals.add(event.terminal);
                this._onDidChangePreviewInterruptStateEmitter.fire();
            }),
            vscode.window.onDidEndTerminalShellExecution(event => {
                this._executingTerminals.delete(event.terminal);
                this._onDidChangePreviewInterruptStateEmitter.fire();
            }),
        );

        this._outputChannel.debug('[PositronPreviewService] Initialized');
    }

    dispose(): void {
        this._proxyService.dispose();
        this._onDidShowPreviewEmitter.dispose();
        this._onDidChangePreviewInterruptStateEmitter.dispose();
        this._disposables.forEach(d => d.dispose());
    }

    private async _handleRuntimeEvent(runtimeEvent: ILanguageRuntimeGlobalEvent): Promise<void> {
        const sessionId = runtimeEvent.session_id;

        switch (runtimeEvent.event.name) {
            case UiFrontendEvent.ShowHtmlFile: {
                const event = this._normalizeShowHtmlFileEvent(runtimeEvent.event.data);
                if (!event) {
                    return;
                }

                await this.handleShowHtmlFile(sessionId, event);
                return;
            }

            case UiFrontendEvent.ShowUrl: {
                const event = this._normalizeShowUrlEvent(runtimeEvent.event.data);
                if (!event) {
                    return;
                }

                await this.handleShowUrl(sessionId, event);
                return;
            }
        }
    }

    private _normalizeShowHtmlFileEvent(data: unknown): ShowHtmlFileEvent | undefined {
        const event = (data ?? {}) as Partial<ShowHtmlFileEvent>;
        if (typeof event.path !== 'string' || event.path.length === 0) {
            return undefined;
        }

        const destination = Object.values(ShowHtmlFileDestination).includes(
            event.destination as ShowHtmlFileDestination
        )
            ? event.destination as ShowHtmlFileDestination
            : ShowHtmlFileDestination.Viewer;

        const title = typeof event.title === 'string' && event.title.length > 0
            ? event.title
            : event.path;

        const height = typeof event.height === 'number' && Number.isFinite(event.height)
            ? event.height
            : 0;

        return {
            path: event.path,
            title,
            destination,
            height,
        };
    }

    private _normalizeShowUrlEvent(data: unknown): ShowUrlEvent | undefined {
        const event = (data ?? {}) as Partial<ShowUrlEvent>;
        if (typeof event.url !== 'string' || event.url.length === 0) {
            return undefined;
        }

        return {
            url: event.url,
            source: event.source,
        };
    }

    async handleShowHtmlFile(sessionId: string, event: ShowHtmlFileEvent): Promise<void> {
        const uri = await this._proxyService.resolvePath(event.path);

        switch (event.destination) {
            case ShowHtmlFileDestination.Plot: {
                this._plotsService.addHtmlPlot(sessionId, {
                    uri,
                    title: event.title
                });
                break;
            }
            case ShowHtmlFileDestination.Viewer: {
                this._publishPreview({
                    type: 'html',
                    uri,
                    restoreUri: vscode.Uri.file(event.path),
                    title: event.title,
                    height: event.height,
                    sessionId,
                    source: 'ui-client',
                });
                break;
            }
            case ShowHtmlFileDestination.Editor: {
                await vscode.commands.executeCommand('vscode.open', uri, {
                    preview: true
                });
                break;
            }
            default: {
                this._outputChannel.debug(
                    `[PositronPreviewService] Unknown show_html_file destination: ${event.destination}`
                );
                break;
            }
        }
    }

    async handleShowUrl(
        sessionId: string,
        event: ShowUrlEvent,
        metadata?: Pick<PreviewItem, 'outputId' | 'source' | 'fallbackReason'>,
    ): Promise<void> {
        let uri: vscode.Uri;
        try {
            uri = vscode.Uri.parse(event.url);
        } catch {
            uri = vscode.Uri.file(event.url);
        }

        const restoreUri = uri;
        const uriPath = uri.path.toLowerCase();
        if (
            uri.scheme === 'file' &&
            (uriPath.endsWith('/') || uriPath.endsWith('.html') || uriPath.endsWith('.htm'))
        ) {
            uri = await this._proxyService.resolvePath(event.url);
        } else if (uri.scheme === 'http' || uri.scheme === 'https') {
            const openLocalhostUrls = vscode.workspace.getConfiguration().get<boolean>(
                'supervisor.viewer.openLocalhostUrls',
                true,
            );
            if (!shouldOpenUrlInViewer(uri.toString(true), openLocalhostUrls)) {
                let externalUri = uri;
                try {
                    externalUri = await vscode.env.asExternalUri(uri);
                } catch (error) {
                    this._outputChannel.debug(
                        `[PositronPreviewService] Failed to resolve external URI for ${event.url}: ${error}`
                    );
                }
                await vscode.env.openExternal(externalUri);
                this._outputChannel.debug(
                    `[PositronPreviewService] Opened non-local URL in the external browser: ${event.url}`
                );
                return;
            }
            try {
                uri = await vscode.env.asExternalUri(uri);
            } catch (error) {
                this._outputChannel.debug(
                    `[PositronPreviewService] Failed to resolve external URI for ${event.url}: ${error}`
                );
            }
        }

        this._publishPreview({
            type: 'url',
            uri,
            restoreUri,
            title: event.url,
            sessionId,
            source: metadata?.source ?? 'ui-client',
            sourceIdentity: event.source,
            outputId: metadata?.outputId,
            fallbackReason: metadata?.fallbackReason,
        });
    }

    /**
     * Shows an HTML file generated from a runtime rich-output message.
     * The stable output ID allows update messages to replace the current
     * preview instead of becoming an untraceable, silently dropped output.
     */
    async showRuntimeOutputHtml(
        sessionId: string,
        fileUri: vscode.Uri,
        options: {
            title: string;
            outputId?: string;
            fallbackReason?: string;
        },
    ): Promise<void> {
        const resolvedUri = await this.resolveRuntimeOutputHtmlUri(fileUri);
        const uri = resolvedUri.with({
            query: `${resolvedUri.query ? `${resolvedUri.query}&` : ''}outputVersion=${Date.now()}`,
        });
        this._publishPreview({
            type: 'html',
            uri,
            restoreUri: fileUri,
            title: options.title,
            sessionId,
            outputId: options.outputId,
            source: options.fallbackReason ? 'fallback' : 'runtime-output',
            fallbackReason: options.fallbackReason,
        });
    }

    /** Resolves a generated local rich-output file through the HTML proxy. */
    resolveRuntimeOutputHtmlUri(fileUri: vscode.Uri): Promise<vscode.Uri> {
        return this._proxyService.resolvePath(fileUri.fsPath);
    }

    /** Shows a URL directly supplied by a runtime rich-output bundle. */
    async showRuntimeOutputUrl(
        sessionId: string,
        url: string,
        outputId?: string,
    ): Promise<void> {
        await this.handleShowUrl(sessionId, { url }, {
            outputId,
            source: 'runtime-output',
        });
        this._outputChannel.debug(
            `[PositronPreviewService] Routed runtime output ${outputId ?? '<without output id>'} to ${url}`
        );
    }

    /** Attaches a preview model to a concrete Viewer/editor surface. */
    attachPreview(
        preview: PreviewItem,
        surfaceId: string,
        kind: SurfaceKind = SurfaceKind.ViewerPane,
        ownerId: string = 'preview-service',
    ): SurfaceAttachmentLease | undefined {
        if (!preview.modelId || !this._surfaceLifecycle?.getModel(preview.modelId)) {
            return undefined;
        }
        return this._surfaceLifecycle.attach(preview.modelId, {
            surfaceId,
            kind,
            ownerId,
            metadata: { outputId: preview.outputId, type: preview.type },
        });
    }

    /** Dispatches interrupt through the model source, with runtime fallback for restored models. */
    async interruptPreview(preview: PreviewItem): Promise<boolean> {
        if (preview.modelId && this._surfaceLifecycle) {
            const model = this._surfaceLifecycle.getModel(preview.modelId);
            const result = await this._surfaceLifecycle.stopModel(preview.modelId);
            if (result.handled) {
                return true;
            }
            if (result.reason === 'failed') {
                throw result.error;
            }
            if (model?.source.kind !== SurfaceSourceKind.Runtime) {
                return false;
            }
        }
        if (!preview.sessionId) {
            return false;
        }
        await this._sessionManager.interruptSession(preview.sessionId);
        return true;
    }

    async isPreviewInterruptible(preview: PreviewItem): Promise<boolean> {
        return (await this.getPreviewInterruptState(preview)).interruptible;
    }

    async getPreviewInterruptState(preview: PreviewItem): Promise<PreviewInterruptState> {
        const sourceIdentity = preview.sourceIdentity;
        if (sourceIdentity?.type === 'terminal') {
            return {
                interruptible: await this._hasExecutingTerminalProcess(sourceIdentity.id),
                interrupting: false,
            };
        }

        const runtimeSessionId = sourceIdentity?.type === 'runtime'
            ? sourceIdentity.id
            : preview.sessionId;
        if (!runtimeSessionId) {
            return { interruptible: false, interrupting: false };
        }
        const session = this._sessionManager.getSession(runtimeSessionId);
        return {
            interruptible: session?.state === RuntimeState.Busy || session?.state === RuntimeState.Interrupting,
            interrupting: session?.state === RuntimeState.Interrupting,
        };
    }

    /** Rehydrates the most recently updated persistent Viewer model. */
    async restoreLastPreview(): Promise<PreviewItem | undefined> {
        // Viewer providers are constructed before application activation. Make
        // restoration independent of that ordering instead of observing an
        // empty registry during extension-host startup.
        await this._surfaceLifecycle?.initialize();
        const restored = this._surfaceLifecycle
            ?.getModels(SurfaceModelKind.Viewer)
            .filter(model => model.retention === 'persistent')
            .sort((left, right) => right.updatedAt - left.updatedAt)[0];
        const payload = restored?.payload.preview;
        if (!restored || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return undefined;
        }
        const preview = payload as Record<string, unknown>;
        if (
            (preview.type !== 'url' && preview.type !== 'html') ||
            typeof preview.uri !== 'string' ||
            typeof preview.sessionId !== 'string'
        ) {
            return undefined;
        }

        const restoreUri = vscode.Uri.parse(preview.uri);
        let uri = restoreUri;
        try {
            if (restoreUri.scheme === 'file') {
                uri = await this._proxyService.resolvePath(restoreUri.fsPath);
            } else if (restoreUri.scheme === 'http' || restoreUri.scheme === 'https') {
                try {
                    uri = await vscode.env.asExternalUri(restoreUri);
                } catch {
                    uri = restoreUri;
                }
            }
            this._surfaceLifecycle.setRestoreState(restored.id, 'backend', 'ready');
        } catch (error) {
            this._surfaceLifecycle.setRestoreState(restored.id, 'backend', 'failed', error);
            throw error;
        }

        return {
            type: preview.type,
            uri,
            restoreUri,
            title: typeof preview.title === 'string' ? preview.title : undefined,
            height: typeof preview.height === 'number' ? preview.height : undefined,
            sessionId: preview.sessionId,
            outputId: typeof preview.outputId === 'string' ? preview.outputId : undefined,
            source: preview.source === 'fallback' ? 'fallback' : 'runtime-output',
            fallbackReason: typeof preview.fallbackReason === 'string' ? preview.fallbackReason : undefined,
            sourceIdentity: isPreviewSource(preview.sourceIdentity) ? preview.sourceIdentity : undefined,
            modelId: restored.id,
        };
    }

    private _publishPreview(preview: PreviewItem): PreviewItem {
        if (!this._surfaceLifecycle) {
            this._onDidShowPreviewEmitter.fire(preview);
            return preview;
        }
        const semanticId = preview.outputId ?? `${Date.now()}-${++this._nextPreviewId}`;
        const modelId = createSurfaceModelId(
            SurfaceModelKind.Viewer,
            preview.sessionId || 'extension',
            semanticId,
        );
        const source = this._surfaceSource(preview);
        this._surfaceLifecycle.upsertModel({
            id: modelId,
            kind: SurfaceModelKind.Viewer,
            resourceId: preview.outputId ?? semanticId,
            title: preview.title ?? 'Viewer',
            source,
            outputId: preview.outputId,
            retention: preview.outputId ? 'persistent' : 'retain-on-detach',
            payload: {
                preview: {
                    type: preview.type,
                    uri: (preview.restoreUri ?? preview.uri).toString(),
                    title: preview.title,
                    height: preview.height,
                    sessionId: preview.sessionId,
                    outputId: preview.outputId,
                    source: preview.source,
                    fallbackReason: preview.fallbackReason,
                    sourceIdentity: preview.sourceIdentity,
                },
            },
        });
        const published = { ...preview, modelId };
        this._onDidShowPreviewEmitter.fire(published);
        return published;
    }

    private _surfaceSource(preview: PreviewItem) {
        if (preview.sourceIdentity?.type === 'terminal') {
            return {
                kind: SurfaceSourceKind.Terminal,
                id: preview.sourceIdentity.id,
                stop: async () => this._interruptTerminal(preview.sourceIdentity!.id),
            };
        }
        if (preview.sourceIdentity?.type === 'runtime') {
            return {
                kind: SurfaceSourceKind.Runtime,
                id: preview.sourceIdentity.id,
                sessionId: preview.sourceIdentity.id,
                stop: async () => this._sessionManager.interruptSession(preview.sourceIdentity!.id),
            };
        }
        if (preview.sessionId) {
            return {
                kind: SurfaceSourceKind.Runtime,
                id: preview.sessionId,
                sessionId: preview.sessionId,
                stop: async () => this._sessionManager.interruptSession(preview.sessionId),
            };
        }
        return {
            kind: SurfaceSourceKind.Extension,
            id: 'preview-service',
        };
    }

    private async _interruptTerminal(processId: string): Promise<void> {
        for (const terminal of vscode.window.terminals) {
            const terminalProcessId = await terminal.processId;
            if (terminalProcessId !== undefined && String(terminalProcessId) === processId) {
                terminal.sendText('\x03', false);
                return;
            }
        }
        throw new Error(`Terminal process '${processId}' is no longer available`);
    }

    private async _hasExecutingTerminalProcess(processId: string): Promise<boolean> {
        for (const terminal of this._executingTerminals) {
            if (String(await terminal.processId) === processId) {
                return true;
            }
        }
        return false;
    }
}

function isPreviewSource(value: unknown): value is PreviewSource {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const candidate = value as Partial<PreviewSource>;
    return (candidate.type === 'runtime' || candidate.type === 'terminal') && typeof candidate.id === 'string';
}
