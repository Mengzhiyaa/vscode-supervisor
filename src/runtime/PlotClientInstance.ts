/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    type LanguageRuntimeMessageCommData,
    type LanguageRuntimeMessageCommOpen,
    RuntimeClientType,
} from '../internal/runtimeTypes';
import { RuntimeClientInstance, RuntimeClientMessageSender } from './RuntimeClientInstance';
import type { IPlotSize, IPositronPlotSizingPolicy } from './sizingPolicy';
import type { IntrinsicSize, PlotOrigin, PlotRenderSettings, PlotResult } from './comms/positronPlotComm';
import { PlotRenderFormat, PlotUnit } from './comms/positronPlotComm';
import { DeferredRender, IRenderedPlot } from './positronPlotRenderQueue';
import { PlotSizingPolicyAuto } from './sizingPolicyAuto';
import { PlotSizingPolicyCustom } from './sizingPolicyCustom';
import { PlotsConfiguration } from './plotsConfiguration';
import { PositronPlotCommProxy } from './comms/positronPlotCommProxy';
import { PlotClientState, ZoomLevel } from '../shared/plots';
import { logFrameworkDiagnostic } from '../logging/frameworkLogger';
export { PlotClientState, ZoomLevel } from '../shared/plots';

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

export function shouldFreezeSlowPlot(
    isFirstRender: boolean,
    rendered: Pick<IRenderedPlot, 'renderTimeMs' | 'size'>,
    freezeSlowPlots: boolean,
): rendered is Pick<IRenderedPlot, 'renderTimeMs'> & { size: IPlotSize } {
    return isFirstRender && rendered.renderTimeMs > 3000 && !!rendered.size && freezeSlowPlots;
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

    private readonly _plotSubscriptions: vscode.Disposable[] = [];
    private _disposedPlot = false;

    // Current state of the plot client
    private _plotState: PlotClientState = PlotClientState.Unrendered;

    // Time it took to render the plot last time
    private _lastRenderTimeMs: number = 0;

    // The sizing policy for this plot
    private _sizingPolicy: IPositronPlotSizingPolicy;

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
                format: preRender.settings.format ?? this._preRenderFormat(preRender.mime_type),
                renderTimeMs: 0,
            };
        }

        this._plotSubscriptions.push(commProxy.onDidClose(() => this.dispose()));

        this._plotSubscriptions.push(commProxy.onDidRenderUpdate(async (evt) => {
            const preRender = evt.pre_render;
            // Preserve the viewport request before installing the new kernel image.
            const desired = this._currentRender?.renderRequest ?? this._lastRender;
            let needsSelect = true;
            if (preRender?.data && preRender?.mime_type && preRender?.settings) {
                const rendered: IRenderedPlot = {
                    uri: `data:${preRender.mime_type};base64,${this._padBase64(preRender.data)}`,
                    size: preRender.settings.size,
                    pixel_ratio: preRender.settings.pixel_ratio || 1,
                    format: preRender.settings.format ?? this._preRenderFormat(preRender.mime_type),
                    renderTimeMs: 0,
                };
                if (this._currentRender && this._settingsEqual(rendered, this._currentRender.renderRequest)) {
                    this._currentRender.complete(rendered);
                } else {
                    this._currentRender?.cancel();
                }
                this._currentRender = undefined;
                this._lastRender = rendered;
                this._stateEmitter.fire(PlotClientState.Rendered);
                this._completeRenderEmitter.fire(rendered);
                this._renderUpdateEmitter.fire(rendered);
                if (!desired || this._settingsEqual(rendered, desired)) { return; }
                needsSelect = false;
            }
            try {
                const rendered = await this._queuePlotUpdateRequest(desired);
                if (needsSelect && !this._disposedPlot) { this._renderUpdateEmitter.fire(rendered); }
            } catch (error) {
                if (this._disposedPlot || (error instanceof Error && error.message === 'Canceled')) { return; }
                logFrameworkDiagnostic('PlotClientInstance', `Failed to queue plot update request: ${error}`);
                this._onDidUpdatePlot.fire();
            }
        }));

        // Listen for show plot events from the comm proxy
        this._plotSubscriptions.push(commProxy.onDidShowPlot(() => {
            this._showPlotEmitter.fire();
        }));

        // Listen for intrinsic size changes from the comm proxy
        this._plotSubscriptions.push(commProxy.onDidSetIntrinsicSize((size) => {
            this._intrinsicSizeEmitter.fire(size);
        }));

        // Listen for state changes
        this._plotSubscriptions.push(this.onDidChangeState((state) => {
            this._plotState = state;
        }));
    }

    /** Infer the format for older kernels that omit it from pre-render settings. */
    private _preRenderFormat(mime: string): PlotRenderFormat {
        switch (mime.toLowerCase()) {
            case 'image/svg+xml': return PlotRenderFormat.Svg;
            case 'image/jpeg': return PlotRenderFormat.Jpeg;
            case 'application/pdf': return PlotRenderFormat.Pdf;
            case 'image/tiff': return PlotRenderFormat.Tiff;
            default: return PlotRenderFormat.Png;
        }
    }

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
    getIntrinsicSize(): Promise<IntrinsicSize | undefined> {
        return this._commProxy.getIntrinsicSize();
    }

    /**
     * Returns the cached intrinsic size.
     */
    get intrinsicSize(): IntrinsicSize | undefined {
        return this._commProxy.intrinsicSize;
    }

    /**
     * Returns whether we have received the intrinsic size.
     */
    get receivedIntrinsicSize(): boolean {
        return this._commProxy.receivedIntrinsicSize;
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
        if (left.size?.height !== right.size?.height) {return false;}
        if (left.size?.width !== right.size?.width) {return false;}
        if (left.pixel_ratio !== right.pixel_ratio) {return false;}
        return (left.format ?? PlotRenderFormat.Png) === (right.format ?? PlotRenderFormat.Png);
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
        if (this._disposedPlot) { return Promise.reject(new vscode.CancellationError()); }
        const settings = {
            size: size && { height: Math.floor(size.height), width: Math.floor(size.width) },
            pixel_ratio,
            format,
        };
        if (!this._currentRender && this._lastRender && this._settingsEqual(settings, this._lastRender)) {
            return Promise.resolve(this._lastRender);
        }
        return this._performRender(settings, suppressCompleteEvent);
    }

    private _performRender(settings: { size?: IPlotSize; pixel_ratio: number; format: PlotRenderFormat }, suppressCompleteEvent = false): Promise<IRenderedPlot> {
        if (this._disposedPlot) { return Promise.reject(new vscode.CancellationError()); }
        this._currentRender?.cancel();
        const request = new DeferredRender(settings);
        this._currentRender = request;
        this._stateEmitter.fire(PlotClientState.RenderPending);
        // Install promise handlers before the proxy can synchronously complete/cancel it.
        const result = request.promise.then(rendered => {
            const result = { ...rendered, format: settings.format };
            if (this._disposedPlot || this._currentRender !== request) { return result; }
            const frozen = vscode.workspace.getConfiguration().get<boolean>(PlotsConfiguration.freezeSlowPlots, true);
            if (shouldFreezeSlowPlot(!this._lastRender, result, frozen)) {
                this.sizingPolicy = new PlotSizingPolicyCustom(result.size, true);
            }
            this._lastRender = result;
            this._lastRenderTimeMs = result.renderTimeMs;
            this._currentRender = undefined;
            if (!suppressCompleteEvent) { this._completeRenderEmitter.fire(result); }
            this._stateEmitter.fire(PlotClientState.Rendered);
            return result;
        }, error => {
            if (!this._disposedPlot && this._currentRender === request) {
                this._currentRender = undefined;
                this._stateEmitter.fire(PlotClientState.Rendered);
            }
            throw error;
        });
        this._commProxy.render(request);
        return result;
    }

    private _queuePlotUpdateRequest(settings = this._currentRender?.renderRequest ?? this._lastRender): Promise<IRenderedPlot> {
        if (!settings) { return Promise.reject(new Error('Cannot update plot before it has been rendered')); }
        // Kernel updates invalidate the cached pixels even when dimensions match.
        return this._performRender({
            size: settings.size,
            pixel_ratio: settings.pixel_ratio,
            format: settings.format ?? PlotRenderFormat.Png,
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
        if (this._disposedPlot) { return; }
        this._disposedPlot = true;
        this._currentRender?.cancel();
        this._currentRender = undefined;
        this._stateEmitter.fire(PlotClientState.Closed);
        this._onDidClose.fire();
        this._plotSubscriptions.forEach(subscription => subscription.dispose());
        this._plotSubscriptions.length = 0;

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
        this._renderUpdateEmitter.dispose();

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
