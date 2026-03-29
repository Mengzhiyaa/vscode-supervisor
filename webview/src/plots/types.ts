export {
    DarkFilter,
    HistoryPolicy,
    HistoryPosition,
    PlotClientState,
    ZoomLevel,
    type SizingPolicyInfo,
} from "@shared/plots";

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
