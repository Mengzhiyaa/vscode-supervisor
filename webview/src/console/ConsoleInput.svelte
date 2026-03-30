<!--
    ConsoleInput.svelte
    
    Monaco Editor based console input component.
    Mirrors: positron/.../components/consoleInput.tsx
    
    Uses Monaco Editor for code input with:
    - Syntax highlighting for R
    - Dynamic line numbers as prompts (from session dynState)
    - History navigation with HistoryNavigator2 pattern
    - Code completion integration
    - Current code fragment preservation
-->
<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import { monaco, ensureMonacoRuntime } from "$lib/monaco/setup";
    import {
        ensureLanguageTextMateTokenizerReady,
        getTextMateThemeRules,
        loadLanguageMonacoSupportModule,
        type ConsoleThemeData,
        type LanguageMonacoSupportModule,
    } from "$lib/monaco/languageSupport";
    import type { ConsoleSettings, ConsoleState } from "../types/console";
    import { createEditorHost } from "./services/editorHost";
    import {
        createSessionModelManager,
        type ConsoleInputCommand,
        type KnownSessionInfo,
        type SessionHistoryState,
    } from "./services/sessionModelManager";
    import HistoryBrowserPopup from "./HistoryBrowserPopup.svelte";
    import {
        type HistoryMatch,
        type IInputHistoryEntry,
        HistoryPrefixMatchStrategy,
        HistoryInfixMatchStrategy,
    } from "./history";
    import { copyScopedSelection } from "./utils/selectionUtils";

    // Position constants (Positron pattern - using const instead of enum for Svelte compatibility)
    const Position = {
        First: 0,
        Last: 1,
    } as const;
    const isMacintosh =
        typeof navigator !== "undefined" &&
        navigator.platform.toLowerCase().includes("mac");

    // ConsoleInputProps interface (Positron pattern)
    interface ConsoleInputProps {
        readonly width: number;
        readonly hidden: boolean;
        readonly active: boolean;
        readonly sessionId: string;
        readonly languageId: string;
        readonly knownSessions?: KnownSessionInfo[];
        readonly state: ConsoleState;
        readonly inputPrompt: string;
        readonly continuationPrompt: string;
        readonly onExecute: (sessionId: string, code: string) => void;
        readonly onInterrupt: (sessionId: string) => void;
        readonly onActivate: (sessionId: string) => void;
        readonly onSelectAll: () => void;
        readonly onCodeExecuted: () => void;
        readonly onOpenSearch?: (sessionId: string) => void;
        readonly onOpenInEditor?: (sessionId: string, code: string) => void;
        readonly onClearConsole?: (sessionId: string) => void;
        readonly onCharWidthChanged?: (charWidth: number) => void;
        readonly connection: MessageConnection | undefined;
        readonly consoleSettings: ConsoleSettings;
        readonly languageAssetsVersion?: number;
        readonly inputCommand?:
            | {
                  sessionId: string;
                  command: ConsoleInputCommand;
                  nonce: number;
              }
            | undefined;
        readonly themeData?: ConsoleThemeData;
    }

    let {
        width,
        hidden,
        active = true,
        sessionId,
        languageId = "plaintext",
        knownSessions = [],
        state: consoleState,
        inputPrompt = ">",
        continuationPrompt = "+",
        onExecute,
        onInterrupt,
        onActivate,
        onSelectAll,
        onCodeExecuted,
        onOpenSearch,
        onOpenInEditor,
        onClearConsole,
        onCharWidthChanged,
        connection,
        consoleSettings,
        languageAssetsVersion = 0,
        inputCommand,
        themeData,
    }: ConsoleInputProps = $props();

    // Reference to the code editor widget container (Positron pattern)
    // svelte-ignore non_reactive_update
    let codeEditorWidgetContainerRef: HTMLDivElement;
    let codeEditorWidget: monaco.editor.IStandaloneCodeEditor;

    // State refs (Positron pattern)
    // svelte-ignore state_referenced_locally
    let codeEditorWidth = $state(width);

    // History state (Positron pattern: HistoryNavigator2)
    let historyEntries = $state<IInputHistoryEntry[]>([]);
    let historyIndex = $state(-1);

    // Current code fragment (Positron pattern)
    // This preserves the user's input when navigating history
    let currentCodeFragment = $state<string | undefined>(undefined);

    // History browser state (Positron pattern)
    let historyBrowserActive = $state(false);
    let historyBrowserSelectedIndex = $state(0);
    let historyItems = $state<HistoryMatch[]>([]);

    // Disposables for cleanup
    let disposables: monaco.IDisposable[] = [];
    let languageMonacoSupportModule: LanguageMonacoSupportModule | undefined;
    let languageMonacoSupportModuleLanguageId = "";
    let destroyed = false;
    let inputVisibilityAnimationFrame: number | undefined;
    let activationEpoch = 0;
    let activationState = $state<"idle" | "switching">("idle");
    let activatingSessionId = $state<string | undefined>(undefined);
    let committedSessionId = $state<string | undefined>(undefined);

    const handledCommandNonces = new Set<number>();
    const editorHost = createEditorHost();
    const sessionModelManager = createSessionModelManager({
        monaco,
        getConnection: () => connection,
    });

    // Ref object to hold current active state (solves closure capture issue)
    // This allows command handlers to access the current active value, not the captured value
    // svelte-ignore state_referenced_locally
    const activeRef = { current: active };

    // Also need a ref for consoleState since it's also captured in closures
    // svelte-ignore state_referenced_locally
    const stateRef = { current: consoleState };

    // Ref to prevent concurrent execute attempts from key-repeat or rapid Enter presses.
    const executeAttemptInProgressRef = { current: false };

    // Tracks a queued Enter press that should execute once this session is ready again.
    const deferredExecuteSessionIdRef = { current: undefined as string | undefined };

    function normalizeLanguageId(value: string | undefined): string {
        const normalizedLanguageId = value?.trim().toLowerCase();
        return normalizedLanguageId || "plaintext";
    }

    function currentLanguageId(): string {
        return normalizeLanguageId(languageId);
    }

    async function ensureLanguageMonacoSupportModule(
        targetLanguageId: string,
    ): Promise<LanguageMonacoSupportModule | undefined> {
        const normalizedLanguageId = normalizeLanguageId(targetLanguageId);
        if (
            languageMonacoSupportModule &&
            languageMonacoSupportModuleLanguageId === normalizedLanguageId
        ) {
            return languageMonacoSupportModule;
        }

        try {
            languageMonacoSupportModule =
                await loadLanguageMonacoSupportModule(normalizedLanguageId);
            languageMonacoSupportModuleLanguageId = languageMonacoSupportModule
                ? normalizedLanguageId
                : "";
        } catch (error) {
            console.warn(
                `[ConsoleInput] Failed to load language support for '${normalizedLanguageId}'`,
                error,
            );
            languageMonacoSupportModule = undefined;
            languageMonacoSupportModuleLanguageId = "";
        }
        return languageMonacoSupportModule;
    }

    async function ensureLanguageSupportRegistered(
        targetLanguageId: string,
    ): Promise<LanguageMonacoSupportModule | undefined> {
        const normalizedLanguageId = normalizeLanguageId(targetLanguageId);
        const languageMonacoSupport =
            await ensureLanguageMonacoSupportModule(normalizedLanguageId);

        if (destroyed) {
            return languageMonacoSupport;
        }

        languageMonacoSupport?.registerLanguage(monaco);
        await ensureLanguageTextMateTokenizerReady(
            monaco,
            normalizedLanguageId,
        );
        languageMonacoSupport?.ensureProviders?.(monaco);
        return languageMonacoSupport;
    }

    function applyMonacoTheme(theme: ConsoleThemeData) {
        const body = document.body;
        const cs = getComputedStyle(body);

        function cssVar(name: string): string | undefined {
            const val = cs.getPropertyValue(name).trim();
            if (!val) return undefined;
            if (val.startsWith("#")) return val;
            const m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            if (m) {
                const r = parseInt(m[1]).toString(16).padStart(2, "0");
                const g = parseInt(m[2]).toString(16).padStart(2, "0");
                const b = parseInt(m[3]).toString(16).padStart(2, "0");
                return `#${r}${g}${b}`;
            }
            return undefined;
        }

        const editorBg =
            cssVar("--vscode-input-background") ||
            cssVar("--vscode-editor-background");
        const editorFg = cssVar("--vscode-editor-foreground");
        const widgetBg = cssVar("--vscode-editorWidget-background");
        const widgetFg = cssVar("--vscode-editorWidget-foreground");
        const widgetBorder = cssVar("--vscode-editorWidget-border");
        const hoverBg =
            cssVar("--vscode-editorHoverWidget-background") || widgetBg;
        const hoverFg =
            cssVar("--vscode-editorHoverWidget-foreground") || widgetFg;
        const hoverBorder =
            cssVar("--vscode-editorHoverWidget-border") || widgetBorder;
        const suggestBg =
            cssVar("--vscode-editorSuggestWidget-background") || widgetBg;
        const suggestFg =
            cssVar("--vscode-editorSuggestWidget-foreground") || widgetFg;
        const suggestBorder =
            cssVar("--vscode-editorSuggestWidget-border") || widgetBorder;
        const suggestHighlight = cssVar(
            "--vscode-editorSuggestWidget-highlightForeground",
        );
        const suggestSelected =
            cssVar("--vscode-editorSuggestWidget-selectedBackground") ||
            cssVar("--vscode-list-activeSelectionBackground");
        const suggestSelectedFg =
            cssVar("--vscode-editorSuggestWidget-selectedForeground") ||
            cssVar("--vscode-list-activeSelectionForeground");
        const suggestSelectedIcon =
            cssVar("--vscode-editorSuggestWidget-selectedIconForeground") ||
            suggestSelectedFg;
        const suggestFocusHighlight =
            cssVar("--vscode-editorSuggestWidget-focusHighlightForeground") ||
            suggestHighlight;
        const listHoverBg = cssVar("--vscode-list-hoverBackground");

        const colors: Record<string, string> = {};
        if (editorBg) {
            colors["editor.background"] = editorBg;
        }
        if (editorFg) {
            colors["editor.foreground"] = editorFg;
        }
        if (hoverBg) {
            colors["editorHoverWidget.background"] = hoverBg;
        }
        if (hoverFg) {
            colors["editorHoverWidget.foreground"] = hoverFg;
        }
        if (hoverBorder) {
            colors["editorHoverWidget.border"] = hoverBorder;
        }
        if (suggestBg) {
            colors["editorSuggestWidget.background"] = suggestBg;
        }
        if (suggestFg) {
            colors["editorSuggestWidget.foreground"] = suggestFg;
        }
        if (suggestBorder) {
            colors["editorSuggestWidget.border"] = suggestBorder;
        }
        if (suggestHighlight) {
            colors["editorSuggestWidget.highlightForeground"] =
                suggestHighlight;
        }
        if (suggestSelected) {
            colors["editorSuggestWidget.selectedBackground"] = suggestSelected;
        }
        if (suggestSelectedFg) {
            colors["editorSuggestWidget.selectedForeground"] =
                suggestSelectedFg;
        }
        if (suggestSelectedIcon) {
            colors["editorSuggestWidget.selectedIconForeground"] =
                suggestSelectedIcon;
        }
        if (suggestFocusHighlight) {
            colors["editorSuggestWidget.focusHighlightForeground"] =
                suggestFocusHighlight;
        }
        if (widgetBg) {
            colors["editorWidget.background"] = widgetBg;
            colors["peekViewEditor.background"] = widgetBg;
        }
        if (widgetFg) {
            colors["editorWidget.foreground"] = widgetFg;
        }
        if (widgetBorder) {
            colors["editorWidget.border"] = widgetBorder;
        }
        if (listHoverBg) {
            colors["list.hoverBackground"] = listHoverBg;
        }

        const themeName = "vscode-console-theme";
        monaco.editor.defineTheme(themeName, {
            base: theme.base,
            inherit: true,
            rules: getTextMateThemeRules(theme),
            colors,
        });
        monaco.editor.setTheme(themeName);
        return themeName;
    }

    function getConsoleLineHeightPx(settings: ConsoleSettings): number {
        return Math.round(settings.fontSize * settings.lineHeight);
    }

    function applyConsoleFontSettings(settings: ConsoleSettings): void {
        if (!codeEditorWidget) {
            return;
        }

        codeEditorWidget.updateOptions({
            fontFamily: settings.fontFamily,
            fontSize: settings.fontSize,
            lineHeight: getConsoleLineHeightPx(settings),
        });

        const layoutWidth =
            codeEditorWidgetContainerRef?.clientWidth || codeEditorWidth;
        codeEditorWidth = layoutWidth;
        codeEditorWidget.layout({
            width: layoutWidth,
            height: codeEditorWidget.getContentHeight(),
        });
    }

    function currentSessionId(): string {
        return (
            committedSessionId || editorHost.getActiveSessionId() || sessionId
        );
    }

    function waitForAnimationFrame(): Promise<void> {
        return new Promise((resolve) => {
            requestAnimationFrame(() => resolve());
        });
    }

    function normalizeEditorSelectionToEnd(
        model: monaco.editor.ITextModel | null | undefined,
    ): void {
        if (!codeEditorWidget || !model) {
            return;
        }

        const lineNumber = model.getLineCount();
        const column = model.getLineMaxColumn(lineNumber);
        const selection = new monaco.Selection(
            lineNumber,
            column,
            lineNumber,
            column,
        );

        codeEditorWidget.setSelections([selection]);
        codeEditorWidget.setPosition({ lineNumber, column });
        codeEditorWidget.revealPosition(
            { lineNumber, column },
            monaco.editor.ScrollType.Immediate,
        );
    }

    function resetEditorTransientState(): void {
        if (!codeEditorWidget) {
            return;
        }

        const contributionIds = [
            "editor.contrib.suggestController",
            "editor.contrib.parameterHintsController",
            "editor.contrib.contentHover",
            "snippetController2",
        ];

        for (const contributionId of contributionIds) {
            const contribution = (codeEditorWidget as any).getContribution?.(
                contributionId,
            ) as
                | {
                      cancelSuggestWidget?: () => void;
                      cancel?: () => void;
                      hide?: () => void;
                      reset?: () => void;
                      cancelSession?: () => void;
                  }
                | undefined;

            contribution?.cancelSuggestWidget?.();
            contribution?.cancel?.();
            contribution?.hide?.();
            contribution?.reset?.();
            contribution?.cancelSession?.();
        }
    }

    // Sync refs when props change
    $effect(() => {
        activeRef.current = active;
    });
    $effect(() => {
        const previousState = stateRef.current;
        stateRef.current = consoleState;

        // Positron pattern: Update line numbers on state change
        if (codeEditorWidget) {
            // Update line number options when state changes (shows/hides prompt)
            codeEditorWidget.updateOptions(createLineNumbersOptions());
        }

        if (previousState !== "ready" && consoleState === "ready") {
            void maybeExecuteDeferredCode();
        }
    });

    // Update line numbers when prompt changes
    $effect(() => {
        if (codeEditorWidget) {
            codeEditorWidget.updateOptions(createLineNumbersOptions());
        }
    });

    /**
     * Creates the line numbers options (Positron pattern).
     * Hides prompt when not in ready state (busy, offline, etc.).
     * Note: lineDecorationsWidth provides the space after the prompt.
     */
    function createLineNumbersOptions(): monaco.editor.IEditorOptions {
        const promptWidth = Math.max(
            inputPrompt.length,
            continuationPrompt.length,
        );

        // Keep the prompt visible while a restart is reconnecting so the input
        // area does not visually disappear between banner restore and ready.
        const showPrompt =
            stateRef.current === "ready" ||
            stateRef.current === "starting" ||
            stateRef.current === "restarting" ||
            stateRef.current === "uninitialized";

        return {
            lineNumbers: (lineNumber: number) => {
                if (!showPrompt) {
                    return ""; // Hide prompt during busy/offline/etc states
                }
                return lineNumber < 2 ? inputPrompt : continuationPrompt;
            },
            lineNumbersMinChars: promptWidth,
        };
    }

    function updateLineDecorationsWidthPx(newCharWidth: number) {
        if (!codeEditorWidget || newCharWidth <= 0) {
            return;
        }
        codeEditorWidget.updateOptions({
            lineDecorationsWidth: `${newCharWidth}px`,
        });
    }

    function resolveConsoleInstance(): HTMLElement | undefined {
        const candidate =
            codeEditorWidgetContainerRef?.closest(".console-instance");
        return candidate instanceof HTMLElement ? candidate : undefined;
    }

    function scheduleEnsureInputBottomVisible() {
        if (inputVisibilityAnimationFrame !== undefined) {
            cancelAnimationFrame(inputVisibilityAnimationFrame);
        }

        inputVisibilityAnimationFrame = requestAnimationFrame(() => {
            inputVisibilityAnimationFrame = undefined;

            if (hidden || !activeRef.current || !codeEditorWidgetContainerRef) {
                return;
            }

            const consoleInstance = resolveConsoleInstance();
            if (!consoleInstance) {
                return;
            }

            const bottomMarginPx = 8;
            const consoleRect = consoleInstance.getBoundingClientRect();
            const editorRect =
                codeEditorWidgetContainerRef.getBoundingClientRect();
            const overflowBottom =
                editorRect.bottom - (consoleRect.bottom - bottomMarginPx);

            if (overflowBottom > 0) {
                consoleInstance.scrollTop += overflowBottom;
            }
        });
    }

    /**
     * Updates the code editor widget position (Positron pattern).
     * @param linePosition The line position.
     * @param columnPosition The column position.
     */
    function updateCodeEditorWidgetPosition(
        linePosition: number,
        columnPosition: number,
    ) {
        const textModel = codeEditorWidget?.getModel();
        if (textModel) {
            const lineNumber =
                linePosition === Position.First ? 1 : textModel.getLineCount();
            const column =
                columnPosition === Position.First
                    ? 1
                    : textModel.getLineMaxColumn(lineNumber);

            codeEditorWidget.setPosition({ lineNumber, column });

            // Ensure the bottom of the expanding input stays visible inside the console viewport.
            scheduleEnsureInputBottomVisible();
        }
    }

    /**
     * Engages the history browser with the given match strategy (Positron pattern).
     */
    function engageHistoryBrowser(strategy: {
        getMatches: (input: string) => HistoryMatch[];
    }) {
        cancelSuggestWidget();

        // Look for the text to match against
        const value = codeEditorWidget.getValue();
        const position = codeEditorWidget.getSelection()?.getStartPosition();
        const matchText = value.substring(
            0,
            (position?.column || value.length) - 1,
        );

        // Get the initial set of matches
        const matches = strategy.getMatches(matchText);
        historyItems = matches;

        // Update the selected index to the last (most recent) item
        historyBrowserSelectedIndex = Math.max(0, matches.length - 1);

        // Make the history browser active
        historyBrowserActive = true;
    }

    /**
     * Disengages the history browser (Positron pattern).
     */
    function disengageHistoryBrowser() {
        historyBrowserActive = false;
        historyItems = [];
    }

    /**
     * Accepts an item from the history browser (Positron pattern).
     */
    function acceptHistoryMatch(index: number) {
        if (index >= 0 && index < historyItems.length) {
            // Set the value of the code editor widget to the selected history item
            codeEditorWidget.setValue(historyItems[index].input);

            // Position cursor at end
            updateCodeEditorWidgetPosition(Position.Last, Position.Last);
        }

        // Dismiss the history browser
        disengageHistoryBrowser();
    }

    /**
     * Navigates the history up (Positron pattern).
     */
    function navigateHistoryUp() {
        const position = codeEditorWidget.getPosition();
        if (position?.lineNumber !== 1) {
            // Not at first line, let default cursor movement happen
            codeEditorWidget.trigger("keyboard", "cursorUp", null);
            return;
        }

        if (historyEntries.length === 0) return;

        // When the user moves up from the end, save current code fragment
        if (historyIndex === -1) {
            currentCodeFragment = codeEditorWidget.getValue();
            historyIndex = historyEntries.length - 1;
        } else if (historyIndex > 0) {
            historyIndex--;
        } else {
            return; // Already at oldest entry
        }

        // Set the value to the history entry
        codeEditorWidget.setValue(historyEntries[historyIndex].input);

        // Position cursor (Positron pattern: first line, last column)
        updateCodeEditorWidgetPosition(Position.First, Position.Last);
    }

    /**
     * Navigates the history down (Positron pattern).
     */
    function navigateHistoryDown() {
        const position = codeEditorWidget.getPosition();
        const textModel = codeEditorWidget.getModel();

        if (position?.lineNumber !== textModel?.getLineCount()) {
            // Not at last line, let default cursor movement happen
            codeEditorWidget.trigger("keyboard", "cursorDown", null);
            return;
        }

        if (historyIndex === -1) return;

        if (historyIndex >= historyEntries.length - 1) {
            // Reached the end, restore current code fragment
            historyIndex = -1;
            if (currentCodeFragment !== undefined) {
                codeEditorWidget.setValue(currentCodeFragment);
                currentCodeFragment = undefined;
            }
        } else {
            historyIndex++;
            codeEditorWidget.setValue(historyEntries[historyIndex].input);
        }

        // Position cursor (Positron pattern: last line, last column)
        updateCodeEditorWidgetPosition(Position.Last, Position.Last);
    }

    function addHistoryEntry(input: string, when?: number) {
        const trimmed = input.trim();
        if (!trimmed) return;

        const last = historyEntries[historyEntries.length - 1];
        if (last?.input === trimmed) {
            return;
        }

        const entry: IInputHistoryEntry = {
            input: trimmed,
            when: new Date(when ?? Date.now()),
        };

        const next = [...historyEntries, entry];
        if (next.length > 1000) {
            next.shift();
        }
        historyEntries = next;
        historyIndex = -1;
    }

    function setHistoryEntries(
        entries: { input: string; when?: number }[],
    ): void {
        const normalized: IInputHistoryEntry[] = [];
        let lastInput: string | undefined;

        for (const entry of entries) {
            const trimmed = entry.input.trim();
            if (!trimmed) {
                continue;
            }
            if (lastInput === trimmed) {
                continue;
            }
            normalized.push({
                input: trimmed,
                when: new Date(entry.when ?? Date.now()),
            });
            lastInput = trimmed;
        }

        if (normalized.length > 1000) {
            normalized.splice(0, normalized.length - 1000);
        }

        historyEntries = normalized;
        historyIndex = -1;
        historyBrowserActive = false;
        historyItems = [];
        historyBrowserSelectedIndex = 0;
    }

    function applyPasteText(text: string) {
        const selections = codeEditorWidget.getSelections();
        if (!selections || !selections.length) {
            return;
        }

        const lines = text.split("\n");
        const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];

        if (lines.length === selections.length) {
            for (let i = 0; i < lines.length; i++) {
                edits.push({
                    range: selections[i],
                    text: lines[i],
                    forceMoveMarkers: true,
                });
            }
        } else {
            for (const selection of selections) {
                edits.push({
                    range: selection,
                    text,
                    forceMoveMarkers: true,
                });
            }
        }

        codeEditorWidget.executeEdits("console", edits);
        updateCodeEditorWidgetPosition(Position.Last, Position.Last);
    }

    function clearHistory() {
        historyEntries = [];
        historyIndex = -1;
        currentCodeFragment = undefined;
        historyBrowserActive = false;
        historyItems = [];
        historyBrowserSelectedIndex = 0;
    }

    function captureHistoryState(): SessionHistoryState {
        return {
            historyEntries: historyEntries.map((entry) => ({
                ...entry,
                when: new Date(entry.when),
            })),
            historyIndex,
            currentCodeFragment,
        };
    }

    function applyHistoryState(state: SessionHistoryState | undefined): void {
        historyEntries = state ? [...state.historyEntries] : [];
        historyIndex = state?.historyIndex ?? -1;
        currentCodeFragment = state?.currentCodeFragment;
        historyBrowserActive = false;
        historyItems = [];
        historyBrowserSelectedIndex = 0;
    }

    function saveSessionState(sessionIdToSave: string): void {
        if (!codeEditorWidget) {
            return;
        }

        sessionModelManager.setViewState(
            sessionIdToSave,
            editorHost.saveViewState(),
        );
        sessionModelManager.setHistoryState(
            sessionIdToSave,
            captureHistoryState(),
        );
    }

    function applyCommandToActiveSession(command: ConsoleInputCommand): void {
        switch (command.kind) {
            case "focus":
                codeEditorWidget?.focus();
                break;
            case "insertText":
                if (codeEditorWidget) {
                    codeEditorWidget.focus();
                    codeEditorWidget.trigger("keyboard", "type", {
                        text: command.text,
                    });
                }
                break;
            case "paste":
                if (codeEditorWidget) {
                    applyPasteText(command.text);
                }
                break;
            case "historyUp":
                if (command.usingPrefixMatch) {
                    if (!historyBrowserActive) {
                        engageHistoryBrowser(
                            new HistoryPrefixMatchStrategy(historyEntries),
                        );
                    } else {
                        navigateHistoryUp();
                    }
                } else {
                    navigateHistoryUp();
                }
                codeEditorWidget?.focus();
                break;
            case "historyDown":
                navigateHistoryDown();
                codeEditorWidget?.focus();
                break;
            case "historyClear":
                clearHistory();
                codeEditorWidget?.focus();
                break;
            case "openInEditor":
                onOpenInEditor?.(
                    currentSessionId(),
                    codeEditorWidget?.getValue() ?? "",
                );
                break;
            case "setPendingCode":
                if (codeEditorWidget) {
                    codeEditorWidget.setValue(command.code || "");
                    updateCodeEditorWidgetPosition(
                        Position.Last,
                        Position.Last,
                    );
                    void maybeExecuteDeferredCode();
                }
                break;
            case "historyAdd":
                addHistoryEntry(command.input, command.when);
                break;
            case "historySet":
                setHistoryEntries(command.entries);
                break;
        }
    }

    function needsActiveEditorContext(command: ConsoleInputCommand): boolean {
        return (
            command.kind === "focus" ||
            command.kind === "insertText" ||
            command.kind === "paste" ||
            command.kind === "historyUp" ||
            command.kind === "historyDown" ||
            command.kind === "openInEditor"
        );
    }

    function flushPendingCommands(sessionIdToFlush: string): void {
        const commands = sessionModelManager.flushPending(sessionIdToFlush);
        for (const command of commands) {
            applyCommandToActiveSession(command);
        }
    }

    async function activateSessionModel(
        nextSessionId: string,
        nextLanguageId: string,
        force = false,
    ): Promise<void> {
        if (!codeEditorWidget) {
            return;
        }

        const previousSessionId = committedSessionId;
        if (previousSessionId && (previousSessionId !== nextSessionId || force)) {
            // Force re-activation of the same session is used for language/support
            // refreshes. Persist local history/view state first so we do not
            // restore stale cached state back over the current input history.
            saveSessionState(previousSessionId);
        }

        const nextState = sessionModelManager.ensureSession(
            nextSessionId,
            nextLanguageId,
        );
        const epoch = ++activationEpoch;

        if (
            !force &&
            previousSessionId === nextSessionId &&
            codeEditorWidget.getModel() === nextState.model
        ) {
            flushPendingCommands(nextSessionId);
            return;
        }
        activationState = "switching";
        activatingSessionId = nextSessionId;
        resetEditorTransientState();
        editorHost.activateSession(
            nextSessionId,
            nextState.model,
            nextState.viewState,
        );

        if (destroyed || epoch !== activationEpoch) {
            return;
        }

        applyHistoryState(sessionModelManager.getHistoryState(nextSessionId));

        await tick();
        await waitForAnimationFrame();

        if (destroyed || epoch !== activationEpoch || !codeEditorWidget) {
            return;
        }

        const currentWidth =
            codeEditorWidgetContainerRef?.clientWidth ||
            codeEditorWidth ||
            width;
        codeEditorWidth = currentWidth;
        codeEditorWidget.layout({
            width: currentWidth,
            height: codeEditorWidget.getContentHeight(),
        });

        if (!nextState.viewState) {
            normalizeEditorSelectionToEnd(nextState.model);
        }

        committedSessionId = nextSessionId;
        activationState = "idle";
        activatingSessionId = undefined;
        flushPendingCommands(nextSessionId);
        scheduleEnsureInputBottomVisible();
        void maybeExecuteDeferredCode();
    }

    function enqueuePendingCommand(
        sessionIdToQueue: string,
        command: ConsoleInputCommand,
    ): void {
        sessionModelManager.enqueuePending(sessionIdToQueue, command);
    }

    function syncKnownSessionModels(): void {
        sessionModelManager.ensureSessions(knownSessions);
        sessionModelManager.pruneUnknownSessions(
            knownSessions.map((session) => session.sessionId),
            currentSessionId(),
        );
    }

    function submitCodeEditorWidgetCode(code: string): boolean {
        const trimmedCode = code.trim();
        if (!trimmedCode) {
            return false;
        }

        if (deferredExecuteSessionIdRef.current === currentSessionId()) {
            deferredExecuteSessionIdRef.current = undefined;
        }

        // Clear current code fragment
        currentCodeFragment = undefined;

        // Clear the code editor widget's model
        codeEditorWidget.setValue("");

        // Immediately change the prompt to spaces to eliminate flickering (Positron pattern)
        const promptWidth = Math.max(
            inputPrompt.length,
            continuationPrompt.length,
        );
        codeEditorWidget.updateOptions({
            lineNumbers: (_: number) => " ".repeat(promptWidth),
            lineNumbersMinChars: promptWidth,
        });

        // Add to history
        addHistoryEntry(code);

        // Execute the code (explicitly target this session)
        onExecute(currentSessionId(), code);

        // Render the code editor widget
        codeEditorWidget.render(true);

        // Call the code executed callback
        onCodeExecuted();

        return true;
    }

    /**
     * Executes the code editor widget's code, if possible (Positron pattern).
     * Handles all four status types: Complete, Incomplete, Invalid, Unknown.
     */
    async function executeCodeEditorWidgetCodeIfPossible(): Promise<boolean> {
        if (executeAttemptInProgressRef.current) {
            return true;
        }

        const code = codeEditorWidget.getValue();

        if (!code.trim() || stateRef.current !== "ready") {
            return false;
        }

        executeAttemptInProgressRef.current = true;

        try {
            // Check if code is complete (Positron pattern: use runtime isCodeFragmentComplete)
            if (connection) {
                try {
                    const result = (await connection.sendRequest(
                        "console/isComplete",
                        {
                            code,
                            sessionId: currentSessionId(),
                        },
                    )) as { status: string };

                    // Handle status according to Positron pattern
                    switch (result.status) {
                        case "complete":
                            // Code is complete, proceed to execute
                            break;

                        case "incomplete":
                            // Code is incomplete, don't execute - let user add more lines
                            return false;

                        case "invalid":
                            // Code has syntax errors, log warning but execute anyway
                            // (so user can see the error from the interpreter)
                            console.warn(
                                `Executing invalid code fragment: '${code}'`,
                            );
                            break;

                        case "unknown":
                            // Could not determine completeness, log warning but execute anyway
                            console.warn(
                                `Could not determine whether code fragment: '${code}' is complete.`,
                            );
                            break;

                        default:
                            // Unknown status, treat as complete
                            console.warn(
                                `Unknown isComplete status: ${result.status}`,
                            );
                            break;
                    }
                } catch (e) {
                    // Handle errors - show notification to user (Positron pattern)
                    if (e instanceof Error) {
                        console.error(
                            `Cannot execute code: ${e.name} (${e.message})`,
                        );
                    } else {
                        console.error(
                            `Cannot execute code: ${JSON.stringify(e)}`,
                        );
                    }
                    return false;
                }
            }

            return submitCodeEditorWidgetCode(code);
        } finally {
            executeAttemptInProgressRef.current = false;
        }
    }

    function deferCodeEditorWidgetCodeUntilReady(): boolean {
        const code = codeEditorWidget.getValue();
        if (!code.trim()) {
            return false;
        }

        deferredExecuteSessionIdRef.current = currentSessionId();
        return true;
    }

    async function maybeExecuteDeferredCode(): Promise<void> {
        if (!codeEditorWidget || stateRef.current !== "ready") {
            return;
        }

        const deferredSessionId = deferredExecuteSessionIdRef.current;
        if (!deferredSessionId || deferredSessionId !== currentSessionId()) {
            return;
        }

        if (!codeEditorWidget.getValue().trim()) {
            return;
        }

        deferredExecuteSessionIdRef.current = undefined;
        await executeCodeEditorWidgetCodeIfPossible();
    }

    onMount(() => {
        void (async () => {
            // Ensure Monaco runtime is initialized exactly once.
            // We keep current eager-loading behavior and only make init re-entrant.
            await ensureMonacoRuntime();
            if (destroyed) {
                return;
            }

            const initialLanguageId = currentLanguageId();
            syncKnownSessionModels();

            await ensureLanguageSupportRegistered(initialLanguageId);
            if (destroyed) {
                return;
            }

            const fontFamily = consoleSettings.fontFamily || "monospace";
            const fontSize = consoleSettings.fontSize;
            const lineHeight = getConsoleLineHeightPx(consoleSettings);

            // Create Monaco editor (Positron CodeEditorWidget pattern)
            codeEditorWidget = monaco.editor.create(
                codeEditorWidgetContainerRef,
                {
                    value: "",
                    language: initialLanguageId,
                    theme: themeData
                        ? applyMonacoTheme(themeData)
                        : getVSCodeTheme(),
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: false, // We handle layout manually
                    wordWrap: "bounded",
                    wordWrapColumn: 2048,
                    glyphMargin: false,
                    folding: false,
                    fixedOverflowWidgets: true,
                    lineDecorationsWidth: "1.0ch",
                    renderLineHighlight: "none",
                    renderFinalNewline: "on",
                    overviewRulerLanes: 0,
                    rulers: [],
                    renderValidationDecorations: "off",
                    scrollbar: {
                        vertical: "hidden",
                        useShadows: false,
                        handleMouseWheel: false,
                        alwaysConsumeMouseWheel: false,
                    },
                    fontFamily,
                    fontSize,
                    lineHeight,
                    padding: { top: 4, bottom: 4 },
                    // Enable suggestions/completions
                    quickSuggestions: true,
                    suggestOnTriggerCharacters: true,
                    acceptSuggestionOnEnter: "off", // Don't auto-accept on Enter (keep for execute)
                    tabCompletion: "on",
                    // Hover support
                    hover: {
                        enabled: true,
                        delay: 300,
                    },
                    // Parameter hints (signature help)
                    parameterHints: {
                        enabled: true,
                        cycle: true,
                    },
                    // Line numbers options
                    ...createLineNumbersOptions(),
                },
            );

            editorHost.setEditor(codeEditorWidget);

            await activateSessionModel(sessionId, initialLanguageId, true);
            syncKnownSessionModels();

            // Set up keyboard shortcuts (Positron keyDownHandler pattern)
            setupKeyBindings();

            // Auto-grow the editor as content size changes (Positron pattern)
            // Keep this handler layout-only to avoid fighting outer container scroll logic.
            disposables.push(
                codeEditorWidget.onDidContentSizeChange(() => {
                    const contentHeight = codeEditorWidget.getContentHeight();

                    // Get current container width directly to avoid stale closure
                    const currentWidth =
                        codeEditorWidgetContainerRef?.clientWidth ||
                        codeEditorWidth;

                    // Update editor layout
                    codeEditorWidget.layout({
                        width: currentWidth,
                        height: contentHeight,
                    });

                    scheduleEnsureInputBottomVisible();
                }),
            );

            // Set the paste event handler (Positron pattern)
            disposables.push(
                codeEditorWidget.onDidPaste(() => {
                    updateCodeEditorWidgetPosition(
                        Position.Last,
                        Position.Last,
                    );
                }),
            );

            const editorDomNode = codeEditorWidget.getDomNode();
            if (editorDomNode) {
                const forwardConsumedWheelToConsole = (event: WheelEvent) => {
                    if (!event.defaultPrevented) {
                        return;
                    }

                    const consoleInstance = resolveConsoleInstance();
                    if (!consoleInstance) {
                        return;
                    }

                    consoleInstance.scrollBy(event.deltaX, event.deltaY);
                };

                const isWebHost = !/\bElectron\//i.test(navigator.userAgent);
                const forwardWheelToConsoleOnWeb = (event: WheelEvent) => {
                    if (!isWebHost || event.defaultPrevented) {
                        return;
                    }

                    const consoleInstance = resolveConsoleInstance();
                    if (!consoleInstance) {
                        return;
                    }

                    consoleInstance.scrollBy(event.deltaX, event.deltaY);
                };

                editorDomNode.addEventListener(
                    "wheel",
                    forwardConsumedWheelToConsole,
                    true,
                );
                editorDomNode.addEventListener(
                    "wheel",
                    forwardWheelToConsoleOnWeb,
                    false,
                );

                disposables.push({
                    dispose: () => {
                        editorDomNode.removeEventListener(
                            "wheel",
                            forwardConsumedWheelToConsole,
                            true,
                        );
                        editorDomNode.removeEventListener(
                            "wheel",
                            forwardWheelToConsoleOnWeb,
                            false,
                        );
                    },
                });
            }

            // Ensure the focused editor activates its session
            disposables.push(
                codeEditorWidget.onDidFocusEditorText(() => {
                    if (!activeRef.current) {
                        onActivate(
                            editorHost.getActiveSessionId() ||
                                currentSessionId(),
                        );
                    }
                    scheduleEnsureInputBottomVisible();
                }),
            );

            // ResizeObserver to handle container width changes
            const resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const newWidth = entry.contentRect.width;
                    if (newWidth > 0 && newWidth !== codeEditorWidth) {
                        codeEditorWidth = newWidth;
                        codeEditorWidget.layout({
                            width: newWidth,
                            height: codeEditorWidget.getContentHeight(),
                        });
                    }
                }
            });
            resizeObserver.observe(codeEditorWidgetContainerRef);
            disposables.push({
                dispose: () => resizeObserver.disconnect(),
            });

            // Initial layout using container width
            const initialWidth =
                codeEditorWidgetContainerRef.clientWidth || width;
            codeEditorWidth = initialWidth;
            codeEditorWidget.layout({
                width: initialWidth,
                height: codeEditorWidget.getContentHeight(),
            });

            // Get font info from Monaco and notify parent of character width (Positron pattern)
            // This uses Monaco's built-in font measurement which is more accurate than manual DOM measurement
            const fontInfo = codeEditorWidget.getOption(
                monaco.editor.EditorOption.fontInfo,
            );
            const charWidth = fontInfo.spaceWidth;
            if (charWidth > 0) {
                updateLineDecorationsWidthPx(charWidth);
                if (onCharWidthChanged) {
                    onCharWidthChanged(charWidth);
                }
            }

            // Also listen for font info changes (e.g., when user changes font settings)
            disposables.push(
                codeEditorWidget.onDidChangeConfiguration(
                    (e: monaco.editor.ConfigurationChangedEvent) => {
                        if (e.hasChanged(monaco.editor.EditorOption.fontInfo)) {
                            const newFontInfo = codeEditorWidget.getOption(
                                monaco.editor.EditorOption.fontInfo,
                            );
                            const newCharWidth =
                                newFontInfo.typicalHalfwidthCharacterWidth ||
                                newFontInfo.spaceWidth;
                            if (newCharWidth > 0) {
                                updateLineDecorationsWidthPx(newCharWidth);
                                if (onCharWidthChanged) {
                                    onCharWidthChanged(newCharWidth);
                                }
                            }
                        }
                    },
                ),
            );
        })();
    });

    onDestroy(() => {
        destroyed = true;
        activationEpoch += 1;
        activationState = "idle";
        activatingSessionId = undefined;

        if (codeEditorWidget) {
            saveSessionState(currentSessionId());
        }

        sessionModelManager.clear();
        editorHost.clearEditor();
        handledCommandNonces.clear();

        disposables.forEach((d) => d.dispose());
        if (inputVisibilityAnimationFrame !== undefined) {
            cancelAnimationFrame(inputVisibilityAnimationFrame);
        }
        if (codeEditorWidget) {
            codeEditorWidget.dispose();
        }
    });

    // Handle external input commands (Positron pattern)
    $effect(() => {
        if (!inputCommand || handledCommandNonces.has(inputCommand.nonce)) {
            return;
        }

        const targetSessionId = inputCommand.sessionId;
        const activeCommittedSessionId = committedSessionId;
        const isActivationPending = activationState === "switching";
        handledCommandNonces.add(inputCommand.nonce);

        if (!codeEditorWidget) {
            enqueuePendingCommand(targetSessionId, inputCommand.command);
            return;
        }

        if (isActivationPending) {
            if (
                needsActiveEditorContext(inputCommand.command) &&
                targetSessionId !== activeCommittedSessionId &&
                targetSessionId !== activatingSessionId
            ) {
                onActivate(targetSessionId);
            }
            enqueuePendingCommand(targetSessionId, inputCommand.command);
            return;
        }

        if (
            targetSessionId !== activeCommittedSessionId &&
            needsActiveEditorContext(inputCommand.command)
        ) {
            onActivate(targetSessionId);
            enqueuePendingCommand(targetSessionId, inputCommand.command);
            return;
        }

        if (targetSessionId !== activeCommittedSessionId) {
            enqueuePendingCommand(targetSessionId, inputCommand.command);
            return;
        }

        applyCommandToActiveSession(inputCommand.command);
    });

    $effect(() => {
        activeRef.current = active;

        if (!codeEditorWidget) {
            return;
        }

        void activateSessionModel(sessionId, currentLanguageId());
    });

    $effect(() => {
        syncKnownSessionModels();
        sessionModelManager.updateConnection(connection);
    });

    $effect(() => {
        const targetSessionId = sessionId;
        const targetLanguageId = currentLanguageId();
        void languageAssetsVersion;

        void ensureLanguageSupportRegistered(targetLanguageId).then(() => {
            if (destroyed || !codeEditorWidget) {
                return;
            }

            void activateSessionModel(targetSessionId, targetLanguageId, true);
        });
    });

    function getVSCodeTheme(): string {
        const fallbackTheme: ConsoleThemeData = {
            base: "vs-dark",
            rules: [],
        };
        return applyMonacoTheme(fallbackTheme);
    }

    $effect(() => {
        const currentThemeData = themeData;

        if (!currentThemeData || !codeEditorWidget) {
            return;
        }

        applyMonacoTheme(currentThemeData);
    });

    $effect(() => {
        const currentConsoleSettings = consoleSettings;

        if (!codeEditorWidget) {
            return;
        }

        applyConsoleFontSettings(currentConsoleSettings);
    });

    function shouldTriggerSuggestOnTab(): boolean {
        if (!codeEditorWidget) return false;

        const selection = codeEditorWidget.getSelection();
        if (selection && !selection.isEmpty()) {
            return false;
        }

        const model = codeEditorWidget.getModel();
        const position = codeEditorWidget.getPosition();
        if (!model || !position) return false;

        if (position.column <= 1) {
            return false;
        }

        const line = model.getLineContent(position.lineNumber);
        const leftChar = line.charAt(position.column - 2);
        if (!leftChar || /\s/.test(leftChar)) {
            return false;
        }

        // Avoid triggering on empty/grouping parentheses.
        if (leftChar === "(" || leftChar === ")") {
            return false;
        }

        if (leftChar === ":") {
            const prevChar = line.charAt(position.column - 3);
            return prevChar === ":";
        }

        return /[A-Za-z0-9_.@$/]/.test(leftChar);
    }

    function hasVisibleSuggestWidget(): boolean {
        if (typeof document === "undefined") {
            return false;
        }
        return Array.from(
            document.getElementsByClassName("suggest-widget"),
        ).some((widget) => widget.classList.contains("visible"));
    }

    function cancelSuggestWidget(): void {
        const suggestController = codeEditorWidget.getContribution(
            "editor.contrib.suggestController",
        ) as { cancelSuggestWidget?: () => void } | undefined;
        suggestController?.cancelSuggestWidget?.();
    }

    function moveHistoryBrowserSelection(delta: number): void {
        if (historyItems.length === 0) {
            historyBrowserSelectedIndex = 0;
            return;
        }

        historyBrowserSelectedIndex = Math.min(
            historyItems.length - 1,
            Math.max(0, historyBrowserSelectedIndex + delta),
        );
    }

    function setupKeyBindings() {
        // Handle Enter/Shift+Enter via editor keydown to avoid global keybinding leakage
        disposables.push(
            codeEditorWidget.onKeyDown((e: monaco.IKeyboardEvent) => {
                // Match Positron: if the suggest widget is visibly open, let Monaco
                // own Tab/Enter/arrow handling instead of second-guessing suggest state.
                const ctrlCmd = e.ctrlKey || e.metaKey;
                const suggestVisible = hasVisibleSuggestWidget();
                if (!ctrlCmd && suggestVisible) {
                    if (e.keyCode === monaco.KeyCode.Enter && !e.shiftKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        codeEditorWidget.trigger(
                            "keyboard",
                            "acceptSelectedSuggestion",
                            null,
                        );
                    }
                    return;
                }

                if (e.keyCode === monaco.KeyCode.Tab) {
                    if (historyBrowserActive) {
                        e.preventDefault();
                        e.stopPropagation();
                        acceptHistoryMatch(historyBrowserSelectedIndex);
                        return;
                    }

                    // Only trigger completions when there's a meaningful token before the cursor.
                    if (shouldTriggerSuggestOnTab()) {
                        e.preventDefault();
                        e.stopPropagation();
                        codeEditorWidget.trigger(
                            "keyboard",
                            "editor.action.triggerSuggest",
                            null,
                        );
                    }
                    return;
                }

                if (e.keyCode === monaco.KeyCode.Enter && !e.shiftKey) {
                    if (historyBrowserActive) {
                        e.preventDefault();
                        e.stopPropagation();
                        acceptHistoryMatch(historyBrowserSelectedIndex);
                        return;
                    }

                    const editorDomNode = codeEditorWidget.getDomNode();
                    const activeElement =
                        document.activeElement as HTMLElement | null;
                    const hasFocus =
                        codeEditorWidget.hasTextFocus() ||
                        codeEditorWidget.hasWidgetFocus() ||
                        (!!editorDomNode &&
                            !!activeElement &&
                            editorDomNode.contains(activeElement));

                    if (!activeRef.current && !hasFocus) {
                        return;
                    }
                    if (!activeRef.current && hasFocus) {
                        onActivate(currentSessionId());
                    }
                    if (stateRef.current !== "ready") {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!deferCodeEditorWidgetCodeUntilReady()) {
                            codeEditorWidget.trigger("keyboard", "type", {
                                text: "\n",
                            });
                        }
                        return;
                    }

                    e.preventDefault();
                    e.stopPropagation();

                    void (async () => {
                        if (!(await executeCodeEditorWidgetCodeIfPossible())) {
                            // Code was not executed, insert a new line
                            codeEditorWidget.trigger("keyboard", "type", {
                                text: "\n",
                            });
                        }
                    })();
                    return;
                }

                if (e.keyCode === monaco.KeyCode.Enter && e.shiftKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    codeEditorWidget.trigger("keyboard", "type", {
                        text: "\n",
                    });
                    return;
                }

                // UpArrow: Ctrl+Up for history search, or suggest widget nav, or history
                // Uses onKeyDown (per-editor) instead of addCommand (global)
                // to avoid cross-editor interference in multi-session mode
                if (e.keyCode === monaco.KeyCode.UpArrow) {
                    if (historyBrowserActive) {
                        e.preventDefault();
                        e.stopPropagation();
                        moveHistoryBrowserSelection(-1);
                        return;
                    }

                    // Ctrl/Cmd+Up: Engage prefix history search (RStudio style)
                    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        engageHistoryBrowser(
                            new HistoryPrefixMatchStrategy(historyEntries),
                        );
                        return;
                    }

                    const position = codeEditorWidget.getPosition();
                    if (position?.lineNumber === 1) {
                        e.preventDefault();
                        e.stopPropagation();
                        navigateHistoryUp();
                        return;
                    }

                    return;
                }

                // DownArrow: navigate suggest widget or history
                if (e.keyCode === monaco.KeyCode.DownArrow) {
                    if (historyBrowserActive) {
                        e.preventDefault();
                        e.stopPropagation();
                        moveHistoryBrowserSelection(1);
                        return;
                    }

                    const position = codeEditorWidget.getPosition();
                    const textModel = codeEditorWidget.getModel();
                    if (position?.lineNumber === textModel?.getLineCount()) {
                        e.preventDefault();
                        e.stopPropagation();
                        navigateHistoryDown();
                        return;
                    }

                    return;
                }

                // Ctrl+C: interrupt when there is no selection, otherwise let Monaco copy.
                if (
                    ctrlCmd &&
                    e.keyCode === monaco.KeyCode.KeyC &&
                    !e.shiftKey &&
                    !e.altKey
                ) {
                    const consoleInstance =
                        codeEditorWidgetContainerRef?.closest(
                            ".console-instance",
                        );
                    if (
                        consoleInstance instanceof HTMLElement &&
                        copyScopedSelection(consoleInstance)
                    ) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                }

                // Ctrl+C: interrupt when there is no Monaco selection, otherwise let Monaco copy.
                if (
                    e.ctrlKey &&
                    !e.metaKey &&
                    e.keyCode === monaco.KeyCode.KeyC &&
                    !e.shiftKey &&
                    !e.altKey
                ) {
                    const selection = codeEditorWidget.getSelection();
                    if (!selection || selection.isEmpty()) {
                        e.preventDefault();
                        e.stopPropagation();
                        onInterrupt(currentSessionId());
                    }
                    return;
                }

                // Ctrl/Cmd+U: Delete all left (Positron pattern)
                if (
                    ctrlCmd &&
                    e.keyCode === monaco.KeyCode.KeyU &&
                    !e.shiftKey &&
                    !e.altKey
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    const position = codeEditorWidget.getPosition();
                    if (position) {
                        const model = codeEditorWidget.getModel();
                        if (model) {
                            const range = new monaco.Range(
                                position.lineNumber,
                                1,
                                position.lineNumber,
                                position.column,
                            );
                            model.applyEdits([{ range, text: "" }]);
                        }
                    }
                    return;
                }

                // Ctrl/Cmd+A: Select all (Positron pattern)
                if (
                    ctrlCmd &&
                    e.keyCode === monaco.KeyCode.KeyA &&
                    !e.shiftKey &&
                    !e.altKey
                ) {
                    const codeFragment = codeEditorWidget.getValue();
                    if (!codeFragment.length) {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelectAll();
                    }
                    return;
                }

                // Ctrl/Cmd+F: open whole-console search instead of Monaco find.
                if (
                    ctrlCmd &&
                    e.keyCode === monaco.KeyCode.KeyF &&
                    !e.shiftKey &&
                    !e.altKey
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenSearch?.(currentSessionId());
                    return;
                }

                // Ctrl+R: engage infix history search (bash style).
                if (
                    !isMacintosh &&
                    e.ctrlKey &&
                    !e.metaKey &&
                    e.keyCode === monaco.KeyCode.KeyR &&
                    !e.shiftKey &&
                    !e.altKey
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    engageHistoryBrowser(
                        new HistoryInfixMatchStrategy(historyEntries),
                    );
                    return;
                }

                // Ctrl/Cmd+Shift+M: Insert pipe operator |> (RStudio style)
                if (
                    ctrlCmd &&
                    e.shiftKey &&
                    e.keyCode === monaco.KeyCode.KeyM &&
                    !e.altKey
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    codeEditorWidget.trigger("keyboard", "type", {
                        text: " |> ",
                    });
                    return;
                }

                // Ctrl/Cmd+L: Clear console (RStudio style)
                if (
                    ctrlCmd &&
                    e.keyCode === monaco.KeyCode.KeyL &&
                    !e.shiftKey &&
                    !e.altKey
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    onClearConsole?.(currentSessionId());
                    return;
                }

                // Alt+-: Insert assignment operator <- (RStudio style)
                if (
                    e.altKey &&
                    e.keyCode === monaco.KeyCode.Minus &&
                    !e.ctrlKey &&
                    !e.metaKey &&
                    !e.shiftKey
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    codeEditorWidget.trigger("keyboard", "type", {
                        text: " <- ",
                    });
                    return;
                }

                // Escape: Dismiss history browser or interrupt
                if (e.keyCode === monaco.KeyCode.Escape) {
                    if (historyBrowserActive) {
                        e.preventDefault();
                        e.stopPropagation();
                        disengageHistoryBrowser();
                    } else if (stateRef.current === "busy") {
                        e.preventDefault();
                        e.stopPropagation();
                        onInterrupt(currentSessionId());
                    }
                    return;
                }
            }),
        );
    }

    // Focus management for multi-session support.
    // Active/inactive controls whether the editor can capture events, but
    // activation alone must not move keyboard focus into the console.
    $effect(() => {
        // Sync activeRef.current with the latest active prop value
        activeRef.current = active;

        if (codeEditorWidget) {
            const editorDomNode = codeEditorWidget.getDomNode();
            const isEnabled = active && !hidden;

            if (isEnabled) {
                // Active session: enable the editor without stealing focus.
                if (editorDomNode) {
                    // Restore pointer events and visibility
                    editorDomNode.style.pointerEvents = "";
                    editorDomNode.style.visibility = "";
                }
            } else {
                // Inactive session: completely disable the editor to prevent keyboard capture
                if (editorDomNode) {
                    // Prevent all pointer events and hide visually
                    editorDomNode.style.pointerEvents = "none";
                    // Use visibility:hidden instead of display:none to maintain layout
                    // but prevent keyboard focus
                    editorDomNode.style.visibility = "hidden";
                }
                // Explicitly blur to prevent hidden editors capturing keys
                const domNode = codeEditorWidget.getDomNode();
                domNode?.blur();
                const inputArea = domNode?.querySelector("textarea");
                if (inputArea instanceof HTMLElement) {
                    inputArea.blur();
                }
            }
        }
    });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
    class="console-input"
    class:hidden
    role="textbox"
    tabindex="-1"
    onclick={() => {
        if (hidden) return;
        onActivate(currentSessionId());
        requestAnimationFrame(() => {
            codeEditorWidget?.focus();
        });
    }}
>
    <div
        class="code-editor-widget-container"
        bind:this={codeEditorWidgetContainerRef}
    ></div>

    {#if historyBrowserActive}
        <HistoryBrowserPopup
            items={historyItems}
            selectedIndex={historyBrowserSelectedIndex}
            bottomPx={codeEditorWidgetContainerRef?.getBoundingClientRect()
                .height ?? 30}
            leftPx={24}
            onSelected={acceptHistoryMatch}
            onDismissed={disengageHistoryBrowser}
        />
    {/if}
</div>

<style>
    .console-input {
        display: flex;
        position: relative;
        width: 100%;
        padding-bottom: 10px;
        background: var(--vscode-input-background);
        white-space: normal;
    }

    .console-input.hidden {
        display: none;
    }

    .code-editor-widget-container {
        width: 100%;
    }

    /* Override Monaco's default styles to match VS Code webview */
    :global(.monaco-editor) {
        background-color: var(--vscode-input-background) !important;
    }

    :global(.monaco-editor .margin) {
        background-color: var(--vscode-input-background) !important;
    }

    :global(.monaco-editor .line-numbers) {
        color: var(--vscode-terminal-ansiBrightBlue) !important;
        font-weight: bold;
    }

    /* Ensure Monaco's suggest widget and signature help can extend beyond container */
    :global(.monaco-editor .suggest-widget),
    :global(.monaco-editor .signature-help-widget),
    :global(.monaco-editor .parameter-hints-widget) {
        z-index: 10000 !important;
    }

    /* Fixed overflow widgets container should be visible above everything */
    :global(.overflow-guard > .overflowingContentWidgets) {
        z-index: 10000 !important;
    }

    /* --- Monaco widget theme overrides using VS Code CSS variables --- */

    /* Hover widget */
    :global(.monaco-editor .monaco-hover) {
        background-color: var(
            --vscode-editorHoverWidget-background,
            var(--vscode-editorWidget-background)
        ) !important;
        color: var(
            --vscode-editorHoverWidget-foreground,
            var(--vscode-editorWidget-foreground)
        ) !important;
        border: 1px solid
            var(
                --vscode-editorHoverWidget-border,
                var(--vscode-editorWidget-border, transparent)
            ) !important;
    }

    :global(.monaco-editor .monaco-hover .hover-row),
    :global(.monaco-editor .monaco-hover .hover-contents),
    :global(.monaco-editor .monaco-hover .markdown-hover) {
        background-color: var(
            --vscode-editorHoverWidget-background,
            var(--vscode-editorWidget-background)
        ) !important;
        color: var(
            --vscode-editorHoverWidget-foreground,
            var(--vscode-editorWidget-foreground)
        ) !important;
    }

    :global(.monaco-editor .monaco-hover .hover-row .actions) {
        background-color: var(
            --vscode-editorHoverWidget-statusBarBackground,
            var(
                --vscode-editorHoverWidget-background,
                var(--vscode-editorWidget-background)
            )
        ) !important;
    }

    /* Suggest widget */
    :global(.monaco-editor .suggest-widget) {
        background-color: var(
            --vscode-editorSuggestWidget-background,
            var(--vscode-editorWidget-background)
        ) !important;
        color: var(
            --vscode-editorSuggestWidget-foreground,
            var(--vscode-editorWidget-foreground)
        ) !important;
        border: 1px solid
            var(
                --vscode-editorSuggestWidget-border,
                var(--vscode-editorWidget-border, transparent)
            ) !important;
    }

    :global(
            .monaco-editor .suggest-widget .monaco-list .monaco-list-row.focused
        ) {
        background-color: var(
            --vscode-editorSuggestWidget-selectedBackground,
            var(--vscode-list-activeSelectionBackground)
        ) !important;
        color: var(
            --vscode-editorSuggestWidget-selectedForeground,
            var(--vscode-list-activeSelectionForeground)
        ) !important;
    }

    :global(.monaco-editor .suggest-widget .details) {
        background-color: var(
            --vscode-editorSuggestWidget-background,
            var(--vscode-editorWidget-background)
        ) !important;
        color: var(
            --vscode-editorSuggestWidget-foreground,
            var(--vscode-editorWidget-foreground)
        ) !important;
        border-left: 1px solid
            var(
                --vscode-editorSuggestWidget-border,
                var(--vscode-editorWidget-border, transparent)
            ) !important;
    }

    /* Parameter hints / signature help widget */
    :global(.monaco-editor .parameter-hints-widget) {
        background-color: var(
            --vscode-editorHoverWidget-background,
            var(--vscode-editorWidget-background)
        ) !important;
        color: var(
            --vscode-editorHoverWidget-foreground,
            var(--vscode-editorWidget-foreground)
        ) !important;
        border: 1px solid
            var(
                --vscode-editorHoverWidget-border,
                var(--vscode-editorWidget-border, transparent)
            ) !important;
    }

    :global(.monaco-editor .parameter-hints-widget .signature) {
        color: var(
            --vscode-editorHoverWidget-foreground,
            var(--vscode-editorWidget-foreground)
        ) !important;
    }

    /* General widget/context menu theming */
    :global(.monaco-editor .context-view .monaco-menu) {
        background-color: var(
            --vscode-menu-background,
            var(--vscode-editorWidget-background)
        ) !important;
        color: var(
            --vscode-menu-foreground,
            var(--vscode-editorWidget-foreground)
        ) !important;
    }

    :global(.monaco-editor .rename-box) {
        background-color: var(--vscode-editorWidget-background) !important;
        color: var(--vscode-editorWidget-foreground) !important;
        border: 1px solid var(--vscode-editorWidget-border, transparent) !important;
    }
</style>
