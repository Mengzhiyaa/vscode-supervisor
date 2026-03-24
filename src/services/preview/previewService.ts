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
    ShowUrlEvent,
    UiFrontendEvent,
} from '../../runtime/comms/positronUiComm';
import type { ILanguageRuntimeGlobalEvent } from '../../runtime/runtimeEvents';

export interface PreviewItem {
    type: 'url' | 'html';
    uri: vscode.Uri;
    title?: string;
    height?: number;
    sessionId: string;
}

/**
 * PositronPreviewService class (aligned with Positron pattern).
 * Manages preview routing for runtime UI events.
 */
export class PositronPreviewService implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _proxyService: HtmlProxyService;

    private readonly _onDidShowPreviewEmitter = new vscode.EventEmitter<PreviewItem>();
    readonly onDidShowPreview = this._onDidShowPreviewEmitter.event;

    constructor(
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _plotsService: PositronPlotsService,
        private readonly _outputChannel: vscode.LogOutputChannel
    ) {
        this._proxyService = new HtmlProxyService(_outputChannel);
    }

    initialize(): void {
        this._outputChannel.debug('[PositronPreviewService] Initializing...');

        this._disposables.push(
            this._sessionManager.onDidReceiveRuntimeEvent((runtimeEvent) => {
                void this._handleRuntimeEvent(runtimeEvent);
            })
        );

        this._outputChannel.debug('[PositronPreviewService] Initialized');
    }

    dispose(): void {
        this._proxyService.dispose();
        this._onDidShowPreviewEmitter.dispose();
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
                this._onDidShowPreviewEmitter.fire({
                    type: 'html',
                    uri,
                    title: event.title,
                    height: event.height,
                    sessionId
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

    async handleShowUrl(sessionId: string, event: ShowUrlEvent): Promise<void> {
        let uri: vscode.Uri;
        try {
            uri = vscode.Uri.parse(event.url);
        } catch {
            uri = vscode.Uri.file(event.url);
        }

        const uriPath = uri.path.toLowerCase();
        if (
            uri.scheme === 'file' &&
            (uriPath.endsWith('/') || uriPath.endsWith('.html') || uriPath.endsWith('.htm'))
        ) {
            uri = await this._proxyService.resolvePath(event.url);
        } else if (uri.scheme === 'http' || uri.scheme === 'https') {
            try {
                uri = await vscode.env.asExternalUri(uri);
            } catch (error) {
                this._outputChannel.debug(
                    `[PositronPreviewService] Failed to resolve external URI for ${event.url}: ${error}`
                );
            }
        }

        this._onDidShowPreviewEmitter.fire({
            type: 'url',
            uri,
            title: event.url,
            sessionId
        });
    }
}
