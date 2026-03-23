import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import type { MessageConnection } from "vscode-jsonrpc/browser";
import { loadLanguageMonacoSupportModule } from "$lib/monaco/languageSupport";
import type { IInputHistoryEntry } from "../history";

export type ConsoleInputCommand =
    | { kind: "focus" }
    | { kind: "type"; text: string }
    | { kind: "paste"; text: string }
    | { kind: "historyUp"; usingPrefixMatch: boolean }
    | { kind: "historyDown" }
    | { kind: "historyClear" }
    | { kind: "openInEditor" }
    | { kind: "setPendingCode"; code?: string }
    | { kind: "historyAdd"; input: string; when?: number }
    | { kind: "historySet"; entries: { input: string; when?: number }[] };

export interface SessionHistoryState {
    historyEntries: IInputHistoryEntry[];
    historyIndex: number;
    currentCodeFragment: string | undefined;
}

export interface SessionModelState {
    model: MonacoApi.editor.ITextModel;
    viewState: MonacoApi.editor.ICodeEditorViewState | null;
}

interface SessionState {
    editor: SessionModelState;
    history: SessionHistoryState;
}

export interface SessionModelManager {
    ensureSession(sessionId: string): SessionModelState;
    ensureSessions(sessionIds: string[]): void;
    getHistoryState(sessionId: string): SessionHistoryState;
    setHistoryState(sessionId: string, historyState: SessionHistoryState): void;
    setViewState(
        sessionId: string,
        viewState: MonacoApi.editor.ICodeEditorViewState | null,
    ): void;
    enqueuePending(sessionId: string, command: ConsoleInputCommand): void;
    flushPending(sessionId: string): ConsoleInputCommand[];
    removeSession(sessionId: string): void;
    pruneUnknownSessions(knownSessionIds: string[], activeSessionId?: string): void;
    updateConnection(connection: MessageConnection | undefined): void;
    clear(): void;
}

export interface SessionModelManagerOptions {
    monaco: typeof MonacoApi;
    getConnection: () => MessageConnection | undefined;
}

function cloneHistoryState(state: SessionHistoryState): SessionHistoryState {
    return {
        historyEntries: state.historyEntries.map((entry) => ({
            ...entry,
            when: new Date(entry.when),
        })),
        historyIndex: state.historyIndex,
        currentCodeFragment: state.currentCodeFragment,
    };
}

export function createSessionModelManager(
    options: SessionModelManagerOptions,
): SessionModelManager {
    const { monaco, getConnection } = options;

    const sessionStateById = new Map<string, SessionState>();
    const pendingCommandsBySession = new Map<string, ConsoleInputCommand[]>();

    function createDefaultHistoryState(): SessionHistoryState {
        return {
            historyEntries: [],
            historyIndex: -1,
            currentCodeFragment: undefined,
        };
    }

    function registerSessionModel(
        model: MonacoApi.editor.ITextModel,
        sessionId: string,
    ): void {
        const connection = getConnection();
        if (connection) {
            void loadLanguageMonacoSupportModule("r").then((support) => {
                support?.registerModel?.(model, sessionId, connection);
            });
        }
    }

    function getOrCreateSessionState(sessionId: string): SessionState {
        const existing = sessionStateById.get(sessionId);
        if (existing) {
            return existing;
        }

        const uri = monaco.Uri.parse(
            `inmemory://console/session-${encodeURIComponent(sessionId)}.R`,
        );
        const model =
            monaco.editor.getModel(uri) ??
            monaco.editor.createModel("", "r", uri);

        registerSessionModel(model, sessionId);

        const created: SessionState = {
            editor: {
                model,
                viewState: null,
            },
            history: createDefaultHistoryState(),
        };

        sessionStateById.set(sessionId, created);
        return created;
    }

    return {
        ensureSession(sessionId) {
            return getOrCreateSessionState(sessionId).editor;
        },

        ensureSessions(sessionIds) {
            for (const sessionId of sessionIds) {
                getOrCreateSessionState(sessionId);
            }
        },

        getHistoryState(sessionId) {
            return cloneHistoryState(getOrCreateSessionState(sessionId).history);
        },

        setHistoryState(sessionId, historyState) {
            const state = getOrCreateSessionState(sessionId);
            state.history = cloneHistoryState(historyState);
        },

        setViewState(sessionId, viewState) {
            const state = getOrCreateSessionState(sessionId);
            state.editor.viewState = viewState;
        },

        enqueuePending(sessionId, command) {
            const queue = pendingCommandsBySession.get(sessionId) ?? [];
            queue.push(command);
            pendingCommandsBySession.set(sessionId, queue);
        },

        flushPending(sessionId) {
            const queue = pendingCommandsBySession.get(sessionId) ?? [];
            pendingCommandsBySession.delete(sessionId);
            return queue;
        },

        removeSession(sessionId) {
            const state = sessionStateById.get(sessionId);
            if (!state) {
                pendingCommandsBySession.delete(sessionId);
                return;
            }

            void loadLanguageMonacoSupportModule("r").then((support) => {
                support?.unregisterModel?.(state.editor.model);
            });
            state.editor.model.dispose();
            sessionStateById.delete(sessionId);
            pendingCommandsBySession.delete(sessionId);
        },

        pruneUnknownSessions(knownSessionIds, activeSessionId) {
            const known = new Set(knownSessionIds);
            for (const sessionId of [...sessionStateById.keys()]) {
                if (sessionId === activeSessionId) {
                    continue;
                }

                if (!known.has(sessionId)) {
                    this.removeSession(sessionId);
                }
            }
        },

        updateConnection(connection) {
            if (!connection) {
                return;
            }

            for (const [sessionId, state] of sessionStateById.entries()) {
                registerModel(state.editor.model, sessionId, connection);
            }
        },

        clear() {
            for (const [sessionId] of sessionStateById.entries()) {
                this.removeSession(sessionId);
            }
            sessionStateById.clear();
            pendingCommandsBySession.clear();
        },
    };
}
