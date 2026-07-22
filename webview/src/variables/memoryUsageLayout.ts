/** Width tiers used by the Variables action bar, matching Positron's priority order. */
export const MemoryMeterBarMinimumWidth = 27;
export const MemoryMeterChromeWidth = 34;
export const MemoryMeterWarningWidth = 20;
export const MemoryMeterLabelMinimumWidth = 34;

export type MemoryMeterLayout = 'barAndLabel' | 'labelAndWarning' | 'label' | 'hidden';

export function getMemoryMeterLayout(availableWidth: number, lowMemory: boolean): MemoryMeterLayout {
    if (availableWidth >= MemoryMeterChromeWidth + MemoryMeterLabelMinimumWidth + MemoryMeterBarMinimumWidth) {
        return 'barAndLabel';
    }
    if (lowMemory && availableWidth >= MemoryMeterChromeWidth + MemoryMeterLabelMinimumWidth) {
        return 'labelAndWarning';
    }
    if (availableWidth >= MemoryMeterWarningWidth + MemoryMeterLabelMinimumWidth) {
        return 'label';
    }
    return 'hidden';
}
