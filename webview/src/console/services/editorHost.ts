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
            } else {
                const lineNumber = model.getLineCount();
                const column = model.getLineMaxColumn(lineNumber);

                editor.setSelection({
                    startLineNumber: lineNumber,
                    startColumn: column,
                    endLineNumber: lineNumber,
                    endColumn: column,
                });
                editor.setPosition({ lineNumber, column });
                editor.revealPositionInCenterIfOutsideViewport({
                    lineNumber,
                    column,
                });
            }

            activeSessionId = sessionId;
        },

        focus() {
            editor?.focus();
        },
    };
}
