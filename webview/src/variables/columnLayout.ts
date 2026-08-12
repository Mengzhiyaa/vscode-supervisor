export interface VariablesColumnLayout {
    nameWidth: number;
    detailsWidth: number;
    rightColumnVisible: boolean;
}

export function getNameColumnBounds(
    containerWidth: number,
    minimumNameWidth: number,
): { minimum: number; maximum: number } {
    const maximum = Math.max(0, Math.trunc((2 * containerWidth) / 3));
    return {
        minimum: Math.min(Math.max(0, minimumNameWidth), maximum),
        maximum,
    };
}

export function calculateVariablesColumnLayout(
    containerWidth: number,
    requestedNameWidth: number,
    minimumNameWidth: number,
    rightColumnVisibilityThreshold: number,
): VariablesColumnLayout {
    const safeContainerWidth = Math.max(0, containerWidth);
    const bounds = getNameColumnBounds(
        safeContainerWidth,
        minimumNameWidth,
    );
    const nameWidth = Math.min(
        bounds.maximum,
        Math.max(bounds.minimum, requestedNameWidth),
    );
    const detailsWidth = Math.max(0, safeContainerWidth - nameWidth);
    return {
        nameWidth,
        detailsWidth,
        rightColumnVisible:
            detailsWidth > rightColumnVisibilityThreshold,
    };
}
