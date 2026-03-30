<script lang="ts">
    /**
     * ConsoleCore.svelte - Console Core (Positron pattern)
     * Main container managing multi-session console with sidebar
     */
    import { onMount } from "svelte";
    import { getRpcConnection } from "$lib/rpc/client";
    import ActionBar from "./ActionBar.svelte";
    import ConsoleTabList from "./ConsoleTabList.svelte";
    import ConsoleInstance from "./ConsoleInstance.svelte";
    import SharedConsoleInputHost from "./SharedConsoleInputHost.svelte";
    import VerticalSplitter from "./VerticalSplitter.svelte";
    import StartupStatus from "./StartupStatus.svelte";
    import EmptyConsole from "./EmptyConsole.svelte";
    import { deserializePromptState } from "@shared/console";
    import type {
        SerializedActivityItem,
        SerializedConsoleState,
        SerializedRuntimeItem,
    } from "@shared/consoleState";
    import type { RuntimeResourceUsage as ResourceUsage } from "@shared/runtime";
    import type {
        ConsoleSettings,
        RuntimeStartupPhase,
    } from "../types/console";
    import {
        createConsoleInstanceModel,
        type ConsoleInstanceModel,
        type ConsoleSessionInfo as SessionInfo,
    } from "./models/consoleInstance";
    import type { ConsoleInputCommand } from "./services/sessionModelManager";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import {
        RuntimeItem,
        RuntimeItemActivity,
        RuntimeItemStarted,
        RuntimeItemStartup,
        RuntimeItemStartupFailure,
        RuntimeItemExited,
        RuntimeItemOffline,
        RuntimeItemPendingInput,
        RuntimeItemStarting,
        RuntimeItemTrace,
        RuntimeItemReconnected,
        ActivityItemInput,
        ActivityItemInputState,
        ActivityItemStream,
        ActivityItemStreamType,
        ActivityItemErrorMessage,
        ActivityItemOutputHtml,
        ActivityItemOutputMessage,
        ActivityItemOutputPlot,
        ActivityItemPrompt,
        ActivityItemPromptState,
        type ILanguageRuntimeMessageOutputData,
    } from "./classes";
    import type { ConsoleThemeData } from "$lib/monaco/languageSupport";

    // Per-session data storage
    interface SessionData {
        runtimeItems: RuntimeItem[];
        runtimeItemActivities: Map<string, RuntimeItemActivity>;
        runtimeItemsMarker: number;
        executeScrollMarker: number;
        hydrated: boolean;
    }

    interface RuntimeStartupEvent {
        runtimeName: string;
        languageName: string;
        base64EncodedIconSvg?: string;
        newSession: boolean;
    }

    interface RuntimeChange {
        kind:
            | "appendRuntimeItem"
            | "appendActivityItem"
            | "replaceActivityOutput"
            | "clearActivityOutput"
            | "updateActivityInputState";
        parentId?: string;
        outputId?: string;
        state?: ActivityItemInputState;
        runtimeItem?: SerializedRuntimeItem;
        activityItem?: SerializedActivityItem;
    }

    type RuntimeActivityItem =
        | ActivityItemInput
        | ActivityItemStream
        | ActivityItemErrorMessage
        | ActivityItemOutputHtml
        | ActivityItemOutputMessage
        | ActivityItemOutputPlot
        | ActivityItemPrompt;

    interface ConsoleInputCommandEnvelope {
        sessionId: string;
        command: ConsoleInputCommand;
        nonce: number;
    }

    // Constants (matching Positron)
    const ACTION_BAR_HEIGHT = 28;
    const MINIMUM_CONSOLE_TAB_LIST_WIDTH = 64;
    const MAXIMUM_CONSOLE_TAB_LIST_WIDTH = 200; // Cap at 200px
    const MINIMUM_CONSOLE_PANE_WIDTH = 120;
    const MAX_RESOURCE_USAGE_HISTORY = 600;
    const DEFAULT_SCROLLBACK_SIZE = 1000;
    const DEFAULT_CONSOLE_FONT_SIZE = 14;
    const DEFAULT_CONSOLE_LINE_HEIGHT = 1.4;
    const DEFAULT_CONSOLE_FONT_FAMILY = "var(--vscode-editor-font-family)";
    // State
    let connection = $state<MessageConnection | undefined>();
    let sessions = $state<SessionInfo[]>([]);
    let activeConsoleSessionId = $state<string | undefined>();
    let pendingForegroundSessionId = $state<string | undefined>();
    let sessionDataMap = $state(new Map<string, SessionData>());
    const sessionSyncSeqMap = new Map<string, number>();
    const pendingFullStateRequests = new Set<string>();
    let inputCommand = $state<ConsoleInputCommandEnvelope | undefined>(
        undefined,
    );
    let inputCommandCounter = 0;
    let inputAnchorBySession = $state(new Map<string, HTMLDivElement>());
    let inputAnchorVersion = $state(0);
    let scrollLockedBySession = $state(new Map<string, boolean>());
    let sessionSwitchNonce = 0;
    let revealRequest = $state<
        { sessionId: string; executionId: string; nonce: number } | undefined
    >(undefined);

    // Layout state
    let containerWidth = $state(800);
    let containerHeight = $state(600);
    let consolePaneWidth = $state(0);
    let consoleTabListWidth = $state(0);
    let consoleSessionListCollapsed = $state(false);

    // ActionBar state
    let workingDirectoryBySession = $state(new Map<string, string>());
    const currentWorkingDirectory = $derived(
        activeConsoleSessionId
            ? (workingDirectoryBySession.get(activeConsoleSessionId) ?? "")
            : "",
    );
    let promptBySession = $state(
        new Map<string, { inputPrompt: string; continuationPrompt: string }>(),
    );
    let wordWrapBySession = $state(new Map<string, boolean>());
    let traceBySession = $state(new Map<string, boolean>());
    let resourceUsageBySession = $state(new Map<string, ResourceUsage[]>());
    let languageAssetsVersion = $state(0);

    // Console width state (Positron pattern: dynamic width adjustment)
    let consoleWidthInChars = $state(80);
    let charWidth = $state(8); // Cached character width from Monaco, default 8px
    let widthChangeTimer: ReturnType<typeof setTimeout> | undefined;
    let scrollbackSize = $state(DEFAULT_SCROLLBACK_SIZE);
    let consoleSettings = $state<ConsoleSettings>({
        scrollbackSize: DEFAULT_SCROLLBACK_SIZE,
        fontFamily: DEFAULT_CONSOLE_FONT_FAMILY,
        fontSize: DEFAULT_CONSOLE_FONT_SIZE,
        lineHeight: DEFAULT_CONSOLE_LINE_HEIGHT,
    });
    let consoleThemeData = $state<ConsoleThemeData | undefined>(undefined);
    // When true (default), permanently delete data beyond scrollback limit to free memory
    let clearScrollbackData = $state(true);
    let runtimeStartupPhase = $state<RuntimeStartupPhase>("initializing");
    let discoveredRuntimeCount = $state(0);
    let runtimeStartupEvent = $state<RuntimeStartupEvent | undefined>(
        undefined,
    );
    let openSearchRequest = $state<
        { sessionId: string; nonce: number } | undefined
    >(undefined);
    let openSearchCounter = 0;

    // Refs
    let mainContainer: HTMLDivElement;

    // ID generation
    let nextId = 0;
    function generateId(): string {
        return `fragment-${Date.now()}-${nextId++}`;
    }

    /**
     * Handle character width change from Monaco Editor (Positron pattern)
     * Monaco provides accurate font metrics via fontInfo.spaceWidth
     */
    function handleCharWidthChanged(newCharWidth: number) {
        if (newCharWidth > 0 && newCharWidth !== charWidth) {
            charWidth = newCharWidth;
            // Note: ConsoleInstance will handle the width calculation now
        }
    }

    /**
     * Handle width in characters change from ConsoleInstance (Positron pattern)
     * Width is derived from the visible console viewport, not the input widget.
     */
    function handleWidthInCharsChanged(
        sessionId: string,
        newWidthInChars: number,
    ) {
        if (newWidthInChars !== consoleWidthInChars) {
            consoleWidthInChars = newWidthInChars;
            debouncedSendWidthChange(sessionId, newWidthInChars);
        }
    }

    /**
     * Send width change to extension with debouncing (Positron pattern)
     */
    function debouncedSendWidthChange(sessionId: string, newWidth: number) {
        if (widthChangeTimer) {
            clearTimeout(widthChangeTimer);
        }
        widthChangeTimer = setTimeout(() => {
            connection?.sendNotification("console/setWidthInChars", {
                widthInChars: newWidth,
                sessionId: sessionId,
            });
        }, 200);
    }

    function replaceLanguageSupportAssets(
        params:
            | {
                  modules?: Record<string, string>;
                  grammars?: Record<
                      string,
                      { scopeName: string; grammarUrl: string }
                  >;
              }
            | undefined,
    ) {
        globalThis.__arkLanguageMonacoSupportModules = {
            ...(params?.modules ?? {}),
        };
        globalThis.__arkLanguageTextMateGrammars = {
            ...(params?.grammars ?? {}),
        };
        languageAssetsVersion += 1;
    }

    // Get the foreground console session.
    function getActiveConsoleSession(): SessionInfo | undefined {
        return sessions.find((session) => session.id === activeConsoleSessionId);
    }

    function resolveForegroundConsoleSessionId(
        nextSessions: SessionInfo[],
        requestedForegroundSessionId?: string,
        previousForegroundSessionId?: string,
    ): string | undefined {
        if (nextSessions.length === 0) {
            return undefined;
        }

        if (
            previousForegroundSessionId &&
            nextSessions.some(
                (session) => session.id === previousForegroundSessionId,
            )
        ) {
            return previousForegroundSessionId;
        }

        if (
            requestedForegroundSessionId &&
            nextSessions.some(
                (session) => session.id === requestedForegroundSessionId,
            )
        ) {
            return requestedForegroundSessionId;
        }

        return nextSessions[0]?.id;
    }

    function pruneRemovedSessions(nextSessions: SessionInfo[]): void {
        const remainingSessionIds = new Set(
            nextSessions.map((session) => session.id),
        );

        for (const sessionId of [...sessionDataMap.keys()]) {
            if (!remainingSessionIds.has(sessionId)) {
                sessionDataMap.delete(sessionId);
                sessionSyncSeqMap.delete(sessionId);
                pendingFullStateRequests.delete(sessionId);
            }
        }
        sessionDataMap = new Map(sessionDataMap);

        for (const sessionId of [...promptBySession.keys()]) {
            if (!remainingSessionIds.has(sessionId)) {
                promptBySession.delete(sessionId);
            }
        }
        promptBySession = new Map(promptBySession);

        for (const sessionId of [...wordWrapBySession.keys()]) {
            if (!remainingSessionIds.has(sessionId)) {
                wordWrapBySession.delete(sessionId);
            }
        }
        wordWrapBySession = new Map(wordWrapBySession);

        for (const sessionId of [...traceBySession.keys()]) {
            if (!remainingSessionIds.has(sessionId)) {
                traceBySession.delete(sessionId);
            }
        }
        traceBySession = new Map(traceBySession);

        for (const sessionId of [...resourceUsageBySession.keys()]) {
            if (!remainingSessionIds.has(sessionId)) {
                resourceUsageBySession.delete(sessionId);
            }
        }
        resourceUsageBySession = new Map(resourceUsageBySession);

        for (const sessionId of [...workingDirectoryBySession.keys()]) {
            if (!remainingSessionIds.has(sessionId)) {
                workingDirectoryBySession.delete(sessionId);
            }
        }
        workingDirectoryBySession = new Map(workingDirectoryBySession);

        for (const sessionId of [...inputAnchorBySession.keys()]) {
            if (!remainingSessionIds.has(sessionId)) {
                inputAnchorBySession.delete(sessionId);
            }
        }
        inputAnchorBySession = new Map(inputAnchorBySession);
        inputAnchorVersion += 1;

        for (const sessionId of [...scrollLockedBySession.keys()]) {
            if (!remainingSessionIds.has(sessionId)) {
                scrollLockedBySession.delete(sessionId);
            }
        }
        scrollLockedBySession = new Map(scrollLockedBySession);

        if (
            pendingForegroundSessionId &&
            !remainingSessionIds.has(pendingForegroundSessionId)
        ) {
            pendingForegroundSessionId = undefined;
        }
    }

    function requestFullState(sessionId: string, reason: string): void {
        if (!connection || pendingFullStateRequests.has(sessionId)) {
            return;
        }

        pendingFullStateRequests.add(sessionId);
        void connection
            .sendRequest("console/requestFullState", { sessionId, reason })
            .catch((error) => {
                pendingFullStateRequests.delete(sessionId);
                console.error(
                    `[Console Sync] Failed to request full state for ${sessionId}`,
                    error,
                );
            });
    }

    function mergeIncomingSession(
        nextSession: SessionInfo,
        existingSession?: SessionInfo,
    ): SessionInfo {
        ensureSessionData(nextSession.id);

        return {
            ...existingSession,
            ...nextSession,
        };
    }

    function mergeSessionSnapshot(nextSessions: SessionInfo[]): SessionInfo[] {
        const existingById = new Map(
            sessions.map((session) => [session.id, session]),
        );
        return nextSessions.map((session) =>
            mergeIncomingSession(session, existingById.get(session.id)),
        );
    }

    function applySessionSnapshot(nextSessions: SessionInfo[]): SessionInfo[] {
        const previousCount = sessions.length;
        const mergedSessions = mergeSessionSnapshot(nextSessions);
        sessions = mergedSessions;

        if (mergedSessions.length !== previousCount) {
            updateLayout();
        }

        return mergedSessions;
    }

    function syncForegroundConsoleSession(
        nextSessions: SessionInfo[],
        requestedForegroundSessionId?: string,
    ): void {
        const previousForegroundSessionId = activeConsoleSessionId;
        const hasPendingForegroundSession =
            pendingForegroundSessionId &&
            nextSessions.some(
                (session) => session.id === pendingForegroundSessionId,
            );

        if (pendingForegroundSessionId && hasPendingForegroundSession) {
            activeConsoleSessionId = pendingForegroundSessionId;

            if (
                requestedForegroundSessionId === pendingForegroundSessionId
            ) {
                pendingForegroundSessionId = undefined;
            }
            return;
        }

        if (pendingForegroundSessionId && !hasPendingForegroundSession) {
            pendingForegroundSessionId = undefined;
        }

        activeConsoleSessionId = resolveForegroundConsoleSessionId(
            nextSessions,
            requestedForegroundSessionId,
            previousForegroundSessionId,
        );
    }

    function upsertSession(nextSession: SessionInfo): SessionInfo[] {
        const existingIndex = sessions.findIndex(
            (session) => session.id === nextSession.id,
        );
        const mergedSession = mergeIncomingSession(
            nextSession,
            existingIndex >= 0 ? sessions[existingIndex] : undefined,
        );

        if (existingIndex >= 0) {
            sessions = sessions.map((session, index) =>
                index === existingIndex ? mergedSession : session,
            );
            return sessions;
        }

        sessions = [...sessions, mergedSession];
        updateLayout();
        return sessions;
    }

    function stateLabelForSession(session: SessionInfo | undefined): string {
        if (!session) {
            return "";
        }

        switch (session.state) {
            case "starting":
                return "Starting";
            case "restarting":
                return "Restarting";
            case "interrupting":
                return "Interrupting";
            case "exiting":
                return "Shutting down";
            case "offline":
                return "Reconnecting";
            default:
                return "";
        }
    }

    function canShutdownSession(session: SessionInfo | undefined): boolean {
        if (!session) {
            return false;
        }

        return (
            session.state === "ready" ||
            session.state === "busy" ||
            session.state === "interrupting"
        );
    }

    function canStartSession(session: SessionInfo | undefined): boolean {
        if (!session) {
            return false;
        }

        return (
            session.state === "exited" || session.state === "uninitialized"
        );
    }

    // Get session data (returns empty data if not exists - DO NOT MUTATE during render)
    function getSessionData(sessionId: string): SessionData {
        let data = sessionDataMap.get(sessionId);
        if (!data) {
            // Return empty data without mutating state (to avoid state_unsafe_mutation)
            return {
                runtimeItems: [],
                runtimeItemActivities: new Map(),
                runtimeItemsMarker: 0,
                executeScrollMarker: 0,
                hydrated: false,
            };
        }
        return data;
    }

    // Ensure session data exists (call from event handlers, NOT during render)
    function ensureSessionData(sessionId: string): void {
        if (!sessionDataMap.has(sessionId)) {
            sessionDataMap.set(sessionId, {
                runtimeItems: [],
                runtimeItemActivities: new Map(),
                runtimeItemsMarker: 0,
                executeScrollMarker: 0,
                hydrated: false,
            });
            sessionDataMap = new Map(sessionDataMap); // Trigger reactivity
        }

        // Seed per-session state maps
        if (!promptBySession.has(sessionId)) {
            promptBySession.set(sessionId, {
                inputPrompt: ">",
                continuationPrompt: "+",
            });
            promptBySession = new Map(promptBySession);
        }
        if (!wordWrapBySession.has(sessionId)) {
            wordWrapBySession.set(sessionId, true);
            wordWrapBySession = new Map(wordWrapBySession);
        }
        if (!traceBySession.has(sessionId)) {
            traceBySession.set(sessionId, false);
            traceBySession = new Map(traceBySession);
        }
        if (!resourceUsageBySession.has(sessionId)) {
            resourceUsageBySession.set(sessionId, []);
            resourceUsageBySession = new Map(resourceUsageBySession);
        }
    }

    function normalizeScrollbackSize(value?: number): number {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return DEFAULT_SCROLLBACK_SIZE;
        }
        return Math.max(0, Math.trunc(value));
    }

    function applyScrollbackSize(value?: number): void {
        const normalized = normalizeScrollbackSize(value);
        if (normalized === scrollbackSize) {
            return;
        }
        scrollbackSize = normalized;
        optimizeScrollbackForAllSessions();
    }

    function normalizeConsoleFontFamily(value?: string): string {
        const trimmed = value?.trim();
        return trimmed ? trimmed : DEFAULT_CONSOLE_FONT_FAMILY;
    }

    function normalizeConsoleFontSize(value?: number): number {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return DEFAULT_CONSOLE_FONT_SIZE;
        }
        return Math.min(32, Math.max(8, value));
    }

    function normalizeConsoleLineHeight(value?: number): number {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return DEFAULT_CONSOLE_LINE_HEIGHT;
        }
        return Math.min(3, Math.max(1, value));
    }

    function applyConsoleSettings(
        nextSettings: Partial<ConsoleSettings> | undefined,
    ): void {
        const normalizedScrollbackSize = normalizeScrollbackSize(
            nextSettings?.scrollbackSize ?? consoleSettings.scrollbackSize,
        );
        const normalizedFontFamily = normalizeConsoleFontFamily(
            nextSettings?.fontFamily ?? consoleSettings.fontFamily,
        );
        const normalizedFontSize = normalizeConsoleFontSize(
            nextSettings?.fontSize ?? consoleSettings.fontSize,
        );
        const normalizedLineHeight = normalizeConsoleLineHeight(
            nextSettings?.lineHeight ?? consoleSettings.lineHeight,
        );

        applyScrollbackSize(normalizedScrollbackSize);

        if (
            consoleSettings.scrollbackSize === normalizedScrollbackSize &&
            consoleSettings.fontFamily === normalizedFontFamily &&
            consoleSettings.fontSize === normalizedFontSize &&
            consoleSettings.lineHeight === normalizedLineHeight
        ) {
            return;
        }

        consoleSettings = {
            scrollbackSize: normalizedScrollbackSize,
            fontFamily: normalizedFontFamily,
            fontSize: normalizedFontSize,
            lineHeight: normalizedLineHeight,
        };
    }

    function optimizeScrollbackForSession(sessionId: string): void {
        const data = getSessionData(sessionId);
        let remaining = scrollbackSize;
        for (let i = data.runtimeItems.length - 1; i >= 0; i--) {
            remaining = data.runtimeItems[i].optimizeScrollback(
                remaining,
                clearScrollbackData,
            );
        }
    }

    function optimizeScrollbackForAllSessions(): void {
        for (const [sessionId, data] of sessionDataMap) {
            optimizeScrollbackForSession(sessionId);
            data.runtimeItems = [...data.runtimeItems];
        }
        sessionDataMap = new Map(sessionDataMap);
    }

    function signalCodeExecuted(sessionId: string): void {
        const data = sessionDataMap.get(sessionId);
        if (!data) {
            return;
        }

        data.executeScrollMarker += 1;
        sessionDataMap = new Map(sessionDataMap);
    }

    function requestOpenSearch(sessionId: string): void {
        if (sessionId !== activeConsoleSessionId) {
            handleSetForegroundSession(sessionId);
        }

        openSearchRequest = {
            sessionId,
            nonce: ++openSearchCounter,
        };
    }

    function getPrompt(sessionId: string): {
        inputPrompt: string;
        continuationPrompt: string;
    } {
        return (
            promptBySession.get(sessionId) || {
                inputPrompt: ">",
                continuationPrompt: "+",
            }
        );
    }

    function getScrollLocked(sessionId: string): boolean {
        return scrollLockedBySession.get(sessionId) ?? false;
    }

    function handleScrollLockChanged(
        sessionId: string,
        nextScrollLocked: boolean,
    ): void {
        const previous = scrollLockedBySession.get(sessionId);
        if (previous === nextScrollLocked) {
            return;
        }

        scrollLockedBySession.set(sessionId, nextScrollLocked);
        scrollLockedBySession = new Map(scrollLockedBySession);
    }

    function getWordWrap(sessionId: string): boolean {
        return wordWrapBySession.get(sessionId) ?? true;
    }

    function setWordWrap(sessionId: string, enabled: boolean): void {
        wordWrapBySession.set(sessionId, enabled);
        wordWrapBySession = new Map(wordWrapBySession);
    }

    function getTraceEnabled(sessionId?: string): boolean {
        if (!sessionId) return false;
        return traceBySession.get(sessionId) ?? false;
    }

    function setTraceEnabled(sessionId: string, enabled: boolean): void {
        traceBySession.set(sessionId, enabled);
        traceBySession = new Map(traceBySession);
    }

    function pushResourceUsage(sessionId: string, usage: ResourceUsage): void {
        const history = resourceUsageBySession.get(sessionId) || [];
        const updated = [...history, usage];
        if (updated.length > MAX_RESOURCE_USAGE_HISTORY) {
            updated.splice(0, updated.length - MAX_RESOURCE_USAGE_HISTORY);
        }
        resourceUsageBySession.set(sessionId, updated);
        resourceUsageBySession = new Map(resourceUsageBySession);
    }

    function emitInputCommand(
        sessionId: string,
        command: ConsoleInputCommand,
    ): void {
        inputCommand = {
            sessionId,
            command,
            nonce: ++inputCommandCounter,
        };
    }

    function escapeCssAttributeValue(value: string): string {
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
            return CSS.escape(value);
        }
        return value.replace(/["\\]/g, "\\$&");
    }

    function findPromptInput(sessionId: string): HTMLInputElement | undefined {
        if (!mainContainer) {
            return undefined;
        }

        const escapedSessionId = escapeCssAttributeValue(sessionId);
        const selector = `.activity-prompt[data-session-id="${escapedSessionId}"][data-prompt-state="${ActivityItemPromptState.Unanswered}"] .prompt-input`;
        const promptInput = mainContainer.querySelector(selector);
        return promptInput instanceof HTMLInputElement ? promptInput : undefined;
    }

    function focusPromptInput(sessionId: string): boolean {
        const promptInput = findPromptInput(sessionId);
        if (!promptInput) {
            return false;
        }

        promptInput.focus();
        return true;
    }

    function insertPromptText(sessionId: string, text: string): boolean {
        const promptInput = findPromptInput(sessionId);
        if (!promptInput) {
            return false;
        }

        const normalizedText = text.replace(/[\r\n]+/g, " ");
        promptInput.focus();

        const selectionStart = promptInput.selectionStart ?? promptInput.value.length;
        const selectionEnd = promptInput.selectionEnd ?? promptInput.value.length;
        promptInput.setRangeText(
            normalizedText,
            selectionStart,
            selectionEnd,
            "end",
        );
        promptInput.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    }

    function requestInputFocus(sessionId: string): void {
        const focusPreferredInput = () => {
            if (focusPromptInput(sessionId)) {
                return;
            }
            emitInputCommand(sessionId, { kind: "focus" });
        };

        if (sessionId !== activeConsoleSessionId) {
            handleSetForegroundSession(sessionId);
            requestAnimationFrame(() => {
                focusPreferredInput();
            });
            return;
        }

        focusPreferredInput();
    }

    function queueInsertText(sessionId: string, text: string): void {
        if (!text.length) {
            return;
        }

        if (insertPromptText(sessionId, text)) {
            return;
        }

        if (sessionId !== activeConsoleSessionId) {
            handleSetForegroundSession(sessionId);
        }
        emitInputCommand(sessionId, { kind: "insertText", text });
    }

    function queuePastedInput(sessionId: string, text: string): void {
        if (!text.length) {
            requestInputFocus(sessionId);
            return;
        }

        if (insertPromptText(sessionId, text)) {
            return;
        }

        if (sessionId !== activeConsoleSessionId) {
            handleSetForegroundSession(sessionId);
        }
        emitInputCommand(sessionId, { kind: "paste", text });
    }

    function handleInputAnchorReady(
        sessionId: string,
        anchor: HTMLDivElement | null,
    ): void {
        if (anchor) {
            inputAnchorBySession.set(sessionId, anchor);
        } else {
            inputAnchorBySession.delete(sessionId);
        }

        inputAnchorBySession = new Map(inputAnchorBySession);
        inputAnchorVersion += 1;
    }

    function getInputAnchor(sessionId: string): HTMLDivElement | undefined {
        return inputAnchorBySession.get(sessionId);
    }

    function selectPlot(outputId?: string): void {
        if (!outputId || !connection) {
            return;
        }
        void connection.sendRequest("plots/select", {
            plotId: outputId,
        });
    }

    function applySessionMetadataUpdate(
        sessionId: string,
        metadata: {
            trace?: boolean;
            wordWrap?: boolean;
            inputPrompt?: string;
            continuationPrompt?: string;
            workingDirectory?: string | null;
        },
    ): void {
        ensureSessionData(sessionId);

        if (typeof metadata.trace === "boolean") {
            setTraceEnabled(sessionId, metadata.trace);
        }
        if (typeof metadata.wordWrap === "boolean") {
            setWordWrap(sessionId, metadata.wordWrap);
        }
        if (
            typeof metadata.inputPrompt === "string" ||
            typeof metadata.continuationPrompt === "string"
        ) {
            const previousPrompt = getPrompt(sessionId);
            promptBySession.set(sessionId, {
                inputPrompt:
                    typeof metadata.inputPrompt === "string" &&
                    metadata.inputPrompt.trimEnd().length > 0
                        ? metadata.inputPrompt
                        : previousPrompt.inputPrompt,
                continuationPrompt:
                    typeof metadata.continuationPrompt === "string" &&
                    metadata.continuationPrompt.trimEnd().length > 0
                        ? metadata.continuationPrompt
                        : previousPrompt.continuationPrompt,
            });
            promptBySession = new Map(promptBySession);
        }
        if ("workingDirectory" in metadata) {
            if (typeof metadata.workingDirectory === "string") {
                workingDirectoryBySession.set(
                    sessionId,
                    metadata.workingDirectory,
                );
            } else {
                workingDirectoryBySession.delete(sessionId);
            }
            workingDirectoryBySession = new Map(workingDirectoryBySession);
        }
    }

    function syncSessionRuntimeItems(sessionId: string): void {
        const data = getSessionData(sessionId);
        optimizeScrollbackForSession(sessionId);
        data.runtimeItems = [...data.runtimeItems];
        data.runtimeItemsMarker += 1;
        sessionDataMap = new Map(sessionDataMap);
    }

    function deserializeActivityItem(
        item: SerializedActivityItem,
        sessionId?: string,
    ):
        | ActivityItemInput
        | ActivityItemStream
        | ActivityItemErrorMessage
        | ActivityItemOutputHtml
        | ActivityItemOutputMessage
        | ActivityItemOutputPlot
        | ActivityItemPrompt
        | undefined {
        switch (item.type) {
            case "input":
                return new ActivityItemInput(
                    item.id,
                    item.parentId,
                    new Date(item.when),
                    item.state as ActivityItemInputState,
                    item.inputPrompt,
                    item.continuationPrompt,
                    item.code,
                );
            case "stream":
                return new ActivityItemStream(
                    item.id,
                    item.parentId,
                    new Date(item.when),
                    item.streamType as ActivityItemStreamType,
                    item.text,
                );
            case "error":
                return new ActivityItemErrorMessage(
                    item.id,
                    item.parentId,
                    new Date(item.when),
                    item.name,
                    item.message,
                    item.traceback ?? [],
                );
            case "outputHtml":
                return new ActivityItemOutputHtml(
                    item.id,
                    item.parentId,
                    new Date(item.when),
                    item.html,
                    item.resource,
                    item.outputId as string | undefined,
                );
            case "output":
                return new ActivityItemOutputMessage(
                    item.id,
                    item.parentId,
                    new Date(item.when),
                    item.data as ILanguageRuntimeMessageOutputData,
                    item.outputId as string | undefined,
                );
            case "outputPlot":
                return new ActivityItemOutputPlot(
                    item.id,
                    item.parentId,
                    new Date(item.when),
                    item.data as ILanguageRuntimeMessageOutputData,
                    () => selectPlot(item.outputId as string | undefined),
                    item.outputId as string | undefined,
                );
            case "prompt":
                {
                    const promptItem = new ActivityItemPrompt(
                        item.id,
                        item.parentId,
                        new Date(item.when),
                        item.prompt,
                        item.password,
                        sessionId,
                    );
                    const promptState = deserializePromptState(
                        item.state as string | undefined,
                    );
                    if (promptState) {
                        promptItem.state = promptState;
                    }
                    if (typeof item.answer === "string") {
                        promptItem.answer = item.answer;
                    }
                    return promptItem;
                }
        }

        return undefined;
    }

    function deserializeRuntimeItem(
        item: SerializedRuntimeItem,
        sessionId: string,
    ): { runtimeItem: RuntimeItem; activity?: RuntimeItemActivity } | undefined {
        switch (item.type) {
            case "activity": {
                const activityItems = (item.items ?? [])
                    .map((entry: SerializedActivityItem) =>
                        deserializeActivityItem(entry, sessionId),
                    )
                    .filter(
                        (
                            entry: ReturnType<typeof deserializeActivityItem>,
                        ): entry is RuntimeActivityItem => entry !== undefined,
                    );

                if (activityItems.length === 0) {
                    return undefined;
                }

                const activity = new RuntimeItemActivity(
                    item.parentId,
                    activityItems[0],
                );
                for (let i = 1; i < activityItems.length; i++) {
                    activity.addActivityItem(activityItems[i]);
                }

                return {
                    runtimeItem: activity,
                    activity,
                };
            }
            case "started":
                return {
                    runtimeItem: new RuntimeItemStarted(
                        item.id,
                        `${item.sessionName} started.`,
                    ),
                };
            case "restarted":
                return {
                    runtimeItem: new RuntimeItemStarted(
                        item.id,
                        `${item.sessionName} restarted.`,
                    ),
                };
            case "startup":
                return {
                    runtimeItem: new RuntimeItemStartup(item.id, item.banner),
                };
            case "startupFailure":
                return {
                    runtimeItem: new RuntimeItemStartupFailure(
                        item.id,
                        (item.message as string | undefined) ??
                            "Runtime failed to start.",
                        (item.details as string | undefined) ?? "",
                    ),
                };
            case "exited": {
                const fallbackSessionName =
                    sessions.find((session) => session.id === sessionId)
                        ?.runtimeName ??
                    sessions.find((session) => session.id === sessionId)?.name ??
                    "R";
                return {
                    runtimeItem: new RuntimeItemExited(
                        item.id,
                        (item.sessionName as string | undefined) ??
                            fallbackSessionName,
                        (item.exitCode as number | undefined) ?? 0,
                        (item.reason as string | undefined) ?? "",
                    ),
                };
            }
            case "offline":
                return {
                    runtimeItem: new RuntimeItemOffline(
                        item.id,
                        item.sessionName,
                        item.reason,
                    ),
                };
            case "pendingInput":
                return {
                    runtimeItem: new RuntimeItemPendingInput(
                        item.id,
                        item.inputPrompt ?? item.prompt ?? ">",
                        item.code ?? "",
                    ),
                };
            case "trace":
                return {
                    runtimeItem: new RuntimeItemTrace(
                        item.id,
                        item.trace,
                        new Date(item.when),
                    ),
                };
            case "starting":
                return {
                    runtimeItem: new RuntimeItemStarting(
                        item.id,
                        (item.message as string | undefined) ??
                            `${sessions.find((session) => session.id === sessionId)?.runtimeName ?? "R"} starting.`,
                        (item.attachMode as
                            | "starting"
                            | "restarting"
                            | "switching"
                            | "reconnecting"
                            | "connected"
                            | undefined) ?? "starting",
                    ),
                };
            case "reconnected":
                return {
                    runtimeItem: new RuntimeItemReconnected(
                        item.id,
                        `${item.sessionName} reconnected.`,
                    ),
                };
            default:
                return undefined;
        }
    }

    function appendRuntimeItem(
        sessionId: string,
        item: SerializedRuntimeItem,
        sync: boolean = true,
    ): boolean {
        ensureSessionData(sessionId);
        const data = getSessionData(sessionId);
        const deserialized = deserializeRuntimeItem(item, sessionId);
        if (!deserialized) {
            return false;
        }

        if (deserialized.activity) {
            data.runtimeItemActivities.set(
                deserialized.runtimeItem.id,
                deserialized.activity,
            );
        }
        data.runtimeItems.push(deserialized.runtimeItem);
        if (sync) {
            syncSessionRuntimeItems(sessionId);
        }
        return true;
    }

    function updatePendingRuntimeItem(
        sessionId: string,
        code?: string,
        inputPrompt: string = ">",
    ): void {
        ensureSessionData(sessionId);
        const data = getSessionData(sessionId);
        const existingPendingItems = data.runtimeItems.filter(
            (item): item is RuntimeItemPendingInput =>
                item instanceof RuntimeItemPendingInput,
        );
        if (!code && existingPendingItems.length === 0) {
            return;
        }
        const pendingId = existingPendingItems[0]?.id ?? generateId();

        data.runtimeItems = data.runtimeItems.filter(
            (item) => !(item instanceof RuntimeItemPendingInput),
        );

        if (code) {
            data.runtimeItems.push(
                new RuntimeItemPendingInput(pendingId, inputPrompt, code),
            );
        }

        syncSessionRuntimeItems(sessionId);
    }

    function appendActivityItem(
        sessionId: string,
        parentId: string,
        item: SerializedActivityItem,
        sync: boolean = true,
    ): boolean {
        ensureSessionData(sessionId);
        const data = getSessionData(sessionId);
        const activityItem = deserializeActivityItem(item, sessionId);
        if (!activityItem) {
            return false;
        }

        let activity = data.runtimeItemActivities.get(parentId);
        if (!activity) {
            activity = new RuntimeItemActivity(parentId, activityItem);
            data.runtimeItemActivities.set(parentId, activity);
            data.runtimeItems.push(activity);
        } else {
            activity.addActivityItem(activityItem);
        }

        if (sync) {
            syncSessionRuntimeItems(sessionId);
        }
        return true;
    }

    function replaceActivityOutput(
        sessionId: string,
        parentId: string,
        outputId: string,
        item: SerializedActivityItem,
        sync: boolean = true,
    ): boolean {
        ensureSessionData(sessionId);
        const data = getSessionData(sessionId);
        const activity = data.runtimeItemActivities.get(parentId);
        const activityItem = deserializeActivityItem(item, sessionId);
        if (
            !activity ||
            !activityItem ||
            !(
                activityItem instanceof ActivityItemOutputHtml ||
                activityItem instanceof ActivityItemOutputMessage ||
                activityItem instanceof ActivityItemOutputPlot
            )
        ) {
            return appendActivityItem(sessionId, parentId, item, sync);
        }

        if (!activity.replaceOutputItemByOutputId(outputId, activityItem)) {
            activity.addActivityItem(activityItem);
        }

        if (sync) {
            syncSessionRuntimeItems(sessionId);
        }
        return true;
    }

    function clearActivityOutput(
        sessionId: string,
        parentId: string,
        sync: boolean = true,
    ): boolean {
        ensureSessionData(sessionId);
        const activity = getSessionData(sessionId).runtimeItemActivities.get(
            parentId,
        );
        if (!activity) {
            return false;
        }

        activity.clearOutputItems();
        if (sync) {
            syncSessionRuntimeItems(sessionId);
        }
        return true;
    }

    function updateActivityInputState(
        sessionId: string,
        parentId: string,
        state: ActivityItemInputState,
        sync: boolean = true,
    ): boolean {
        ensureSessionData(sessionId);
        const activity = getSessionData(sessionId).runtimeItemActivities.get(
            parentId,
        );
        if (!activity) {
            return false;
        }

        for (const item of activity.activityItems) {
            if (item instanceof ActivityItemInput) {
                item.state = state;
                break;
            }
        }

        if (sync) {
            syncSessionRuntimeItems(sessionId);
        }
        return true;
    }

    function applyRuntimeChanges(
        sessionId: string,
        changes: RuntimeChange[],
    ): void {
        if (!changes.length) {
            return;
        }

        ensureSessionData(sessionId);
        getSessionData(sessionId).hydrated = true;

        let changed = false;
        for (const change of changes) {
            switch (change.kind) {
                case "appendRuntimeItem":
                    changed =
                        appendRuntimeItem(
                            sessionId,
                            change.runtimeItem as SerializedRuntimeItem,
                            false,
                        ) || changed;
                    break;
                case "appendActivityItem":
                    changed =
                        appendActivityItem(
                            sessionId,
                            change.parentId as string,
                            change.activityItem as SerializedActivityItem,
                            false,
                        ) || changed;
                    break;
                case "replaceActivityOutput":
                    changed =
                        replaceActivityOutput(
                            sessionId,
                            change.parentId as string,
                            change.outputId as string,
                            change.activityItem as SerializedActivityItem,
                            false,
                        ) || changed;
                    break;
                case "clearActivityOutput":
                    changed =
                        clearActivityOutput(
                            sessionId,
                            change.parentId as string,
                            false,
                        ) || changed;
                    break;
                case "updateActivityInputState":
                    changed =
                        updateActivityInputState(
                            sessionId,
                            change.parentId as string,
                            change.state as ActivityItemInputState,
                            false,
                        ) || changed;
                    break;
            }
        }

        if (changed) {
            syncSessionRuntimeItems(sessionId);
        }
    }

    function restoreConsoleState(
        sessionId: string,
        state: SerializedConsoleState,
    ): void {
        if (!state || (state.version !== 1 && state.version !== 2)) {
            return;
        }

        ensureSessionData(sessionId);
        const data = getSessionData(sessionId);

        const runtimeItems: RuntimeItem[] = [];
        const runtimeItemActivities = new Map<string, RuntimeItemActivity>();

        for (const item of state.items ?? []) {
            const deserialized = deserializeRuntimeItem(item, sessionId);
            if (!deserialized) {
                continue;
            }

            if (deserialized.activity) {
                runtimeItemActivities.set(
                    deserialized.runtimeItem.id,
                    deserialized.activity,
                );
            }
            runtimeItems.push(deserialized.runtimeItem);
        }

        data.runtimeItems = runtimeItems;
        data.runtimeItemActivities = runtimeItemActivities;
        data.hydrated = true;
        applySessionMetadataUpdate(sessionId, state);

        const historyEntries = state.inputHistory ?? [];
        const entries = historyEntries.map((input) => ({ input }));
        setTimeout(() => {
            emitInputCommand(sessionId, {
                kind: "historySet",
                entries,
            });
        }, 0);
        syncSessionRuntimeItems(sessionId);
    }

    onMount(() => {
        connection = getRpcConnection();

        // Note: charWidth will be updated from Monaco Editor via handleCharWidthChanged
        // No need to measure manually - Monaco provides accurate font metrics

        // Initialize layout
        updateLayout();

        // Observe container size
        const resizeObserver = new ResizeObserver(() => {
            updateLayout();
        });
        if (mainContainer) {
            resizeObserver.observe(mainContainer);
        }

        // Listen for reveal execution requests
        connection.onNotification(
            "console/revealExecution",
            (params: { executionId: string; sessionId?: string }) => {
                const sessionId = params.sessionId;
                if (!sessionId) {
                    console.warn(
                        "[Console] Dropping revealExecution without sessionId",
                    );
                    return;
                }

                revealRequest = {
                    sessionId,
                    executionId: params.executionId,
                    nonce: Date.now(),
                };
            },
        );

        // Listen for clear command
        connection.onNotification(
            "console/clear",
            (params?: { sessionId?: string; reason?: "user" | "runtime" }) => {
                const sessionId = params?.sessionId;
                if (!sessionId) {
                    console.warn("[Console] Dropping clear without sessionId");
                    return;
                }

                if (params?.reason === "user") {
                    requestInputFocus(sessionId);
                }
            },
        );

        // Listen for session info updates (backward compatibility)
        connection.onNotification(
            "session/info",
            (params: { sessions: SessionInfo[]; activeSessionId?: string }) => {
                const mergedSessions = applySessionSnapshot(params.sessions);
                pruneRemovedSessions(mergedSessions);
                syncForegroundConsoleSession(
                    mergedSessions,
                    params.activeSessionId,
                );
            },
        );

        // Restore console state after reload (Positron-style)
        connection.onNotification(
            "console/restoreState",
            (params: {
                sessionId: string;
                syncSeq: number;
                state: SerializedConsoleState;
            }) => {
                if (!params.sessionId || !params.state) {
                    return;
                }
                const localSyncSeq =
                    sessionSyncSeqMap.get(params.sessionId) ?? 0;
                if (params.syncSeq < localSyncSeq) {
                    return;
                }
                pendingFullStateRequests.delete(params.sessionId);
                sessionSyncSeqMap.set(params.sessionId, params.syncSeq);
                restoreConsoleState(params.sessionId, params.state);
            },
        );

        connection.onNotification(
            "console/sessionMetadataChanged",
            (params: {
                sessionId: string;
                syncSeq: number;
                trace?: boolean;
                wordWrap?: boolean;
                inputPrompt?: string;
                continuationPrompt?: string;
                workingDirectory?: string | null;
            }) => {
                if (!params.sessionId) {
                    return;
                }
                const localSyncSeq =
                    sessionSyncSeqMap.get(params.sessionId) ?? 0;
                if (params.syncSeq <= localSyncSeq) {
                    return;
                }
                if (params.syncSeq > localSyncSeq + 1) {
                    requestFullState(
                        params.sessionId,
                        `seq gap on metadata: local=${localSyncSeq}, received=${params.syncSeq}`,
                    );
                    return;
                }
                sessionSyncSeqMap.set(params.sessionId, params.syncSeq);
                applySessionMetadataUpdate(params.sessionId, params);
            },
        );

        connection.onNotification(
            "console/runtimeChanges",
            (params: {
                sessionId: string;
                syncSeq: number;
                changes: RuntimeChange[];
            }) => {
                if (!params.sessionId || !params.changes?.length) {
                    return;
                }
                const localSyncSeq =
                    sessionSyncSeqMap.get(params.sessionId) ?? 0;
                if (params.syncSeq <= localSyncSeq) {
                    return;
                }
                if (params.syncSeq > localSyncSeq + 1) {
                    requestFullState(
                        params.sessionId,
                        `seq gap on runtimeChanges: local=${localSyncSeq}, received=${params.syncSeq}`,
                    );
                    return;
                }
                sessionSyncSeqMap.set(params.sessionId, params.syncSeq);
                applyRuntimeChanges(params.sessionId, params.changes);
            },
        );

        // Console input control events (Positron pattern)
        connection.onNotification(
            "console/focusInput",
            (params: { sessionId: string }) => {
                requestInputFocus(params.sessionId);
            },
        );

        connection.onNotification(
            "console/pasteText",
            (params: { sessionId: string; text: string }) => {
                queuePastedInput(params.sessionId, params.text);
            },
        );

        connection.onNotification(
            "console/selectAll",
            (params: { sessionId: string }) => {
                selectAllRuntimeItems(params.sessionId);
            },
        );

        connection.onNotification(
            "console/historyNavigateUp",
            (params: { sessionId: string; usingPrefixMatch: boolean }) => {
                emitInputCommand(params.sessionId, {
                    kind: "historyUp",
                    usingPrefixMatch: params.usingPrefixMatch,
                });
            },
        );

        connection.onNotification(
            "console/historyNavigateDown",
            (params: { sessionId: string }) => {
                emitInputCommand(params.sessionId, { kind: "historyDown" });
            },
        );

        connection.onNotification(
            "console/historyClear",
            (params: { sessionId: string }) => {
                emitInputCommand(params.sessionId, { kind: "historyClear" });
            },
        );

        connection.onNotification(
            "console/setPendingCode",
            (params: { sessionId: string; code?: string }) => {
                emitInputCommand(params.sessionId, {
                    kind: "setPendingCode",
                    code: params.code,
                });
            },
        );

        connection.onNotification(
            "console/pendingInputChanged",
            (params: { sessionId: string; code?: string; inputPrompt: string }) => {
                if (!params.sessionId) {
                    return;
                }
                updatePendingRuntimeItem(
                    params.sessionId,
                    params.code,
                    params.inputPrompt,
                );
            },
        );

        connection.onNotification(
            "console/historyAdd",
            (params: { sessionId: string; input: string; when?: number }) => {
                emitInputCommand(params.sessionId, {
                    kind: "historyAdd",
                    input: params.input,
                    when: params.when,
                });
            },
        );

        connection.onNotification(
            "console/settingsChanged",
            (params: ConsoleSettings) => {
                applyConsoleSettings(params);
            },
        );

        connection.onNotification(
            "console/resourceUsage",
            (params: { sessionId: string; usage: ResourceUsage }) => {
                pushResourceUsage(params.sessionId, params.usage);
            },
        );

        connection.onNotification(
            "console/themeChanged",
            (params: { theme: ConsoleThemeData }) => {
                consoleThemeData = params.theme;
            },
        );

        connection.onNotification(
            "console/languageSupportAssetsChanged",
            (params: {
                modules: Record<string, string>;
                grammars: Record<
                    string,
                    { scopeName: string; grammarUrl: string }
                >;
            }) => {
                replaceLanguageSupportAssets(params);
            },
        );

        connection.onNotification(
            "console/runtimeStartupPhase",
            (params: {
                phase: RuntimeStartupPhase;
                discoveredCount?: number;
                runtimeStartupEvent?: RuntimeStartupEvent;
            }) => {
                runtimeStartupPhase = params.phase;
                discoveredRuntimeCount = params.discoveredCount ?? 0;
                runtimeStartupEvent = params.runtimeStartupEvent;
            },
        );

        // Load initial settings before sessions so Monaco starts with the
        // effective console font instead of a transient fallback.
        connection.sendNotification("console/ready");
        void (async () => {
            await loadConsoleSettings();
            await loadSessions();
        })();

        return () => {
            resizeObserver.disconnect();
        };
    });

    /**
     * Update layout based on container size
     */
    function updateLayout() {
        if (!mainContainer) return;

        const newWidth = mainContainer.clientWidth;
        const newHeight = mainContainer.clientHeight;

        // Skip layout update when container is hidden (switching panels)
        // This prevents corrupted layout when the webview is not visible
        if (newWidth < MINIMUM_CONSOLE_PANE_WIDTH) {
            return;
        }

        // Use 1/5 of width, but cap at MAXIMUM_CONSOLE_TAB_LIST_WIDTH (200px)
        const maxTabWidth = Math.min(
            Math.trunc(newWidth / 5),
            MAXIMUM_CONSOLE_TAB_LIST_WIDTH,
        );

        // Only show tab list when there are multiple sessions
        const shouldShowTabList =
            !consoleSessionListCollapsed && sessions.length > 1;

        if (!shouldShowTabList) {
            // Single session or collapsed: use full width
            consolePaneWidth = newWidth;
            consoleTabListWidth = 0;
        } else if (consolePaneWidth === 0 || consoleTabListWidth === 0) {
            // Initial layout OR transition from single to multi-session
            // Need to allocate space for the tab list
            consoleTabListWidth = maxTabWidth;
            consolePaneWidth = newWidth - maxTabWidth;
        } else {
            // Resize handling (maintaining existing proportions)
            const delta = newWidth - containerWidth;
            if (delta >= 0) {
                consolePaneWidth = newWidth - consoleTabListWidth;
            } else {
                const newPaneWidth = newWidth - consoleTabListWidth;
                if (newPaneWidth >= MINIMUM_CONSOLE_PANE_WIDTH) {
                    consolePaneWidth = newPaneWidth;
                } else {
                    consoleTabListWidth = Math.max(
                        newWidth - consolePaneWidth,
                        MINIMUM_CONSOLE_TAB_LIST_WIDTH,
                    );
                }
            }
        }

        containerWidth = newWidth;
        containerHeight = newHeight;

        // Note: Width in characters calculation is handled by Monaco in ConsoleInput,
        // which measures the actual editor layout width and font metrics.
    }

    /**
     * Handle splitter resize
     */
    function handleBeginResize() {
        return {
            minimumWidth: MINIMUM_CONSOLE_PANE_WIDTH,
            maximumWidth: containerWidth - MINIMUM_CONSOLE_TAB_LIST_WIDTH,
            startingWidth: consolePaneWidth,
        };
    }

    function handleResize(newWidth: number) {
        consolePaneWidth = newWidth;
        consoleTabListWidth = containerWidth - newWidth;
    }

    async function loadConsoleSettings() {
        if (!connection) return;
        try {
            const result = (await connection.sendRequest(
                "console/getSettings",
                {},
            )) as Partial<ConsoleSettings>;
            applyConsoleSettings(result);
        } catch (e) {
            console.error("Failed to load console settings:", e);
        }
    }

    $effect(() => {
        const container = mainContainer;
        const settings = consoleSettings;
        if (!container) {
            return;
        }

        container.style.setProperty(
            "--console-content-font-family",
            settings.fontFamily,
        );
        container.style.setProperty(
            "--console-content-font-size",
            `${settings.fontSize}px`,
        );
        container.style.setProperty(
            "--console-line-height",
            String(settings.lineHeight),
        );
    });

    async function loadSessions() {
        if (!connection) return;
        try {
            const result = await connection.sendRequest("session/list", {});
            const loadedSessions = Array.isArray((result as any).sessions)
                ? ((result as any).sessions as SessionInfo[])
                : [];
            const mergedSessions = applySessionSnapshot(loadedSessions);
            pruneRemovedSessions(mergedSessions);
            syncForegroundConsoleSession(
                mergedSessions,
                (result as any).activeSessionId,
            );
        } catch (e) {
            console.error("Failed to load sessions:", e);
        }
    }

    async function handleStartSession(): Promise<void> {
        if (!connection) {
            return;
        }

        try {
            const result = (await connection.sendRequest("session/create", {
                showRuntimePicker: true,
            })) as { session?: SessionInfo };

            if (result.session) {
                const mergedSessions = upsertSession(result.session);
                syncForegroundConsoleSession(mergedSessions, result.session.id);
            }
        } catch (error) {
            console.error("Failed to create session:", error);
        }
    }

    async function handleExecute(sessionId: string, code: string) {
        if (!connection) return;

        const targetSessionId = sessionId || activeConsoleSessionId;
        if (!targetSessionId) return;

        const executionId = generateId();

        try {
            await connection.sendRequest("console/execute", {
                code,
                executionId,
                sessionId: targetSessionId,
                allowIncomplete: true,
            });
        } catch (error) {
            console.error("Execute error:", error);
        }
    }

    async function handleInterrupt(sessionId?: string) {
        if (!connection) return;
        const targetSessionId = sessionId || activeConsoleSessionId;
        if (!targetSessionId) return;
        try {
            await connection.sendRequest("console/interrupt", {
                sessionId: targetSessionId,
            });
        } catch (e) {
            console.error("Interrupt failed:", e);
        }
    }

    async function handleOpenInEditor(sessionId: string, code?: string) {
        if (!connection) return;

        const targetSessionId = sessionId || activeConsoleSessionId;
        if (!targetSessionId) return;

        try {
            await connection.sendRequest("console/openInEditor", {
                sessionId: targetSessionId,
                code,
            });
        } catch (error) {
            console.error("Open in editor failed:", error);
        }
    }

    async function handleChangeForegroundSession(
        sessionId: string,
        optimistic: boolean = false,
    ) {
        if (!connection) return;

        const previousForegroundSessionId = activeConsoleSessionId;
        const switchNonce = ++sessionSwitchNonce;

        if (optimistic) {
            pendingForegroundSessionId = sessionId;
            activeConsoleSessionId = sessionId;
        }

        try {
            await connection.sendRequest("session/switch", { sessionId });
        } catch (e) {
            if (
                optimistic &&
                sessionSwitchNonce === switchNonce &&
                activeConsoleSessionId === sessionId &&
                pendingForegroundSessionId === sessionId
            ) {
                pendingForegroundSessionId = undefined;
                activeConsoleSessionId = resolveForegroundConsoleSessionId(
                    sessions,
                    previousForegroundSessionId,
                    previousForegroundSessionId,
                );
            }
            console.error("Switch session failed:", e);
        }
    }

    function handleSetForegroundSession(sessionId: string) {
        if (sessionId === activeConsoleSessionId) return;
        void handleChangeForegroundSession(sessionId, true);
    }

    async function handleDeleteSession(sessionId: string) {
        if (!connection) return;
        try {
            await connection.sendRequest("session/stop", { sessionId });
        } catch (e) {
            console.error("Delete session failed:", e);
        }
    }

    async function handleRenameSession(sessionId: string, newName: string) {
        if (!connection) return;
        try {
            await connection.sendRequest("session/rename", {
                sessionId,
                newName,
            });
        } catch (e) {
            console.error("Rename session failed:", e);
        }
    }

    async function restartSession(sessionId: string) {
        if (!connection) return;
        try {
            await connection.sendRequest("session/restart", {
                sessionId,
            });
        } catch (e) {
            console.error("Restart session failed:", e);
        }
    }

    async function restartCurrentSession() {
        if (!activeConsoleSessionId) return;
        await restartSession(activeConsoleSessionId);
    }

    function clearOutput() {
        if (!activeConsoleSessionId) return;
        if (connection) {
            void connection.sendRequest("console/clearConsole", {
                sessionId: activeConsoleSessionId,
            });
        }
    }

    /**
     * Handle clear console from keyboard shortcut (Ctrl+L)
     * Clears the console output for a specific session
     */
    function handleClearConsole(sessionId: string) {
        if (connection) {
            void connection.sendRequest("console/clearConsole", {
                sessionId,
            });
        }
    }

    function selectAllRuntimeItems(sessionId?: string) {
        const targetSessionId = sessionId || activeConsoleSessionId;
        if (!targetSessionId) {
            return;
        }

        const container = document.querySelector(
            `[data-testid="console-${targetSessionId}"] .console-instance-container`,
        );
        if (container) {
            const range = document.createRange();
            range.selectNodeContents(container);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
        }
    }

    // Derived state
    const adjustedHeight = $derived(containerHeight - ACTION_BAR_HEIGHT);
    const activeSession = $derived(getActiveConsoleSession());
    const consoleInstances = $derived.by((): ConsoleInstanceModel[] =>
        sessions.map((session) => {
            const sessionData = getSessionData(session.id);
            const prompt = getPrompt(session.id);

            return createConsoleInstanceModel(session, {
                runtimeItems: sessionData.runtimeItems,
                runtimeItemActivities: sessionData.runtimeItemActivities,
                runtimeItemsMarker: sessionData.runtimeItemsMarker,
                executeScrollMarker: sessionData.executeScrollMarker,
                inputPrompt: prompt.inputPrompt,
                continuationPrompt: prompt.continuationPrompt,
                wordWrap: getWordWrap(session.id),
                trace: getTraceEnabled(session.id),
                workingDirectory: workingDirectoryBySession.get(session.id),
                resourceUsage: resourceUsageBySession.get(session.id),
                scrollLocked: getScrollLocked(session.id),
                sessionDataHydrated: sessionData.hydrated,
            });
        }),
    );
    const activeConsoleInstance = $derived(
        consoleInstances.find(
            (consoleInstance) =>
                consoleInstance.sessionId === activeConsoleSessionId,
        ),
    );
    const knownSessions = $derived(
        consoleInstances.map((consoleInstance) => ({
            sessionId: consoleInstance.sessionId,
            languageId: consoleInstance.languageId,
        })),
    );
    const showSessionTabs = $derived(
        !consoleSessionListCollapsed && sessions.length > 1,
    );
    const visibleConsolePaneWidth = $derived(
        showSessionTabs ? consolePaneWidth : containerWidth,
    );
</script>

<div class="console-core" bind:this={mainContainer}>
    {#if sessions.length === 0}
        {#if runtimeStartupPhase !== "complete"}
            <StartupStatus
                startupPhase={runtimeStartupPhase}
                discoveredCount={discoveredRuntimeCount}
                {runtimeStartupEvent}
            />
        {:else}
            <EmptyConsole onStartSession={handleStartSession} />
        {/if}
    {:else}
        <!-- Left: Console pane -->
        <div
            class="console-pane"
            style="width: {visibleConsolePaneWidth}px; height: {containerHeight}px;"
        >
            <ActionBar
                {currentWorkingDirectory}
                stateLabel={stateLabelForSession(activeSession)}
                interruptible={activeSession?.state === "busy"}
                interrupting={activeSession?.state === "interrupting"}
                restarting={
                    activeSession?.state === "starting" ||
                    activeSession?.state === "restarting"
                }
                showDeleteButton={Boolean(activeSession)}
                canShutdown={canShutdownSession(activeSession)}
                canStart={canStartSession(activeSession)}
                traceEnabled={activeConsoleInstance?.trace ?? false}
                session={activeSession}
                onInterrupt={handleInterrupt}
                onRestart={restartCurrentSession}
                onClear={clearOutput}
                onToggleWordWrap={() => {
                    if (!activeConsoleSessionId) {
                        return;
                    }
                    if (connection) {
                        void connection.sendRequest("console/toggleWordWrap", {
                            sessionId: activeConsoleSessionId,
                        });
                    }
                }}
                onToggleTrace={() => {
                    if (!activeConsoleSessionId) {
                        return;
                    }
                    if (connection) {
                        void connection.sendRequest("console/toggleTrace", {
                            sessionId: activeConsoleSessionId,
                        });
                    }
                }}
                onDeleteSession={() => {
                    if (activeConsoleSessionId) {
                        handleDeleteSession(activeConsoleSessionId);
                    }
                }}
                onOpenInEditor={() => {
                    if (activeConsoleSessionId) {
                        void handleOpenInEditor(activeConsoleSessionId);
                    }
                }}
            />

            {#if visibleConsolePaneWidth > 0}
                <div
                    class="console-instances-container"
                    style="height: {adjustedHeight}px;"
                >
                    {#each consoleInstances as consoleInstance (consoleInstance.sessionId)}
                        <ConsoleInstance
                            {consoleInstance}
                            active={consoleInstance.sessionId === activeConsoleSessionId}
                            width={visibleConsolePaneWidth}
                            height={adjustedHeight}
                            {languageAssetsVersion}
                            {charWidth}
                            {revealRequest}
                            {openSearchRequest}
                            onSelectAll={() =>
                                selectAllRuntimeItems(consoleInstance.sessionId)}
                            onFocusInput={() =>
                                requestInputFocus(consoleInstance.sessionId)}
                            onInsertText={(text) =>
                                queueInsertText(consoleInstance.sessionId, text)}
                            onPasteText={(text) =>
                                queuePastedInput(consoleInstance.sessionId, text)}
                            onRestart={() => restartSession(consoleInstance.sessionId)}
                            onInputAnchorReady={handleInputAnchorReady}
                            onScrollLockChanged={handleScrollLockChanged}
                            onWidthInCharsChanged={handleWidthInCharsChanged}
                        />
                    {/each}

                    <SharedConsoleInputHost
                        activeConsoleInstance={activeConsoleInstance}
                        width={visibleConsolePaneWidth}
                        {languageAssetsVersion}
                        {connection}
                        {inputCommand}
                        themeData={consoleThemeData}
                        {consoleSettings}
                        onExecute={handleExecute}
                        onInterrupt={handleInterrupt}
                        onActivate={handleSetForegroundSession}
                        onSelectAll={() =>
                            selectAllRuntimeItems(activeConsoleSessionId)}
                        onCodeExecuted={() => {
                            if (activeConsoleSessionId) {
                                signalCodeExecuted(activeConsoleSessionId);
                            }
                        }}
                        onOpenSearch={requestOpenSearch}
                        onOpenInEditor={handleOpenInEditor}
                        onClearConsole={handleClearConsole}
                        onCharWidthChanged={handleCharWidthChanged}
                        {knownSessions}
                        getAnchor={getInputAnchor}
                        anchorVersion={inputAnchorVersion}
                    />
                </div>
            {/if}
        </div>

        <!-- Splitter -->
        {#if showSessionTabs && consoleTabListWidth > 0}
            <VerticalSplitter
                onBeginResize={handleBeginResize}
                onResize={handleResize}
            />
        {/if}

        <!-- Right: Session tabs -->
        {#if showSessionTabs && consoleTabListWidth > 0}
            <ConsoleTabList
                {sessions}
                activeSessionId={activeConsoleSessionId}
                width={consoleTabListWidth}
                height={containerHeight}
                {resourceUsageBySession}
                onSelectSession={(sessionId) =>
                    handleChangeForegroundSession(sessionId, true)}
                onDeleteSession={handleDeleteSession}
                onRenameSession={handleRenameSession}
            />
        {/if}
    {/if}
</div>

<style>
    .console-core {
        display: flex;
        flex-direction: row;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    .console-pane {
        display: flex;
        flex-direction: column;
        min-width: 0;
        overflow: hidden;
    }

    .console-instances-container {
        flex: 1;
        position: relative;
        overflow: hidden;
    }
</style>
