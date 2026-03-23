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
    originUri?: string;
    name?: string;
    code?: string;
    parentId?: string;
    languageId?: string;
    zoomLevel?: number;
    sizingPolicyId?: string;
    customSize?: IPlotSize;
    hasIntrinsicSize?: boolean;
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
        originUri: plot.originUri,
        name: plot.name,
        code: plot.code,
        parentId: plot.parentId,
        languageId: plot.languageId,
        zoomLevel: plot.zoomLevel,
        sizingPolicyId: plot.sizingPolicyId,
        customSize: cloneSize(plot.customSize),
        hasIntrinsicSize: plot.hasIntrinsicSize,
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
