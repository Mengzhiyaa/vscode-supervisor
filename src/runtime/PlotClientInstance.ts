/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    type LanguageRuntimeMessageCommData,
    type LanguageRuntimeMessageCommOpen,
    RuntimeClientType,
} from '../positronTypes';
import { RuntimeClientInstance, RuntimeClientMessageSender } from './RuntimeClientInstance';
import type { IPlotSize, IPositronPlotSizingPolicy } from './sizingPolicy';
import type { IntrinsicSize, PlotOrigin, PlotRenderSettings, PlotResult } from './comms/positronPlotComm';
import { PlotRenderFormat, PlotUnit } from './comms/positronPlotComm';
import { DeferredRender, IRenderedPlot, RenderRequest } from './positronPlotRenderQueue';
import { PlotSizingPolicyAuto } from './sizingPolicyAuto';
import { PlotSizingPolicyCustom } from './sizingPolicyCustom';
import { PositronPlotCommProxy } from './comms/positronPlotCommProxy';

/**
 * The possible states for the plot client instance.
 * Matches Positron's PlotClientState enum.
 */
export enum PlotClientState {
    /** The plot client has never rendered a plot */
    Unrendered = 'unrendered',

    /** The plot client has been requested to render a plot, but hasn't done it yet. */
    RenderPending = 'render_pending',

    /** The plot client is currently rendering a plot */
    Rendering = 'rendering',

    /** The plot client has rendered a plot */
    Rendered = 'rendered',

    /** The plot client is closed (disconnected); it cannot render any further plots */
    Closed = 'closed',
}

/**
 * Zoom levels for displaying plots.
 * Matches Positron's ZoomLevel enum.
 */
export enum ZoomLevel {
    Fit = 0,
    Fifty = 0.5,
    SeventyFive = 0.75,
    OneHundred = 1,
    TwoHundred = 2,
}

/**
 * The result of rendering a plot.
 * Kept for backward compatibility.
 */
export interface RenderedPlot {
    /** Data URI of the rendered plot (e.g., 'data:image/png;base64,...') */
    uri: string;
    /** The size at which the plot was rendered */
    size?: { width: number; height: number };
    /** The pixel ratio used for rendering */
    pixel_ratio: number;
    /** Time taken to render in milliseconds */
    renderTimeMs: number;
}

/**
 * Metadata associated with a Positron plot.
 * Matches Positron's IPositronPlotMetadata interface.
 */
export interface PlotMetadata {
    /** The plot's unique ID, as supplied by the language runtime */
    id: string;
    /** The plot's moment of creation, in milliseconds since the Epoch */
    created: number;
    /** The kind of the plot (e.g. 'Matplotlib', 'ggplot2', etc.) */
    kind?: string;
    /** A unique, human-readable name for the plot */
    name?: string;
    /** The execution ID that created the plot */
    execution_id?: string;
    /** The code that created the plot, if known */
    code?: string;
    /** The origin of the plot in source code, if known */
    origin?: PlotOrigin;
    /** The ID of the runtime session that created the plot */
    session_id: string;
    /** The optional output identifier of the plot */
    output_id?: string;
    /** The plot's location for display (view/editor) */
    location?: string;
    /** The pre-rendering of the plot for initial display, if any */
    pre_render?: PlotResult;
    /** Suggested file name for saving the plot */
    suggested_file_name?: string;
    /** HTML URI for html plot clients */
    html_uri?: string;
    /** The language of the session */
    language?: string;
    /** The sizing policy for the plot */
    sizing_policy?: {
        id: string;
        size?: IPlotSize;
    };
    /** The zoom level for displaying the plot */
    zoom_level?: ZoomLevel;
}

/**
 * A client instance for handling plot comms from the runtime.
 * 
 * This is a full version of Positron's PlotClientInstance that:
 * - Extends RuntimeClientInstance for comm management
 * - Handles plot render requests and updates
 * - Emits events when plots are rendered
 * - Supports sizing policies and intrinsic size
 * - Manages render state with throttling
 * 
 * Matches Positron's PlotClientInstance in services/languageRuntime.
 */
export class PlotClientInstance extends RuntimeClientInstance {
    // The comm proxy that handles rendering via the session render queue
    private readonly _commProxy: PositronPlotCommProxy;

    // The last rendered plot
    private _lastRender?: IRenderedPlot;

    // The currently active render request, if any (for smart pre-render checking)
    private _currentRender?: DeferredRender;

    // The render request queued for processing after an update
    private _queuedRender?: DeferredRender;

    // Current state of the plot client
    private _plotState: PlotClientState = PlotClientState.Unrendered;

    // Time it took to render the plot last time
    private _lastRenderTimeMs: number = 0;

    // The sizing policy for this plot
    private _sizingPolicy: IPositronPlotSizingPolicy;

    // Cached intrinsic size
    private _intrinsicSize?: IntrinsicSize;

    // Whether we have received the intrinsic size
    private _receivedIntrinsicSize: boolean = false;

    // Emitters
    private readonly _onDidRenderPlot = new vscode.EventEmitter<RenderedPlot>();
    private readonly _onDidUpdatePlot = new vscode.EventEmitter<void>();
    private readonly _onDidClose = new vscode.EventEmitter<void>();
    private readonly _stateEmitter = new vscode.EventEmitter<PlotClientState>();
    private readonly _completeRenderEmitter = new vscode.EventEmitter<IRenderedPlot>();
    private readonly _sizingPolicyEmitter = new vscode.EventEmitter<IPositronPlotSizingPolicy>();
    private readonly _intrinsicSizeEmitter = new vscode.EventEmitter<IntrinsicSize | undefined>();
    private readonly _zoomLevelEmitter = new vscode.EventEmitter<ZoomLevel>();
    private readonly _showPlotEmitter = new vscode.EventEmitter<void>();
    private readonly _renderUpdateEmitter = new vscode.EventEmitter<IRenderedPlot>();
    private readonly _metadataUpdateEmitter = new vscode.EventEmitter<PlotMetadata>();

    /** Event that fires when a plot has been rendered. */
    readonly onDidRenderPlot = this._onDidRenderPlot.event;

    /** Event that fires when the plot has been updated by the runtime. */
    readonly onDidUpdatePlot = this._onDidUpdatePlot.event;

    /** Event that fires when the plot is closed. */
    readonly onDidClose = this._onDidClose.event;

    /** Event that fires when the state changes. */
    readonly onDidChangeState = this._stateEmitter.event;

    /** Event that fires when a render completes. */
    readonly onDidCompleteRender = this._completeRenderEmitter.event;

    /** Event that fires when the sizing policy changes. */
    readonly onDidChangeSizingPolicy = this._sizingPolicyEmitter.event;

    /** Event that fires when the intrinsic size is set. */
    readonly onDidSetIntrinsicSize = this._intrinsicSizeEmitter.event;

    /** Event that fires when the zoom level changes. */
    readonly onDidChangeZoomLevel = this._zoomLevelEmitter.event;

    /** Event that fires when the plot should be shown. */
    readonly onDidShowPlot = this._showPlotEmitter.event;

    /** Event that fires when a render update arrives (for UI selection). */
    readonly onDidRenderUpdate = this._renderUpdateEmitter.event;

    /** Event that fires when the metadata is updated. */
    readonly onDidUpdateMetadata = this._metadataUpdateEmitter.event;

    /** The plot's metadata (mutable for updateMetadata). */
    metadata: PlotMetadata;

    /**
     * Creates a new PlotClientInstance.
     *
     * @param message The comm_open message that created this client
     * @param sender Function to send messages to the kernel
     * @param closer Function to close the comm
     * @param sessionId The session ID that owns this plot
     * @param sizingPolicy Optional initial sizing policy (defaults to Auto)
     * @param commProxy Comm proxy for queue-based rendering (required)
     */
    constructor(
        message: LanguageRuntimeMessageCommOpen,
        sender: RuntimeClientMessageSender,
        closer: () => void,
        sessionId: string,
        sizingPolicy: IPositronPlotSizingPolicy | undefined,
        commProxy: PositronPlotCommProxy
    ) {
        super(message, sender, closer);

        // Store the comm proxy for queue-based rendering
        this._commProxy = commProxy;

        // Initialize sizing policy
        this._sizingPolicy = sizingPolicy || new PlotSizingPolicyAuto();

        // Initialize metadata from the comm_open message
        const data = message.data as Record<string, any>;
        this.metadata = {
            id: message.comm_id,
            created: Date.now(),
            kind: data.kind,
            name: data.name,
            execution_id: data.execution_id,
            code: data.code,
            origin: data.origin,
            session_id: sessionId,
            pre_render: data.pre_render,
            sizing_policy: {
                id: this._sizingPolicy.id
            }
        };

        // Handle pre-render if present in the initial message
        if (data.pre_render?.settings) {
            const preRender = data.pre_render;
            const uri = `data:${preRender.mime_type};base64,${this._padBase64(preRender.data)}`;
            this._lastRender = {
                uri,
                size: preRender.settings.size,
                pixel_ratio: preRender.settings.pixel_ratio,
                renderTimeMs: 0,
            };
        }

        // Listen for close events from the comm proxy
        commProxy.onDidClose(() => {
            this._onDidClose.fire();
            this._currentRender?.cancel();
            this._stateEmitter.fire(PlotClientState.Closed);
        });

        // Listen for render update events from the comm proxy (Positron-style with queuePlotUpdateRequest)
        commProxy.onDidRenderUpdate(async (evt) => {
            const preRender = evt.pre_render;
            let needsSelect = true;

            if (preRender?.data && preRender?.mime_type && preRender?.settings) {
                const uri = `data:${preRender.mime_type};base64,${preRender.data}`;
                const preRenderPlot: IRenderedPlot = {
                    uri,
                    size: preRender.settings.size,
                    pixel_ratio: preRender.settings.pixel_ratio || 1,
                    renderTimeMs: 0,
                };

                // Store the pre-rendering as the last render
                this._lastRender = preRenderPlot;

                // Fire the render update event to select the updated plot in the UI
                this._renderUpdateEmitter.fire(preRenderPlot);

                // Smart pre-render checking: Check if settings match current render request
                const currentRenderRequest = this._currentRender?.renderRequest ?? this._lastRender;
                const normalizedSettings = {
                    size: preRender.settings.size,
                    pixel_ratio: preRender.settings.pixel_ratio || 1
                };
                if (currentRenderRequest && this._settingsEqual(
                    normalizedSettings,
                    currentRenderRequest
                )) {
                    // Settings match — treat pre-render as final, notify listeners
                    this._completeRenderEmitter.fire(preRenderPlot);
                    return;
                }

                // Settings mismatch — skip pre-render notification to avoid
                // transmitting an image that will be immediately replaced by
                // the re-render below. Also don't select plot again to avoid
                // unexpected jerkiness.
                needsSelect = false;
            }

            // No pre-render or settings mismatch: Queue a render request
            try {
                const rendered = await this._queuePlotUpdateRequest();

                // Fire the update event to select it in the UI
                if (needsSelect) {
                    this._renderUpdateEmitter.fire(rendered);
                }
            } catch (err) {
                // Log error but don't crash - plot may not have been rendered yet
                console.warn('Failed to queue plot update request:', err);
                this._onDidUpdatePlot.fire();
            }
        });

        // Listen for show plot events from the comm proxy
        commProxy.onDidShowPlot(() => {
            this._showPlotEmitter.fire();
        });

        // Listen for intrinsic size changes from the comm proxy
        commProxy.onDidSetIntrinsicSize((size) => {
            this._intrinsicSize = size;
            this._receivedIntrinsicSize = true;
            this._intrinsicSizeEmitter.fire(size);
        });

        // Listen for state changes
        this.onDidChangeState((state) => {
            this._plotState = state;
        });
    }

    /**
     * Pad base64 string to ensure proper decoding.
     */
    private _padBase64(data: string): string {
        const padding = data.length % 4;
        if (padding > 0) {
            return data + '='.repeat(4 - padding);
        }
        return data;
    }



    /**
     * Get the intrinsic size of the plot, if known.
     *
     * @returns A promise that resolves to the intrinsic size of the plot, if known.
     */
    async getIntrinsicSize(): Promise<IntrinsicSize | undefined> {
        if (this._receivedIntrinsicSize) {
            return this._intrinsicSize;
        }

        try {
            const result = await this._commProxy.getIntrinsicSize();
            this._intrinsicSize = result;
            this._receivedIntrinsicSize = true;
            this._intrinsicSizeEmitter.fire(result);
            return result;
        } catch (e) {
            this._receivedIntrinsicSize = true;
            return undefined;
        }
    }

    /**
     * Returns the cached intrinsic size.
     */
    get intrinsicSize(): IntrinsicSize | undefined {
        return this._intrinsicSize;
    }

    /**
     * Returns whether we have received the intrinsic size.
     */
    get receivedIntrinsicSize(): boolean {
        return this._receivedIntrinsicSize;
    }

    /**
     * Returns the current state of the plot client.
     */
    get state(): PlotClientState {
        return this._plotState;
    }

    /**
     * Returns an estimate for the time it will take to render the plot, in milliseconds.
     */
    get renderEstimateMs(): number {
        return this._lastRenderTimeMs;
    }

    /**
     * Gets the current sizing policy.
     */
    get sizingPolicy(): IPositronPlotSizingPolicy {
        return this._sizingPolicy;
    }

    /**
     * Sets a new sizing policy.
     */
    set sizingPolicy(newSizingPolicy: IPositronPlotSizingPolicy) {
        this._sizingPolicy = newSizingPolicy;
        this.metadata.sizing_policy = {
            id: newSizingPolicy.id,
            size: newSizingPolicy instanceof PlotSizingPolicyCustom ? newSizingPolicy.size : undefined
        };
        this._sizingPolicyEmitter.fire(newSizingPolicy);
    }

    /**
     * Render using the sizing policy.
     *
     * @param suppressCompleteEvent When true, the completion event is not fired.
     *   Use this when the caller already delivers the rendered URI (e.g. via an
     *   RPC response) and emitting the event would duplicate the transmission.
     */
    renderWithSizingPolicy(size: IPlotSize | undefined, pixel_ratio: number, format = PlotRenderFormat.Png, suppressCompleteEvent = false): Promise<IRenderedPlot> {
        return this.renderPlot(size ? this._sizingPolicy.getPlotSize(size) : size, pixel_ratio, format, suppressCompleteEvent);
    }

    /**
     * Check if render settings are equal.
     */
    private _settingsEqual(
        left: { size?: IPlotSize; pixel_ratio: number; format?: PlotRenderFormat },
        right: { size?: IPlotSize; pixel_ratio: number; format?: PlotRenderFormat }
    ): boolean {
        if (left.size?.height !== right.size?.height) return false;
        if (left.size?.width !== right.size?.width) return false;
        if (left.pixel_ratio !== right.pixel_ratio) return false;
        return true;
    }

    /**
     * Requests that the plot be rendered at a specific size.
     *
     * @param size The plot size, in pixels
     * @param pixel_ratio The device pixel ratio
     * @param format The format of the plot
     * @returns A promise that resolves to a rendered image
     */
    renderPlot(size: IPlotSize | undefined, pixel_ratio: number, format = PlotRenderFormat.Png, suppressCompleteEvent = false): Promise<IRenderedPlot> {
        // Deal with whole pixels only
        const sizeInt = size && {
            height: Math.floor(size.height),
            width: Math.floor(size.width)
        };

        // Compare against the last render request
        if (sizeInt && this._lastRender?.size && this._settingsEqual(
            { size: sizeInt, pixel_ratio, format },
            this._lastRender
        )) {
            // The last render request was the same size; return the last render result
            return Promise.resolve(this._lastRender);
        }

        // Create and track the render request for smart pre-render checking
        const request = new DeferredRender({
            size: sizeInt,
            pixel_ratio,
            format
        });
        this._currentRender = request;

        // Use queue-based rendering via the comm proxy
        this._stateEmitter.fire(PlotClientState.RenderPending);
        this._commProxy.render(request);

        return request.promise.then((rendered) => {
            this._lastRender = rendered;
            this._lastRenderTimeMs = rendered.renderTimeMs;
            if (!suppressCompleteEvent) {
                this._completeRenderEmitter.fire(rendered);
            }
            this._stateEmitter.fire(PlotClientState.Rendered);
            this._currentRender = undefined;
            return rendered;
        }).catch((err) => {
            this._stateEmitter.fire(PlotClientState.Rendered);
            this._currentRender = undefined;
            throw err;
        });
    }

    /**
     * Queues a plot update request, if necessary. Returns a promise that
     * resolves with the rendered plot.
     * 
     * Matches Positron's queuePlotUpdateRequest() pattern.
     */
    private _queuePlotUpdateRequest(): Promise<IRenderedPlot> {
        if (this._queuedRender) {
            // There is already a queued render request; it will take care of
            // updating the plot.
            return this._queuedRender.promise;
        }

        // If we have never rendered this plot, we can't process any updates yet.
        const render = this._currentRender?.renderRequest ?? this._lastRender;
        if (!render) {
            return Promise.reject(new Error('Cannot update plot before it has been rendered'));
        }

        // Use the dimensions of the last or current render request to determine
        // the size and DPI of the plot to update.
        const sizeInt = render.size && {
            height: Math.floor(render.size.height),
            width: Math.floor(render.size.width)
        };

        // Create the render request
        // Note: IRenderedPlot doesn't have format, so default to Png
        const format = 'format' in render ? render.format : PlotRenderFormat.Png;
        const request = new DeferredRender({
            size: sizeInt,
            pixel_ratio: render.pixel_ratio,
            format
        });
        this._queuedRender = request;

        // Use queue-based rendering via the comm proxy
        this._stateEmitter.fire(PlotClientState.RenderPending);
        this._commProxy.render(request);

        return request.promise.then((rendered) => {
            this._lastRender = rendered;
            this._lastRenderTimeMs = rendered.renderTimeMs;
            this._completeRenderEmitter.fire(rendered);
            this._stateEmitter.fire(PlotClientState.Rendered);
            this._queuedRender = undefined;
            return rendered;
        }).catch((err) => {
            this._stateEmitter.fire(PlotClientState.Rendered);
            this._queuedRender = undefined;
            throw err;
        });
    }

    /**
     * Gets the last rendered plot, if any.
     */
    get lastRender(): IRenderedPlot | undefined {
        return this._lastRender;
    }

    /**
     * Gets the plot's unique ID.
     */
    get id(): string {
        return this.metadata.id;
    }

    /**
     * Gets or sets the zoom level.
     */
    get zoomLevel(): ZoomLevel {
        return this.metadata.zoom_level ?? ZoomLevel.Fit;
    }

    set zoomLevel(level: ZoomLevel) {
        if (this.metadata.zoom_level !== level) {
            this.metadata.zoom_level = level;
            this._zoomLevelEmitter.fire(level);
        }
    }

    /**
     * Requests that the plot be rendered at a specific size (legacy interface).
     *
     * @param settings The render settings (size, pixel ratio, format)
     * @returns A promise that resolves with the rendered plot
     */
    async render(settings: PlotRenderSettings): Promise<RenderedPlot> {
        const result = await this.renderPlot(settings.size, settings.pixel_ratio, settings.format);
        return result;
    }

    /**
     * Disposes the plot client.
     */
    override dispose(): void {
        this._stateEmitter.fire(PlotClientState.Closed);
        this._onDidClose.fire();

        // Dispose emitters
        this._onDidRenderPlot.dispose();
        this._onDidUpdatePlot.dispose();
        this._onDidClose.dispose();
        this._stateEmitter.dispose();
        this._completeRenderEmitter.dispose();
        this._sizingPolicyEmitter.dispose();
        this._intrinsicSizeEmitter.dispose();
        this._zoomLevelEmitter.dispose();
        this._showPlotEmitter.dispose();
        this._metadataUpdateEmitter.dispose();

        super.dispose();
    }

    /**
     * Updates the metadata for this plot client.
     * Called after fetching metadata from the backend via get_metadata RPC.
     * Matches Positron's metadata update pattern.
     * 
     * @param metadata Partial metadata to merge with existing metadata
     */
    updateMetadata(metadata: Partial<PlotMetadata>): void {
        this.metadata = { ...this.metadata, ...metadata };
        this._metadataUpdateEmitter.fire(this.metadata);
    }
}

/**
 * Creates a PlotClientInstance from a RuntimeClientInstance.
 * Used when the RuntimeClientManager receives a comm_open for a plot.
 *
 * @param message The comm_open message
 * @param sender Function to send messages to the kernel
 * @param closer Function to close the comm
 * @param sessionId The session ID
 * @param sizingPolicy Sizing policy (can be undefined for default)
 * @param commProxy Comm proxy for queue-based rendering (required)
 * @returns A new PlotClientInstance
 */
export function createPlotClient(
    message: LanguageRuntimeMessageCommOpen,
    sender: RuntimeClientMessageSender,
    closer: () => void,
    sessionId: string,
    sizingPolicy: IPositronPlotSizingPolicy | undefined,
    commProxy: PositronPlotCommProxy
): PlotClientInstance {
    return new PlotClientInstance(message, sender, closer, sessionId, sizingPolicy, commProxy);
}
