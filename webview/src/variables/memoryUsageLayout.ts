/** Width tiers used by the Variables action bar, matching Positron's priority order. */
export const MemoryMeterBarMinimumWidth = 27;
export const MemoryMeterBarMaximumWidth = 100;
export const MemoryMeterChromeWidth = 34;
export const MemoryMeterNoBarWidth = 28;
export const MemoryMeterWarningWidth = 20;
export const MemoryMeterLabelMinimumWidth = 35;

export type MemoryMeterLayout = 'barAndLabel' | 'labelAndWarning' | 'label' | 'hidden';

export interface MemoryMeterSizing {
    layout: MemoryMeterLayout;
    width: number;
    barWidth?: number;
    showWarning: boolean;
}

export function getMemoryMeterSizing(
    availableWidth: number,
    lowMemory: boolean,
    labelWidth = MemoryMeterLabelMinimumWidth,
): MemoryMeterSizing {
    const warningWidth = lowMemory ? MemoryMeterWarningWidth : 0;
    const spaceForBar = availableWidth - MemoryMeterChromeWidth - labelWidth - warningWidth;
    if (spaceForBar >= MemoryMeterBarMinimumWidth) {
        const barWidth = Math.min(MemoryMeterBarMaximumWidth, Math.floor(spaceForBar));
        return {
            layout: 'barAndLabel',
            width: MemoryMeterChromeWidth + labelWidth + warningWidth + barWidth,
            barWidth,
            showWarning: lowMemory,
        };
    }
    const labelOnlyWidth = MemoryMeterNoBarWidth + labelWidth;
    if (availableWidth >= labelOnlyWidth + warningWidth) {
        return {
            layout: lowMemory ? 'labelAndWarning' : 'label',
            width: labelOnlyWidth + warningWidth,
            showWarning: lowMemory,
        };
    }
    if (availableWidth >= labelOnlyWidth) {
        return { layout: 'label', width: labelOnlyWidth, showWarning: false };
    }
    return { layout: 'hidden', width: 0, showWarning: false };
}

export function getMemoryMeterLayout(availableWidth: number, lowMemory: boolean): MemoryMeterLayout {
    return getMemoryMeterSizing(availableWidth, lowMemory).layout;
}

export function getMemoryMeterLabelWidth(label: string): number {
    return Math.max(MemoryMeterLabelMinimumWidth, Math.ceil(label.length * 6));
}

export function formatMemoryBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }

    const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
}
