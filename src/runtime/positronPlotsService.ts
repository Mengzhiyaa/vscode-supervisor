/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import * as vscode from 'vscode';
import { CoreCommandIds } from '../coreCommandIds';
import type { IPlotSize, IPositronPlotSizingPolicy } from './sizingPolicy';
import { PlotSizingPolicyAuto } from './sizingPolicyAuto';
import { PlotSizingPolicyIntrinsic } from './sizingPolicyIntrinsic';
import { PlotSizingPolicyCustom } from './sizingPolicyCustom';
import { PlotSizingPolicyFill } from './sizingPolicyFill';
import { PlotSizingPolicySquare } from './sizingPolicySquare';
import { PlotSizingPolicyLandscape } from './sizingPolicyLandscape';
import { PlotSizingPolicyPortrait } from './sizingPolicyPortrait';
import { createPlotClient, PlotClientInstance, PlotMetadata as PlotClientMetadata, ZoomLevel } from './PlotClientInstance';
import { PositronPlotCommProxy } from './comms/positronPlotCommProxy';
import { PositronPlotRenderQueue, type IRuntimeSession } from './positronPlotRenderQueue';
import { StaticPlotClient } from './staticPlotClient';
import { HtmlPlotClient, IShowHtmlUriEvent } from './htmlPlotClient';
import { RuntimeClientInstance } from './RuntimeClientInstance';
import {
    RuntimeOutputKind,
    type LanguageRuntimeOutputWithKind,
    type LanguageRuntimeResultWithKind,
    type LanguageRuntimeUpdateOutputWithKind,
} from './runtimeOutputKind';
import { RuntimeSession } from './session';
import { RuntimeSessionService } from './runtimeSession';
import {
    type LanguageRuntimeInput,
    type LanguageRuntimeMessageCommOpen,
    RuntimeClientType,
} from '../internal/runtimeTypes';
import {
    parseDarkFilter,
    parseHistoryPolicy,
    parseHistoryPosition,
} from '../shared/plots';
import {
    type IPositronPlotsService,
    type IPositronPlotClient,
    type PlotRenderSettings,
    PlotRenderFormat,
    HistoryPolicy,
    HistoryPosition,
    DarkFilter,
    PlotsDisplayLocation,
} from './positronPlots';

/** The maximum number of recent executions to store. */
const MaxRecentExecutions = 10;

/** The maximum number of plots with an active webview. */
const MaxActiveWebviewPlots = 5;

/** The config key used to store the default sizing policy setting */
const DefaultSizingPolicyConfigKey = 'plots.defaultSizingPolicy';

/** The config key used to store the history policy setting */
const HistoryPolicyConfigKey = 'plots.historyPolicy';

/** The config key used to store the dark filter mode setting */
const DarkFilterModeConfigKey = 'plots.darkFilterMode';

const PlotMetadataStorageKeyPrefix = 'vscode-supervisor.plot.metadata.';
const CachedPlotThumbnailDescriptorsStorageKey = 'vscode-supervisor.plots.cachedPlotThumbnailDescriptors';
const SelectedSizingPolicyStorageKey = 'vscode-supervisor.plots.selectedSizingPolicy';
const CustomPlotSizeStorageKey = 'vscode-supervisor.plots.customPlotSize';
const SelectedHistoryPolicyStorageKey = 'vscode-supervisor.plots.selectedHistoryPolicy';
const SelectedHistoryPositionStorageKey = 'vscode-supervisor.plots.selectedHistoryPosition';
const PreferredEditorTargetStorageKey = 'vscode-supervisor.plots.preferredEditorTarget';
const PlotStorageLocationView = 'view';
const PlotStorageLocationEditor = 'editor';
const MaxPersistedPlotCodeChars = 2048;

type PreferredEditorTarget = 'activeGroup' | 'sideGroup' | 'newWindow';

/** Single Memento key for all plot metadata (batch write). */
const AllPlotMetadataStorageKey = 'vscode-supervisor.plots.allMetadata';

interface ICachedPlotThumbnailDescriptor {
    readonly plotClientId: string;
    readonly thumbnailURI: string;
}

/**
 * PositronPlotsService class.
 * Matches Positron's PositronPlotsService class.
 */
export class PositronPlotsService implements IPositronPlotsService, vscode.Disposable {
    /**
     * Cached plot thumbnail descriptors.
     */
    private readonly _cachedPlotThumbnailDescriptors = new Map<string, ICachedPlotThumbnailDescriptor>();

    /**
     * The list of all plot instances.
     */
    private readonly _plots: IPositronPlotClient[] = [];

    /**
     * The currently selected plot ID.
     */
    private _selectedPlotId: string | undefined;

    /**
     * The list of available sizing policies.
     */
    private readonly _sizingPolicies: IPositronPlotSizingPolicy[];

    /**
     * The currently selected sizing policy.
     */
    private _selectedSizingPolicy: IPositronPlotSizingPolicy;

    /**
     * Custom sizing policy (if set).
     */
    private _customSizingPolicy: PlotSizingPolicyCustom | undefined;

    /**
     * The current history policy.
     */
    private _historyPolicy: HistoryPolicy = HistoryPolicy.Automatic;

    /**
     * The current dark filter mode.
     */
    private _darkFilterMode: DarkFilter = DarkFilter.Auto;

    /**
     * The current history position policy.
     */
    private _historyPosition: HistoryPosition = HistoryPosition.Auto;

    /**
     * The current display location.
     */
    private _displayLocation: PlotsDisplayLocation = PlotsDisplayLocation.MainWindow;

    /**
     * Preferred target for opening plots in an editor.
     */
    private _preferredEditorTarget: PreferredEditorTarget = 'activeGroup';

    /**
     * The current render settings.
     */
    private _renderSettings: PlotRenderSettings = {
        size: { width: 800, height: 600 },
        pixel_ratio: 1,
        format: PlotRenderFormat.Png
    };

    /**
     * Map of editor plot instances keyed by ID.
     */
    private readonly _editorPlotClients = new Map<string, IPositronPlotClient>();

    /**
     * Map of plot client instances keyed by ID.
     */
    private readonly _plotClients = new Map<string, PlotClientInstance>();

    /**
     * Map of plot client instances keyed by comm ID.
     * Matches Positron's _plotClientsByComm.
     */
    private readonly _plotClientsByComm = new Map<string, PlotClientInstance[]>();

    /**
     * Map of plot comm proxies keyed by comm ID.
     */
    private readonly _plotCommProxies = new Map<string, PositronPlotCommProxy>();

    /**
     * Render queues keyed by session ID (per-session rendering).
     */
    private readonly _renderQueues = new Map<string, PositronPlotRenderQueue>();

    /**
     * Recently executed code (parent_id -> code) for plot attribution.
     */
    private readonly _recentExecutions = new Map<string, string>();
    private readonly _recentExecutionIds: string[] = [];

    /**
     * Track attached sessions and their disposables.
     */
    private readonly _attachedSessions = new Set<string>();
    private readonly _attachedClientManagers = new Set<string>();
    private readonly _sessionDisposables = new Map<string, vscode.Disposable[]>();

    /**
     * Session manager for multi-session plot routing.
     */
    private _sessionManager: RuntimeSessionService | undefined;

    /**
     * Disposables for cleanup.
     */
    private readonly _disposables: vscode.Disposable[] = [];

    // Event emitters
    private readonly _onDidSelectPlot = new vscode.EventEmitter<string>();
    private readonly _onDidEmitPlot = new vscode.EventEmitter<IPositronPlotClient>();
    private readonly _onDidRemovePlot = new vscode.EventEmitter<IPositronPlotClient>();
    private readonly _onDidChangeSizingPolicy = new vscode.EventEmitter<IPositronPlotSizingPolicy>();
    private readonly _onDidChangeHistoryPolicy = new vscode.EventEmitter<HistoryPolicy>();
    private readonly _onDidChangeHistoryPosition = new vscode.EventEmitter<HistoryPosition>();
    private readonly _onDidReplacePlots = new vscode.EventEmitter<IPositronPlotClient[]>();
    private readonly _onDidChangeDarkFilterMode = new vscode.EventEmitter<DarkFilter>();
    private readonly _onDidChangePlotsRenderSettings = new vscode.EventEmitter<PlotRenderSettings>();
    private readonly _onDidUpdatePlotMetadata = new vscode.EventEmitter<string>();
    private readonly _onDidChangeDisplayLocation = new vscode.EventEmitter<PlotsDisplayLocation>();

    // Events
    readonly onDidSelectPlot = this._onDidSelectPlot.event;
    readonly onDidEmitPlot = this._onDidEmitPlot.event;
    readonly onDidRemovePlot = this._onDidRemovePlot.event;
    readonly onDidChangeSizingPolicy = this._onDidChangeSizingPolicy.event;
    readonly onDidChangeHistoryPolicy = this._onDidChangeHistoryPolicy.event;
    readonly onDidChangeHistoryPosition = this._onDidChangeHistoryPosition.event;
    readonly onDidReplacePlots = this._onDidReplacePlots.event;
    readonly onDidChangeDarkFilterMode = this._onDidChangeDarkFilterMode.event;
    readonly onDidChangePlotsRenderSettings = this._onDidChangePlotsRenderSettings.event;
    readonly onDidUpdatePlotMetadata = this._onDidUpdatePlotMetadata.event;
    readonly onDidChangeDisplayLocation = this._onDidChangeDisplayLocation.event;

    /**
     * Optional output channel for logging.
     */
    private readonly _outputChannel?: vscode.LogOutputChannel;

    /**
     * Workspace storage for plot persistence.
     */
    private readonly _workspaceState?: vscode.Memento;

    /**
     * In-memory cache of all plot metadata keyed by storage key.
     * Loaded from a single Memento key at startup and flushed back as one batch.
     */
    private readonly _allPlotMetadata = new Map<string, PlotClientMetadata>();

    private _isRestoring = false;
    private _isShuttingDown = false;
    private _thumbnailPersistTimer?: ReturnType<typeof setTimeout>;
    private _thumbnailPersistenceDirty = false;
    private _plotMetadataDirty = false;

    constructor(outputChannel?: vscode.LogOutputChannel, context?: vscode.ExtensionContext) {
        this._outputChannel = outputChannel;
        this._workspaceState = context?.workspaceState;

        this._loadAllPlotMetadata();
        // Initialize sizing policies (matching Positron's core policies)
        this._sizingPolicies = [
            new PlotSizingPolicyAuto(),
            new PlotSizingPolicyLandscape(),
            new PlotSizingPolicyPortrait(),
            new PlotSizingPolicySquare(),
            new PlotSizingPolicyFill(),
            new PlotSizingPolicyIntrinsic(),
        ];

        // Default to auto sizing policy
        this._selectedSizingPolicy = this._sizingPolicies[0];

        // Load configuration
        this._loadConfiguration();

        // Restore persisted settings/cached thumbnails (if available)
        if (this._workspaceState) {
            this._restorePersistedSettings();
            this._restoreCachedPlotThumbnails();
        }

        // Register emitters for disposal
        this._disposables.push(this._onDidSelectPlot);
        this._disposables.push(this._onDidEmitPlot);
        this._disposables.push(this._onDidRemovePlot);
        this._disposables.push(this._onDidChangeSizingPolicy);
        this._disposables.push(this._onDidChangeHistoryPolicy);
        this._disposables.push(this._onDidChangeHistoryPosition);
        this._disposables.push(this._onDidReplacePlots);
        this._disposables.push(this._onDidChangeDarkFilterMode);
        this._disposables.push(this._onDidChangePlotsRenderSettings);
        this._disposables.push(this._onDidUpdatePlotMetadata);
        this._disposables.push(this._onDidChangeDisplayLocation);

        // Listen for configuration changes
        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration(DefaultSizingPolicyConfigKey) ||
                    e.affectsConfiguration(HistoryPolicyConfigKey) ||
                    e.affectsConfiguration(DarkFilterModeConfigKey)) {
                    this._loadConfiguration();
                }
            })
        );

        // Listen for plot selection and update selected plot ID
        this._disposables.push(
            this._onDidSelectPlot.event((id) => {
                this._selectedPlotId = id;
                const selectedPlot = this._plots.find(plot => plot.id === id);
                if (selectedPlot instanceof PlotClientInstance) {
                    this._selectedSizingPolicy = selectedPlot.sizingPolicy;
                    this._onDidChangeSizingPolicy.fire(selectedPlot.sizingPolicy);
                }

                this._storeSelectedSizingPolicy();
            })
        );
    }

    /**
     * Load configuration from settings.
     */
    private _loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration();

        // Load history policy
        const historyPolicySetting = config.get<string>(HistoryPolicyConfigKey, HistoryPolicy.Automatic);
        this._historyPolicy = parseHistoryPolicy(historyPolicySetting);

        // Load dark filter mode
        const darkFilterSetting = config.get<string>(DarkFilterModeConfigKey, 'auto');
        this._darkFilterMode = parseDarkFilter(darkFilterSetting);

        // Load default sizing policy
        const sizingPolicySetting = config.get<string>(DefaultSizingPolicyConfigKey, 'auto');
        const policy = this._sizingPolicies.find(p => p.id === sizingPolicySetting);
        if (policy) {
            this._selectedSizingPolicy = policy;
        }
    }

    private _restorePersistedSettings(): void {
        if (!this._workspaceState) {
            return;
        }

        this._isRestoring = true;
        try {
            const customSize = this._getWorkspaceState<IPlotSize>(CustomPlotSizeStorageKey);
            if (customSize) {
                this.setCustomPlotSize(customSize);
            } else {
                const selectedSizingPolicyId = this._getWorkspaceState<string>(SelectedSizingPolicyStorageKey);
                if (selectedSizingPolicyId) {
                    try {
                        this.selectSizingPolicy(selectedSizingPolicyId);
                    } catch {
                        // ignore invalid policy id
                    }
                }
            }

            const selectedHistoryPolicy = this._getWorkspaceState<string>(SelectedHistoryPolicyStorageKey);
            if (typeof selectedHistoryPolicy === 'string') {
                this._historyPolicy = parseHistoryPolicy(selectedHistoryPolicy);
            }

            const selectedHistoryPosition = this._getWorkspaceState<string>(SelectedHistoryPositionStorageKey);
            if (typeof selectedHistoryPosition === 'string') {
                this._historyPosition = parseHistoryPosition(selectedHistoryPosition);
            }

            const preferredEditorTarget = this._getWorkspaceState<PreferredEditorTarget>(PreferredEditorTargetStorageKey);
            switch (preferredEditorTarget) {
                case 'activeGroup':
                case 'sideGroup':
                case 'newWindow':
                    this._preferredEditorTarget = preferredEditorTarget;
                    break;
            }
        } finally {
            this._isRestoring = false;
        }
    }

    private _restoreCachedPlotThumbnails(): void {
        // Thumbnail payloads are intentionally not persisted.
        // Clear any stale entry and keep runtime cache in-memory only.
        this._cachedPlotThumbnailDescriptors.clear();
        if (this._workspaceState) {
            void this._workspaceState.update(CachedPlotThumbnailDescriptorsStorageKey, undefined);
        }
    }

    private _storeSelectedSizingPolicy(): void {
        if (!this._workspaceState || this._isRestoring) {
            return;
        }
        this._updateWorkspaceState(SelectedSizingPolicyStorageKey, this._selectedSizingPolicy.id);
    }

    private _storeCustomPlotSize(): void {
        if (!this._workspaceState || this._isRestoring) {
            return;
        }
        this._updateWorkspaceState(CustomPlotSizeStorageKey, this._customSizingPolicy?.size);
    }

    private _storeSelectedHistoryPolicy(): void {
        if (!this._workspaceState || this._isRestoring) {
            return;
        }
        this._updateWorkspaceState(SelectedHistoryPolicyStorageKey, this._historyPolicy);
    }

    private _storeSelectedHistoryPosition(): void {
        if (!this._workspaceState || this._isRestoring) {
            return;
        }
        this._updateWorkspaceState(SelectedHistoryPositionStorageKey, this._historyPosition);
    }

    private _storePreferredEditorTarget(): void {
        if (!this._workspaceState || this._isRestoring) {
            return;
        }
        this._updateWorkspaceState(PreferredEditorTargetStorageKey, this._preferredEditorTarget);
    }

    private _persistCachedPlotThumbnails(): void {
        if (this._isRestoring) {
            return;
        }

        // Keep thumbnails in memory only. Persisting data URIs is expensive
        // and unnecessary for reload recovery.
        this._thumbnailPersistenceDirty = true;
    }

    private _flushThumbnailPersistence(force = false): void {
        if (this._thumbnailPersistTimer) {
            clearTimeout(this._thumbnailPersistTimer);
            this._thumbnailPersistTimer = undefined;
        }
        if (!this._thumbnailPersistenceDirty && !force) {
            return;
        }

        if (this._workspaceState) {
            void this._workspaceState.update(CachedPlotThumbnailDescriptorsStorageKey, undefined);
        }

        this._thumbnailPersistenceDirty = false;
    }

    /**
     * Flush all plot metadata to a single Memento key.
     * Called once on dispose — no intermediate writes during runtime.
     */
    private _flushPlotMetadataPersistence(): void {
        if (!this._plotMetadataDirty || !this._workspaceState) {
            return;
        }

        const entries: Record<string, PlotClientMetadata> = {};
        for (const [key, metadata] of this._allPlotMetadata.entries()) {
            entries[key] = metadata;
        }

        this._updateWorkspaceState(
            AllPlotMetadataStorageKey,
            Object.keys(entries).length > 0 ? entries : undefined,
        );

        this._plotMetadataDirty = false;
    }

    /**
     * Load all plot metadata from the single Memento key at startup.
     */
    private _loadAllPlotMetadata(): void {
        if (!this._workspaceState) {
            return;
        }

        const stored = this._getWorkspaceState<Record<string, PlotClientMetadata>>(AllPlotMetadataStorageKey);
        if (stored) {
            for (const [key, metadata] of Object.entries(stored)) {
                if (metadata?.id && metadata?.session_id) {
                    const location = this._storageLocationFromKey(key);
                    const minimized = this._toPersistedPlotMetadata(metadata, location);
                    if (minimized) {
                        this._allPlotMetadata.set(
                            this._plotStorageKey(minimized.session_id, minimized.id, location),
                            minimized
                        );
                    }
                }
            }
        }
    }

    private _plotStorageKey(sessionId: string, plotId: string, location = PlotStorageLocationView): string {
        return `${PlotMetadataStorageKeyPrefix}${sessionId}.${plotId}.${location}`;
    }

    private _plotStoragePrefixForSession(sessionId: string): string {
        return `${PlotMetadataStorageKeyPrefix}${sessionId}.`;
    }

    private _getWorkspaceState<T>(key: string): T | undefined {
        if (!this._workspaceState) {
            return undefined;
        }

        return this._workspaceState.get<T>(key);
    }

    private _updateWorkspaceState(key: string, value: unknown): void {
        if (!this._workspaceState) {
            return;
        }

        void this._workspaceState.update(key, value);
    }

    private _storageLocationFromKey(key: string): string {
        if (key.endsWith(`.${PlotStorageLocationEditor}`)) {
            return PlotStorageLocationEditor;
        }
        return PlotStorageLocationView;
    }


    private _toPersistedPlotMetadata(
        metadata: PlotClientMetadata,
        location: string
    ): PlotClientMetadata | undefined {
        if (!metadata?.id || !metadata?.session_id) {
            return undefined;
        }

        if (metadata.kind === 'html') {
            if (!metadata.html_uri || metadata.html_uri.startsWith('data:')) {
                return undefined;
            }
        }

        // Keep the persisted payload intentionally small: do not persist image
        // bytes (pre_render.data / thumbnails) and cap code length.
        const trimmedCode = typeof metadata.code === 'string'
            ? metadata.code.slice(0, MaxPersistedPlotCodeChars)
            : undefined;

        const storedMetadata: PlotClientMetadata = {
            id: metadata.id,
            created: metadata.created,
            kind: metadata.kind,
            name: metadata.name,
            execution_id: metadata.execution_id,
            code: trimmedCode,
            session_id: metadata.session_id,
            output_id: metadata.output_id,
            location,
            suggested_file_name: metadata.suggested_file_name,
            html_uri: metadata.html_uri,
            language: metadata.language,
            sizing_policy: metadata.sizing_policy
        };

        if (typeof metadata.zoom_level !== 'undefined') {
            storedMetadata.zoom_level = metadata.zoom_level;
        }

        return storedMetadata;
    }

    private _getStoredPlotMetadata(
        sessionId: string,
        plotId: string,
        location = PlotStorageLocationView
    ): PlotClientMetadata | undefined {
        const key = this._plotStorageKey(sessionId, plotId, location);
        return this._allPlotMetadata.get(key);
    }

    private _listStoredPlotMetadataEntries(): Array<[string, PlotClientMetadata]> {
        return Array.from(this._allPlotMetadata.entries());
    }



    private _storePlotMetadata(metadata: PlotClientMetadata, location = PlotStorageLocationView): void {
        if (!this._workspaceState || this._isRestoring || this._isShuttingDown) {
            return;
        }

        const storedMetadata = this._toPersistedPlotMetadata(metadata, location);
        if (!storedMetadata) {
            return;
        }

        this._allPlotMetadata.set(
            this._plotStorageKey(metadata.session_id, metadata.id, location),
            storedMetadata
        );
        this._plotMetadataDirty = true;
    }

    private _removeStoredPlotMetadata(metadata: PlotClientMetadata, location = PlotStorageLocationView): void {
        if (!this._workspaceState || this._isShuttingDown) {
            return;
        }

        this._allPlotMetadata.delete(
            this._plotStorageKey(metadata.session_id, metadata.id, location)
        );
        this._plotMetadataDirty = true;

        if (location === PlotStorageLocationView) {
            this._cachedPlotThumbnailDescriptors.delete(metadata.id);
            this._persistCachedPlotThumbnails();
        }
    }

    // Getters
    get positronPlotInstances(): IPositronPlotClient[] {
        return [...this._plots];
    }

    get selectedPlotId(): string | undefined {
        return this._selectedPlotId;
    }

    get sizingPolicies(): IPositronPlotSizingPolicy[] {
        return [...this._sizingPolicies];
    }

    get selectedSizingPolicy(): IPositronPlotSizingPolicy {
        return this._selectedSizingPolicy;
    }

    get historyPolicy(): HistoryPolicy {
        return this._historyPolicy;
    }

    get historyPosition(): HistoryPosition {
        return this._historyPosition;
    }

    get darkFilterMode(): DarkFilter {
        return this._darkFilterMode;
    }

    get displayLocation(): PlotsDisplayLocation {
        return this._displayLocation;
    }

    /**
     * Gets the cached plot thumbnail URI for a given plot ID.
     */
    getCachedPlotThumbnailURI(plotId: string): string | undefined {
        return this._cachedPlotThumbnailDescriptors.get(plotId)?.thumbnailURI;
    }

    /**
     * Caches a plot thumbnail URI.
     */
    cachePlotThumbnailURI(plotId: string, thumbnailURI: string): void {
        this._cachedPlotThumbnailDescriptors.set(plotId, {
            plotClientId: plotId,
            thumbnailURI
        });
        this._persistCachedPlotThumbnails();
    }

    /**
     * Selects the plot with the specified ID.
     */
    selectPlot(id: string): void {
        const plot = this._plots.find(p => p.id === id);
        if (plot) {
            this._onDidSelectPlot.fire(id);
        }
    }

    /**
     * Selects the next plot in the list of plots.
     */
    selectNextPlot(): void {
        if (this._plots.length === 0) {
            return;
        }

        if (!this._selectedPlotId) {
            // Select the first plot if none is selected
            this._onDidSelectPlot.fire(this._plots[0].id);
            return;
        }

        const currentIndex = this._plots.findIndex(p => p.id === this._selectedPlotId);
        if (currentIndex === -1) {
            // Current plot not found, select first
            this._onDidSelectPlot.fire(this._plots[0].id);
        } else if (currentIndex < this._plots.length - 1) {
            // Select next plot
            this._onDidSelectPlot.fire(this._plots[currentIndex + 1].id);
        }
        // If already at the last plot, do nothing
    }

    /**
     * Selects the previous plot in the list of plots.
     */
    selectPreviousPlot(): void {
        if (this._plots.length === 0) {
            return;
        }

        if (!this._selectedPlotId) {
            // Select the last plot if none is selected
            this._onDidSelectPlot.fire(this._plots[this._plots.length - 1].id);
            return;
        }

        const currentIndex = this._plots.findIndex(p => p.id === this._selectedPlotId);
        if (currentIndex === -1) {
            // Current plot not found, select last
            this._onDidSelectPlot.fire(this._plots[this._plots.length - 1].id);
        } else if (currentIndex > 0) {
            // Select previous plot
            this._onDidSelectPlot.fire(this._plots[currentIndex - 1].id);
        }
        // If already at the first plot, do nothing
    }

    /**
     * Removes the plot with the specified ID.
     */
    removePlot(id: string): void {
        const index = this._plots.findIndex(p => p.id === id);
        if (index === -1) {
            return;
        }

        const [removedPlot] = this._plots.splice(index, 1);

        // Clean up the underlying client/comm
        this.unregisterPlotClient(removedPlot);

        // Remove cached thumbnail
        this._cachedPlotThumbnailDescriptors.delete(id);
        this._persistCachedPlotThumbnails();

        // Fire the event
        this._onDidRemovePlot.fire(removedPlot);

        // If the removed plot was selected, select another
        if (this._selectedPlotId === id) {
            if (this._plots.length > 0) {
                // Select the plot at the same index, or the last plot if we removed the last one
                const newIndex = Math.min(index, this._plots.length - 1);
                this._onDidSelectPlot.fire(this._plots[newIndex].id);
            } else {
                this._selectedPlotId = undefined;
            }
        }
    }

    /**
     * Removes the selected plot.
     */
    removeSelectedPlot(): void {
        if (this._selectedPlotId) {
            this.removePlot(this._selectedPlotId);
        }
    }

    /**
     * Removes all the plots in the service.
     */
    removeAllPlots(): void {
        // Dispose each plot client
        const count = this._plots.length;
        for (let i = count - 1; i >= 0; i--) {
            const plot = this._plots[i];
            this.unregisterPlotClient(plot);
        }

        this._plots.length = 0;
        this._selectedPlotId = undefined;
        this._cachedPlotThumbnailDescriptors.clear();
        this._persistCachedPlotThumbnails();

        // Notify UI with a replace event (Positron pattern)
        this._onDidSelectPlot.fire('');
        this._onDidReplacePlots.fire(this._plots);
    }

    /**
     * Selects a sizing policy.
     */
    selectSizingPolicy(id: string): void {
        if (this.selectedSizingPolicy.id === id) {
            return;
        }

        const policy = this._sizingPolicies.find(p => p.id === id);
        if (!policy) {
            throw new Error(`Invalid sizing policy ID: ${id}`);
        }

        this._selectedSizingPolicy = policy;
        this._onDidChangeSizingPolicy.fire(policy);

        const selectedPlot = this._plots.find((plot) => this._selectedPlotId === plot.id);
        if (selectedPlot instanceof PlotClientInstance) {
            selectedPlot.sizingPolicy = policy;
        }

        this._storeSelectedSizingPolicy();
    }

    /**
     * Sets a custom plot size (and selects the custom sizing policy).
     */
    setCustomPlotSize(size: IPlotSize): void {
        if (this._customSizingPolicy) {
            const index = this._sizingPolicies.indexOf(this._customSizingPolicy);
            if (index >= 0) {
                this._sizingPolicies.splice(index, 1);
            }
        }

        const policy = new PlotSizingPolicyCustom(size);
        this._sizingPolicies.push(policy);
        this._selectedSizingPolicy = policy;
        this._customSizingPolicy = policy;
        this._onDidChangeSizingPolicy.fire(policy);

        const selectedPlot = this._plots.find((plot) => this._selectedPlotId === plot.id);
        if (selectedPlot instanceof PlotClientInstance) {
            selectedPlot.sizingPolicy = policy;
        }

        this._storeCustomPlotSize();
        this._storeSelectedSizingPolicy();
    }

    /**
     * Clears the custom plot size.
     */
    clearCustomPlotSize(): void {
        if (this._customSizingPolicy) {
            const currentPolicy = this._customSizingPolicy === this._selectedSizingPolicy;

            const index = this._sizingPolicies.indexOf(this._customSizingPolicy);
            if (index >= 0) {
                this._sizingPolicies.splice(index, 1);
            }
            // Switch back to auto if currently using custom
            if (currentPolicy) {
                this._selectedSizingPolicy = new PlotSizingPolicyAuto();
                this._onDidChangeSizingPolicy.fire(this._selectedSizingPolicy);

                const selectedPlot = this._plots.find((plot) => this._selectedPlotId === plot.id);
                if (selectedPlot instanceof PlotClientInstance) {
                    selectedPlot.sizingPolicy = this._selectedSizingPolicy;
                }
            }
            this._customSizingPolicy = undefined;
        }

        this._storeCustomPlotSize();
        this._storeSelectedSizingPolicy();
    }

    /**
     * Selects a history policy.
     */
    selectHistoryPolicy(policy: HistoryPolicy): void {
        if (policy !== this._historyPolicy) {
            this._historyPolicy = policy;
            this._onDidChangeHistoryPolicy.fire(policy);
            this._storeSelectedHistoryPolicy();
        }
    }

    /**
     * Selects a history position policy.
     */
    selectHistoryPosition(position: HistoryPosition): void {
        if (position !== this._historyPosition) {
            this._historyPosition = position;
            this._onDidChangeHistoryPosition.fire(position);
            this._storeSelectedHistoryPosition();
        }
    }

    /**
     * Copies the currently selected plot to the clipboard.
     */
    async copyViewPlotToClipboard(): Promise<void> {
        if (!this._selectedPlotId) {
            vscode.window.showWarningMessage('No plot selected to copy.');
            return;
        }

        const client = this._plotClients.get(this._selectedPlotId);
        if (!client) {
            vscode.window.showWarningMessage('Plot client not found.');
            return;
        }

        const lastRender = client.lastRender;
        if (!lastRender?.uri) {
            vscode.window.showWarningMessage('No rendered plot available to copy.');
            return;
        }

        try {
            // Extract base64 data from data URI
            const base64Match = lastRender.uri.match(/^data:image\/\w+;base64,(.+)$/);
            if (!base64Match) {
                throw new Error('Invalid image data URI');
            }

            // Use VS Code's clipboard API (note: binary clipboard support varies by platform)
            await vscode.env.clipboard.writeText(lastRender.uri);
            vscode.window.showInformationMessage('Plot copied to clipboard as data URL.');
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to copy plot: ${e}`);
        }
    }

    /**
     * Saves the currently selected plot to a file.
     */
    async saveViewPlot(): Promise<void> {
        if (!this._selectedPlotId) {
            vscode.window.showWarningMessage('No plot selected to save.');
            return;
        }

        const client = this._plotClients.get(this._selectedPlotId);
        if (!client) {
            vscode.window.showWarningMessage('Plot client not found.');
            return;
        }

        const lastRender = client.lastRender;
        if (!lastRender?.uri) {
            vscode.window.showWarningMessage('No rendered plot available to save.');
            return;
        }

        try {
            // Show save dialog
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(`plot_${this._selectedPlotId}.png`),
                filters: {
                    'PNG Images': ['png'],
                    'JPEG Images': ['jpg', 'jpeg'],
                    'All Files': ['*']
                }
            });

            if (!uri) {
                return; // User cancelled
            }

            // Extract base64 data from data URI
            const base64Match = lastRender.uri.match(/^data:image\/\w+;base64,(.+)$/);
            if (!base64Match) {
                throw new Error('Invalid image data URI');
            }

            const base64Data = base64Match[1];
            const buffer = Buffer.from(base64Data, 'base64');

            // Write to file
            await vscode.workspace.fs.writeFile(uri, buffer);
            vscode.window.showInformationMessage(`Plot saved to ${uri.fsPath}`);
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to save plot: ${e}`);
        }
    }

    /**
     * Sets the display location of the plots pane.
     */
    setDisplayLocation(location: PlotsDisplayLocation): void {
        if (this._displayLocation !== location) {
            this._displayLocation = location;
            this._onDidChangeDisplayLocation.fire(location);
        }
    }

    /**
     * Sets a new dark filter mode.
     */
    setDarkFilterMode(mode: DarkFilter): void {
        if (this._darkFilterMode !== mode) {
            this._darkFilterMode = mode;
            this._onDidChangeDarkFilterMode.fire(mode);
        }
    }

    /**
     * Gets the current plot rendering settings.
     */
    getPlotsRenderSettings(): PlotRenderSettings {
        return { ...this._renderSettings };
    }

    /**
     * Sets the current plot rendering settings.
     */
    setPlotsRenderSettings(settings: PlotRenderSettings): void {
        // Skip if settings haven't actually changed.  Without this guard,
        // every plot-selection triggers didChangePlotsRenderSettings on the
        // R kernel, which re-renders ALL existing plot comms and sends the
        // full base64 pre_render data back through the comm channel — a huge
        // amount of SSH traffic in Remote-SSH environments.
        if (this._renderSettings &&
            this._renderSettings.size.width === settings.size.width &&
            this._renderSettings.size.height === settings.size.height &&
            this._renderSettings.pixel_ratio === settings.pixel_ratio &&
            this._renderSettings.format === settings.format) {
            return;
        }

        this._renderSettings = { ...settings };
        this._onDidChangePlotsRenderSettings.fire(this._renderSettings);

        // Broadcast settings to all sessions via UI comm
        if (this._sessionManager) {
            for (const session of this._sessionManager.sessions) {
                void session.updatePlotsRenderSettings(this._renderSettings);
            }
        }
    }

    /**
     * Removes the plot client and if no other clients are connected to the plot comm, disposes it.
     */
    unregisterPlotClient(plotClient: IPositronPlotClient): void {
        if (plotClient instanceof PlotClientInstance) {
            const plotId = plotClient.id;
            const plotClients = this._plotClientsByComm.get(plotId);
            if (plotClients) {
                const indexToRemove = plotClients.indexOf(plotClient);
                if (indexToRemove >= 0) {
                    plotClients.splice(indexToRemove, 1);
                }

                if (plotClients.length === 0) {
                    const commProxy = this._plotCommProxies.get(plotId);
                    commProxy?.dispose();
                    this._plotCommProxies.delete(plotId);
                    this._plotClientsByComm.delete(plotId);
                }
            }

            plotClient.dispose();
            this._plotClients.delete(plotId);

            if (!this._isShuttingDown) {
                this._removeStoredPlotMetadata(plotClient.metadata, PlotStorageLocationView);
            }
        }

        if (this._editorPlotClients.has(plotClient.id)) {
            this._editorPlotClients.delete(plotClient.id);
            if (!this._isShuttingDown) {
                this._removeStoredPlotMetadata(plotClient.metadata, PlotStorageLocationEditor);
            }
        }

        if (plotClient instanceof StaticPlotClient || plotClient instanceof HtmlPlotClient) {
            if (!this._isShuttingDown) {
                this._removeStoredPlotMetadata(plotClient.metadata, PlotStorageLocationView);
            }
            if (typeof (plotClient as vscode.Disposable).dispose === 'function') {
                (plotClient as vscode.Disposable).dispose();
            }
        }
    }

    /**
     * Sets the sizing policy for a specific plot (editor).
     */
    setEditorSizingPolicy(plotId: string, policyId: string): void {
        const plot = this._editorPlotClients.get(plotId);
        if (!(plot instanceof PlotClientInstance)) {
            return;
        }

        const policy = this._sizingPolicies.find(p => p.id === policyId);
        if (!policy) {
            vscode.window.showWarningMessage(`Invalid sizing policy: ${policyId}`);
            return;
        }

        plot.sizingPolicy = policy;
    }
    /**
     * Saves the plot from the editor tab.
     */
    async saveEditorPlot(plotId: string): Promise<void> {
        const editorClient = this._editorPlotClients.get(plotId);
        const dynamicClient = editorClient instanceof PlotClientInstance
            ? editorClient
            : this._plotClients.get(plotId);

        let imageUri: string | undefined;
        if (dynamicClient instanceof PlotClientInstance) {
            imageUri = dynamicClient.lastRender?.uri;
        } else if (editorClient instanceof StaticPlotClient) {
            imageUri = editorClient.uri;
        }

        if (!imageUri) {
            vscode.window.showWarningMessage('No rendered plot available to save.');
            return;
        }

        try {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(`plot_${plotId}.png`),
                filters: {
                    'PNG Images': ['png'],
                    'JPEG Images': ['jpg', 'jpeg'],
                    'All Files': ['*']
                }
            });

            if (!uri) {
                return;
            }

            const base64Match = imageUri.match(/^data:image\/\w+;base64,(.+)$/);
            if (!base64Match) {
                throw new Error('Invalid image data URI');
            }

            const base64Data = base64Match[1];
            const buffer = Buffer.from(base64Data, 'base64');
            await vscode.workspace.fs.writeFile(uri, buffer);
            vscode.window.showInformationMessage(`Plot saved to ${uri.fsPath}`);
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to save plot: ${e}`);
        }
    }
    /**
     * Copies the plot from the editor tab to the clipboard.
     */
    async copyEditorPlotToClipboard(plotId: string): Promise<void> {
        const editorClient = this._editorPlotClients.get(plotId);
        const dynamicClient = editorClient instanceof PlotClientInstance
            ? editorClient
            : this._plotClients.get(plotId);

        let imageUri: string | undefined;
        if (dynamicClient instanceof PlotClientInstance) {
            imageUri = dynamicClient.lastRender?.uri;
        } else if (editorClient instanceof StaticPlotClient) {
            imageUri = editorClient.uri;
        }

        if (!imageUri) {
            vscode.window.showWarningMessage('No rendered plot available to copy.');
            return;
        }

        try {
            await vscode.env.clipboard.writeText(imageUri);
            vscode.window.showInformationMessage('Plot data URI copied to clipboard.');
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to copy plot: ${e}`);
        }
    }
    /**
     * Opens the given plot in an editor.
     */
    async openEditor(plotId: string, groupType?: number, metadata?: PlotClientMetadata, moveToNewWindow?: boolean): Promise<void> {
        const viewPlot = this._plots.find(plot => plot.id === plotId);
        if (!viewPlot) {
            vscode.window.showWarningMessage('Plot not found.');
            return;
        }

        let editorPlot = this._editorPlotClients.get(plotId);
        if (!editorPlot) {
            if (viewPlot instanceof PlotClientInstance) {
                const commProxy = this._plotCommProxies.get(plotId);
                if (!commProxy) {
                    vscode.window.showWarningMessage('Plot communication channel not found.');
                    return;
                }

                const editorMetadata: PlotClientMetadata = {
                    ...viewPlot.metadata,
                    ...metadata,
                    id: plotId,
                    session_id: viewPlot.metadata.session_id,
                };

                const plotCopy = this.createRuntimePlotClient(commProxy, editorMetadata, viewPlot);
                plotCopy.sizingPolicy = viewPlot.sizingPolicy;
                this._editorPlotClients.set(plotId, plotCopy);
                this._storePlotMetadata(plotCopy.metadata, PlotStorageLocationEditor);
                this._disposables.push(
                    plotCopy.onDidClose(() => {
                        this._removeStoredPlotMetadata(plotCopy.metadata, PlotStorageLocationEditor);
                        this._editorPlotClients.delete(plotId);
                    }),
                    plotCopy.onDidUpdateMetadata((updatedMetadata) => {
                        this._storePlotMetadata(updatedMetadata, PlotStorageLocationEditor);
                    }),
                    plotCopy.onDidChangeZoomLevel(() => {
                        this._storePlotMetadata(plotCopy.metadata, PlotStorageLocationEditor);
                    })
                );
                editorPlot = plotCopy;
            } else if (viewPlot instanceof StaticPlotClient) {
                const plotCopy = StaticPlotClient.fromMetadata(
                    { ...viewPlot.metadata },
                    viewPlot.mimeType,
                    viewPlot.data
                );
                this._editorPlotClients.set(plotId, plotCopy);
                this._storePlotMetadata(plotCopy.metadata, PlotStorageLocationEditor);
                editorPlot = plotCopy;
            } else {
                vscode.window.showWarningMessage('Opening this plot type in editor is not supported yet.');
                return;
            }
        }

        let plotData: string | undefined;
        if (editorPlot instanceof PlotClientInstance) {
            let rendered = editorPlot.lastRender;
            if (!rendered) {
                try {
                    rendered = await editorPlot.renderWithSizingPolicy(
                        this._renderSettings.size,
                        this._renderSettings.pixel_ratio,
                        this._renderSettings.format
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to render plot for editor: ${error}`);
                    return;
                }
            }
            plotData = rendered?.uri;
        } else if (editorPlot instanceof StaticPlotClient) {
            plotData = editorPlot.uri;
        }

        if (!plotData) {
            vscode.window.showWarningMessage('No rendered plot available to open in editor.');
            return;
        }

        const selectedTarget: PreferredEditorTarget = moveToNewWindow
            ? 'newWindow'
            : groupType === vscode.ViewColumn.Beside
                ? 'sideGroup'
                : typeof groupType === 'number'
                    ? 'activeGroup'
                    : this._preferredEditorTarget;
        const viewColumn = selectedTarget === 'sideGroup'
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.Active;

        await vscode.commands.executeCommand(
            CoreCommandIds.openPlotInEditor,
            plotId,
            plotData,
            viewColumn,
            selectedTarget === 'newWindow',
        );

        this.setPreferredEditorTarget(selectedTarget);
    }

    setPreferredEditorTarget(target: PreferredEditorTarget): void {
        if (this._preferredEditorTarget === target) {
            return;
        }

        this._preferredEditorTarget = target;
        this._storePreferredEditorTarget();
    }

    getPreferredEditorTarget(): PreferredEditorTarget {
        return this._preferredEditorTarget;
    }

    /**
     * Gets the preferred editor group for opening the plot in an editor tab.
     */
    getPreferredEditorGroup(): number {
        return this._preferredEditorTarget === 'sideGroup'
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.Active;
    }

    /**
     * Gets the plot client that is connected to an editor for the specified id.
     */
    getEditorInstance(id: string): IPositronPlotClient | undefined {
        return this._editorPlotClients.get(id);
    }

    /**
     * Remove an editor plot.
     */
    removeEditorPlot(id: string): void {
        const editorClient = this._editorPlotClients.get(id);
        if (editorClient) {
            this._editorPlotClients.delete(id);
            this._removeStoredPlotMetadata(editorClient.metadata, PlotStorageLocationEditor);
            this._onDidRemovePlot.fire(editorClient);
        }
    }

    // =====================================================================
    // Session Attachment (Positron-style multi-session plot management)
    // =====================================================================

    private _attachSession(session: RuntimeSession): void {
        const sessionId = session.sessionId;
        if (this._attachedSessions.has(sessionId)) {
            return;
        }

        this._attachedSessions.add(sessionId);
        const disposables: vscode.Disposable[] = [];
        this._sessionDisposables.set(sessionId, disposables);

        // Direct typed message subscriptions (1:1 Positron pattern)
        disposables.push(
            session.onDidReceiveRuntimeMessageInput((msg) => {
                const code = msg.code;
                if (!code) {
                    return;
                }
                this._recentExecutionIds.push(msg.parent_id);
                if (this._recentExecutionIds.length > MaxRecentExecutions) {
                    const id = this._recentExecutionIds.shift();
                    if (id) {
                        this._recentExecutions.delete(id);
                    }
                }
                this._recentExecutions.set(msg.parent_id, code);
            })
        );
        disposables.push(
            session.onDidReceiveRuntimeMessageOutput((msg) => {
                this._handleStaticPlotOutput(session, msg);
            })
        );
        disposables.push(
            session.onDidReceiveRuntimeMessageResult((msg) => {
                this._handleStaticPlotOutput(session, msg);
            })
        );
        disposables.push(
            session.onDidReceiveRuntimeMessageUpdateOutput((msg) => {
                this._handleUpdateOutput(session, msg);
            })
        );

        // Plot comm/client manager attachment

        // Attach plot comms when client manager becomes available
        const tryAttachClientManager = () => {
            if (this._attachedClientManagers.has(sessionId)) {
                return;
            }

            const manager = session.clientManager;
            if (!manager) {
                return;
            }

            this._attachedClientManagers.add(sessionId);

            // Subscribe with existing+future semantics.
            disposables.push(
                manager.watchClient(RuntimeClientType.Plot, (client, message) => {
                    this._handlePlotClient(session, client, message);
                })
            );
        };

        tryAttachClientManager();

        // If client manager isn't ready yet, retry on state change
        if (!this._attachedClientManagers.has(sessionId)) {
            disposables.push(
                session.onDidChangeRuntimeState(() => {
                    tryAttachClientManager();
                })
            );
        }
    }

    private _detachSession(sessionId: string): void {
        const disposables = this._sessionDisposables.get(sessionId);
        if (disposables) {
            disposables.forEach(d => d.dispose());
            this._sessionDisposables.delete(sessionId);
        }

        this._attachedSessions.delete(sessionId);
        this._attachedClientManagers.delete(sessionId);

        const renderQueue = this._renderQueues.get(sessionId);
        if (renderQueue) {
            renderQueue.dispose();
            this._renderQueues.delete(sessionId);
        }

        const prefix = this._plotStoragePrefixForSession(sessionId);
        const stalePlotIds = new Set<string>();
        for (const [key, metadata] of this._listStoredPlotMetadataEntries()) {
            if (key.startsWith(prefix)) {
                stalePlotIds.add(metadata.id);
                this._allPlotMetadata.delete(key);
            }
        }
        if (stalePlotIds.size > 0) {
            this._plotMetadataDirty = true;
        }

        for (const plotId of stalePlotIds) {
            this._cachedPlotThumbnailDescriptors.delete(plotId);
        }
        if (stalePlotIds.size > 0) {
            this._persistCachedPlotThumbnails();
        }
    }



    private _handleStaticPlotOutput(session: RuntimeSession, message: LanguageRuntimeOutputWithKind | LanguageRuntimeResultWithKind): void {
        if (this.hasPlot(session.sessionId, message.id)) {
            return;
        }

        const plot = this._createPlotFromOutput(message, session);
        if (!plot) {
            return;
        }

        if (message.output_id) {
            const existingPlot = this.getPlotForOutput(session.sessionId, message.output_id);
            if (existingPlot) {
                this.replacePlot(existingPlot.id, plot);
                return;
            }
        }

        this.registerNewPlotClient(plot);
    }

    private _handleUpdateOutput(session: RuntimeSession, message: LanguageRuntimeUpdateOutputWithKind): void {
        const plot = this._createPlotFromOutput(message, session);
        if (!plot) {
            return;
        }

        const existingPlot = this.getPlotForOutput(session.sessionId, message.output_id);
        if (existingPlot) {
            this.replacePlot(existingPlot.id, plot);
        }
    }

    private _createPlotFromOutput(
        message: LanguageRuntimeOutputWithKind | LanguageRuntimeResultWithKind | LanguageRuntimeUpdateOutputWithKind,
        session: RuntimeSession
    ): IPositronPlotClient | undefined {
        const code = this._recentExecutions.get(message.parent_id) ?? '';

        if (message.kind === RuntimeOutputKind.StaticImage) {
            const data = message.data;
            if (!data) {
                return undefined;
            }

            const imageEntry = Object.entries(data).find(([mimeType]) => mimeType.startsWith('image/'));
            if (!imageEntry) {
                return undefined;
            }

            const [mimeType, content] = imageEntry;
            const payload = typeof content === 'string' ? content : String(content ?? '');
            return StaticPlotClient.fromMessage(
                session.sessionId,
                message.id,
                mimeType,
                payload,
                code,
                message.output_id
            );
        }

        if (message.kind === RuntimeOutputKind.PlotWidget) {
            // Positron creates notebook-webview plot clients for this kind.
            // vscode-ark currently handles dynamic plots through plot comm clients.
            return undefined;
        }

        return undefined;
    }

    private _handlePlotClient(
        session: RuntimeSession,
        client: RuntimeClientInstance,
        message: LanguageRuntimeMessageCommOpen
    ): void {
        const clientId = client.message.comm_id;
        const existingPlot = this._plots.find(
            plot => plot.metadata.session_id === session.sessionId && plot.metadata.id === clientId
        );
        if (existingPlot && existingPlot instanceof PlotClientInstance) {
            return;
        }

        const code = this._recentExecutions.get(message.parent_id) ?? '';
        const data = message.data as { pre_render?: any } | undefined;

        const storedMetadata = this._getStoredPlotMetadata(
            session.sessionId,
            clientId,
            PlotStorageLocationView
        );

        const metadata: PlotClientMetadata = storedMetadata ? {
            ...storedMetadata,
            id: clientId,
            session_id: session.sessionId,
            language: session.runtimeMetadata.languageId,
            pre_render: data?.pre_render ?? storedMetadata.pre_render,
            execution_id: (message.data as any)?.execution_id ?? storedMetadata.execution_id,
            code: code || storedMetadata.code || ''
        } : {
            id: clientId,
            created: Date.parse(message.when),
            session_id: session.sessionId,
            code,
            pre_render: data?.pre_render,
            zoom_level: ZoomLevel.Fit,
            language: session.runtimeMetadata.languageId,
            execution_id: (message.data as any)?.execution_id
        };

        const commProxy = this.createCommProxy(client, metadata);
        const plotClient = this.createRuntimePlotClient(commProxy, metadata, client);
        if (storedMetadata?.sizing_policy?.id) {
            const preferredPolicy = this._sizingPolicies.find(policy => policy.id === storedMetadata.sizing_policy?.id);
            if (preferredPolicy) {
                this._selectedSizingPolicy = preferredPolicy;
                this._storeSelectedSizingPolicy();
            }
        }
        if (metadata.zoom_level !== undefined) {
            plotClient.zoomLevel = metadata.zoom_level;
        }

        // Fetch additional metadata from backend
        this.fetchAndUpdateMetadata(commProxy, metadata, plotClient);

        if (existingPlot) {
            this.replacePlot(existingPlot.id, plotClient);
        } else {
            this.registerPlotClient(plotClient, true);
        }
    }


    /**
     * Initializes the plots service and attaches to runtime sessions.
     */
    initialize(sessionManager?: RuntimeSessionService): void {
        if (sessionManager) {
            this._sessionManager = sessionManager;

            this._restorePlotMetadataForSessions(sessionManager.sessions);

            // Attach to existing sessions
            for (const session of sessionManager.sessions) {
                this._attachSession(session);
            }

            // Attach to new sessions as they start
            this._disposables.push(
                sessionManager.onWillStartSession(({ session }) => {
                    this._restorePlotMetadataForSessions([session]);
                    this._attachSession(session);
                })
            );

            // Clean up per-session resources when sessions are deleted
            this._disposables.push(
                sessionManager.onDidDeleteRuntimeSession((sessionId) => {
                    this._detachSession(sessionId);
                })
            );

        }
    }

    private _restorePlotMetadataForSessions(sessions: readonly RuntimeSession[]): void {
        if (sessions.length === 0) {
            return;
        }

        const validSessionIds = new Set(sessions.map(session => session.sessionId));
        const restoredHtml = new Set<string>();

        for (const [, metadata] of this._listStoredPlotMetadataEntries()) {
            if (!validSessionIds.has(metadata.session_id)) {
                continue;
            }

            if (metadata.location === PlotStorageLocationEditor) {
                continue;
            }

            if (this._plots.some(plot => plot.metadata.session_id === metadata.session_id && plot.id === metadata.id)) {
                continue;
            }

            if (metadata.kind === 'html') {
                const storedUri = metadata.html_uri;
                if (!storedUri) {
                    continue;
                }

                try {
                    const restored = HtmlPlotClient.fromMetadata(metadata, vscode.Uri.parse(storedUri));
                    this._plots.push(restored);
                    this._storePlotMetadata(restored.metadata, PlotStorageLocationView);
                    restoredHtml.add(restored.id);
                } catch {
                    // ignore malformed URI metadata
                }
            }
        }

        if (restoredHtml.size > 0) {
            this._plots.sort((left, right) => (left.metadata.created ?? 0) - (right.metadata.created ?? 0));
            this._onDidReplacePlots.fire([...this._plots]);
            if (!this._selectedPlotId || !this._plots.some(plot => plot.id === this._selectedPlotId)) {
                const lastPlot = this._plots[this._plots.length - 1];
                if (lastPlot) {
                    this._onDidSelectPlot.fire(lastPlot.id);
                }
            }
        }
    }

    private createCommProxy(
        client: RuntimeClientInstance,
        metadata: PlotClientMetadata
    ): PositronPlotCommProxy {
        let renderQueue = this._renderQueues.get(metadata.session_id);
        if (!renderQueue) {
            const session = this._sessionManager?.getSession(metadata.session_id);
            if (!session) {
                this._outputChannel?.error(
                    `[PositronPlotsService] Cannot find session ${metadata.session_id} for plot ${metadata.id}`
                );
                throw new Error(`Cannot find session ${metadata.session_id} for plot ${metadata.id}`);
            }

            const runtimeSession: IRuntimeSession = {
                sessionId: session.sessionId,
                getRuntimeState: () => session.state as any,
                onDidChangeRuntimeState: session.onDidChangeRuntimeState as any
            };

            renderQueue = new PositronPlotRenderQueue(runtimeSession);
            this._disposables.push(renderQueue);
            this._renderQueues.set(metadata.session_id, renderQueue);
        }

        const commProxy = new PositronPlotCommProxy(client, renderQueue);
        this._plotCommProxies.set(metadata.id, commProxy);

        this._disposables.push(
            commProxy.onDidClose(() => {
                const plotClients = this._plotClientsByComm.get(metadata.id);
                if (plotClients) {
                    plotClients.forEach(plotClient => {
                        plotClient.dispose();
                    });
                }
                this._plotClientsByComm.delete(metadata.id);
                this._plotCommProxies.delete(metadata.id);
            })
        );

        this._disposables.push(commProxy);
        return commProxy;
    }

    private createRuntimePlotClient(
        commProxy: PositronPlotCommProxy,
        metadata: PlotClientMetadata,
        client: RuntimeClientInstance
    ): PlotClientInstance {
        const sizingPolicy = this._selectedSizingPolicy;
        const plotClient = createPlotClient(
            client.message,
            client.sender,
            client.closer,
            metadata.session_id,
            sizingPolicy,
            commProxy
        );

        // Merge in session-specific metadata (code, pre_render, language, etc.)
        plotClient.updateMetadata(metadata);

        let plotClients = this._plotClientsByComm.get(metadata.id);
        if (!plotClients) {
            plotClients = [];
            this._plotClientsByComm.set(metadata.id, plotClients);
        }
        plotClients.push(plotClient);

        return plotClient;
    }

    private async fetchAndUpdateMetadata(
        commProxy: PositronPlotCommProxy,
        metadata: PlotClientMetadata,
        plotClient?: PlotClientInstance
    ): Promise<void> {
        try {
            const backendMetadata = await commProxy.getMetadata();
            metadata.kind = backendMetadata.kind;
            metadata.name = backendMetadata.name;
            metadata.execution_id = backendMetadata.execution_id;
            if (!metadata.code) {
                metadata.code = backendMetadata.code;
            }

            if (plotClient) {
                plotClient.updateMetadata({
                    kind: backendMetadata.kind,
                    name: backendMetadata.name,
                    execution_id: backendMetadata.execution_id,
                    code: metadata.code
                });

                this._storePlotMetadata(plotClient.metadata, PlotStorageLocationView);
            } else {
                this._storePlotMetadata(metadata, PlotStorageLocationView);
            }

            this._onDidUpdatePlotMetadata.fire(metadata.id);
        } catch (err) {
            const errMessage = err?.message ? String(err.message) : String(err);
            let dataSuffix = '';
            if (err?.data) {
                const dataMessage = err.data?.message ? String(err.data.message) : '';
                if (dataMessage) {
                    dataSuffix = `; data=${dataMessage}`;
                } else {
                    try {
                        dataSuffix = `; data=${JSON.stringify(err.data)}`;
                    } catch {
                        dataSuffix = '; data=[unserializable]';
                    }
                }
            }
            this._outputChannel?.warn(
                `[PositronPlotsService] Failed to fetch metadata for plot ${metadata.id}: ${errMessage}${dataSuffix}`
            );
        }
    }

    private registerPlotClient(plotClient: PlotClientInstance, fireEvents: boolean): void {
        // Add to plots list
        this._plots.push(plotClient);

        // Track by ID for render requests
        this._plotClients.set(plotClient.id, plotClient);

        this._disposables.push(
            plotClient.onDidChangeSizingPolicy((policy) => {
                this.selectSizingPolicy(policy.id);
                this._storePlotMetadata(plotClient.metadata, PlotStorageLocationView);
            }),
            plotClient.onDidCompleteRender((rendered) => {
                this.cachePlotThumbnailURI(plotClient.id, rendered.uri);
                this._storePlotMetadata(plotClient.metadata, PlotStorageLocationView);
            }),
            plotClient.onDidChangeZoomLevel(() => {
                this._storePlotMetadata(plotClient.metadata, PlotStorageLocationView);
            }),
            plotClient.onDidUpdateMetadata((metadata) => {
                this._storePlotMetadata(metadata, PlotStorageLocationView);
            })
        );

        this._storePlotMetadata(plotClient.metadata, PlotStorageLocationView);

        if (fireEvents) {
            this._onDidEmitPlot.fire(plotClient);
            this._onDidSelectPlot.fire(plotClient.id);
        }

        // Remove when closed
        this._disposables.push(
            plotClient.onDidClose(() => {
                if (this._plots.some(plot => plot.id === plotClient.id)) {
                    this.removePlot(plotClient.id);
                }
            })
        );
    }

    private registerNewPlotClient(client: IPositronPlotClient): void {
        this._plots.unshift(client);

        if (client instanceof HtmlPlotClient) {
            client.metadata.html_uri = client.uri.toString();
            this._storePlotMetadata(client.metadata, PlotStorageLocationView);
        }

        this._onDidEmitPlot.fire(client);
        this._onDidSelectPlot.fire(client.id);
    }

    private replacePlot(id: string, newPlot: IPositronPlotClient): void {
        const index = this._plots.findIndex(plot => plot.id === id);
        if (index < 0) {
            return;
        }

        const oldPlot = this._plots[index];
        this.unregisterPlotClient(oldPlot);

        this._plots.splice(index, 1);
        if (newPlot instanceof PlotClientInstance) {
            this.registerPlotClient(newPlot, false);
        } else {
            this._plots.splice(index, 0, newPlot);
            if (newPlot instanceof StaticPlotClient || newPlot instanceof HtmlPlotClient) {
                this._storePlotMetadata(newPlot.metadata, PlotStorageLocationView);

                if (newPlot instanceof StaticPlotClient) {
                    this._disposables.push(
                        newPlot.onDidChangeZoomLevel(() => {
                            this._storePlotMetadata(newPlot.metadata, PlotStorageLocationView);
                        })
                    );
                }
            }
        }

        this._onDidRemovePlot.fire(oldPlot);
        this._onDidEmitPlot.fire(newPlot);
        this._onDidSelectPlot.fire(newPlot.id);
    }

    private getPlotForOutput(sessionId: string, outputId: string): IPositronPlotClient | undefined {
        return this._plots.find(plot => plot.metadata.session_id === sessionId && plot.metadata.output_id === outputId);
    }

    private hasPlot(sessionId: string, plotId: string): boolean {
        return this._plots.some(plot => plot.metadata.session_id === sessionId && plot.metadata.id === plotId);
    }

    /**
     * Adds a plot client instance to the service.
     */
    addPlotClient(client: PlotClientInstance): void {
        this.registerPlotClient(client, true);
    }

    /**
     * Adds an HTML plot (webview-based) to the plots service.
     * Used for show_html_file events from the UI comm.
     */
    addHtmlPlot(sessionId: string, event: IShowHtmlUriEvent): void {
        // Get the most recent execution ID and code, if available.
        const executionId = this._recentExecutionIds.length > 0
            ? this._recentExecutionIds[this._recentExecutionIds.length - 1]
            : undefined;
        const code = executionId ? this._recentExecutions.get(executionId) : undefined;

        const plotClient = new HtmlPlotClient(sessionId, event, executionId, code);
        plotClient.metadata.html_uri = plotClient.uri.toString();
        this.registerNewPlotClient(plotClient);
    }

    /**
     * Gets a plot client instance by ID.
     */
    getPlotClient(id: string): PlotClientInstance | undefined {
        return this._plotClients.get(id);
    }

    /**
     * Dispose the service and clean up resources.
     */
    dispose(): void {
        this._flushPlotMetadataPersistence();
        this._isShuttingDown = true;
        this._flushThumbnailPersistence(true);
        this._persistCachedPlotThumbnails = () => { }; // prevent further debounced writes
        this._storeSelectedSizingPolicy();
        this._storeCustomPlotSize();

        // Dispose all clients
        for (const client of this._plotClients.values()) {
            client.dispose();
        }
        this._plotClients.clear();

        // Dispose all disposables
        this._disposables.forEach(d => d.dispose());
    }
}
