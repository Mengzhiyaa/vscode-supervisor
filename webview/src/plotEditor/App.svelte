<script lang="ts">
    /**
     * Plot Editor App component.
     * A standalone plot viewer for individual plots opened in editor tabs.
     * Features: zoom dropdown, save, copy, debounced resize rendering.
     */

    import { onMount } from "svelte";
    import { getRpcConnection } from "$lib/rpc/client";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import PanZoomImage from "../plots/PanZoomImage.svelte";
    import { ZoomLevel } from "../plots/types";
    import DynamicActionBar from "../shared/DynamicActionBar.svelte";
    import ActionBarButton from "../shared/ActionBarButton.svelte";
    import ActionBarMenuButton from "../shared/ActionBarMenuButton.svelte";
    import { localize } from "$lib/localization";

    // JSON-RPC connection
    let connection = $state<MessageConnection | undefined>();

    // Zoom levels
    const ZOOM_LEVELS = [
        { value: ZoomLevel.Fit, label: "Fit" },
        { value: ZoomLevel.Fifty, label: "50%" },
        { value: ZoomLevel.SeventyFive, label: "75%" },
        { value: ZoomLevel.OneHundred, label: "100%" },
        { value: ZoomLevel.TwoHundred, label: "200%" },
    ] as const;

    type EditorZoomLevel = (typeof ZOOM_LEVELS)[number]["value"];

    // State
    let imageUri = $state("");
    let contentKind = $state<"image" | "html">("image");
    let htmlUri = $state("");
    let htmlTitle = $state("");
    let statusMessage = $state("");
    let statusError = $state(false);
    let zoom = $state<EditorZoomLevel>(ZoomLevel.Fit);
    let lastRenderKey = "";
    let renderTimer: ReturnType<typeof setTimeout> | null = null;
    let containerEl: HTMLDivElement;
    let containerWidth = $state(1);
    let containerHeight = $state(1);

    // Derived
    const zoomLabel = $derived(
        ZOOM_LEVELS.find((l) => l.value === zoom)?.label ?? `${zoom}%`,
    );

    function updateContainerSize() {
        if (!containerEl) {
            return;
        }

        containerWidth = Math.max(1, containerEl.clientWidth);
        containerHeight = Math.max(1, containerEl.clientHeight);
    }

    // Debounce delay (ms)
    const DEBOUNCE_MS = 150;

    // --- Debounced render request ---
    function requestRender() {
        if (!connection || !containerEl || contentKind !== "image") return;
        const width = containerWidth || containerEl.clientWidth;
        const height = containerHeight || containerEl.clientHeight;
        if (width <= 0 || height <= 0) return;

        const pixelRatio = window.devicePixelRatio || 1;
        const renderKey = `${width}x${height}@${pixelRatio}`;
        if (renderKey === lastRenderKey) return;

        lastRenderKey = renderKey;
        connection.sendNotification("plotEditor/render", {
            width,
            height,
            pixelRatio,
            format: "png",
        });
    }

    function scheduleRender() {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(requestRender, DEBOUNCE_MS);
    }

    // --- Zoom ---
    function selectZoom(value: EditorZoomLevel) {
        zoom = value;
    }

    function handleSave() {
        connection?.sendNotification("plotEditor/save");
    }

    function handleCopy() {
        if (contentKind === "html") {
            statusMessage = localize("plotEditor.copyingHtml", "Copying plot HTML…");
            statusError = false;
            connection?.sendNotification("plotEditor/copy");
            return;
        }
        // Try Clipboard API first, fall back to extension
        const imgEl = containerEl?.querySelector(
            "img",
        ) as HTMLImageElement | null;
        if (!imgEl?.src) {
            connection?.sendNotification("plotEditor/copy");
            return;
        }
        copyImageToClipboard(imgEl.src)
            .then(() => {
                statusMessage = localize("plotEditor.copied", "Plot copied to clipboard");
                statusError = false;
            })
            .catch(() => {
                connection?.sendNotification("plotEditor/copy");
            });
    }

    function handleOpenInBrowser() {
        connection?.sendNotification("plotEditor/openInBrowser");
    }

    async function copyImageToClipboard(dataUri: string): Promise<void> {
        const ClipboardItemCtor = window.ClipboardItem;
        if (!navigator.clipboard || !ClipboardItemCtor)
            throw new Error("Clipboard API not available");

        const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) throw new Error("Unsupported data URI format");

        const mime = match[1];
        const base64 = match[2];
        const byteString = atob(base64);
        const bytes = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) {
            bytes[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mime });

        if (ClipboardItemCtor.supports && !ClipboardItemCtor.supports(mime)) {
            throw new Error(`Unsupported image format: ${mime}`);
        }

        await navigator.clipboard.write([
            new ClipboardItemCtor({ [mime]: blob }),
        ]);
    }

    function handleWindowKeyDown(event: KeyboardEvent) {
        const isCloseShortcut =
            (event.metaKey || event.ctrlKey) &&
            !event.shiftKey &&
            !event.altKey &&
            event.key.toLowerCase() === "w";

        if (!isCloseShortcut) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        connection?.sendNotification("plotEditor/close");
    }

    onMount(() => {
        connection = getRpcConnection();
        const subscriptions = [
            connection.onNotification(
                "plotEditor/renderResult",
                (params: { data: string; mimeType: string }) => {
                    if (typeof params?.data === "string" && params.data.length > 0) {
                        imageUri = params.data;
                    }
                },
            ),
            connection.onNotification(
                "plotEditor/setImage",
                (params: { data: string }) => {
                    if (typeof params?.data === "string" && params.data.length > 0) {
                        imageUri = params.data;
                        contentKind = "image";
                        htmlUri = "";
                        lastRenderKey = "";
                        scheduleRender();
                    }
                },
            ),
            connection.onNotification(
                "plotEditor/setContent",
                (params: {
                    kind: "image" | "html";
                    data?: string;
                    mimeType?: string;
                    uri?: string;
                    title?: string;
                }) => {
                    contentKind = params.kind;
                    if (params.kind === "html" && params.uri) {
                        htmlUri = params.uri;
                        htmlTitle = params.title || localize("plotEditor.interactivePlot", "Interactive plot");
                        imageUri = "";
                        lastRenderKey = "";
                    } else if (params.kind === "image" && params.data) {
                        imageUri = params.data;
                        htmlUri = "";
                        lastRenderKey = "";
                        scheduleRender();
                    }
                },
            ),
            connection.onNotification(
                "plotEditor/status",
                (params: { message: string; error: boolean }) => {
                    statusMessage = params.message;
                    statusError = params.error;
                },
            ),
        ];

        connection.sendNotification("plotEditor/ready");

        return () => {
            for (const subscription of subscriptions) {
                subscription.dispose();
            }
        };
    });

    // --- Lifecycle ---
    $effect(() => {
        // Set up ResizeObserver with debounce
        if (!containerEl) return;

        const resizeObserver = new ResizeObserver(() => {
            updateContainerSize();
            scheduleRender();
        });
        resizeObserver.observe(containerEl);

        return () => {
            resizeObserver.disconnect();
            if (renderTimer) clearTimeout(renderTimer);
        };
    });

    // Initial render
    $effect(() => {
        if (containerEl) {
            updateContainerSize();
            if (contentKind === "image") {
                requestRender();
            }
        }
    });
</script>

<svelte:window
    on:resize={scheduleRender}
    on:keydown|capture={handleWindowKeyDown}
/>

<!-- Action Bar -->
{#snippet zoomMenuSnippet()}
    <ActionBarMenuButton
        icon="positron-size-to-fit"
        label={zoomLabel}
        tooltip="Set the plot zoom"
        ariaLabel="Set the plot zoom"
        actions={() => ZOOM_LEVELS.map(level => ({
            id: level.label,
            label: level.label,
            checked: zoom === level.value,
            onSelected: () => selectZoom(level.value),
        }))}
    />
{/snippet}

{#snippet saveSnippet()}
    <ActionBarButton
        icon="positron-save"
        ariaLabel="Save plot"
        tooltip="Save plot"
        onclick={handleSave}
    />
{/snippet}

{#snippet copySnippet()}
    <ActionBarButton
        icon="copy"
        ariaLabel="Copy plot to clipboard"
        tooltip="Copy plot to clipboard"
        onclick={handleCopy}
    />
{/snippet}

<DynamicActionBar
    leftActions={[
        ...(contentKind === "image" ? [{
            fixedWidth: 36,
            text: zoomLabel,
            minWidth: 54,
            separator: false,
            component: zoomMenuSnippet,
        }] : []),
        { fixedWidth: 24, separator: contentKind === "image", component: saveSnippet, overflowMenuItem: { label: localize('plots.save', 'Save plot'), icon: 'positron-save', onSelected: handleSave } },
        { fixedWidth: 24, separator: false, component: copySnippet, overflowMenuItem: { label: contentKind === "html" ? localize('plotEditor.copyHtml', 'Copy plot HTML') : localize('plots.copyPlot', 'Copy plot to clipboard'), icon: 'copy', onSelected: handleCopy } },
        ...(contentKind === "html" ? [{
            fixedWidth: 24,
            separator: false,
            component: openBrowserSnippet,
            overflowMenuItem: {
                label: localize('common.openInBrowser', 'Open in Browser'),
                icon: 'link-external',
                onSelected: handleOpenInBrowser,
            },
        }] : []),
    ]}
    rightActions={[]}
    paddingLeft={8}
    paddingRight={4}
    borderTop={true}
    borderBottom={true}
/>

{#snippet openBrowserSnippet()}
    <ActionBarButton
        icon="link-external"
        ariaLabel={localize('common.openInBrowser', 'Open in Browser')}
        tooltip={localize('common.openInBrowser', 'Open in Browser')}
        onclick={handleOpenInBrowser}
    />
{/snippet}

<!-- Plot container -->
<div
    class="plot-container"
    bind:this={containerEl}
>
    {#if contentKind === "html" && htmlUri}
        <iframe
            class="html-plot-frame"
            src={htmlUri}
            title={htmlTitle}
        ></iframe>
    {:else if imageUri}
        <PanZoomImage
            width={containerWidth}
            height={containerHeight}
            imageUri={imageUri}
            description="Plot"
            zoom={zoom}
        />
    {/if}
    {#if statusMessage}
        <div class:status-error={statusError} class="plot-status" role="status" aria-live="polite">
            {statusMessage}
        </div>
    {/if}
</div>

<style>
    /* Plot container */
    .plot-container {
        flex: 1;
        overflow: hidden;
        position: relative;
    }

    .html-plot-frame {
        width: 100%;
        height: 100%;
        border: 0;
        background: white;
    }

    .plot-status {
        position: absolute;
        right: 8px;
        bottom: 8px;
        max-width: min(420px, calc(100% - 16px));
        padding: 4px 8px;
        color: var(--vscode-notifications-foreground, var(--vscode-foreground));
        background: var(--vscode-notifications-background, var(--vscode-editorWidget-background));
        border: 1px solid var(--vscode-notifications-border, var(--vscode-panel-border));
        border-radius: 3px;
        font-size: 12px;
    }

    .plot-status.status-error {
        color: var(--vscode-errorForeground);
    }
</style>
