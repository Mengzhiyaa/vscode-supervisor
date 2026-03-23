/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ZoomLevel, PlotMetadata } from './PlotClientInstance';
import { IPositronPlotClient, IZoomablePlotClient } from './positronPlots';

/**
 * A static plot client for handling static image plots (PNG, SVG, JPEG, etc.).
 * 
 * Matches Positron's StaticPlotClient implementation.
 */
export class StaticPlotClient implements IPositronPlotClient, IZoomablePlotClient, vscode.Disposable {
    /** The plot metadata */
    public readonly metadata: PlotMetadata;

    /** The MIME type of the plot data */
    public readonly mimeType: string;

    /** The raw plot data (base64 for binary, raw for SVG) */
    public readonly data: string;

    /** The code that generated this plot (if known) */
    public readonly code?: string;

    /** Internal zoom level */
    private _zoomLevel: ZoomLevel = ZoomLevel.Fit;

    /** Event emitter for zoom level changes */
    private readonly _onDidChangeZoomLevel = new vscode.EventEmitter<ZoomLevel>();

    /** Event emitter for metadata updates */
    private readonly _onDidUpdateMetadata = new vscode.EventEmitter<PlotMetadata>();

    /** Static counter for generating unique IDs */
    private static _nextId = 0;

    /**
     * Creates a StaticPlotClient from a runtime message containing image data.
     * 
     * @param sessionId The session ID
     * @param messageId The message ID
     * @param mimeType The MIME type of the image
     * @param data The image data (base64 encoded for binary formats, raw for SVG)
     * @param code The code that generated this plot (optional)
     * @returns A new StaticPlotClient instance
     */
    static fromMessage(
        sessionId: string,
        messageId: string,
        mimeType: string,
        data: string,
        code?: string,
        outputId?: string
    ): StaticPlotClient {
        const metadata: PlotMetadata = {
            id: messageId || `static-plot-${StaticPlotClient._nextId++}`,
            created: Date.now(),
            session_id: sessionId,
            output_id: outputId,
            code: code ?? '',
            zoom_level: ZoomLevel.Fit
        };

        return new StaticPlotClient(metadata, mimeType, data, code);
    }

    /**
     * Creates a StaticPlotClient from existing metadata.
     * 
     * @param metadata The plot metadata
     * @param mimeType The MIME type
     * @param data The plot data
     * @returns A new StaticPlotClient instance
     */
    static fromMetadata(
        metadata: PlotMetadata,
        mimeType: string,
        data: string
    ): StaticPlotClient {
        return new StaticPlotClient(metadata, mimeType, data, metadata.code);
    }

    /**
     * Constructor.
     */
    private constructor(
        metadata: PlotMetadata,
        mimeType: string,
        data: string,
        code?: string
    ) {
        this.metadata = metadata;
        this.mimeType = mimeType;
        this.data = data;
        this.code = code;
    }

    /** Event that fires when the zoom level changes */
    get onDidChangeZoomLevel(): vscode.Event<ZoomLevel> {
        return this._onDidChangeZoomLevel.event;
    }

    /** Event that fires when the metadata is updated */
    get onDidUpdateMetadata(): vscode.Event<PlotMetadata> {
        return this._onDidUpdateMetadata.event;
    }

    /** Gets the unique ID of the plot */
    get id(): string {
        return this.metadata.id;
    }

    /** Gets the data URI representation of the plot */
    get uri(): string {
        if (this.mimeType === 'image/svg+xml') {
            // SVG data should be URI-encoded
            const svgData = encodeURIComponent(this.data);
            return `data:${this.mimeType};utf8,${svgData}`;
        }
        // Binary data is base64 encoded
        return `data:${this.mimeType};base64,${this.data}`;
    }

    /** Gets the current zoom level */
    get zoomLevel(): ZoomLevel {
        return this._zoomLevel;
    }

    /** Sets a new zoom level */
    set zoomLevel(level: ZoomLevel) {
        if (this._zoomLevel !== level) {
            this._zoomLevel = level;
            if (this.metadata.zoom_level !== level) {
                this.metadata.zoom_level = level;
            }
            this._onDidChangeZoomLevel.fire(level);
        }
    }

    /**
     * Disposes the static plot client.
     */
    dispose(): void {
        this._onDidChangeZoomLevel.dispose();
        this._onDidUpdateMetadata.dispose();
    }
}
