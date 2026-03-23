/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { IPlotSize, IPositronPlotSizingPolicy } from './sizingPolicy';
import type { PlotClientInstance, PlotMetadata as PlotClientMetadata } from './PlotClientInstance';
import { ZoomLevel } from './PlotClientInstance';
import type { PlotRenderSettings } from './comms/positronPlotComm';

/**
 * Plot render settings and formats (re-exported to avoid type duplication).
 * Matches Positron's PlotRenderSettings/PlotRenderFormat.
 */
export { PlotRenderFormat, type PlotRenderSettings } from './comms/positronPlotComm';

/**
 * The set of policies governing when we show the plot history (filmstrip
 * thumbnail list) in the Plots pane.
 *
 * Matches Positron's HistoryPolicy enum.
 */
export enum HistoryPolicy {
    /** The plot history is always shown */
    AlwaysVisible = 'always',

    /** The plot history is never shown */
    NeverVisible = 'never',

    /** The plot history is shown only when there is more than one plot (default) */
    Automatic = 'automatic'
}

/**
 * The position policy for the plot history filmstrip.
 */
export enum HistoryPosition {
    /** Choose bottom or right automatically based on aspect ratio */
    Auto = 'auto',

    /** Always show history at the bottom */
    Bottom = 'bottom',

    /** Always show history on the right */
    Right = 'right'
}

/**
 * Settings for the dark filter mode.
 * Matches Positron's DarkFilter enum.
 */
export enum DarkFilter {
    /** The dark filter is always on (i.e., plots always have their colors inverted in dark themes) */
    On = 'on',

    /** The dark filter is always off (i.e., plots are always shown in their given colors */
    Off = 'off',

    /** The dark filter follows the current theme (i.e., it's on in dark themes and off in light themes) */
    Auto = 'auto'
}

/**
 * The location where the plots pane is currently being displayed.
 * Matches Positron's PlotsDisplayLocation enum.
 */
export enum PlotsDisplayLocation {
    /** Plots are displayed in the main window (auxiliary bar view pane) */
    MainWindow = 'main',

    /** Plots are displayed in an auxiliary window */
    AuxiliaryWindow = 'auxiliary'
}

// PlotRenderSettings/PlotRenderFormat are re-exported above.

/**
 * Interface for a Positron plot client.
 * Matches Positron's IPositronPlotClient interface.
 */
export interface IPositronPlotClient {
    /** The unique ID of the plot */
    readonly id: string;

    /** The plot's metadata */
    readonly metadata: PlotClientMetadata;

    /** Event that fires when the metadata is updated */
    readonly onDidUpdateMetadata?: vscode.Event<PlotClientMetadata>;
}

/**
 * Interface for a zoomable plot client.
 * Matches Positron's IZoomablePlotClient interface.
 */
export interface IZoomablePlotClient {
    /** The current zoom level */
    zoomLevel: ZoomLevel;

    /** Event that fires when the zoom level changes */
    onDidChangeZoomLevel: vscode.Event<ZoomLevel>;
}

/**
 * Type guard for IZoomablePlotClient.
 * Matches Positron's isZoomablePlotClient function.
 */
export function isZoomablePlotClient(obj: any): obj is IZoomablePlotClient {
    return obj &&
        typeof obj.zoomLevel !== 'undefined' &&
        typeof obj.onDidChangeZoomLevel !== 'undefined';
}

/**
 * IPositronPlotsService interface.
 * Matches Positron's IPositronPlotsService interface.
 */
export interface IPositronPlotsService {
    /**
     * The list of all plot instances.
     */
    readonly positronPlotInstances: IPositronPlotClient[];

    /**
     * The currently selected plot ID.
     */
    readonly selectedPlotId: string | undefined;

    /**
     * The list of available sizing policies.
     */
    readonly sizingPolicies: IPositronPlotSizingPolicy[];

    /**
     * The currently selected sizing policy.
     */
    readonly selectedSizingPolicy: IPositronPlotSizingPolicy;

    /**
     * The current history policy.
     */
    readonly historyPolicy: HistoryPolicy;

    /**
     * The current dark filter mode.
     */
    readonly darkFilterMode: DarkFilter;

    /**
     * The current history position policy.
     */
    readonly historyPosition: HistoryPosition;

    /**
     * The current display location.
     */
    readonly displayLocation: PlotsDisplayLocation;

    /**
     * Event that fires when a plot is selected.
     */
    readonly onDidSelectPlot: vscode.Event<string>;

    /**
     * Event that fires when a plot is added.
     */
    readonly onDidEmitPlot: vscode.Event<IPositronPlotClient>;

    /**
     * Event that fires when a plot is removed.
     */
    readonly onDidRemovePlot: vscode.Event<IPositronPlotClient>;

    /**
     * Event that fires when the sizing policy changes.
     */
    readonly onDidChangeSizingPolicy: vscode.Event<IPositronPlotSizingPolicy>;

    /**
     * Event that fires when the history policy changes.
     */
    readonly onDidChangeHistoryPolicy: vscode.Event<HistoryPolicy>;

    /**
     * Event that fires when the history position changes.
     */
    readonly onDidChangeHistoryPosition: vscode.Event<HistoryPosition>;

    /**
     * Event that fires when all plots are replaced (e.g., after restore).
     */
    readonly onDidReplacePlots: vscode.Event<IPositronPlotClient[]>;

    /**
     * Notifies subscribers when the dark filter mode has changed.
     */
    readonly onDidChangeDarkFilterMode: vscode.Event<DarkFilter>;

    /**
     * Notifies subscribers when the settings for rendering a plot have changed.
     */
    readonly onDidChangePlotsRenderSettings: vscode.Event<PlotRenderSettings>;

    /**
     * Notifies subscribers when a plot's metadata has been updated.
     */
    readonly onDidUpdatePlotMetadata: vscode.Event<string>;

    /**
     * Notifies subscribers when the display location changes.
     */
    readonly onDidChangeDisplayLocation: vscode.Event<PlotsDisplayLocation>;

    /**
     * Gets the cached plot thumbnail URI for a given plot ID.
     * @param plotId The plot ID to get the thumbnail URI for.
     * @returns The thumbnail URI for the plot, or undefined if not found.
     */
    getCachedPlotThumbnailURI(plotId: string): string | undefined;

    /**
     * Selects the plot with the specified ID.
     *
     * @param id The ID of the plot to select.
     */
    selectPlot(id: string): void;

    /**
     * Selects the next plot in the list of plots.
     */
    selectNextPlot(): void;

    /**
     * Selects the previous plot in the list of plots.
     */
    selectPreviousPlot(): void;

    /**
     * Removes the plot with the specified ID.
     *
     * @param id The ID of the plot to remove.
     */
    removePlot(id: string): void;

    /**
     * Removes the selected plot.
     */
    removeSelectedPlot(): void;

    /**
     * Removes all the plots in the service.
     */
    removeAllPlots(): void;

    /**
     * Selects a sizing policy.
     */
    selectSizingPolicy(id: string): void;

    /**
     * Sets a custom plot size (and selects the custom sizing policy).
     */
    setCustomPlotSize(size: IPlotSize): void;

    /**
     * Clears the custom plot size.
     */
    clearCustomPlotSize(): void;

    /**
     * Removes the plot client and if no other clients are connected to the plot comm, disposes it.
     *
     * @param plotClient the plot client to unregister
     */
    unregisterPlotClient(plotClient: IPositronPlotClient): void;

    /**
     * Sets the sizing policy for a specific plot (editor).
     */
    setEditorSizingPolicy(plotId: string, policyId: string): void;

    /**
     * Selects a history policy.
     */
    selectHistoryPolicy(policy: HistoryPolicy): void;

    /**
     * Selects a history position policy.
     */
    selectHistoryPosition(position: HistoryPosition): void;

    /**
     * Copies the currently selected plot to the clipboard.
     */
    copyViewPlotToClipboard(): Promise<void>;

    /**
     * Saves the currently selected plot to a file.
     */
    saveViewPlot(): Promise<void>;

    /**
     * Saves the plot from the editor tab.
     *
     * @param plotId The id of the plot to save.
     */
    saveEditorPlot(plotId: string): Promise<void>;

    /**
     * Copies the plot from the editor tab to the clipboard.
     *
     * @param plotId The id of the plot to copy.
     */
    copyEditorPlotToClipboard(plotId: string): Promise<void>;

    /**
     * Sets a new dark filter mode.
     */
    setDarkFilterMode(mode: DarkFilter): void;

    /**
     * Gets the current plot rendering settings.
     */
    getPlotsRenderSettings(): PlotRenderSettings;

    /**
     * Sets the current plot rendering settings.
     *
     * @param settings The new settings.
     */
    setPlotsRenderSettings(settings: PlotRenderSettings): void;

    /**
     * Opens the given plot in an editor.
     *
     * @param plotId The id of the plot to open in an editor tab.
     * @param groupType Specify where the editor tab will be opened.
     * @param metadata The metadata for the plot. Uses the existing plot client if not provided.
     */
    openEditor(plotId: string, groupType?: number, metadata?: PlotClientMetadata): Promise<void>;

    /**
     * Gets the preferred editor group for opening the plot in an editor tab.
     */
    getPreferredEditorGroup(): number;

    /**
     * Gets the plot client that is connected to an editor for the specified id.
     *
     * @param id The id of the plot client to get.
     * @returns The plot client, or undefined if the plot client does not exist.
     */
    getEditorInstance(id: string): IPositronPlotClient | undefined;

    /**
     * Remove an editor plot.
     *
     * @param id The ID of the plot to remove.
     */
    removeEditorPlot(id: string): void;

    /**
     * Sets the display location of the plots pane.
     *
     * @param location The new display location.
     */
    setDisplayLocation(location: PlotsDisplayLocation): void;

    /**
     * Placeholder for service initialization.
     */
    initialize(): void;
}
