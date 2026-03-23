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

    onMount(() => {
        connection.onNotification("viewer/show", (params: ViewerShowParams) => {
            currentUrl = params.url;
            title = params.title || "";
            height = params.height;
            kind = params.kind || "basic";
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
    });

    const iframeHeight = $derived(
        height && height > 0 ? `${height}px` : "100%",
    );

    // --- Action handlers that notify the extension ---
    function handleNavigate(url: string) {
        connection.sendNotification("viewer/navigate", { url });
    }
    function handleBack() {
        connection.sendNotification("viewer/navigateBack", {});
    }
    function handleForward() {
        connection.sendNotification("viewer/navigateForward", {});
    }
    function handleReload() {
        connection.sendNotification("viewer/reload", {});
    }
    function handleClear() {
        currentUrl = null;
        title = "";
        kind = "basic";
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
</script>

<div class="viewer-root">
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

        <!-- Content iframe -->
        <iframe
            class="viewer-frame"
            src={currentUrl}
            style="height: {iframeHeight};"
            title={title || "Viewer"}
        ></iframe>
    {:else}
        <!-- Empty state -->
        <div class="viewer-placeholder">
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
</style>
