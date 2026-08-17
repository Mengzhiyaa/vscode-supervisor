import * as PlotsProtocol from '../rpc/webview/plots';
import type { IPlotSize } from '../runtime/sizingPolicy';

export interface SerializedPlotRecord {
    id: string;
    thumbnail?: string;
    initialData?: string;
    initialRenderSettings?: { width: number; height: number; pixelRatio: number; };
    renderVersion: number;
    sessionId?: string;
    kind?: 'static' | 'dynamic' | 'html';
    htmlUri?: string;
    htmlActive?: boolean;
    originUri?: string;
    name?: string;
    code?: string;
    parentId?: string;
    languageId?: string;
    zoomLevel?: number;
    sizingPolicyId?: string;
    customSize?: IPlotSize;
    hasIntrinsicSize?: boolean;
    /** Stable creation timestamp used to order mixed plot kinds. */
    created?: number;
}

export interface PlotHistoryEntry {
    id: string;
    created: number;
}

/** Sort mixed static, dynamic, and HTML plots by their creation metadata. */
export function orderedPlots<T extends PlotHistoryEntry>(plots: Iterable<T>): T[] {
    return Array.from(plots).sort((left, right) =>
        (left.created || 0) - (right.created || 0) || left.id.localeCompare(right.id));
}

function cloneSize(size: IPlotSize | undefined): IPlotSize | undefined {
    if (!size) {
        return undefined;
    }

    return {
        width: size.width,
        height: size.height,
    };
}

export function serializePlotRecord(
    plot: Omit<SerializedPlotRecord, 'thumbnail' | 'initialData' | 'initialRenderSettings'>,
    transport: Pick<SerializedPlotRecord, 'thumbnail' | 'initialData' | 'initialRenderSettings'>,
): SerializedPlotRecord {
    return {
        ...plot,
        thumbnail: transport.thumbnail,
        initialData: transport.initialData,
        initialRenderSettings: transport.initialRenderSettings,
        customSize: cloneSize(plot.customSize),
    };
}

export function toPlotAddedParams(
    plot: SerializedPlotRecord,
): PlotsProtocol.PlotAddedNotification.Params {
    return {
        plotId: plot.id,
        thumbnail: plot.thumbnail,
        initialData: plot.initialData,
        initialRenderSettings: plot.initialRenderSettings,
        renderVersion: plot.renderVersion,
        sessionId: plot.sessionId,
        kind: plot.kind,
        htmlUri: plot.htmlUri,
        htmlActive: plot.htmlActive,
        originUri: plot.originUri,
        name: plot.name,
        code: plot.code,
        parentId: plot.parentId,
        languageId: plot.languageId,
        zoomLevel: plot.zoomLevel,
        sizingPolicyId: plot.sizingPolicyId,
        customSize: cloneSize(plot.customSize),
        hasIntrinsicSize: plot.hasIntrinsicSize,
        created: plot.created,
    };
}

export function createSelectedPlotChangedPayload(input: {
    plotId?: string;
    selectedSizingPolicyId?: string;
    sizingPolicies?: PlotsProtocol.SizingPolicyInfo[];
    customSize?: IPlotSize;
    hasIntrinsicSize?: boolean;
    zoomLevel?: number;
}): PlotsProtocol.SelectedPlotChangedNotification.Params {
    return {
        plotId: input.plotId,
        selectedSizingPolicyId: input.selectedSizingPolicyId,
        sizingPolicies: input.sizingPolicies,
        customSize: cloneSize(input.customSize),
        hasIntrinsicSize: input.hasIntrinsicSize,
        zoomLevel: input.zoomLevel,
    };
}
