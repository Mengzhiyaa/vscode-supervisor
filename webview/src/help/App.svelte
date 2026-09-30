<script lang="ts">
    import { onMount } from "svelte";
    import { getRpcConnection } from "$lib/rpc/client";
    import ActionBarButton from "../shared/ActionBarButton.svelte";
    import ActionBarSeparator from "../shared/ActionBarSeparator.svelte";
    import ActionBarMenuButton from "../shared/ActionBarMenuButton.svelte";
    import ContextMenu from "../shared/ContextMenu.svelte";
    import { localize } from "$lib/localization";

    interface HelpEntryState {
        entryId?: string;
        sourceUrl: string;
        targetUrl: string;
        title?: string;
        scrollX: number;
        scrollY: number;
        isWelcome?: boolean;
    }

    interface HistoryEntry {
        sourceUrl: string;
        targetUrl: string;
        title?: string;
    }

    interface HelpStateParams {
        entry?: HelpEntryState;
        history: HistoryEntry[];
        canNavigateBackward: boolean;
        canNavigateForward: boolean;
    }

    interface IframeMessage {
        id: string;
        [key: string]: any;
    }

    const connection = getRpcConnection();

    let currentEntry = $state<HelpEntryState | undefined>(undefined);
    let history = $state<HistoryEntry[]>([]);
    let canNavigateBackward = $state(false);
    let canNavigateForward = $state(false);

    let iframeEl = $state<HTMLIFrameElement | null>(null);
    let pendingScroll = { x: 0, y: 0 };
    let loadState = $state<"idle" | "loading" | "ready" | "error">("idle");
    let reloadVersion = $state(0);
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingFocus = false;
    let retryRequested = false;
    let currentStyles: Record<string, string> = {};
    let contextMenu = $state<{ x: number; y: number; selection: string } | null>(null);

    let findVisible = $state(false);
    let findValue = $state("");
    let findHasResult = $state(true);

    const currentTitle = $derived(
        currentEntry?.title || (currentEntry?.isWelcome ? "Welcome" : "Help"),
    );

    const currentIndex = $derived.by(() => {
        if (!currentEntry) {
            return -1;
        }
        return history.findIndex((entry) => entry.sourceUrl === currentEntry?.sourceUrl);
    });

    /**
     * Shortens a URL by removing the origin
     */
    function shortenUrl(url: string): string {
        try {
            return url.replace(new URL(url).origin, '');
        } catch {
            return url;
        }
    }

    function sendStyles(): void {
        const styles: Record<string, string> = {};
        const computed = getComputedStyle(document.documentElement);
        for (let i = 0; i < computed.length; i++) {
            const name = computed[i];
            if (name.startsWith("--vscode-")) {
                const value = computed.getPropertyValue(name).trim();
                if (value) {
                    styles[name.slice(2)] = value;
                }
            }
        }
        currentStyles = styles;
        connection.sendNotification("help/styles", { styles });
        postToIframe({ id: "positron-help-styles", styles });
    }

    function clearLoadTimer(): void {
        if (loadTimer) {
            clearTimeout(loadTimer);
            loadTimer = undefined;
        }
    }

    function beginLoading(): void {
        clearLoadTimer();
        loadState = "loading";
        loadTimer = setTimeout(() => {
            loadTimer = undefined;
            loadState = "error";
        }, 15000);
    }

    function retryLoad(): void {
        retryRequested = true;
        beginLoading();
        // Ask the host to refresh the proxy URL before recreating the frame.
        sendStyles();
    }

    function handleLoadError(): void {
        clearLoadTimer();
        loadState = "error";
    }

    function focusContent(): void {
        pendingFocus = true;
        if (loadState !== "ready" || !iframeEl) {
            return;
        }
        pendingFocus = false;
        postToIframe({ id: "positron-help-focus" });
        iframeEl.focus();
    }

    function postToIframe(message: Record<string, unknown>): void {
        if (iframeEl?.contentWindow) {
            iframeEl.contentWindow.postMessage(message, "*");
        }
    }

    function handleIframeMessage(message: IframeMessage): void {
        switch (message.id) {
            case "positron-help-complete":
                clearLoadTimer();
                loadState = "ready";
                postToIframe({ id: "positron-help-styles", styles: currentStyles });
                if (message.title) {
                    connection.sendNotification("help/complete", {
                        entryId: currentEntry?.entryId,
                        title: message.title,
                    });
                }
                if (pendingScroll.x || pendingScroll.y) {
                    postToIframe({
                        id: "positron-help-scroll-to",
                        scrollX: pendingScroll.x,
                        scrollY: pendingScroll.y,
                    });
                }
                pendingScroll = { x: 0, y: 0 };
                if (findVisible && findValue) {
                    postToIframe({ id: "positron-help-update-find", findValue });
                }
                if (pendingFocus) {
                    focusContent();
                }
                break;
            case "positron-help-scroll":
                connection.sendNotification("help/scroll", {
                    entryId: currentEntry?.entryId,
                    scrollX: message.scrollX || 0,
                    scrollY: message.scrollY || 0,
                });
                break;
            case "positron-help-navigate":
                if (message.url) {
                    connection.sendNotification("help/navigate", { entryId: currentEntry?.entryId, url: message.url });
                }
                break;
            case "positron-help-navigate-backward":
                connection.sendNotification("help/navigateBackward", {});
                break;
            case "positron-help-navigate-forward":
                connection.sendNotification("help/navigateForward", {});
                break;
            case "positron-help-find-result":
                findHasResult = Boolean(message.findResult);
                break;
            case "positron-help-keydown":
                if ((message.metaKey || message.ctrlKey) && message.code === "KeyC") {
                    postToIframe({ id: "positron-help-copy-selection" });
                } else if (
                    (message.metaKey || message.ctrlKey) &&
                    !message.altKey &&
                    message.code === "KeyF"
                ) {
                    showFind();
                } else if (message.altKey && !message.ctrlKey && !message.metaKey && !message.shiftKey) {
                    if (message.code === "ArrowLeft" && canNavigateBackward) navigateBackward();
                    if (message.code === "ArrowRight" && canNavigateForward) navigateForward();
                } else if (message.code === "Escape" && findVisible) {
                    closeFind();
                } else if (message.code === "F3") {
                    if (!findVisible) showFind();
                    else if (message.shiftKey) findPrevious();
                    else findNext();
                }
                break;
            case "positron-help-context-menu": {
                const rect = iframeEl?.getBoundingClientRect();
                if (rect) {
                    contextMenu = {
                        x: rect.left + (Number(message.clientX) || 0),
                        y: rect.top + (Number(message.clientY) || 0),
                        selection: typeof message.selection === "string" ? message.selection : "",
                    };
                }
                break;
            }
            case "positron-help-pointer-down":
                contextMenu = null;
                break;
            case "positron-help-copy-selection":
                if (message.selection) {
                    connection.sendNotification("help/copySelection", {
                        selection: message.selection,
                    });
                }
                break;
            case "positron-help-execute-command":
                if (message.command) {
                    connection.sendNotification("help/executeCommand", {
                        command: message.command,
                    });
                }
                break;
            default:
                break;
        }
    }

    function handleWindowMessage(event: MessageEvent): void {
        if (event.source === iframeEl?.contentWindow) {
            const data = event.data as IframeMessage;
            if (data?.id && data.id.startsWith("positron-help-")) {
                handleIframeMessage(data);
            }
        }
    }

    function handleHelpShortcut(event: KeyboardEvent): void {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyF') {
            event.preventDefault();
            showFind();
        } else if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            if (event.code === 'ArrowLeft' && canNavigateBackward) {
                event.preventDefault();
                navigateBackward();
            } else if (event.code === 'ArrowRight' && canNavigateForward) {
                event.preventDefault();
                navigateForward();
            }
        } else if (event.code === 'F3') {
            event.preventDefault();
            if (!findVisible) showFind();
            else if (event.shiftKey) findPrevious();
            else findNext();
        } else if (event.code === 'Escape' && findVisible) {
            event.preventDefault();
            closeFind();
        }
    }

    onMount(() => {
        const subscriptions = [
        connection.onNotification("help/state", (params: HelpStateParams) => {
            const previousUrl = currentEntry?.sourceUrl;
            const previousEntryId = currentEntry?.entryId;
            currentEntry = params.entry;
            if (currentEntry?.entryId !== previousEntryId) contextMenu = null;
            history = params.history || [];
            canNavigateBackward = params.canNavigateBackward;
            canNavigateForward = params.canNavigateForward;

            pendingScroll = {
                x: currentEntry?.scrollX || 0,
                y: currentEntry?.scrollY || 0,
            };

            if (!currentEntry || currentEntry.isWelcome) {
                clearLoadTimer();
                loadState = "idle";
                pendingFocus = false;
                retryRequested = false;
                findVisible = false;
                findValue = "";
            } else if (currentEntry.sourceUrl !== previousUrl || currentEntry.entryId !== previousEntryId) {
                retryRequested = false;
                beginLoading();
            } else if (retryRequested || loadState === "error") {
                // A repeated help request may deliberately revisit the same topic.
                retryRequested = false;
                beginLoading();
                reloadVersion++;
            }
        }),

        connection.onNotification("help/themeChanged", () => {
            sendStyles();
        }),

        connection.onNotification("help/find", () => {
            showFind();
        }),

        connection.onNotification("help/focus", () => {
            focusContent();
        }),
        ];

        sendStyles();
        return () => {
            clearLoadTimer();
            for (const subscription of subscriptions) {
                subscription.dispose();
            }
        };
    });

    function openHistory(index: number): void {
        if (index >= 0) {
            connection.sendNotification("help/openHistory", { index });
        }
    }

    function navigateBackward(): void {
        connection.sendNotification("help/navigateBackward", {});
    }

    function navigateForward(): void {
        connection.sendNotification("help/navigateForward", {});
    }

    function showWelcome(): void {
        connection.sendNotification("help/showWelcome", {});
    }

    function openExternal(url: string): void {
        connection.sendNotification("help/navigate", { entryId: currentEntry?.entryId, url });
    }

    function showFind(): void {
        if (!currentEntry || currentEntry.isWelcome) {
            return;
        }

        findVisible = true;
        pendingFocus = false;
        setTimeout(() => {
            const input = document.getElementById("help-find-input") as HTMLInputElement | null;
            input?.focus();
            input?.select();
        }, 0);
    }

    function closeFind(): void {
        findVisible = false;
        findValue = "";
        postToIframe({ id: "positron-help-update-find", findValue: undefined });
        iframeEl?.focus();
        postToIframe({ id: "positron-help-focus" });
    }

    function updateFind(value: string): void {
        findValue = value;
        postToIframe({ id: "positron-help-update-find", findValue: value });
    }

    function findNext(): void {
        postToIframe({ id: "positron-help-find-next", findValue });
    }

    function findPrevious(): void {
        postToIframe({ id: "positron-help-find-previous", findValue });
    }

    function handleFindKeydown(event: KeyboardEvent): void {
        if (event.key === "Enter") {
            if (event.shiftKey) {
                findPrevious();
            } else {
                findNext();
            }
        } else if (event.key === "Escape") {
            closeFind();
        }
    }
</script>

<svelte:window onmessage={handleWindowMessage} onkeydown={handleHelpShortcut} />

<div
    class="help-root"
    role="region"
    aria-label={localize('help.region', 'Help')}
>
    <!-- Action Bar Container - Two rows like Positron -->
    <div class="action-bars-container">
        <!-- Row 1: Navigation buttons -->
        <div class="action-bar positron-action-bar border-top border-bottom" role="toolbar" aria-label={localize('help.navigation', 'Help navigation')}>
            <ActionBarButton
                icon="arrow-left"
                ariaLabel={localize('help.previousTopic', 'Previous topic')}
                tooltip={localize('help.previousTopic', 'Previous topic')}
                disabled={!canNavigateBackward}
                onclick={navigateBackward}
            />
            <ActionBarButton
                icon="arrow-right"
                ariaLabel={localize('help.nextTopic', 'Next topic')}
                tooltip={localize('help.nextTopic', 'Next topic')}
                disabled={!canNavigateForward}
                onclick={navigateForward}
            />

            <ActionBarSeparator />

            <ActionBarButton
                icon="home"
                ariaLabel={localize('help.home', 'Show help home')}
                tooltip={localize('help.home', 'Show help home')}
                onclick={showWelcome}
            />
        </div>

        <!-- Row 2: History dropdown + Find button -->
        <div class="action-bar positron-action-bar border-bottom" role="toolbar" aria-label={localize('help.topicActions', 'Help topic actions')}>
            <div class="action-bar-region left">
                {#if currentTitle && !currentEntry?.isWelcome}
                    <ActionBarMenuButton
                        label={currentTitle}
                        tooltip={localize('help.history', 'Help history')}
                        ariaLabel={localize('help.history', 'Help history')}
                        actions={() => [...history].reverse().map((entry, idx) => {
                            const realIndex = history.length - 1 - idx;
                            return {
                                id: `history-${realIndex}`,
                                label: entry.title || shortenUrl(entry.sourceUrl),
                                checked: realIndex === currentIndex,
                                onSelected: () => openHistory(realIndex),
                            };
                        })}
                    />
                {:else if currentEntry?.isWelcome}
                    <span class="welcome-title">{localize('common.welcome', 'Welcome')}</span>
                {/if}
            </div>

            <div class="action-bar-region right">
                <ActionBarButton
                    icon="search"
                    ariaLabel={localize('help.find', 'Find in page')}
                    tooltip={localize('help.find', 'Find in page')}
                    disabled={!currentEntry || currentEntry.isWelcome}
                    onclick={showFind}
                />
            </div>
        </div>
    </div>

    <!-- Find Widget (positioned overlay style like VS Code) -->
    {#if findVisible}
        <div class="find-widget" role="search" aria-label={localize('help.find', 'Find in page')}>
            <div class="find-input-container">
                <input
                    id="help-find-input"
                    type="text"
                    class="find-input"
                    placeholder={localize('common.find', 'Find')}
                    aria-label={localize('help.find', 'Find in page')}
                    value={findValue}
                    oninput={(e) => updateFind((e.target as HTMLInputElement).value)}
                    onkeydown={handleFindKeydown}
                />
                {#if findValue && !findHasResult}
                    <span class="find-no-results" role="status" aria-live="polite">{localize('common.noResults', 'No results')}</span>
                {/if}
            </div>
            <button class="find-action" onclick={findPrevious} title={localize('common.previousMatch', 'Previous match')} aria-label={localize('common.previousMatch', 'Previous match')}>
                <span class="codicon codicon-arrow-up"></span>
            </button>
            <button class="find-action" onclick={findNext} title={localize('common.nextMatch', 'Next match')} aria-label={localize('common.nextMatch', 'Next match')}>
                <span class="codicon codicon-arrow-down"></span>
            </button>
            <button class="find-action" onclick={closeFind} title={localize('common.close', 'Close')} aria-label={localize('common.close', 'Close')}>
                <span class="codicon codicon-close"></span>
            </button>
        </div>
    {/if}

    <!-- Help Content -->
    <div class="help-content">
        {#if currentEntry?.isWelcome || !currentEntry}
            <div class="help-welcome-container">
                <div class="welcome-content">
                    <!-- Logo placeholder -->
                    <div class="welcome-logo-text">Positron Help</div>

                    <ul class="welcome-links">
                        <li><a href="https://positron.posit.co/" onclick={(e) => { e.preventDefault(); openExternal("https://positron.posit.co/"); }}>Positron Documentation</a></li>
                        <li><a href="https://github.com/posit-dev/positron/discussions" onclick={(e) => { e.preventDefault(); openExternal("https://github.com/posit-dev/positron/discussions"); }}>Positron Community Forum</a></li>
                        <li class="link-spacer"></li>
                        <li><a href="https://posit.co/resources/cheatsheets/" onclick={(e) => { e.preventDefault(); openExternal("https://posit.co/resources/cheatsheets/"); }}>Posit Cheat Sheets</a></li>
                        <li><a href="https://posit.co/products/" onclick={(e) => { e.preventDefault(); openExternal("https://posit.co/products/"); }}>Posit Products</a></li>
                        <li><a href="https://cran.r-project.org/doc/manuals/r-release/R-intro.html" onclick={(e) => { e.preventDefault(); openExternal("https://cran.r-project.org/doc/manuals/r-release/R-intro.html"); }}>R Introduction</a></li>
                    </ul>
                </div>
            </div>
        {:else}
            {#key `${currentEntry.entryId}:${currentEntry.sourceUrl}:${reloadVersion}`}
            <iframe
                class="help-frame"
                bind:this={iframeEl}
                src={currentEntry.sourceUrl}
                title={currentTitle}
                onerror={handleLoadError}
            ></iframe>
            {/key}
            {#if loadState === "loading"}
                <div class="help-load-status" role="status">
                    {localize('common.loading', 'Loading')}
                </div>
            {:else if loadState === "error"}
                <div class="help-load-status help-load-error" role="alert">
                    <span>{localize('help.loadFailed', 'Help content did not finish loading.')}</span>
                    <button type="button" onclick={retryLoad}>{localize('help.retry', 'Try Again')}</button>
                </div>
            {/if}
        {/if}
    </div>
</div>

{#if contextMenu}
    {@const selection = contextMenu.selection}
    <ContextMenu
        anchorEl={iframeEl}
        anchorPoint={contextMenu}
        entries={[{
            id: 'copy',
            label: localize('common.copy', 'Copy'),
            disabled: !selection,
            onSelected: () => connection.sendNotification('help/copySelection', { selection }),
        }]}
        onclose={() => { contextMenu = null; }}
    />
{/if}

<style>
    /* ============================================
       CSS Variables (Positron-style)
       ============================================ */
    :root {
        --action-bar-height: 28px;
        --action-bar-icon-size: 24px;
    }

    /* ============================================
       Root Container
       ============================================ */
    .help-root {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        position: relative;
        background: var(--vscode-editor-background);
        color: var(--vscode-foreground);
        font-family: var(--vscode-font-family);
    }

    /* ============================================
       Action Bars Container (Two Rows)
       ============================================ */
    .action-bars-container {
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
    }

    .action-bar {
        display: flex;
        align-items: center;
        height: var(--action-bar-height);
        padding: 0 8px;
        box-sizing: border-box;
        background: var(
            --vscode-positronActionBar-background,
            var(--vscode-sideBar-background)
        );
    }

    .action-bar .action-bar-region.left {
        flex: 1;
        min-width: 0;
    }

    .action-bar .action-bar-region.right {
        flex: 0;
    }

    .welcome-title {
        font-size: 12px;
        padding: 0 6px;
    }

    /* ============================================
       Find Widget (VS Code Style)
       ============================================ */
    .find-widget {
        position: absolute;
        top: 56px; /* Below the two action bars */
        right: 16px;
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px;
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        z-index: 100;
    }

    .find-input-container {
        display: flex;
        align-items: center;
        position: relative;
    }

    .find-input {
        width: 200px;
        padding: 4px 8px;
        font-size: 13px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 2px;
        outline: none;
    }

    .find-input:focus {
        border-color: var(--vscode-focusBorder);
    }

    .find-no-results {
        position: absolute;
        right: 8px;
        font-size: 11px;
        color: var(--vscode-errorForeground);
    }

    .find-action {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--vscode-foreground);
        cursor: pointer;
    }

    .find-action:hover {
        background: var(--vscode-toolbar-hoverBackground);
    }

    /* ============================================
       Help Content Area
       ============================================ */
    .help-content {
        flex: 1;
        display: flex;
        position: relative;
        overflow: hidden;
    }

    .help-frame {
        width: 100%;
        height: 100%;
        border: none;
        background: white;
    }

    .help-load-status {
        position: absolute;
        top: 8px;
        left: 8px;
        right: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px;
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-foreground);
        border: 1px solid var(--vscode-widget-border, transparent);
    }

    .help-load-error button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: 1px solid transparent;
        padding: 4px 8px;
        cursor: pointer;
    }

    .help-load-error button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
    }

    /* ============================================
       Welcome Page (Centered Layout like Positron)
       ============================================ */
    .help-welcome-container {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        width: 100%;
        height: 100%;
        background: var(--vscode-editor-background);
    }

    .welcome-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
    }

    .welcome-logo-text {
        font-size: 48px;
        font-weight: 300;
        color: var(--vscode-foreground);
        margin-bottom: 2em;
        opacity: 0.7;
    }

    .welcome-links {
        list-style: none;
        padding: 0;
        margin: 0;
        text-align: left;
    }

    .welcome-links li {
        margin: 4px 0;
    }

    .welcome-links li.link-spacer {
        height: 12px;
    }

    .welcome-links a {
        color: var(--vscode-textLink-foreground);
        text-decoration: none;
        font-size: 13px;
    }

    .welcome-links a:hover {
        text-decoration: underline;
    }
</style>
