<script lang="ts">
    /**
     * Plot Editor App component.
     * A standalone plot viewer for individual plots opened in editor tabs.
     * Features: sizing and zoom menus, save, copy, debounced resize rendering.
     */

    import { onMount } from "svelte";
    import { copyImageToClipboard } from "$lib/imageClipboard";
    import { getRpcConnection } from "$lib/rpc/client";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import PanZoomImage from "../plots/PanZoomImage.svelte";
    import { ZoomLevel } from "../plots/types";
    import DynamicActionBar from "../shared/DynamicActionBar.svelte";
    import ActionBarButton from "../shared/ActionBarButton.svelte";
    import ActionBarMenuButton from "../shared/ActionBarMenuButton.svelte";
    import { localize } from "$lib/localization";
    import type { SizingPolicyInfo } from "@shared/plots";
    import type { PlotEditorSetContentNotification } from "../../../src/rpc/webview/plotEditor";

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
    let sizingPolicies = $state<SizingPolicyInfo[]>([]);
    let selectedSizingPolicyId = $state("");
    let selectingSizingPolicy = $state(false);
    let lastRenderKey = "";
    let renderTimer: ReturnType<typeof setTimeout> | null = null;
    let containerEl: HTMLDivElement;
    let containerWidth = $state(1);
    let containerHeight = $state(1);

    // Derived
    const zoomLabel = $derived(
        ZOOM_LEVELS.find((l) => l.value === zoom)?.label ?? `${zoom}%`,
    );
    const sizingLabel = $derived(
        sizingPolicies.find(policy => policy.id === selectedSizingPolicyId)?.name ?? "",
    );
    const sizingTooltip = localize("plots.sizingPolicy", "Set how the plot's shape and size are determined");

    // Debounce delay (ms)
    const DEBOUNCE_MS = 150;

    // --- Debounced render request ---
    function requestRender() {
        if (!connection || !containerEl || contentKind !== "image") return;
        const width = containerWidth || containerEl.clientWidth;
        const height = containerHeight || containerEl.clientHeight;
        if (width <= 0 || height <= 0) return;

        const pixelRatio = window.devicePixelRatio || 1;
        if (selectingSizingPolicy) return;
        const renderKey = `${width}x${height}@${pixelRatio}:${selectedSizingPolicyId}`;
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

    async function selectSizingPolicy(policyId: string) {
        if (!connection || selectingSizingPolicy || policyId === selectedSizingPolicyId) return;
        selectingSizingPolicy = true;
        try {
            const result = await connection.sendRequest<{ policyId: string }>(
                "plotEditor/selectSizingPolicy", { policyId },
            );
            selectedSizingPolicyId = result.policyId;
            sizingPolicies = sizingPolicies.filter(policy => policy.id !== "custom" || policy.id === result.policyId);
            statusMessage = "";
            statusError = false;
            lastRenderKey = "";
        } catch {
            statusMessage = localize("plotEditor.sizingFailed", "Failed to change plot size.");
            statusError = true;
        } finally {
            selectingSizingPolicy = false;
            scheduleRender();
        }
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
                statusMessage = localize("plots.copyUnavailable", "Image could not be copied. Use Save Plot to export it.");
                statusError = true;
                connection?.sendNotification("plotEditor/copy");
            });
    }

    function handleOpenInBrowser() {
        connection?.sendNotification("plotEditor/openInBrowser");
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
                (params: PlotEditorSetContentNotification.Params) => {
                    contentKind = params.kind;
                    sizingPolicies = (params.sizingPolicies ?? []).map(policy => ({
                        ...policy,
                        name: localize(`plots.sizing.${policy.id}`, policy.name),
                    }));
                    selectedSizingPolicyId = params.selectedSizingPolicyId ?? "";
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

    $effect(() => {
        containerWidth;
        containerHeight;

        if (containerEl && contentKind === "image") {
            scheduleRender();
        }

        return () => {
            if (renderTimer) clearTimeout(renderTimer);
        };
    });
</script>

<svelte:window onkeydowncapture={handleWindowKeyDown} />

<!-- Action Bar -->
{#snippet sizingMenuSnippet()}
    <ActionBarMenuButton
        icon="symbol-ruler"
        label={sizingLabel}
        tooltip={sizingTooltip}
        ariaLabel={sizingTooltip}
        actions={() => sizingPolicies.map(policy => ({
            id: policy.id,
            label: policy.name,
            checked: policy.id === selectedSizingPolicyId,
            // Keep the trigger focusable when the menu closes during the RPC.
            disabled: selectingSizingPolicy,
            onSelected: () => { void selectSizingPolicy(policy.id); },
        }))}
    />
{/snippet}

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
        ...(contentKind === "image" && sizingPolicies.length > 0 ? [{
            fixedWidth: 36,
            text: sizingLabel,
            minWidth: 80,
            separator: false,
            component: sizingMenuSnippet,
        }] : []),
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
    bind:clientWidth={containerWidth}
    bind:clientHeight={containerHeight}
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
