/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { IPlotSize } from '../sizingPolicy';
import type { IntrinsicSize, PlotMetadata } from './positronPlotComm';
import { PlotRenderFormat } from './positronPlotComm';
import {
    DeferredRender,
    IPlotComm,
    PositronPlotRenderQueue,
    type IRenderedPlot
} from '../positronPlotRenderQueue';
import { RuntimeClientInstance } from '../RuntimeClientInstance';
import { PositronPlotCommClass } from './positronPlotCommClass';

/**
 * Update event from the plot backend.
 * Matches Positron's UpdateEvent interface.
 */
export interface UpdateEvent {
    /** Optional pre-rendering data for immediate display */
    pre_render?: {
        data: string;
        mime_type: string;
        settings?: {
            size?: IPlotSize;
            pixel_ratio?: number;
        };
    };
}

/**
 * This class acts as a proxy for a plot comm, handling communication with the
 * backend and providing a higher-level interface for plot operations.
 *
 * It also manages the integration with the session-level render queue to ensure
 * that only one operation is performed at a time across all plots in a session.
 *
 * Matches Positron's PositronPlotCommProxy class.
 */
export class PositronPlotCommProxy implements vscode.Disposable {
    /**
     * The currently active render request, if any.
     */
    private _currentRender?: DeferredRender;

    /**
     * The intrinsic size of the plot, if known.
     */
    private _intrinsicSize?: IntrinsicSize;

    /**
     * Whether the plot has received its intrinsic size (even if it's unknown) from the runtime.
     */
    private _receivedIntrinsicSize = false;

    /**
     * The response of the currently active intrinsic size request, if any.
     */
    private _currentIntrinsicSize?: Promise<IntrinsicSize | undefined>;

    /**
     * Event that fires when the plot is closed on the runtime side, typically
     * because the runtime exited and doesn't preserve plot state.
     */
    readonly onDidClose: vscode.Event<void>;
    private readonly _closeEmitter = new vscode.EventEmitter<void>();

    /**
     * Event that fires when the plot has been updated by the runtime and
     * re-rendered. Notifies clients so they can request a render update with their own
     * render parameters. May include a pre-rendering for immediate display.
     */
    readonly onDidRenderUpdate: vscode.Event<UpdateEvent>;
    private readonly _renderUpdateEmitter = new vscode.EventEmitter<UpdateEvent>();

    /**
     * Event that fires when the plot wants to display itself.
     */
    readonly onDidShowPlot: vscode.Event<void>;
    private readonly _didShowPlotEmitter = new vscode.EventEmitter<void>();

    /**
     * Event that fires when the intrinsic size of the plot is set.
     */
    readonly onDidSetIntrinsicSize: vscode.Event<IntrinsicSize | undefined>;
    private readonly _didSetIntrinsicSizeEmitter = new vscode.EventEmitter<IntrinsicSize | undefined>();

    /**
     * Disposables for cleanup.
     */
    private readonly _disposables: vscode.Disposable[] = [];

    /**
     * The underlying PositronPlotCommClass instance.
     */
    private readonly _comm: PositronPlotCommClass;

    /**
     * The IPlotComm adapter that wraps the comm class.
     */
    private readonly _commAdapter: IPlotComm;

    constructor(
        private readonly _client: RuntimeClientInstance,
        private readonly _sessionRenderQueue: PositronPlotRenderQueue
    ) {
        // Create the PositronPlotCommClass instance
        this._comm = new PositronPlotCommClass(_client);
        this._disposables.push(this._comm);

        // Create the IPlotComm adapter that wraps the comm class
        this._commAdapter = this._createCommAdapter();

        // Register emitters for disposal
        this._disposables.push(this._closeEmitter);
        this._disposables.push(this._renderUpdateEmitter);
        this._disposables.push(this._didShowPlotEmitter);
        this._disposables.push(this._didSetIntrinsicSizeEmitter);

        // Connect close emitter event from the comm class
        this.onDidClose = this._closeEmitter.event;
        this._disposables.push(
            this._comm.onDidClose(() => {
                this._closeEmitter.fire();
                // Silently cancel any pending render requests
                this._currentRender?.cancel();
            })
        );

        // Connect the render update emitter event
        this.onDidRenderUpdate = this._renderUpdateEmitter.event;

        // Connect the show plot emitter event
        this.onDidShowPlot = this._didShowPlotEmitter.event;

        // Connect the intrinsic size emitter event
        this.onDidSetIntrinsicSize = this._didSetIntrinsicSizeEmitter.event;

        // Listen for update events from the comm class (using typed events)
        this._disposables.push(
            this._comm.onDidUpdate((evt) => {
                const updateEvent: UpdateEvent = {};
                if (evt.pre_render) {
                    updateEvent.pre_render = {
                        data: evt.pre_render.data,
                        mime_type: evt.pre_render.mime_type,
                        settings: evt.pre_render.settings ? {
                            size: evt.pre_render.settings.size,
                            pixel_ratio: evt.pre_render.settings.pixel_ratio
                        } : undefined
                    };
                }
                this._renderUpdateEmitter.fire(updateEvent);
            })
        );

        // Listen for show events from the comm class
        this._disposables.push(
            this._comm.onDidShow(() => {
                this._didShowPlotEmitter.fire();
            })
        );
    }

    /**
     * Create the comm adapter that implements IPlotComm interface.
     * This adapter wraps the PositronPlotCommClass to provide the IPlotComm interface
     * required by the render queue.
     */
    private _createCommAdapter(): IPlotComm {
        const comm = this._comm;
        const closeEmitter = this._closeEmitter;
        return {
            get clientId(): string {
                return comm.clientId;
            },
            get onDidClose(): vscode.Event<void> {
                return closeEmitter.event;
            },
            async render(size: IPlotSize | undefined, pixelRatio: number, format: PlotRenderFormat): Promise<{ data: string; mime_type: string }> {
                const result = await comm.render(size, pixelRatio, format);
                return {
                    data: result.data,
                    mime_type: result.mime_type
                };
            },
            async getIntrinsicSize(): Promise<IntrinsicSize | undefined> {
                return comm.getIntrinsicSize();
            },
            async getMetadata(): Promise<PlotMetadata> {
                return comm.getMetadata();
            }
        };
    }

    /**
     * Returns the client ID of the underlying comm.
     */
    get clientId(): string {
        return this._client.getClientId();
    }

    /**
     * Returns the intrinsic size of the plot, if known.
     */
    get intrinsicSize(): IntrinsicSize | undefined {
        return this._intrinsicSize;
    }

    /**
     * Returns a boolean indicating whether this plot has a known intrinsic size.
     */
    get receivedIntrinsicSize(): boolean {
        return this._receivedIntrinsicSize;
    }

    /**
     * Get the intrinsic size of the plot, if known.
     *
     * @returns A promise that resolves to the intrinsic size of the plot, if known.
     */
    public getIntrinsicSize(): Promise<IntrinsicSize | undefined> {
        // If there's already an in-flight request, return its response.
        if (this._currentIntrinsicSize) {
            return this._currentIntrinsicSize;
        }

        // If we have already received the intrinsic size, return it immediately.
        if (this._receivedIntrinsicSize) {
            return Promise.resolve(this._intrinsicSize);
        }

        // Use the session render queue to ensure operations don't overlap
        this._currentIntrinsicSize = this._sessionRenderQueue.queueIntrinsicSizeRequest(this._commAdapter)
            .then((intrinsicSize) => {
                this._intrinsicSize = intrinsicSize;
                this._receivedIntrinsicSize = true;
                this._didSetIntrinsicSizeEmitter.fire(intrinsicSize);
                return intrinsicSize;
            })
            .finally(() => {
                this._currentIntrinsicSize = undefined;
            });
        return this._currentIntrinsicSize;
    }

    /**
     * Get metadata for the plot.
     *
     * @returns A promise that resolves to the plot metadata.
     */
    public getMetadata(): Promise<PlotMetadata> {
        return this._sessionRenderQueue.queueMetadataRequest(this._commAdapter);
    }

    /**
     * Renders a plot. The request is queued if a render is already in progress.
     *
     * @param request The render request to perform
     */
    public render(request: DeferredRender): void {
        this._currentRender = request;

        // The session render queue will handle scheduling and rendering
        this._sessionRenderQueue.queue(request, this._commAdapter);
    }

    /**
     * Render the plot at the given size.
     *
     * @param size The size to render at
     * @param pixelRatio The pixel ratio
     * @param format The render format
     * @returns A promise that resolves to the rendered plot
     */
    public renderPlot(size: IPlotSize | undefined, pixelRatio: number, format: PlotRenderFormat = PlotRenderFormat.Png): Promise<IRenderedPlot> {
        const request = new DeferredRender({
            size,
            pixel_ratio: pixelRatio,
            format
        });
        this.render(request);
        return request.promise;
    }

    /**
     * Dispose the comm proxy and clean up resources.
     */
    dispose(): void {
        // Cancel any pending render
        this._currentRender?.cancel();

        // Dispose all disposables
        this._disposables.forEach(d => d.dispose());
    }
}
