import type * as MonacoApi from "monaco-editor/editor";
import type { MessageConnection } from "vscode-jsonrpc/browser";
import type { IInputHistoryEntry } from "../history";
import type { LspClientManager } from "$lib/lsp/lspClientManager";
import { consoleLspModelUri } from "@shared/lspTunnel";
import { reconcileConsoleInputEdit, type ConsoleInputDraft, type ConsoleInputEdit } from "@shared/consoleInputState";

export type ConsoleInputCommand =
    | { kind: "focus" }
    | { kind: "insertText"; text: string }
    | { kind: "paste"; text: string }
    | { kind: "historyUp"; usingPrefixMatch: boolean }
    | { kind: "historyDown" }
    | { kind: "historyClear" }
    | { kind: "openInEditor" }
    | { kind: "cancelSubmission"; skipHostRequest?: boolean }
    | ({ kind: "setPendingCode" } & ConsoleInputEdit)
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
    draftClientId: string;
    draftListener: MonacoApi.IDisposable;
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
    readInputDraft(sessionId: string): ConsoleInputDraft | undefined;
    applyInputEdit(sessionId: string, edit: ConsoleInputEdit): void;
    clear(): void;
}

export interface SessionModelManagerOptions {
    monaco: typeof MonacoApi;
    getConnection: () => MessageConnection | undefined;
    lspClientManager?: LspClientManager;
    onDidEditInput?: (sessionId: string) => void;
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
    const { monaco, getConnection, lspClientManager } = options;

    const sessionStateById = new Map<string, SessionState>();
    const pendingCommandsBySession = new Map<string, ConsoleInputCommand[]>();
    let draftConnection: MessageConnection | undefined;
    let draftHandlers: Array<{ dispose(): void }> = [];

    function readInputDraft(sessionId: string): ConsoleInputDraft | undefined {
        const state = sessionStateById.get(sessionId);
        return state ? {
            clientId: state.draftClientId,
            version: state.editor.model.getVersionId(),
            code: state.editor.model.getValue(),
        } : undefined;
    }

    function publishDraft(sessionId: string): void {
        const draft = readInputDraft(sessionId);
        if (draft) { void getConnection()?.sendNotification('console/inputDraftChanged', { sessionId, draft }); }
    }

    function applyInputEdit(sessionId: string, edit: ConsoleInputEdit): void {
        const state = sessionStateById.get(sessionId);
        const current = readInputDraft(sessionId);
        if (!state || !current) {
            const pending = pendingCommandsBySession.get(sessionId) ?? [];
            pending.push({ kind: 'setPendingCode', ...edit });
            pendingCommandsBySession.set(sessionId, pending);
            return;
        }
        const next = reconcileConsoleInputEdit(current, edit);
        if (next !== current.code) {
            state.editor.model.setValue(next);
            options.onDidEditInput?.(sessionId);
        }
    }

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
        return monaco.Uri.parse(consoleLspModelUri(sessionId, normalizeLanguageId(languageId)));
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
        connectionOverride?: MessageConnection,
    ): void {
        const connection = connectionOverride ?? getConnection();
        if (connection) {
            lspClientManager?.attachModel(model, sessionId, connection);
        } else {
            lspClientManager?.detachModel(model);
        }
    }

    function unregisterSessionModel(model: MonacoApi.editor.ITextModel): void {
        lspClientManager?.detachModel(model);
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

        registerSessionModel(model, sessionId);

        return {
            draftClientId: crypto.randomUUID(),
            draftListener: model.onDidChangeContent(() => publishDraft(sessionId)),
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

        unregisterSessionModel(sessionState.editor.model);
        sessionState.draftListener.dispose();
        sessionState.editor.model.dispose();
        sessionStateById.set(sessionId, nextState);
        publishDraft(sessionId);
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
        publishDraft(sessionId);
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
        readInputDraft,
        applyInputEdit,
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
            const previousCommand = queue[queue.length - 1];
            if (
                previousCommand?.kind === "insertText" &&
                command.kind === "insertText"
            ) {
                previousCommand.text += command.text;
            } else {
                queue.push(command);
            }
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

            unregisterSessionModel(state.editor.model);
            state.draftListener.dispose();
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
            if (draftConnection !== connection) {
                draftHandlers.forEach(handler => handler.dispose());
                draftHandlers = [];
                draftConnection = connection;
                if (connection) {
                    draftHandlers.push(
                        connection.onRequest('console/getInputDraft', (params: { sessionId: string }) => ({
                            draft: readInputDraft(params.sessionId),
                        })),
                        connection.onRequest('console/applyInputEdit', (params: { sessionId: string } & ConsoleInputEdit) => {
                            applyInputEdit(params.sessionId, params);
                            return { draft: readInputDraft(params.sessionId) };
                        }),
                    );
                }
            }
            if (!connection) {
                for (const state of sessionStateById.values()) {
                    unregisterSessionModel(state.editor.model);
                }
                return;
            }

            for (const [sessionId, state] of sessionStateById.entries()) {
                publishDraft(sessionId);
                registerSessionModel(
                    state.editor.model,
                    sessionId,
                    connection,
                );
            }
        },

        clear() {
            draftHandlers.forEach(handler => handler.dispose());
            draftHandlers = [];
            draftConnection = undefined;
            for (const [sessionId] of sessionStateById.entries()) {
                this.removeSession(sessionId);
            }
            sessionStateById.clear();
            pendingCommandsBySession.clear();
        },
    };
}
