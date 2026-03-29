export enum ZoomLevel {
    Fit = 0,
    Fifty = 0.5,
    SeventyFive = 0.75,
    OneHundred = 1,
    TwoHundred = 2,
}

export enum PlotClientState {
    Unrendered = 'unrendered',
    RenderPending = 'render_pending',
    Rendering = 'rendering',
    Rendered = 'rendered',
    Closed = 'closed',
}

export enum HistoryPolicy {
    AlwaysVisible = 'always',
    NeverVisible = 'never',
    Automatic = 'auto',
}

export function parseHistoryPolicy(value: string | undefined): HistoryPolicy {
    switch (value) {
        case HistoryPolicy.AlwaysVisible:
            return HistoryPolicy.AlwaysVisible;
        case HistoryPolicy.NeverVisible:
            return HistoryPolicy.NeverVisible;
        case 'automatic':
        case HistoryPolicy.Automatic:
        default:
            return HistoryPolicy.Automatic;
    }
}

export enum HistoryPosition {
    Auto = 'auto',
    Bottom = 'bottom',
    Right = 'right',
}

export function parseHistoryPosition(value: string | undefined): HistoryPosition {
    switch (value) {
        case HistoryPosition.Bottom:
            return HistoryPosition.Bottom;
        case HistoryPosition.Right:
            return HistoryPosition.Right;
        case HistoryPosition.Auto:
        default:
            return HistoryPosition.Auto;
    }
}

export enum DarkFilter {
    On = 'on',
    Off = 'off',
    Auto = 'auto',
}

export function parseDarkFilter(value: string | undefined): DarkFilter {
    switch (value) {
        case DarkFilter.On:
            return DarkFilter.On;
        case DarkFilter.Off:
            return DarkFilter.Off;
        case DarkFilter.Auto:
        default:
            return DarkFilter.Auto;
    }
}

export type IntrinsicSizeUnit = 'inches' | 'pixels';

export interface IntrinsicSize {
    width: number;
    height: number;
    unit: IntrinsicSizeUnit;
    source: string;
}

export interface SizingPolicyInfo {
    id: string;
    name: string;
}
