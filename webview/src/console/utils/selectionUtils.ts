export function getScopedSelection(
    container: HTMLElement | null | undefined,
): Selection | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !container) {
        return null;
    }

    for (let index = 0; index < selection.rangeCount; index++) {
        const range = selection.getRangeAt(index);
        if (!container.contains(range.commonAncestorContainer)) {
            return null;
        }
    }

    return selection;
}

export function copyScopedSelection(
    container: HTMLElement | null | undefined,
): boolean {
    const selection = getScopedSelection(container);
    if (selection?.type !== "Range") {
        return false;
    }

    document.execCommand("copy");
    return true;
}
