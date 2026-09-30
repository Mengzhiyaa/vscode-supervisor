import type { ContextMenuEntry } from '../shared/ContextMenu.svelte';
import { localize } from '../lib/localization';
import { DarkFilter, ZoomLevel, type IPositronPlotSizingPolicy } from './types';

export interface PlotMenuAction {
    id: string;
    label: string;
    icon?: string;
    checked?: boolean;
    disabled?: boolean;
    separator?: boolean;
    onSelected?: () => void;
}

export function toContextMenuEntries(actions: PlotMenuAction[]): ContextMenuEntry[] {
    return actions.map(action => action.separator ? { separator: true } : { ...action });
}

export function zoomActions(zoom: ZoomLevel, select?: (zoom: ZoomLevel) => void): PlotMenuAction[] {
    return [ZoomLevel.Fit, ZoomLevel.Fifty, ZoomLevel.SeventyFive, ZoomLevel.OneHundred, ZoomLevel.TwoHundred]
        .map(level => ({
            id: String(level),
            label: level === ZoomLevel.Fit ? localize('plots.zoomFit', 'Fit') : `${level * 100}%`,
            checked: level === zoom,
            onSelected: () => select?.(level),
        }));
}

export function darkFilterIcon(mode: DarkFilter): string {
    return mode === DarkFilter.On ? 'circle-large-filled' : mode === DarkFilter.Off ? 'circle-large' : 'color-mode';
}

export function darkFilterActions(
    mode: DarkFilter,
    select?: (mode: DarkFilter) => void,
    openSettings?: () => void,
): PlotMenuAction[] {
    return [
        ...[
            { mode: DarkFilter.On, label: localize('plots.darkFilter', 'Dark Filter') },
            { mode: DarkFilter.Off, label: localize('plots.noFilter', 'No Filter') },
            { mode: DarkFilter.Auto, label: localize('plots.followTheme', 'Follow Theme') },
        ].map(item => ({
            id: item.mode, label: item.label, checked: item.mode === mode,
            onSelected: () => select?.(item.mode),
        })),
        { id: 'separator', label: '', separator: true },
        { id: 'settings', label: localize('plots.filterSettings', 'Change Default in Settings...'), onSelected: () => openSettings?.() },
    ];
}

export function sizingActions(
    policies: IPositronPlotSizingPolicy[],
    selectedId: string,
    hasIntrinsicSize: boolean,
    hasCustomSize: boolean,
    select?: (id: string) => void,
    setCustomSize?: () => void,
): PlotMenuAction[] {
    const entry = (policy: IPositronPlotSizingPolicy): PlotMenuAction => ({
        id: policy.id, label: policy.getName(), checked: policy.id === selectedId,
        disabled: policy.id === 'intrinsic' && !hasIntrinsicSize,
        onSelected: () => select?.(policy.id),
    });
    return [
        ...policies.filter(policy => policy.id !== 'custom').map(entry),
        { id: 'separator', label: '', separator: true },
        ...policies.filter(policy => policy.id === 'custom').map(entry),
        {
            id: 'custom-size',
            label: hasCustomSize ? localize('plots.changeCustomSize', 'Change Custom Size...') : localize('plots.newCustomSize', 'New Custom Size...'),
            onSelected: () => setCustomSize?.(),
        },
    ];
}

export interface PlotCodeActionsOptions {
    plotCode?: string;
    executionId?: string;
    sessionId?: string;
    languageId?: string;
    hasOriginFile?: boolean;
    oncopyCode?: (code: string) => void;
    onrevealInConsole?: (data: { sessionId: string; executionId: string }) => void;
    onrunCodeAgain?: (data: { code: string; sessionId: string; languageId: string }) => void;
    onopenSourceFile?: () => void;
}

export function plotCodeActions(options: PlotCodeActionsOptions): PlotMenuAction[] {
    const { plotCode, executionId, sessionId, languageId } = options;
    return [
        {
            id: 'copy-code', label: localize('plots.copyCode', 'Copy Code'), icon: 'copy', disabled: !plotCode,
            onSelected: () => { if (plotCode) options.oncopyCode?.(plotCode); },
        },
        {
            id: 'reveal', label: localize('plots.revealCode', 'Reveal Code in Console'), icon: 'go-to-file', disabled: !executionId || !sessionId,
            onSelected: () => { if (executionId && sessionId) options.onrevealInConsole?.({ sessionId, executionId }); },
        },
        {
            id: 'run', label: localize('plots.runCode', 'Run Code Again'), icon: 'run', disabled: !plotCode || !sessionId || !languageId,
            onSelected: () => { if (plotCode && sessionId && languageId) options.onrunCodeAgain?.({ code: plotCode, sessionId, languageId }); },
        },
        {
            id: 'source', label: localize('plots.openSource', 'Open Source File'), icon: 'go-to-file', disabled: !options.hasOriginFile,
            onSelected: () => options.onopenSourceFile?.(),
        },
    ];
}
