<script lang="ts">
    import { onMount } from "svelte";
    import { getRpcConnection } from "$lib/rpc/client";
    import UrlActionBar from "./UrlActionBar.svelte";
    import HtmlActionBar from "./HtmlActionBar.svelte";
    import BasicActionBar from "./BasicActionBar.svelte";
    import type { ViewerOpenTarget } from "./ViewerOpenMenuButton.svelte";
    import { localize } from "$lib/localization";

    interface ViewerShowParams {
        url: string;
        title?: string;
        height?: number;
        sessionId?: string;
        kind?: "url" | "html";
    }

    let connection = getRpcConnection();
    let currentUrl = $state<string | null>(null);
    let title = $state<string>("");
    let height = $state<number | undefined>();
    let kind = $state<"url" | "html" | "basic">("basic");
    let canNavigateBack = $state(false);
    let canNavigateForward = $state(false);
    let interruptible = $state(false);
    let interrupting = $state(false);
    let loadState = $state<"idle" | "loading" | "ready" | "error">("idle");
    let defaultOpenTarget = $state<ViewerOpenTarget>("browser");
    let iframeEl = $state<HTMLIFrameElement | null>(null);
    let findVisible = $state(false);
    let findValue = $state("");
    let findHasResult = $state(true);
    let bridgeAvailable = $state(false);
    let bridgeProbeTimer: ReturnType<typeof setTimeout> | undefined;

    onMount(() => {
        void connection.sendRequest("viewer/getDefaultOpenTarget", {}).then((result) => {
            defaultOpenTarget = (result as { target: ViewerOpenTarget }).target;
        });
        connection.onNotification("viewer/show", (params: ViewerShowParams) => {
            currentUrl = params.url;
            title = params.title || "";
            height = params.height;
            kind = params.kind || "basic";
            loadState = "loading";
            // The extension resolves interrupt capability from the source
            // runtime/terminal state; URL previews are not inherently stoppable.
            interruptible = false;
            interrupting = false;
            bridgeAvailable = false;
            if (bridgeProbeTimer) clearTimeout(bridgeProbeTimer);
        });

        connection.onNotification("viewer/updateInterruptState", (params: {
            interruptible: boolean;
            interrupting: boolean;
        }) => {
            interruptible = params.interruptible;
            interrupting = params.interrupting;
        });

        connection.onNotification("viewer/updateNavState", (params: {
            canNavigateBack: boolean;
            canNavigateForward: boolean;
        }) => {
            canNavigateBack = params.canNavigateBack;
            canNavigateForward = params.canNavigateForward;
        });

        connection.onNotification("viewer/focus", () => {
            focusPreview();
        });

        connection.onNotification("viewer/find", () => {
            showFind();
        });

        const handleKeyboardShortcut = (event: KeyboardEvent) => {
            if (!currentUrl) {
                return;
            }

            if (
                (event.ctrlKey || event.metaKey) &&
                !event.altKey &&
                event.key.toLowerCase() === "f"
            ) {
                event.preventDefault();
                showFind();
                return;
            }

            if (kind !== "url") {
                return;
            }

            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
                const input = document.querySelector<HTMLInputElement>(".url-bar");
                if (input) {
                    event.preventDefault();
                    input.focus();
                    input.select();
                }
                return;
            }

            if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
                return;
            }
            if (event.key === "ArrowLeft" && canNavigateBack) {
                event.preventDefault();
                handleBack();
            } else if (event.key === "ArrowRight" && canNavigateForward) {
                event.preventDefault();
                handleForward();
            }
        };
        const handleFrameMessage = (event: MessageEvent) => {
            if (event.source !== iframeEl?.contentWindow) {
                return;
            }
            const message = event.data as {
                id?: string;
                url?: string;
                title?: string;
                found?: boolean;
            };
            switch (message?.id) {
                case "supervisor-viewer-ready":
                    bridgeAvailable = true;
                    if (bridgeProbeTimer) clearTimeout(bridgeProbeTimer);
                    break;
                case "supervisor-viewer-location":
                case "supervisor-viewer-navigate":
                    if (message.url) {
                        connection.sendNotification("viewer/didNavigate", {
                            url: message.url,
                            title: message.title,
                        });
                    }
                    break;
                case "supervisor-viewer-show-find":
                    showFind();
                    break;
                case "supervisor-viewer-find-result":
                    bridgeAvailable = true;
                    findHasResult = Boolean(message.found);
                    break;
            }
        };
        window.addEventListener("keydown", handleKeyboardShortcut);
        window.addEventListener("message", handleFrameMessage);
        return () => {
            window.removeEventListener("keydown", handleKeyboardShortcut);
            window.removeEventListener("message", handleFrameMessage);
            if (bridgeProbeTimer) clearTimeout(bridgeProbeTimer);
        };
    });

    const iframeHeight = $derived(
        height && height > 0 ? `${height}px` : "100%",
    );

    // --- Action handlers that notify the extension ---
    function handleNavigate(url: string) {
        loadState = "loading";
        connection.sendNotification("viewer/navigate", { url });
    }
    function handleBack() {
        loadState = "loading";
        connection.sendNotification("viewer/navigateBack", {});
    }
    function handleForward() {
        loadState = "loading";
        connection.sendNotification("viewer/navigateForward", {});
    }
    function handleReload() {
        loadState = "loading";
        connection.sendNotification("viewer/reload", {});
    }
    function handleClear() {
        currentUrl = null;
        title = "";
        kind = "basic";
        loadState = "idle";
        connection.sendNotification("viewer/clear", {});
    }
    function handleOpenInBrowser() {
        connection.sendNotification("viewer/openInBrowser", {});
    }
    async function handleOpen(target: ViewerOpenTarget) {
        const result = await connection.sendRequest("viewer/open", { target }) as { success: boolean };
        if (result.success) {
            defaultOpenTarget = target;
        }
    }
    function handleInterrupt() {
        interrupting = true;
        connection.sendNotification("viewer/interrupt", {});
    }

    function handleFrameLoaded() {
        loadState = "ready";
        bridgeAvailable = false;
        postToFrame({ id: "supervisor-viewer-ping" });
        bridgeProbeTimer = setTimeout(() => {
            bridgeAvailable = false;
        }, 500);
    }

    function handleFrameError() {
        loadState = "error";
    }

    function postToFrame(message: Record<string, unknown>) {
        iframeEl?.contentWindow?.postMessage(message, "*");
    }

    function focusPreview() {
        iframeEl?.focus();
        postToFrame({ id: "supervisor-viewer-focus" });
    }

    function showFind() {
        if (!currentUrl) return;
        findVisible = true;
        setTimeout(() => {
            const input = document.getElementById("viewer-find-input") as HTMLInputElement | null;
            input?.focus();
            input?.select();
        }, 0);
    }

    function closeFind() {
        findVisible = false;
        findValue = "";
        findHasResult = true;
        postToFrame({ id: "supervisor-viewer-find", value: "" });
        focusPreview();
    }

    function updateFind(value: string) {
        findValue = value;
        findHasResult = true;
        postToFrame({ id: "supervisor-viewer-find", value });
    }

    function findNext() {
        postToFrame({ id: "supervisor-viewer-find-next", value: findValue });
    }

    function findPrevious() {
        postToFrame({ id: "supervisor-viewer-find-previous", value: findValue });
    }

    function handleFindKeydown(event: KeyboardEvent) {
        if (event.key === "Enter") {
            event.preventDefault();
            event.shiftKey ? findPrevious() : findNext();
        } else if (event.key === "Escape") {
            event.preventDefault();
            closeFind();
        }
    }
</script>

<div
    class="viewer-root"
    role="region"
    aria-label={localize('viewer.region', 'Viewer')}
    aria-busy={loadState === "loading"}
>
    {#if currentUrl}
        <!-- Toolbar: choose based on kind -->
        {#if kind === "url"}
            <UrlActionBar
                url={currentUrl}
                {canNavigateBack}
                {canNavigateForward}
                {interruptible}
                {interrupting}
                onnavigate={handleNavigate}
                onback={handleBack}
                onforward={handleForward}
                onreload={handleReload}
                onclear={handleClear}
                {defaultOpenTarget}
                onopen={handleOpen}
                oninterrupt={handleInterrupt}
                onfind={showFind}
            />
        {:else if kind === "html"}
            <HtmlActionBar
                {title}
                onreload={handleReload}
                onclear={handleClear}
                {defaultOpenTarget}
                onopen={handleOpen}
                onfind={showFind}
            />
        {:else}
            <BasicActionBar
                {title}
                onclear={handleClear}
            />
        {/if}

        <div class="viewer-content">
            {#if findVisible}
                <div
                    class="find-widget"
                    role="search"
                    aria-label={localize('viewer.find', 'Find in preview')}
                >
                    <input
                        id="viewer-find-input"
                        class="find-input"
                        type="text"
                        placeholder={localize('common.find', 'Find')}
                        value={findValue}
                        aria-label={localize('viewer.find', 'Find in preview')}
                        oninput={(event) => updateFind((event.target as HTMLInputElement).value)}
                        onkeydown={handleFindKeydown}
                    />
                    <span class="find-status" role="status" aria-live="polite">
                        {#if !bridgeAvailable}
                            {localize('viewer.findUnavailable', 'Find is unavailable for this content')}
                        {:else if findValue && !findHasResult}
                            {localize('common.noResults', 'No results')}
                        {/if}
                    </span>
                    <button type="button" class="find-action" onclick={findPrevious} aria-label={localize('common.previousMatch', 'Previous match')} title={localize('common.previousMatch', 'Previous match')}>
                        <span class="codicon codicon-arrow-up" aria-hidden="true"></span>
                    </button>
                    <button type="button" class="find-action" onclick={findNext} aria-label={localize('common.nextMatch', 'Next match')} title={localize('common.nextMatch', 'Next match')}>
                        <span class="codicon codicon-arrow-down" aria-hidden="true"></span>
                    </button>
                    <button type="button" class="find-action" onclick={closeFind} aria-label={localize('common.close', 'Close')} title={localize('common.close', 'Close')}>
                        <span class="codicon codicon-close" aria-hidden="true"></span>
                    </button>
                </div>
            {/if}
            <iframe
                class="viewer-frame"
                bind:this={iframeEl}
                src={currentUrl}
                style="height: {iframeHeight};"
                title={title || "Viewer"}
                onload={handleFrameLoaded}
                onerror={handleFrameError}
            ></iframe>
            {#if loadState === "loading"}
                <div class="viewer-progress" aria-hidden="true"><span></span></div>
                <div class="screen-reader-status" role="status" aria-live="polite">
                    {localize('viewer.loading', 'Loading preview')}
                </div>
            {:else if loadState === "error"}
                <div class="viewer-error" role="alert">
                    <span class="codicon codicon-warning" aria-hidden="true"></span>
                    <strong>{localize('viewer.unableToLoad', 'Unable to load preview')}</strong>
                    <span>{localize('viewer.unavailableHint', 'The content may no longer be available.')}</span>
                    <button type="button" onclick={handleReload}>{localize('viewer.tryAgain', 'Try Again')}</button>
                    <button type="button" onclick={handleOpenInBrowser}>{localize('common.openInBrowser', 'Open in Browser')}</button>
                </div>
            {/if}
        </div>
    {:else}
        <!-- Empty state -->
        <div class="viewer-placeholder" role="status">
            <div class="placeholder-icon">
                <span class="codicon codicon-preview"></span>
            </div>
            <div class="placeholder-text">{localize('viewer.noPreview', 'No preview to display')}</div>
            <div class="placeholder-hint">
                {localize('viewer.noPreviewHint', 'Run code that produces HTML output to see it here')}
            </div>
        </div>
    {/if}
</div>

<style>
    .viewer-root {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background: var(--vscode-editor-background);
        color: var(--vscode-foreground);
    }

    .viewer-frame {
        border: none;
        width: 100%;
        flex: 1;
        background: white;
    }

    .viewer-content {
        display: flex;
        position: relative;
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .find-widget {
        position: absolute;
        z-index: 4;
        top: 4px;
        right: 16px;
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px;
        max-width: calc(100% - 32px);
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
        border-radius: 4px;
        box-shadow: 0 2px 8px rgb(0 0 0 / 20%);
    }

    .find-input {
        width: min(220px, 45vw);
        padding: 3px 6px;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, transparent);
        outline: none;
        font: inherit;
    }

    .find-input:focus {
        border-color: var(--vscode-focusBorder);
    }

    .find-status {
        max-width: 180px;
        overflow: hidden;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .find-action {
        display: grid;
        width: 22px;
        height: 22px;
        padding: 0;
        place-items: center;
        border: 0;
        border-radius: 3px;
        color: var(--vscode-foreground);
        background: transparent;
        cursor: pointer;
    }

    .find-action:hover {
        background: var(--vscode-toolbar-hoverBackground);
    }

    .find-action:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
    }

    .viewer-progress {
        position: absolute;
        z-index: 2;
        top: 0;
        left: 0;
        width: 100%;
        height: 2px;
        overflow: hidden;
        background: color-mix(in srgb, var(--vscode-progressBar-background) 24%, transparent);
        pointer-events: none;
    }

    .viewer-progress span {
        display: block;
        width: 35%;
        height: 100%;
        background: var(--vscode-progressBar-background);
        animation: viewer-progress 1.2s ease-in-out infinite;
    }

    .viewer-error {
        position: absolute;
        inset: 0;
        z-index: 3;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 20px;
        text-align: center;
        background: var(--vscode-editor-background);
        color: var(--vscode-descriptionForeground);
    }

    .viewer-error .codicon {
        font-size: 28px;
        color: var(--vscode-problemsWarningIcon-foreground, var(--vscode-editorWarning-foreground));
    }

    .viewer-error strong {
        color: var(--vscode-foreground);
    }

    .viewer-error button {
        margin-top: 4px;
        padding: 4px 12px;
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 2px;
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
        font: inherit;
        cursor: pointer;
    }

    .viewer-error button:hover {
        background: var(--vscode-button-hoverBackground);
    }

    .viewer-error button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
    }

    .screen-reader-status {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }

    .viewer-placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--vscode-descriptionForeground);
        gap: 8px;
        text-align: center;
        padding: 16px;
    }

    .placeholder-icon .codicon {
        font-size: 32px;
    }

    .placeholder-text {
        font-weight: 600;
    }

    .placeholder-hint {
        font-size: 12px;
        max-width: 240px;
    }

    @keyframes viewer-progress {
        from { transform: translateX(-110%); }
        to { transform: translateX(320%); }
    }

    @media (prefers-reduced-motion: reduce) {
        .viewer-progress span {
            width: 100%;
            animation: none;
        }
    }
</style>
