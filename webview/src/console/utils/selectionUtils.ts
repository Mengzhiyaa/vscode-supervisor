import { getRpcConnection } from "../../lib/rpc/client";

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

export function getScopedSelectionText(
    container: HTMLElement | null | undefined,
): string | null {
    const selection = getScopedSelection(container);
    if (selection?.type !== "Range") {
        return null;
    }

    const text = selection.toString();
    return text.length > 0 ? text : null;
}

export async function writeClipboardText(text: string): Promise<void> {
    try {
        await getRpcConnection().sendRequest("console/writeClipboardText", {
            text,
        });
        return;
    } catch (rpcError) {
        // The standalone webview harness and partially initialized webviews may
        // not have a host request handler yet. Preserve a browser fallback.
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch (clipboardError) {
            console.warn("Failed to write console text to the clipboard:", {
                rpcError,
                clipboardError,
            });
        }
    }
}

export function copyScopedSelection(
    container: HTMLElement | null | undefined,
): boolean {
    const text = getScopedSelectionText(container);
    if (text === null) {
        return false;
    }

    void writeClipboardText(text);
    return true;
}
