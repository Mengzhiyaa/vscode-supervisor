export interface VirtualRange {
    start: number;
    end: number;
}

/** Calculates the half-open item range that should exist in the viewport DOM. */
export function calculateVirtualRange(
    itemCount: number,
    scrollOffset: number,
    viewportHeight: number,
    rowHeight: number,
    overscan: number,
): VirtualRange {
    if (itemCount <= 0 || rowHeight <= 0) {
        return { start: 0, end: 0 };
    }

    const safeOffset = Math.max(0, scrollOffset);
    const safeHeight = Math.max(0, viewportHeight);
    const safeOverscan = Math.max(0, Math.trunc(overscan));
    return {
        start: Math.max(
            0,
            Math.floor(safeOffset / rowHeight) - safeOverscan,
        ),
        end: Math.min(
            itemCount,
            Math.ceil((safeOffset + safeHeight) / rowHeight) + safeOverscan,
        ),
    };
}
