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
    languageId: string;
}

export interface KnownSessionInfo {
    sessionId: string;
    languageId: string;
}

export interface SessionModelManager {
    ensureSession(sessionId: string, languageId: string): SessionModelState;
    ensureSessions(sessions: KnownSessionInfo[]): void;
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

    function normalizeLanguageId(languageId: string | undefined): string {
        const normalizedLanguageId = languageId?.trim().toLowerCase();
        return normalizedLanguageId || "plaintext";
    }

    function buildModelUri(
        sessionId: string,
        languageId: string,
    ): MonacoApi.Uri {
        const normalizedLanguageId = normalizeLanguageId(languageId).replace(
            /[^a-z0-9_-]+/g,
            "-",
        );
        return monaco.Uri.parse(
            `inmemory://console/session-${encodeURIComponent(sessionId)}.${normalizedLanguageId}`,
        );
    }

    function syncModelLanguage(
        model: MonacoApi.editor.ITextModel,
        languageId: string,
    ): void {
        if (model.getLanguageId() !== languageId) {
            monaco.editor.setModelLanguage(model, languageId);
        }
    }

    function registerSessionModel(
        model: MonacoApi.editor.ITextModel,
        sessionId: string,
        languageId: string,
        connectionOverride?: MessageConnection,
    ): void {
        const connection = connectionOverride ?? getConnection();
        if (connection) {
            void loadLanguageMonacoSupportModule(languageId)
                .then((support) => {
                    support?.registerModel?.(
                        monaco,
                        model,
                        sessionId,
                        connection,
                    );
                })
                .catch((error) => {
                    console.warn(
                        `[sessionModelManager] Failed to register model for '${languageId}'`,
                        error,
                    );
                });
        }
    }

    function unregisterSessionModel(
        model: MonacoApi.editor.ITextModel,
        languageId: string,
    ): void {
        void loadLanguageMonacoSupportModule(languageId)
            .then((support) => {
                support?.unregisterModel?.(monaco, model);
            })
            .catch((error) => {
                console.warn(
                    `[sessionModelManager] Failed to unregister model for '${languageId}'`,
                    error,
                );
            });
    }

    function createSessionState(
        sessionId: string,
        languageId: string,
        historyState: SessionHistoryState,
        viewState: MonacoApi.editor.ICodeEditorViewState | null,
        initialValue = "",
    ): SessionState {
        const normalizedLanguageId = normalizeLanguageId(languageId);
        const uri = buildModelUri(sessionId, normalizedLanguageId);
        const existingModel = monaco.editor.getModel(uri);
        const model =
            existingModel ??
            monaco.editor.createModel(initialValue, normalizedLanguageId, uri);

        syncModelLanguage(model, normalizedLanguageId);

        if (model.getValue() !== initialValue) {
            model.setValue(initialValue);
        }

        registerSessionModel(model, sessionId, normalizedLanguageId);

        return {
            editor: {
                model,
                viewState,
            },
            history: cloneHistoryState(historyState),
            languageId: normalizedLanguageId,
        };
    }

    function replaceSessionLanguage(
        sessionId: string,
        sessionState: SessionState,
        languageId: string,
    ): SessionState {
        const nextState = createSessionState(
            sessionId,
            languageId,
            sessionState.history,
            sessionState.editor.viewState,
            sessionState.editor.model.getValue(),
        );

        unregisterSessionModel(sessionState.editor.model, sessionState.languageId);
        sessionState.editor.model.dispose();
        sessionStateById.set(sessionId, nextState);
        return nextState;
    }

    function getOrCreateSessionState(
        sessionId: string,
        languageId: string,
    ): SessionState {
        const normalizedLanguageId = normalizeLanguageId(languageId);
        const existing = sessionStateById.get(sessionId);
        if (existing) {
            syncModelLanguage(existing.editor.model, normalizedLanguageId);
            if (existing.languageId !== normalizedLanguageId) {
                return replaceSessionLanguage(
                    sessionId,
                    existing,
                    normalizedLanguageId,
                );
            }
            return existing;
        }

        const created = createSessionState(
            sessionId,
            normalizedLanguageId,
            createDefaultHistoryState(),
            null,
        );
        sessionStateById.set(sessionId, created);
        return created;
    }

    function getExistingOrCreateSessionState(sessionId: string): SessionState {
        const existing = sessionStateById.get(sessionId);
        if (existing) {
            return existing;
        }

        return getOrCreateSessionState(sessionId, "plaintext");
    }

    return {
        ensureSession(sessionId, languageId) {
            return getOrCreateSessionState(sessionId, languageId).editor;
        },

        ensureSessions(sessions) {
            for (const session of sessions) {
                getOrCreateSessionState(session.sessionId, session.languageId);
            }
        },

        getHistoryState(sessionId) {
            return cloneHistoryState(
                getExistingOrCreateSessionState(sessionId).history,
            );
        },

        setHistoryState(sessionId, historyState) {
            const state = getExistingOrCreateSessionState(sessionId);
            state.history = cloneHistoryState(historyState);
        },

        setViewState(sessionId, viewState) {
            const state = getExistingOrCreateSessionState(sessionId);
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

            unregisterSessionModel(state.editor.model, state.languageId);
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
                registerSessionModel(
                    state.editor.model,
                    sessionId,
                    state.languageId,
                    connection,
                );
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
