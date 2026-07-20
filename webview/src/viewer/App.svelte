<script lang="ts">
    import { onMount } from "svelte";
    import { getRpcConnection } from "$lib/rpc/client";
    import UrlActionBar from "./UrlActionBar.svelte";
    import HtmlActionBar from "./HtmlActionBar.svelte";
    import BasicActionBar from "./BasicActionBar.svelte";

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

    onMount(() => {
        connection.onNotification("viewer/show", (params: ViewerShowParams) => {
            currentUrl = params.url;
            title = params.title || "";
            height = params.height;
            kind = params.kind || "basic";
            loadState = "loading";
            // Reset navigation state on new preview
            interruptible = kind === "url";
            interrupting = false;
        });

        connection.onNotification("viewer/updateNavState", (params: {
            canNavigateBack: boolean;
            canNavigateForward: boolean;
        }) => {
            canNavigateBack = params.canNavigateBack;
            canNavigateForward = params.canNavigateForward;
        });

        const handleKeyboardShortcut = (event: KeyboardEvent) => {
            if (!currentUrl || kind !== "url") {
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
        window.addEventListener("keydown", handleKeyboardShortcut);
        return () => window.removeEventListener("keydown", handleKeyboardShortcut);
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
    function handleOpenInEditor() {
        connection.sendNotification("viewer/openInEditor", {});
    }
    function handleOpenInNewWindow() {
        connection.sendNotification("viewer/openInNewWindow", {});
    }
    function handleInterrupt() {
        interrupting = true;
        connection.sendNotification("viewer/interrupt", {});
    }

    function handleFrameLoaded() {
        loadState = "ready";
    }

    function handleFrameError() {
        loadState = "error";
    }
</script>

<div class="viewer-root" aria-busy={loadState === "loading"}>
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
                onopenInBrowser={handleOpenInBrowser}
                onopenInEditor={handleOpenInEditor}
                onopenInNewWindow={handleOpenInNewWindow}
                oninterrupt={handleInterrupt}
            />
        {:else if kind === "html"}
            <HtmlActionBar
                {title}
                onreload={handleReload}
                onclear={handleClear}
                onopenInBrowser={handleOpenInBrowser}
                onopenInEditor={handleOpenInEditor}
                onopenInNewWindow={handleOpenInNewWindow}
            />
        {:else}
            <BasicActionBar
                {title}
                onclear={handleClear}
            />
        {/if}

        <div class="viewer-content">
            <iframe
                class="viewer-frame"
                src={currentUrl}
                style="height: {iframeHeight};"
                title={title || "Viewer"}
                onload={handleFrameLoaded}
                onerror={handleFrameError}
            ></iframe>
            {#if loadState === "loading"}
                <div class="viewer-progress" aria-hidden="true"><span></span></div>
                <div class="screen-reader-status" role="status" aria-live="polite">
                    Loading preview
                </div>
            {:else if loadState === "error"}
                <div class="viewer-error" role="alert">
                    <span class="codicon codicon-warning" aria-hidden="true"></span>
                    <strong>Unable to load preview</strong>
                    <span>The content may no longer be available.</span>
                    <button type="button" onclick={handleReload}>Try Again</button>
                </div>
            {/if}
        </div>
    {:else}
        <!-- Empty state -->
        <div class="viewer-placeholder" role="status">
            <div class="placeholder-icon">
                <span class="codicon codicon-preview"></span>
            </div>
            <div class="placeholder-text">No preview to display</div>
            <div class="placeholder-hint">
                Run code that produces HTML output to see it here
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
