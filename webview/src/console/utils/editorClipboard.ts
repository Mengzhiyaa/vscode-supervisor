import type * as MonacoApi from 'monaco-editor/editor';
import { writeClipboardText } from './selectionUtils';

/** Editors using this helper disable emptySelectionClipboard. */
export function copyEditorSelection(
    editor: MonacoApi.editor.IStandaloneCodeEditor,
    cut = false,
): boolean {
    if (!editor.hasTextFocus()) {
        return false;
    }

    const model = editor.getModel();
    const selections = editor.getSelections()?.filter((selection) => !selection.isEmpty());
    if (!model || !selections?.length) {
        return false;
    }

    const domNode = editor.getDomNode();
    let copied = false;
    const onCopy = (event: ClipboardEvent) => {
        // Monaco populates text, rich text and multi-cursor metadata before
        // the event bubbles out of its input element.
        copied = event.defaultPrevented && !!event.clipboardData;
    };
    domNode?.addEventListener('copy', onCopy);
    try {
        if (domNode?.ownerDocument.queryCommandSupported?.('copy')) {
            editor.trigger('console', 'editor.action.clipboardCopyAction', null);
        }
    } catch {
        // Browser clipboard access can be unavailable in a webview.
    } finally {
        domNode?.removeEventListener('copy', onCopy);
    }

    if (!copied) {
        // Some webview hosts do not dispatch a native copy event. Keep the
        // Host clipboard transport as a fallback without replacing native data.
        selections.sort(
            (a, b) => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn,
        );
        void writeClipboardText(
            selections.map((selection) => model.getValueInRange(selection)).join(model.getEOL()),
        );
    }
    if (cut) {
        // The native cut handler manages all carets and undo; copy above also
        // works with EditContext, where execCommand('cut') is unsupported.
        editor.trigger('console', 'cut', null);
    }
    return true;
}
