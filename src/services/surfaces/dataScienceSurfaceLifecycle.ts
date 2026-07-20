import * as vscode from 'vscode';
import { HtmlPlotClient } from '../../runtime/htmlPlotClient';
import type { IPositronPlotClient } from '../../runtime/positronPlots';
import type { PositronPlotsService } from '../../runtime/positronPlotsService';
import type { RuntimeSessionService } from '../../runtime/runtimeSession';
import type {
    IPositronDataExplorerInstance,
    IPositronDataExplorerService,
} from '../dataExplorer/positronDataExplorerService';
import {
    createSurfaceModelId,
    SurfaceKind,
    SurfaceLifecycleService,
    SurfaceModelKind,
    SurfaceSourceKind,
    type SurfaceAttachmentLease,
} from './surfaceLifecycleService';

const PlotsPaneSurfaceId = 'plots:main';
const CoordinatorOwnerId = 'data-science-surface-lifecycle';

/**
 * Adapts existing Plots and Data Explorer services to the surface-neutral
 * registry without moving rendering or backend ownership into the registry.
 */
export class DataScienceSurfaceLifecycle implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _plotModelIds = new Map<string, string>();
    private readonly _plotSubscriptions = new Map<string, vscode.Disposable>();
    private readonly _dataExplorerModelIds = new Map<string, string>();
    private readonly _dataExplorerSubscriptions = new Map<string, vscode.Disposable>();
    private _plotsPaneAttachment: SurfaceAttachmentLease | undefined;
    private _initialized = false;
    private _disposed = false;

    constructor(
        private readonly _lifecycle: SurfaceLifecycleService,
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _plotsService: PositronPlotsService,
        private readonly _dataExplorerService: IPositronDataExplorerService,
        private readonly _outputChannel: vscode.LogOutputChannel,
    ) { }

    initialize(): void {
        if (this._initialized) {
            return;
        }
        this._initialized = true;

        this._disposables.push(
            this._sessionManager.onDidDeleteRuntimeSession(sessionId => {
                const disposed = this._lifecycle.disposeSession(sessionId);
                if (disposed > 0) {
                    this._outputChannel.debug(
                        `[SurfaceLifecycle] Disposed ${disposed} model(s) for session ${sessionId}`,
                    );
                }
            }),
            this._plotsService.onDidEmitPlot(plot => this._registerPlot(plot)),
            this._plotsService.onDidRemovePlot(plot => this._unregisterPlot(plot)),
            this._plotsService.onDidSelectPlot(plotId => this._selectPlot(plotId)),
            this._plotsService.onDidReplacePlots(plots => this._replacePlots(plots)),
            this._dataExplorerService.onDidCreateInstance(instance => this._registerDataExplorer(instance)),
            this._dataExplorerService.onDidCloseInstance(identifier => this._unregisterDataExplorer(identifier)),
            this._lifecycle.onDidChange(event => {
                if (
                    event.type !== 'disposed' ||
                    event.model.kind !== SurfaceModelKind.DataExplorer ||
                    event.reason !== 'data-explorer-surface-closed'
                ) {
                    return;
                }
                const instance = this._dataExplorerService.getInstance(event.model.resourceId);
                if (instance) {
                    queueMicrotask(() => instance.dispose());
                }
            }),
        );

        this._replacePlots(this._plotsService.positronPlotInstances);
        for (const instance of this._dataExplorerService.instances.values()) {
            this._registerDataExplorer(instance);
        }
    }

    getPlotModelId(plotId: string): string | undefined {
        return this._plotModelIds.get(plotId);
    }

    getDataExplorerModelId(identifier: string): string | undefined {
        return this._dataExplorerModelIds.get(identifier);
    }

    private _plotModelId(plot: IPositronPlotClient): string {
        return createSurfaceModelId(
            SurfaceModelKind.Plot,
            plot.metadata.session_id,
            plot.metadata.output_id ?? plot.id,
        );
    }

    private _registerPlot(plot: IPositronPlotClient): void {
        const modelId = this._plotModelId(plot);
        this._plotModelIds.set(plot.id, modelId);
        this._lifecycle.upsertModel({
            id: modelId,
            kind: SurfaceModelKind.Plot,
            resourceId: plot.id,
            title: plot.metadata.name ?? 'Plot',
            source: {
                kind: SurfaceSourceKind.Runtime,
                id: plot.metadata.session_id,
                sessionId: plot.metadata.session_id,
                stop: async () => this._sessionManager.interruptSession(plot.metadata.session_id),
            },
            outputId: plot.metadata.output_id,
            retention: plot instanceof HtmlPlotClient ? 'persistent' : 'retain-on-detach',
            payload: {
                plotId: plot.id,
                plotKind: plot.metadata.kind,
                htmlUri: plot.metadata.html_uri,
                executionId: plot.metadata.execution_id,
                sessionId: plot.metadata.session_id,
            },
        });

        this._plotSubscriptions.get(plot.id)?.dispose();
        if (plot.onDidUpdateMetadata) {
            this._plotSubscriptions.set(plot.id, plot.onDidUpdateMetadata(metadata => {
                this._lifecycle.updateModel(modelId, {
                    resourceId: plot.id,
                    title: metadata.name ?? 'Plot',
                    outputId: metadata.output_id,
                    payload: {
                        plotId: plot.id,
                        plotKind: metadata.kind,
                        htmlUri: metadata.html_uri,
                        executionId: metadata.execution_id,
                        sessionId: metadata.session_id,
                    },
                });
            }));
        }
    }

    private _unregisterPlot(plot: IPositronPlotClient): void {
        const modelId = this._plotModelIds.get(plot.id) ?? this._plotModelId(plot);
        this._plotModelIds.delete(plot.id);
        this._plotSubscriptions.get(plot.id)?.dispose();
        this._plotSubscriptions.delete(plot.id);

        // replacePlot emits remove + add synchronously. Defer disposal so a
        // replacement with the same output identity updates the existing model.
        queueMicrotask(() => {
            if (this._disposed) {
                return;
            }
            const replacement = this._plotsService.positronPlotInstances.find(candidate =>
                this._plotModelId(candidate) === modelId,
            );
            if (!replacement) {
                this._lifecycle.disposeModel(modelId, 'plot-removed');
            }
        });
    }

    private _selectPlot(plotId: string): void {
        this._plotsPaneAttachment?.dispose();
        this._plotsPaneAttachment = undefined;
        if (!plotId) {
            return;
        }
        const plot = this._plotsService.positronPlotInstances.find(candidate => candidate.id === plotId);
        if (plot && !this._plotModelIds.has(plot.id)) {
            this._registerPlot(plot);
        }
        const modelId = this._plotModelIds.get(plotId);
        if (!modelId || !this._lifecycle.getModel(modelId)) {
            return;
        }
        this._plotsPaneAttachment = this._lifecycle.attach(modelId, {
            surfaceId: PlotsPaneSurfaceId,
            kind: SurfaceKind.PlotsPane,
            ownerId: CoordinatorOwnerId,
            metadata: { plotId },
        });
    }

    private _replacePlots(plots: readonly IPositronPlotClient[]): void {
        const currentIds = new Set(plots.map(plot => plot.id));
        for (const [plotId, modelId] of [...this._plotModelIds]) {
            if (!currentIds.has(plotId)) {
                this._plotModelIds.delete(plotId);
                this._plotSubscriptions.get(plotId)?.dispose();
                this._plotSubscriptions.delete(plotId);
                if (![...plots].some(plot => this._plotModelId(plot) === modelId)) {
                    this._lifecycle.disposeModel(modelId, 'plot-history-replaced');
                }
            }
        }
        plots.forEach(plot => this._registerPlot(plot));
        const selectedPlotId = this._plotsService.selectedPlotId;
        if (selectedPlotId) {
            this._selectPlot(selectedPlotId);
        }
    }

    private _registerDataExplorer(instance: IPositronDataExplorerInstance): void {
        const modelId = createSurfaceModelId(SurfaceModelKind.DataExplorer, instance.identifier);
        this._dataExplorerModelIds.set(instance.identifier, modelId);
        const isFile = instance.identifier.startsWith('duckdb:');
        this._lifecycle.upsertModel({
            id: modelId,
            kind: SurfaceModelKind.DataExplorer,
            resourceId: instance.identifier,
            title: instance.displayName,
            source: {
                kind: isFile ? SurfaceSourceKind.File : SurfaceSourceKind.Runtime,
                id: isFile ? instance.identifier.slice('duckdb:'.length) : (instance.sessionId ?? instance.identifier),
                sessionId: instance.sessionId,
                stop: instance.sessionId
                    ? async () => this._sessionManager.interruptSession(instance.sessionId!)
                    : undefined,
            },
            retention: 'retain-on-detach',
            payload: this._dataExplorerPayload(instance),
        });

        this._dataExplorerSubscriptions.get(instance.identifier)?.dispose();
        this._dataExplorerSubscriptions.set(
            instance.identifier,
            instance.onDidUpdateBackendState(() => {
                this._lifecycle.updateModel(modelId, {
                    title: instance.displayName,
                    payload: this._dataExplorerPayload(instance),
                });
            }),
        );
    }

    private _dataExplorerPayload(instance: IPositronDataExplorerInstance): Record<string, unknown> {
        return {
            identifier: instance.identifier,
            displayName: instance.displayName,
            languageName: instance.languageName,
            inlineOnly: instance.inlineOnly,
            sessionId: instance.sessionId,
            numRows: instance.numRows,
            numColumns: instance.numColumns,
        };
    }

    private _unregisterDataExplorer(identifier: string): void {
        const modelId = this._dataExplorerModelIds.get(identifier);
        this._dataExplorerModelIds.delete(identifier);
        this._dataExplorerSubscriptions.get(identifier)?.dispose();
        this._dataExplorerSubscriptions.delete(identifier);
        if (modelId) {
            this._lifecycle.disposeModel(modelId, 'data-explorer-closed');
        }
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._plotsPaneAttachment?.dispose();
        this._plotsPaneAttachment = undefined;
        this._plotSubscriptions.forEach(disposable => disposable.dispose());
        this._plotSubscriptions.clear();
        this._dataExplorerSubscriptions.forEach(disposable => disposable.dispose());
        this._dataExplorerSubscriptions.clear();
        this._disposables.forEach(disposable => disposable.dispose());
        this._lifecycle.detachOwner(CoordinatorOwnerId);
    }
}
