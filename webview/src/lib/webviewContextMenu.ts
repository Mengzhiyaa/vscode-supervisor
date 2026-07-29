const guardedDocuments = new WeakSet<Document>();

/**
 * Prevents VS Code from showing its default webview context menu.
 *
 * Project-defined context menu handlers still receive the event because this
 * listener does not stop propagation. VS Code's webview bridge observes the
 * cancelled event and therefore does not open its Cut/Copy/Paste menu.
 */
export function installWebviewContextMenuGuard(
    targetDocument: Document = document,
): void {
    if (guardedDocuments.has(targetDocument)) {
        return;
    }

    targetDocument.addEventListener(
        "contextmenu",
        (event) => {
            event.preventDefault();
        },
        { capture: true },
    );
    guardedDocuments.add(targetDocument);
}
