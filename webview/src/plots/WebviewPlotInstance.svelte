<!--
  WebviewPlotInstance.svelte
  Renders a webview-based (HTML) plot.
-->
<script lang="ts">
    import { onMount, onDestroy } from "svelte";

    interface Props {
        plotId: string;
        width: number;
        height: number;
        htmlUri?: string;
        visible?: boolean;
        onclaim?: (payload: { plotId: string }) => void;
        onrelease?: (payload: { plotId: string }) => void;
        onlayout?: (payload: {
            plotId: string;
            width: number;
            height: number;
        }) => void;
    }

    let {
        plotId,
        width,
        height,
        htmlUri,
        visible = true,
        onclaim,
        onrelease,
        onlayout,
    }: Props = $props();

    let webviewRef: HTMLDivElement;
    let clientIsClaimed = $state(false);
    let claimedPlotId = $state<string | undefined>(undefined);
    let resizeObserver: ResizeObserver | undefined;

    function claimPlot(targetPlotId: string) {
        if (!visible || !onclaim || !webviewRef) {
            return;
        }

        onclaim({ plotId: targetPlotId });
        claimedPlotId = targetPlotId;
        clientIsClaimed = true;

        if (onlayout) {
            const nextWidth = webviewRef.clientWidth;
            const nextHeight = webviewRef.clientHeight;
            if (nextWidth > 0 && nextHeight > 0) {
                onlayout({
                    plotId: targetPlotId,
                    width: nextWidth,
                    height: nextHeight,
                });
            }
        }
    }

    function releasePlot(targetPlotId: string) {
        onrelease?.({ plotId: targetPlotId });
        if (claimedPlotId === targetPlotId) {
            claimedPlotId = undefined;
        }
        clientIsClaimed = false;
    }

    onMount(() => {
        if (visible) {
            claimPlot(plotId);
        }

        resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.contentRect.width <= 0 || entry.contentRect.height <= 0) {
                    continue;
                }
                if (clientIsClaimed && claimedPlotId && onlayout) {
                    onlayout({
                        plotId: claimedPlotId,
                        width: entry.contentRect.width,
                        height: entry.contentRect.height,
                    });
                }
            }
        });

        if (webviewRef) {
            resizeObserver.observe(webviewRef);
        }
    });

    onDestroy(() => {
        if (claimedPlotId) {
            releasePlot(claimedPlotId);
        }
        resizeObserver?.disconnect();
    });

    $effect(() => {
        void plotId;
        void visible;

        if (!webviewRef) {
            return;
        }

        if (!visible) {
            if (claimedPlotId) {
                releasePlot(claimedPlotId);
            }
            return;
        }

        if (!claimedPlotId) {
            claimPlot(plotId);
            return;
        }

        if (claimedPlotId !== plotId) {
            releasePlot(claimedPlotId);
            claimPlot(plotId);
        }
    });
</script>

<div
    bind:this={webviewRef}
    class="plot-instance webview-plot-instance"
    style="width: {width}px; height: {height}px;"
    data-plot-id={plotId}
>
    {#if htmlUri}
        <iframe class="plot-html-frame" src={htmlUri} title="HTML Plot"></iframe>
    {/if}
</div>

<style>
    .webview-plot-instance {
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        width: 100%;
        height: 100%;
    }

    .plot-html-frame {
        border: none;
        width: 100%;
        height: 100%;
        background: white;
    }
</style>
