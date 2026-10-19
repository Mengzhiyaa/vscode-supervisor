<script module lang="ts">
    const sharedCompletedRendersByPlotId = new Map<
        string,
        { key: string; renderVersion: number }
    >();
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
    import type { GetCachedRenderRequest } from "../../../src/rpc/webview/plots";
    import PanZoomImage from "./PanZoomImage.svelte";
    import PlotProgressBar from "./PlotProgressBar.svelte";
    import {
        ZoomLevel,
        PlotClientState,
    } from "./types";

    interface Props {
        width: number;
        height: number;
        zoom: ZoomLevel;
        plotId: string;
        connection: MessageConnection | undefined;
        sizingPolicyId?: string;
        customSize?: { width: number; height: number };
        darkFilterMode?: "off" | "auto" | "on";
        latestUri?: string;
        renderVersion?: number;
        hostState?: PlotClientState;
        hostRenderEstimateMs?: number;
        initialData?: string;
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
        customSize,
        darkFilterMode = "auto",
        latestUri,
        renderVersion = 0,
        hostState,
        hostRenderEstimateMs,
        initialData,
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
    let pendingRenderKey: string | undefined;
    let pendingRenderConnection: MessageConnection | undefined;
    let snapshotConnection: MessageConnection | undefined;
    let latestAppliedRenderVersion = $state(0);
    let renderRequestSerial = 0;
    let destroyed = false;

    const plotName = $derived(`Plot ${plotId}`);
    const renderWidth = $derived(
        sizingPolicyId === "custom" && customSize ? customSize.width : width,
    );
    const renderHeight = $derived(
        sizingPolicyId === "custom" && customSize ? customSize.height : height,
    );

    function getRenderRequestKey(): string {
        const targetWidth = Math.floor(renderWidth);
        const targetHeight = Math.floor(renderHeight);
        const ratio = window.devicePixelRatio || 1;
        return `${plotId}:${targetWidth}x${targetHeight}@${ratio}:${sizingPolicyId ?? ""}`;
    }

    async function render(requestedKey: string, requestSerial: number, fetchSnapshot = false) {
        const requestedPlotId = plotId;
        const requestedWidth = renderWidth;
        const requestedHeight = renderHeight;
        const requestedConnection = connection;
        const isCurrent = () =>
            !destroyed &&
            requestSerial === renderRequestSerial &&
            requestedPlotId === plotId &&
            requestedConnection === connection &&
            requestedKey === getRenderRequestKey();

        try {
            if (!isCurrent() || !requestedConnection || !requestedPlotId || height <= 0 || width <= 0) {
                return;
            }

            const ratio = window.devicePixelRatio || 1;
            const params = {
                plotId: requestedPlotId,
                width: requestedWidth,
                height: requestedHeight,
                format: "png" as const,
                pixelRatio: ratio,
            };

            if (fetchSnapshot) {
                // The host applies the sizing policy and compares size, ratio and format.
                // Never infer a cache hit from the raw viewport dimensions here.
                let snapshot: GetCachedRenderRequest.Result | undefined;
                try {
                    snapshot = await requestedConnection.sendRequest<GetCachedRenderRequest.Result>("plots/getCachedRender", params);
                } catch {
                    // A missing snapshot can always fall back to a normal render request.
                }
                if (!isCurrent()) { return; }
                const cached = snapshot?.render;
                if (cached && cached.renderVersion >= latestAppliedRenderVersion) {
                    latestAppliedRenderVersion = cached.renderVersion;
                    uri = cached.uri;
                    error = "";
                    onrendered?.({
                        plotId: requestedPlotId,
                        uri: cached.uri,
                        renderVersion: cached.renderVersion,
                    });
                    if (snapshot?.matchesTarget) {
                        sharedCompletedRendersByPlotId.set(requestedPlotId, {
                            key: requestedKey,
                            renderVersion: cached.renderVersion,
                        });
                        return;
                    }
                }
            }

            if (!hostState) { plotState = PlotClientState.RenderPending; }
            progressBarDone = false;
            const startTime = Date.now();

            // The host resolves intrinsic fallback for this plot ID. An old
            // component must not mutate the newly selected plot's policy.
            const result = (await requestedConnection.sendRequest("plots/render", params)) as {
                data: string; mimeType: string; renderVersion: number;
            };

            if (!isCurrent()) {
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
                    sharedCompletedRendersByPlotId.set(requestedPlotId, {
                        key: requestedKey,
                        renderVersion: result.renderVersion,
                    });
                    onrendered?.({
                        plotId: requestedPlotId,
                        uri: renderedUri,
                        renderVersion: result.renderVersion,
                    });
                }
                error = "";
            }
        } catch (e) {
            if (!isCurrent()) {
                return;
            }
            const err = e as Error;
            if (err.name === "Canceled" || err.message === "Canceled") {
                return;
            }

            const message = `Error rendering plot: ${err.message}`;
            console.error(message);
            error = message;
        } finally {
            if (requestSerial === renderRequestSerial) {
                pendingRenderKey = undefined;
                pendingRenderConnection = undefined;
                if (!destroyed) {
                    if (!hostState) { plotState = PlotClientState.Rendered; }
                    progressBarDone = true;
                }
            }
        }
    }

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    function queueRender(key: string) {
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
        }
        const requestSerial = ++renderRequestSerial;
        pendingRenderKey = key;
        pendingRenderConnection = connection;
        if (snapshotConnection !== connection) {
            snapshotConnection = connection;
            resizeTimeout = null;
            void render(key, requestSerial, true);
            return;
        }
        resizeTimeout = setTimeout(() => {
            resizeTimeout = null;
            void render(key, requestSerial);
        }, 250);
    }

    function queueRenderIfNeeded(force = false): void {
        if (width <= 0 || height <= 0 || !connection || !plotId) {
            return;
        }

        const key = getRenderRequestKey();
        if (!force && pendingRenderKey === key && pendingRenderConnection === connection) {
            return;
        }

        const completedRender = sharedCompletedRendersByPlotId.get(plotId);
        if (!force && !pendingRenderKey) {
            if (
                snapshotConnection === connection &&
                completedRender?.key === key &&
                Boolean(uri) &&
                completedRender.renderVersion === latestAppliedRenderVersion
            ) {
                return;
            }
        }

        queueRender(key);
    }

    $effect(() => {
        if (!hasMounted) {
            return;
        }

        if (width > 0 && height > 0 && connection && plotId) {
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
        if (hostState) {
            plotState = hostState;
            renderEstimateMs = hostRenderEstimateMs ?? 0;
            progressBarDone = hostState === PlotClientState.Rendered;
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
            plotState = hostState ?? PlotClientState.Rendered;
            progressBarDone = !hostState || hostState === PlotClientState.Rendered;
        }
    });

    onMount(() => {
        if (latestUri || initialData) {
            uri = latestUri || initialData || "";
            error = "";
            plotState = hostState ?? PlotClientState.Rendered;
            progressBarDone = !hostState || hostState === PlotClientState.Rendered;
            latestAppliedRenderVersion = renderVersion;
        }

        hasMounted = true;
    });

    onDestroy(() => {
        destroyed = true;
        renderRequestSerial++;
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
        }
        pendingRenderKey = undefined;
        pendingRenderConnection = undefined;
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
        background: var(--vscode-positronPlots-background, var(--vscode-panel-background, var(--vscode-editor-background)));
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
