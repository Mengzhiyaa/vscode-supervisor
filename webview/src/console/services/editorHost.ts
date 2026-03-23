import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";

export interface EditorHost {
    setEditor(editor: MonacoApi.editor.IStandaloneCodeEditor): void;
    clearEditor(): void;
    getEditor(): MonacoApi.editor.IStandaloneCodeEditor | undefined;
    getActiveSessionId(): string | undefined;
    saveViewState(): MonacoApi.editor.ICodeEditorViewState | null;
    activateSession(
        sessionId: string,
        model: MonacoApi.editor.ITextModel,
        viewState: MonacoApi.editor.ICodeEditorViewState | null,
    ): void;
    focus(): void;
}

export function createEditorHost(): EditorHost {
    let editor: MonacoApi.editor.IStandaloneCodeEditor | undefined;
    let activeSessionId: string | undefined;

    return {
        setEditor(nextEditor: MonacoApi.editor.IStandaloneCodeEditor) {
            editor = nextEditor;
        },

        clearEditor() {
            editor = undefined;
            activeSessionId = undefined;
        },

        getEditor() {
            return editor;
        },

        getActiveSessionId() {
            return activeSessionId;
        },

        saveViewState() {
            if (!editor) {
                return null;
            }

            return editor.saveViewState();
        },

        activateSession(
            sessionId: string,
            model: MonacoApi.editor.ITextModel,
            viewState: MonacoApi.editor.ICodeEditorViewState | null,
        ) {
            if (!editor) {
                activeSessionId = sessionId;
                return;
            }

            if (editor.getModel() !== model) {
                editor.setModel(model);
            }

            if (viewState) {
                editor.restoreViewState(viewState);
            }

            activeSessionId = sessionId;
        },

        focus() {
            editor?.focus();
        },
    };
}
