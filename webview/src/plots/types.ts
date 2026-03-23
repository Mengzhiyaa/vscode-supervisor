/**
 * Shared types for the Plots webview.
 * These types are extracted from Svelte components to avoid TypeScript enum issues.
 *
 * Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 * Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 */

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
 * Dark filter modes for plots.
 * Matches Positron's DarkFilter enum.
 */
export enum DarkFilter {
    /** The dark filter is always on */
    On = "on",
    /** The dark filter is always off */
    Off = "off",
    /** The dark filter follows the current theme */
    Auto = "auto",
}

/**
 * The possible states for the plot client instance.
 * Matches Positron's PlotClientState enum.
 */
export enum PlotClientState {
    /** The plot client has never rendered a plot */
    Unrendered = "unrendered",
    /** The plot client has been requested to render a plot, but hasn't done it yet */
    RenderPending = "render_pending",
    /** The plot client is currently rendering a plot */
    Rendering = "rendering",
    /** The plot client has rendered a plot */
    Rendered = "rendered",
    /** The plot client is closed (disconnected) */
    Closed = "closed",
}

/**
 * History policy for showing the plot gallery.
 * Matches Positron's HistoryPolicy enum.
 */
export enum HistoryPolicy {
    /** The plot history is always shown */
    AlwaysVisible = "always",
    /** The plot history is never shown */
    NeverVisible = "never",
    /** The plot history is shown only when there is more than one plot */
    Automatic = "automatic",
}

/**
 * History position for the plot gallery filmstrip.
 */
export enum HistoryPosition {
    /** Automatically choose position based on container aspect ratio */
    Auto = "auto",
    /** Always show history at the bottom */
    Bottom = "bottom",
    /** Always show history on the right */
    Right = "right",
}

/**
 * Sizing policy info for RPC communication.
 */
export interface SizingPolicyInfo {
    id: string;
    name: string;
}

/**
 * IPositronPlotSizingPolicy interface for UI components.
 */
export interface IPositronPlotSizingPolicy {
    id: string;
    getName(plot?: any): string;
    getPlotSize(viewportSize: { width: number; height: number }):
        | { width: number; height: number }
        | undefined;
}

/**
 * Editor target for opening plots in different locations.
 */
export type EditorTarget = 'newWindow' | 'activeGroup' | 'sideGroup';
