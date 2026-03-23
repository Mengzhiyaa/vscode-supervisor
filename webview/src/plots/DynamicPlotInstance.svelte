<script module lang="ts">
    const sharedLastRenderKeyByPlotId = new Map<string, string>();
</script>

<script lang="ts">
    /**
     * DynamicPlotInstance component.
     * This component renders a single dynamic plot in the Plots pane.
     * Unlike a StaticPlotInstance, a DynamicPlotInstance can redraw itself when
     * the plot size changes.
     */

    import { onMount, onDestroy } from "svelte";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import PanZoomImage from "./PanZoomImage.svelte";
    import PlotProgressBar from "./PlotProgressBar.svelte";
    import { ZoomLevel, PlotClientState } from "./types";

    interface Props {
        width: number;
        height: number;
        zoom: ZoomLevel;
        plotId: string;
        connection: MessageConnection | undefined;
        sizingPolicyId?: string;
        darkFilterMode?: "off" | "auto" | "on";
        latestUri?: string;
        renderVersion?: number;
        initialData?: string;
        initialRenderSettings?: {
            width: number;
            height: number;
            pixelRatio: number;
        };
        onrendered?: (payload: {
            plotId: string;
            uri: string;
            renderVersion: number;
        }) => void;
    }

    let {
        width,
        height,
        zoom,
        plotId,
        connection,
        sizingPolicyId,
        darkFilterMode = "auto",
        latestUri,
        renderVersion = 0,
        initialData,
        initialRenderSettings,
        onrendered,
    }: Props = $props();

    let uri = $state("");
    let error = $state("");
    let plotState = $state<PlotClientState>(PlotClientState.Unrendered);
    let renderEstimateMs = $state(0);
    let progressBarDone = $state(false);
    let hasMounted = $state(false);
    let hasSeenSizingPolicy = $state(false);
    let lastSizingPolicyId = $state<string | undefined>(undefined);
    let lastQueuedRenderKey = $state<string | undefined>(undefined);
    let latestAppliedRenderVersion = $state(0);
    let renderRequestSerial = 0;

    const plotName = $derived(`Plot ${plotId}`);

    function hasMatchingInitialRenderSettings(): boolean {
        if (!initialRenderSettings || !initialData) {
            return false;
        }

        const targetWidth = Math.floor(width);
        const targetHeight = Math.floor(height);
        const targetPixelRatio = window.devicePixelRatio || 1;

        return (
            targetWidth === initialRenderSettings.width &&
            targetHeight === initialRenderSettings.height &&
            Math.abs(targetPixelRatio - initialRenderSettings.pixelRatio) < 0.01
        );
    }

    function getRenderRequestKey(): string {
        const targetWidth = Math.floor(width);
        const targetHeight = Math.floor(height);
        const ratio = window.devicePixelRatio || 1;
        return `${plotId}:${targetWidth}x${targetHeight}@${ratio}:${sizingPolicyId ?? ""}`;
    }

    async function render() {
        if (!connection || !plotId) {
            return;
        }

        if (height <= 0 || width <= 0) {
            return;
        }

        const requestSerial = ++renderRequestSerial;

        try {
            plotState = PlotClientState.Rendering;
            progressBarDone = false;

            const startTime = Date.now();
            const ratio = window.devicePixelRatio || 1;

            const result = (await connection.sendRequest("plots/render", {
                plotId,
                width,
                height,
                format: "png",
                pixelRatio: ratio,
            })) as { data: string; mimeType: string; renderVersion: number };

            if (requestSerial !== renderRequestSerial) {
                return;
            }

            renderEstimateMs = Date.now() - startTime;

            if (result.data) {
                const renderedUri = result.data.startsWith("data:")
                    ? result.data
                    : `data:${result.mimeType};base64,${result.data}`;
                if (result.renderVersion >= latestAppliedRenderVersion) {
                    latestAppliedRenderVersion = result.renderVersion;
                    uri = renderedUri;
                    onrendered?.({
                        plotId,
                        uri: renderedUri,
                        renderVersion: result.renderVersion,
                    });
                }
                error = "";
            }

            plotState = PlotClientState.Rendered;
            progressBarDone = true;
        } catch (e) {
            if (requestSerial !== renderRequestSerial) {
                return;
            }
            const err = e as Error;
            if (err.name === "Canceled" || err.message === "Canceled") {
                return;
            }

            const message = `Error rendering plot: ${err.message}`;
            console.error(message);
            error = message;
            plotState = PlotClientState.Rendered;
            progressBarDone = true;
        }
    }

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    function queueRender() {
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
        }
        resizeTimeout = setTimeout(() => {
            void render();
        }, 250);
    }

    function queueRenderIfNeeded(force = false): void {
        if (width <= 0 || height <= 0 || !connection || !plotId) {
            return;
        }

        const key = getRenderRequestKey();
        const sharedKey = sharedLastRenderKeyByPlotId.get(plotId);
        const hasImageForCurrentKey = Boolean(uri) || hasMatchingInitialRenderSettings();
        if (
            !force &&
            (lastQueuedRenderKey === key || sharedKey === key) &&
            hasImageForCurrentKey
        ) {
            return;
        }

        lastQueuedRenderKey = key;
        sharedLastRenderKeyByPlotId.set(plotId, key);
        queueRender();
    }

    $effect(() => {
        if (!hasMounted) {
            return;
        }

        if (width > 0 && height > 0 && connection && plotId) {
            if (hasMatchingInitialRenderSettings()) {
                // Treat initial payload as already satisfying this viewport.
                lastQueuedRenderKey = getRenderRequestKey();
                sharedLastRenderKeyByPlotId.set(plotId, lastQueuedRenderKey);
                return;
            }

            queueRenderIfNeeded();
        }
    });

    $effect(() => {
        const nextSizingPolicyId = sizingPolicyId;

        if (!hasMounted) {
            return;
        }

        if (!hasSeenSizingPolicy) {
            hasSeenSizingPolicy = true;
            lastSizingPolicyId = nextSizingPolicyId;
            return;
        }

        if (lastSizingPolicyId === nextSizingPolicyId) {
            return;
        }

        lastSizingPolicyId = nextSizingPolicyId;

        if (width > 0 && height > 0 && connection && plotId) {
            queueRenderIfNeeded(true);
        }
    });

    $effect(() => {
        if (!latestUri) {
            return;
        }

        if (renderVersion < latestAppliedRenderVersion) {
            return;
        }

        latestAppliedRenderVersion = renderVersion;

        if (latestUri === uri) {
            return;
        }

        uri = latestUri;
        error = "";

        if (plotState !== PlotClientState.Rendering) {
            plotState = PlotClientState.Rendered;
            progressBarDone = true;
        }
    });

    onMount(() => {
        if (latestUri || initialData) {
            uri = latestUri || initialData || "";
            error = "";
            plotState = PlotClientState.Rendered;
            progressBarDone = true;
            latestAppliedRenderVersion = renderVersion;
        }

        hasMounted = true;
    });

    onDestroy(() => {
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
        }
    });

    function getDarkFilterClass(): string {
        if (darkFilterMode === "on") return "dark-filter-on";
        if (darkFilterMode === "auto") return "dark-filter-auto";
        return "";
    }
</script>

<div class="plot-instance dynamic-plot-instance {getDarkFilterClass()}">
    {#if plotState === PlotClientState.Rendering}
        <PlotProgressBar
            infinite={renderEstimateMs === 0}
            total={renderEstimateMs}
            done={progressBarDone}
        />
    {/if}

    {#if uri}
        <PanZoomImage
            description={plotName}
            {height}
            imageUri={uri}
            {width}
            {zoom}
        />
    {:else if error}
        <div class="image-placeholder">
            <div class="image-placeholder-text">{error}</div>
        </div>
    {:else}
        <div class="image-placeholder">
            <div class="image-placeholder-text">Rendering plot...</div>
        </div>
    {/if}
</div>

<style>
    .plot-instance {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        background: var(--vscode-editor-background);
    }

    .dynamic-plot-instance {
        overflow: hidden;
    }

    .image-placeholder {
        display: flex;
        justify-content: center;
        align-items: center;
        width: 100%;
        height: 100%;
    }

    .image-placeholder-text {
        font-size: 12px;
        font-style: italic;
        color: var(--vscode-descriptionForeground);
    }

    .dark-filter-on :global(img.plot) {
        filter: invert(1) hue-rotate(180deg);
    }

    :global(.vscode-dark) .dark-filter-auto :global(img.plot) {
        filter: invert(1) hue-rotate(180deg);
    }
</style>
