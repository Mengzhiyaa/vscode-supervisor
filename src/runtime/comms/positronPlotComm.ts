/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Possible values for PlotUnit.
 * Matches Positron's PlotUnit enum.
 */
export enum PlotUnit {
    Pixels = 'pixels',
    Inches = 'inches'
}

/**
 * Possible values for PlotRenderFormat.
 * Matches Positron's PlotRenderFormat enum.
 */
export enum PlotRenderFormat {
    Png = 'png',
    Jpeg = 'jpeg',
    Svg = 'svg',
    Pdf = 'pdf',
    Tiff = 'tiff'
}

/**
 * The intrinsic size of a plot, if known.
 * Matches Positron's IntrinsicSize interface.
 */
export interface IntrinsicSize {
    /** The width of the plot */
    width: number;

    /** The height of the plot */
    height: number;

    /** The unit of measurement of the plot's dimensions */
    unit: PlotUnit;

    /** The source of the intrinsic size e.g. 'Matplotlib', 'ggplot2' */
    source: string;
}

/**
 * The size of a plot.
 * Matches Positron's PlotSize interface.
 */
export interface PlotSize {
    /** The plot's height, in pixels */
    height: number;

    /** The plot's width, in pixels */
    width: number;
}

/**
 * The settings used to render the plot.
 * Matches Positron's PlotRenderSettings interface.
 */
export interface PlotRenderSettings {
    /** Plot size to render the plot to */
    size: PlotSize;

    /** The pixel ratio of the display device */
    pixel_ratio: number;

    /** Format in which to render the plot */
    format: PlotRenderFormat;
}

/**
 * A rendered plot.
 * Matches Positron's PlotResult interface.
 */
export interface PlotResult {
    /** The plot data, as a base64-encoded string */
    data: string;

    /** The MIME type of the plot data */
    mime_type: string;

    /** The settings used to render the plot */
    settings?: PlotRenderSettings;
}

/**
 * Parameters for the Render method.
 * Matches Positron's RenderParams interface.
 */
export interface RenderParams {
    /** The requested size of the plot. If not provided, the plot will be rendered at its intrinsic size. */
    size?: PlotSize;

    /** The pixel ratio of the display device */
    pixel_ratio: number;

    /** The requested plot format */
    format: PlotRenderFormat;
}

/**
 * Event: Notification that a plot has been updated on the backend.
 * Matches Positron's UpdateEvent interface.
 */
export interface UpdateEvent {
    /** Optional pre-rendering data for immediate display */
    pre_render?: PlotResult;
}

/**
 * Event: Show a plot.
 * Matches Positron's ShowEvent interface.
 */
export interface ShowEvent {
    // Empty interface per Positron spec
}

/**
 * Frontend event types from the plot comm.
 */
export enum PlotFrontendEvent {
    Update = 'update',
    Show = 'show'
}

/**
 * Backend request types for the plot comm.
 */
export enum PlotBackendRequest {
    GetIntrinsicSize = 'get_intrinsic_size',
    GetMetadata = 'get_metadata',
    Render = 'render'
}

/**
 * Source range for a plot origin.
 */
export interface PlotRange {
    start_line: number;
    start_character: number;
    end_line: number;
    end_character: number;
}

/**
 * Origin metadata for a plot.
 */
export interface PlotOrigin {
    uri: string;
    range?: PlotRange;
}

/**
 * Plot metadata returned from the backend.
 * Matches Positron's PlotMetadata interface.
 */
export interface PlotMetadata {
    /** A human-readable name for the plot */
    name: string;

    /** The kind of plot e.g. 'Matplotlib', 'ggplot2', etc. */
    kind: string;

    /** The ID of the code fragment that produced the plot */
    execution_id: string;

    /** The code fragment that produced the plot */
    code: string;

    /** The origin of the plot, if known. */
    origin?: PlotOrigin;
}
