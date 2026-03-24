<script lang="ts">
    /**
     * ConsoleInstance.svelte - Per-session console view
     * Based on Positron's ConsoleInstance in consoleInstance.tsx
     */
    import { onMount, onDestroy } from "svelte";
    import ContextMenu, {
        type ContextMenuEntry,
    } from "../shared/ContextMenu.svelte";
    import ConsoleInstanceItems from "./ConsoleInstanceItems.svelte";
    import ConsoleSearchWidget from "./ConsoleSearchWidget.svelte";
    import type { RuntimeItem } from "./classes";
    import { getVsCodeState, setVsCodeState } from "../lib/rpc/client";
    import type { ConsoleState } from "../types/console";
    import {
        type SearchOptions,
        type SearchMatch,
        defaultSearchOptions,
        buildSearchRegex,
        findMatchesInDOM,
        applyHighlights,
        clearHighlights,
        scrollCurrentMatchIntoView,
    } from "./utils/consoleSearch";
    import {
        copyScopedSelection,
        getScopedSelection,
    } from "./utils/selectionUtils";

    interface SessionInfo {
        id: string;
        name: string;
        runtimeName: string;
        languageId?: string;
        state: ConsoleState;
    }

    /** Persisted state structure for this console */
    interface ConsolePersistedState {
        scrollPositions?: Record<string, number>;
        scrollLocked?: Record<string, boolean>;
    }

    // Props
    let {
        session,
        active = false,
        width = 600,
        height = 400,
        runtimeItems = [],
        runtimeItemsMarker = 0,
        forceScrollMarker = 0,
        wordWrap = true,
        revealRequest = undefined,
        openSearchRequest = undefined,
        languageAssetsVersion = 0,
        charWidth = 0,
        onSelectAll,
        onFocusInput,
        onTypeToInput,
        onPasteText,
        onRestart = undefined,
        onInputAnchorReady = undefined,
        onWidthInCharsChanged = undefined,
    }: {
        session: SessionInfo;
        active: boolean;
        width: number;
        height: number;
        runtimeItems: RuntimeItem[];
        runtimeItemsMarker: number;
        forceScrollMarker: number;
        wordWrap: boolean;
        revealRequest:
            | { sessionId: string; executionId: string; nonce: number }
            | undefined;
        openSearchRequest: { sessionId: string; nonce: number } | undefined;
        languageAssetsVersion?: number;
        charWidth: number;
        onSelectAll: () => void;
        onFocusInput: () => void;
        onTypeToInput: (text: string) => void;
        onPasteText: (text: string) => void;
        onRestart?: () => void;
        onInputAnchorReady?: (
            sessionId: string,
            anchor: HTMLDivElement | null,
        ) => void;
        onWidthInCharsChanged?: (
            sessionId: string,
            widthInChars: number,
        ) => void;
    } = $props();

    // State
    let scrollLocked = $state(false);
    // svelte-ignore non_reactive_update
    let consoleInstanceRef: HTMLDivElement;
    let isInitialMount = $state(true);
    let hasRestoredScroll = $state(false);
    let lastRevealNonce = $state<number | undefined>(undefined);
    let lastOpenSearchNonce = $state<number | undefined>(undefined);
    let lastWidthInChars = $state<number | undefined>(undefined);
    let inputAnchorRef: HTMLDivElement;
    let widthInCharsAnimationFrame: number | undefined;
    let lastRuntimeItemsMarker = $state(0);
    let lastForceScrollMarker = $state(0);

    // Search state
    let searchVisible = $state(false);
    let searchFocusNonce = $state(0);
    let searchQuery = $state("");
    let searchOptions = $state<SearchOptions>({ ...defaultSearchOptions });
    let searchMatches = $state<SearchMatch[]>([]);
    let currentMatchIndex = $state(0);
    let searchInputDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    let searchContentRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    let searchContentObserver: MutationObserver | undefined;
    let showContextMenu = $state(false);
    let contextMenuX = $state(0);
    let contextMenuY = $state(0);
    let contextMenuClipboardText = $state("");
    let contextMenuCopyEnabled = $state(false);

    const contextMenuEntries = $derived.by(
        (): ContextMenuEntry[] => [
            {
                label: "Copy",
                disabled: !contextMenuCopyEnabled,
                onSelected: copySelection,
            },
            {
                label: "Paste",
                disabled: contextMenuClipboardText === "",
                onSelected: () => {
                    pasteText(contextMenuClipboardText);
                },
            },
            { separator: true },
            {
                label: "Select All",
                onSelected: () => onSelectAll(),
            },
        ],
    );

    /**
     * Saves the current scroll position to VS Code state.
     * This persists across webview hide/show and even disposal.
     */
    function saveScrollPosition() {
        if (!consoleInstanceRef) return;

        const state = getVsCodeState<ConsolePersistedState>() || {};
        state.scrollPositions = state.scrollPositions || {};
        state.scrollLocked = state.scrollLocked || {};

        state.scrollPositions[session.id] = consoleInstanceRef.scrollTop;
        state.scrollLocked[session.id] = scrollLocked;

        setVsCodeState(state);
    }

    /**
     * Restores the scroll position from VS Code state.
     */
    function restoreScrollPosition() {
        if (!consoleInstanceRef || hasRestoredScroll) return;

        const state = getVsCodeState<ConsolePersistedState>();
        if (state?.scrollPositions?.[session.id] !== undefined) {
            const savedPosition = state.scrollPositions[session.id];
            const savedLocked = state.scrollLocked?.[session.id] ?? false;

            requestAnimationFrame(() => {
                if (consoleInstanceRef) {
                    consoleInstanceRef.scrollTop = savedPosition;
                    scrollLocked = savedLocked;
                    hasRestoredScroll = true;
                }
            });
        } else {
            hasRestoredScroll = true;
        }
    }

    /**
     * Handle scroll events for scroll lock
     */
    function handleScroll(e: Event) {
        const container = e.target as HTMLDivElement;
        const scrollPosition = Math.abs(
            container.scrollHeight -
                container.clientHeight -
                container.scrollTop,
        );

        // Update scroll lock state
        if (scrollPosition >= 1) {
            scrollLocked = true;
        } else {
            scrollLocked = false;
        }

        // Save scroll position for persistence
        saveScrollPosition();
    }

    /**
     * Scroll to bottom
     */
    function scrollToBottom() {
        scrollLocked = false;
        if (consoleInstanceRef) {
            consoleInstanceRef.scrollTop = consoleInstanceRef.scrollHeight;
            saveScrollPosition();
        }
    }

    /**
     * Scroll to bottom if not locked
     */
    function scrollToBottomIfNeeded() {
        if (!scrollLocked && consoleInstanceRef) {
            requestAnimationFrame(() => {
                if (scrollLocked || !consoleInstanceRef) {
                    return;
                }
                consoleInstanceRef.scrollTop = consoleInstanceRef.scrollHeight;
                saveScrollPosition();
            });
        }
    }

    /**
     * Handle click to focus input
     */
    function handleClick(_e: MouseEvent) {
        closeContextMenu();
        const selection = window.getSelection();
        if ((!selection || selection.type !== "Range") && !scrollLocked) {
            onFocusInput();
        }
    }

    function getConsoleSelection(): Selection | null {
        return getScopedSelection(consoleInstanceRef);
    }

    function copySelection() {
        copyScopedSelection(consoleInstanceRef);
    }

    function pasteText(text: string) {
        if (!text.length) {
            onFocusInput();
            return;
        }

        scrollToBottom();
        onPasteText(text);
    }

    function closeContextMenu() {
        showContextMenu = false;
    }

    async function handleContextMenu(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        const selection = getConsoleSelection();
        contextMenuCopyEnabled = selection?.type === "Range";

        try {
            contextMenuClipboardText = await navigator.clipboard.readText();
        } catch {
            contextMenuClipboardText = "";
        }

        contextMenuX = event.clientX;
        contextMenuY = event.clientY;
        showContextMenu = true;
    }

    /**
     * Handle keyboard shortcuts
     */
    // --- Search methods ---

    function getSearchContainer(): HTMLElement | null {
        return (
            consoleInstanceRef?.querySelector(
                ".console-instance-container",
            ) ?? null
        );
    }

    function clearSearchResults() {
        searchMatches = [];
        currentMatchIndex = 0;
        clearHighlights();
    }

    function scheduleSearchRefresh(
        preserveCurrentIndex = true,
        immediate = false,
    ) {
        if (!searchVisible || !searchQuery || !consoleInstanceRef) {
            return;
        }

        if (searchContentRefreshTimer) {
            clearTimeout(searchContentRefreshTimer);
        }

        searchContentRefreshTimer = setTimeout(() => {
            searchContentRefreshTimer = undefined;
            performSearch(searchQuery, searchOptions, preserveCurrentIndex);
        }, immediate ? 0 : 60);
    }

    function observeSearchContent() {
        searchContentObserver?.disconnect();

        const container = getSearchContainer();
        if (!container) {
            return;
        }

        searchContentObserver = new MutationObserver((mutations) => {
            if (!searchVisible || !searchQuery) {
                return;
            }

            const hasRelevantMutation = mutations.some(
                (mutation) =>
                    mutation.type === "characterData" ||
                    mutation.addedNodes.length > 0 ||
                    mutation.removedNodes.length > 0,
            );
            if (!hasRelevantMutation) {
                return;
            }

            scheduleSearchRefresh(true);
        });

        searchContentObserver.observe(container, {
            childList: true,
            subtree: true,
            characterData: true,
        });
    }

    function openSearch() {
        searchVisible = true;
        searchFocusNonce += 1;
        scheduleSearchRefresh(true, true);
    }

    function closeSearch() {
        searchVisible = false;
        if (searchInputDebounceTimer) {
            clearTimeout(searchInputDebounceTimer);
            searchInputDebounceTimer = undefined;
        }
        if (searchContentRefreshTimer) {
            clearTimeout(searchContentRefreshTimer);
            searchContentRefreshTimer = undefined;
        }
        clearSearchResults();
    }

    function handleSearch(
        query: string,
        options: {
            caseSensitive: boolean;
            useRegex: boolean;
            wholeWord: boolean;
        },
    ) {
        searchQuery = query;
        searchOptions = { ...options };

        // Debounce search for performance
        if (searchInputDebounceTimer) {
            clearTimeout(searchInputDebounceTimer);
        }
        searchInputDebounceTimer = setTimeout(() => {
            searchInputDebounceTimer = undefined;
            performSearch(query, options, false);
        }, 150);
    }

    function performSearch(
        query: string,
        options: SearchOptions,
        preserveCurrentIndex = false,
    ) {
        if (!query || !consoleInstanceRef) {
            clearSearchResults();
            return;
        }

        const regex = buildSearchRegex(query, options);
        if (!regex) {
            clearSearchResults();
            return;
        }

        // Search within the console-instance-container (excludes search widget)
        const container = getSearchContainer();
        if (!container) {
            clearSearchResults();
            return;
        }

        const matches = findMatchesInDOM(container, regex);
        searchMatches = matches;
        currentMatchIndex =
            matches.length === 0
                ? -1
                : preserveCurrentIndex
                  ? Math.min(
                        Math.max(currentMatchIndex, 0),
                        matches.length - 1,
                    )
                  : 0;

        applyHighlights(searchMatches, currentMatchIndex);
        if (matches.length > 0) {
            scrollCurrentMatchIntoView(searchMatches, currentMatchIndex);
        }
    }

    function navigateNextMatch() {
        if (searchMatches.length === 0) return;
        currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
        applyHighlights(searchMatches, currentMatchIndex);
        scrollCurrentMatchIntoView(searchMatches, currentMatchIndex);
    }

    function navigatePreviousMatch() {
        if (searchMatches.length === 0) return;
        currentMatchIndex =
            (currentMatchIndex - 1 + searchMatches.length) %
            searchMatches.length;
        applyHighlights(searchMatches, currentMatchIndex);
        scrollCurrentMatchIntoView(searchMatches, currentMatchIndex);
    }

    // --- Keyboard shortcut handling ---

    function handleKeyDown(e: KeyboardEvent) {
        if (showContextMenu) {
            closeContextMenu();
        }

        const isCmdOrCtrl = e.ctrlKey || e.metaKey;
        const noOtherModifiers = !e.shiftKey && !e.altKey;
        const onlyShiftKey = e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;

        if (isCmdOrCtrl && noOtherModifiers) {
            switch (e.key.toLowerCase()) {
                case "f": {
                    // Open search
                    e.preventDefault();
                    e.stopPropagation();
                    openSearch();
                    break;
                }
                case "c": {
                    // Copy selected text
                    if (copyScopedSelection(consoleInstanceRef)) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    break;
                }
                case "a": {
                    // Select all console output
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectAll();
                    break;
                }
                case "v": {
                    e.preventDefault();
                    e.stopPropagation();
                    void navigator.clipboard
                        .readText()
                        .then((text) => {
                            pasteText(text);
                        })
                        .catch(() => {
                            onFocusInput();
                        });
                    break;
                }
            }
        }

        // F3 / Shift+F3 for next/previous match
        if (e.key === "F3" && searchVisible) {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) {
                navigatePreviousMatch();
            } else {
                navigateNextMatch();
            }
        }

        // Scrolling keys
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
            switch (e.key) {
                case "PageUp":
                    e.preventDefault();
                    scrollLocked = true;
                    consoleInstanceRef.scrollTop -=
                        consoleInstanceRef.clientHeight * 0.9;
                    saveScrollPosition();
                    break;
                case "PageDown":
                    e.preventDefault();
                    consoleInstanceRef.scrollTop +=
                        consoleInstanceRef.clientHeight * 0.9;
                    saveScrollPosition();
                    break;
                case "Home":
                    e.preventDefault();
                    scrollLocked = true;
                    consoleInstanceRef.scrollTop = 0;
                    saveScrollPosition();
                    break;
                case "End":
                    e.preventDefault();
                    scrollToBottom();
                    break;
            }
        }

        if (
            (noOtherModifiers || onlyShiftKey) &&
            e.key.length === 1 &&
            !searchVisible
        ) {
            e.preventDefault();
            e.stopPropagation();
            onTypeToInput(e.key);
        }
    }

    /**
     * Handle wheel events for scroll lock
     */
    function handleWheel(e: WheelEvent) {
        if (e.deltaY < 0 && !scrollLocked) {
            // Scrolling up engages scroll lock
            const scrollable =
                consoleInstanceRef.scrollHeight >
                consoleInstanceRef.clientHeight;
            scrollLocked = scrollable;
        }
    }

    /**
     * Reveal (scroll to and highlight) a specific execution.
     */
    function revealExecution(executionId: string) {
        if (!consoleInstanceRef) return;

        const element = consoleInstanceRef.querySelector(
            `[data-execution-id="${executionId}"]`,
        );
        if (!element) return;

        const activityInput = element.querySelector(".activity-input");
        if (!activityInput) return;

        element.scrollIntoView({ behavior: "smooth", block: "center" });
        activityInput.classList.add("revealed");

        window.setTimeout(() => {
            activityInput.classList.remove("revealed");
        }, 2000);
    }

    function updateWidthInCharsFromConsoleInstance() {
        if (!onWidthInCharsChanged || charWidth <= 0) {
            return;
        }

        let consoleInputWidth = adjustedWidth;
        if (consoleInstanceRef?.scrollHeight >= consoleInstanceRef?.clientHeight) {
            consoleInputWidth -= 14;
        }

        if (consoleInputWidth <= 0) {
            return;
        }

        const widthInChars = Math.max(
            40,
            Math.floor(consoleInputWidth / charWidth),
        );

        if (widthInChars !== lastWidthInChars) {
            lastWidthInChars = widthInChars;
            onWidthInCharsChanged(session.id, widthInChars);
        }
    }

    function scheduleWidthInCharsUpdate() {
        if (widthInCharsAnimationFrame !== undefined) {
            cancelAnimationFrame(widthInCharsAnimationFrame);
        }

        widthInCharsAnimationFrame = requestAnimationFrame(() => {
            widthInCharsAnimationFrame = undefined;
            updateWidthInCharsFromConsoleInstance();
        });
    }

    // Restore scroll position on mount
    onMount(() => {
        if (onInputAnchorReady && inputAnchorRef) {
            onInputAnchorReady(session.id, inputAnchorRef);
        }

        // Wait for DOM to be ready, then restore scroll position
        requestAnimationFrame(() => {
            restoreScrollPosition();
            observeSearchContent();
            isInitialMount = false;
        });
        scheduleWidthInCharsUpdate();
    });

    // Clean up search on destroy
    onDestroy(() => {
        onInputAnchorReady?.(session.id, null);
        clearHighlights();
        if (searchInputDebounceTimer) {
            clearTimeout(searchInputDebounceTimer);
        }
        if (searchContentRefreshTimer) {
            clearTimeout(searchContentRefreshTimer);
        }
        searchContentObserver?.disconnect();
        if (widthInCharsAnimationFrame !== undefined) {
            cancelAnimationFrame(widthInCharsAnimationFrame);
        }
    });

    $effect(() => {
        if (runtimeItemsMarker === lastRuntimeItemsMarker) {
            return;
        }

        lastRuntimeItemsMarker = runtimeItemsMarker;
        if (
            runtimeItemsMarker > 0 &&
            !scrollLocked &&
            !isInitialMount &&
            hasRestoredScroll
        ) {
            scrollToBottomIfNeeded();
        }
    });

    $effect(() => {
        if (
            revealRequest &&
            revealRequest.sessionId === session.id &&
            revealRequest.nonce !== lastRevealNonce
        ) {
            lastRevealNonce = revealRequest.nonce;
            revealExecution(revealRequest.executionId);
        }
    });

    $effect(() => {
        if (forceScrollMarker === lastForceScrollMarker) {
            return;
        }

        lastForceScrollMarker = forceScrollMarker;
        if (forceScrollMarker > 0) {
            scrollToBottom();
        }
    });

    $effect(() => {
        if (
            openSearchRequest &&
            openSearchRequest.sessionId === session.id &&
            openSearchRequest.nonce !== lastOpenSearchNonce
        ) {
            lastOpenSearchNonce = openSearchRequest.nonce;
            openSearch();
        }
    });

    // Adjust width to account for indentation (Positron pattern)
    const adjustedWidth = $derived(width - 10);

    $effect(() => {
        void adjustedWidth;
        void height;
        void charWidth;
        void runtimeItems.length;
        void wordWrap;
        void active;
        void languageAssetsVersion;
        scheduleWidthInCharsUpdate();
    });
</script>

<div
    bind:this={consoleInstanceRef}
    id="console-panel-{session.id}"
    class="console-instance"
    class:hidden={!active}
    role="tabpanel"
    tabindex="0"
    aria-labelledby="console-tab-{session.id}"
    data-testid="console-{session.id}"
    style="width: {adjustedWidth}px; height: {height}px; white-space: {wordWrap
        ? 'pre-wrap'
        : 'pre'}; overflow-x: {wordWrap
        ? 'hidden'
        : 'auto'}; --console-output-white-space: {wordWrap
        ? 'pre-wrap'
        : 'pre'};"
    style:--console-char-width={charWidth > 0 ? `${charWidth}px` : undefined}
    onclick={handleClick}
    onkeydown={handleKeyDown}
    onscroll={handleScroll}
    onwheel={handleWheel}
    oncontextmenu={handleContextMenu}
>
    <!-- Search Widget anchor: sticky keeps it at the scroll viewport top -->
    <div class="search-widget-anchor">
        <ConsoleSearchWidget
            visible={searchVisible}
            focusRequest={searchFocusNonce}
            matchCount={searchMatches.length}
            currentMatchIndex={Math.max(0, currentMatchIndex)}
            onSearch={handleSearch}
            onNextMatch={navigateNextMatch}
            onPreviousMatch={navigatePreviousMatch}
            onClose={closeSearch}
        />
    </div>

    <div class="console-instance-container">
        <!-- prettier-ignore -->
        <ConsoleInstanceItems
            {runtimeItems}
            languageId={session.languageId ?? "plaintext"}
            {languageAssetsVersion}
            {charWidth}
            {onRestart}
            sessionName={session.name || session.runtimeName || "Session"}
        />
        <div class="console-input-anchor" bind:this={inputAnchorRef}></div>
    </div>
</div>

{#if showContextMenu && consoleInstanceRef}
    <ContextMenu
        entries={contextMenuEntries}
        anchorEl={consoleInstanceRef}
        anchorPoint={{ x: contextMenuX, y: contextMenuY }}
        onclose={closeContextMenu}
    />
{/if}

<style>
    .console-instance {
        top: 0;
        left: 0;
        cursor: default;
        position: absolute;
        overflow-y: auto;
        overflow-x: hidden;
        padding-left: 10px;
        font-family: var(--console-content-font-family);
        font-size: var(--console-content-font-size);
        user-select: text;
        -ms-user-select: text;
        -moz-user-select: text;
        -webkit-user-select: text;

        /* Custom scrollbar */
        scrollbar-width: thin;
    }

    .console-instance::-webkit-scrollbar {
        width: 14px;
        height: 14px;
    }

    .console-instance::-webkit-scrollbar:vertical {
        border-left: 1px solid var(--vscode-positronScrollBar-border);
    }

    .console-instance::-webkit-scrollbar:horizontal {
        border-top: 1px solid var(--vscode-positronScrollBar-border);
    }

    .console-instance::-webkit-scrollbar-track {
        opacity: 0;
    }

    .console-instance::-webkit-scrollbar-thumb {
        min-height: 20px;
        background-color: var(
            --vscode-scrollbarSlider-background
        ) !important;
    }

    .console-instance::-webkit-scrollbar-thumb:hover {
        cursor: pointer !important;
        background-color: var(
            --vscode-scrollbarSlider-hoverBackground
        ) !important;
    }

    .console-instance::-webkit-scrollbar-corner {
        border-top: 1px solid var(--vscode-positronScrollBar-border);
        border-left: 1px solid var(--vscode-positronScrollBar-border);
    }

    .console-instance.hidden {
        display: none;
    }

    .console-instance:focus {
        outline: none !important;
    }

    .console-instance-container {
        cursor: text;
        white-space: normal;
        word-wrap: break-word;
    }

    .console-input-anchor {
        width: 100%;
        min-height: 0;
    }

    /* Enable text selection */
    .console-instance ::selection {
        background-color: var(--vscode-editor-selectionBackground);
    }
    .search-widget-anchor {
        position: sticky;
        top: 0;
        z-index: 100;
        width: 100%;
        height: 0;
        overflow: visible;
        display: flex;
        justify-content: flex-end;
        pointer-events: none;
        container-type: inline-size;
    }
</style>
