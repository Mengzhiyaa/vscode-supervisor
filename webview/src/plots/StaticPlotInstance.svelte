<!--
  StaticPlotInstance.svelte
  1:1 Positron replication - Renders a static (unchanging) plot
-->
<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import PanZoomImage from "./PanZoomImage.svelte";
    import { ZoomLevel } from "./types";

    // Props using Svelte 5 runes
    interface Props {
        plotId: string;
        plotName?: string;
        imageUri: string;
        zoom?: ZoomLevel;
    }

    let {
        plotId,
        plotName,
        imageUri,
        zoom = ZoomLevel.OneHundred,
    }: Props = $props();

    let containerRef: HTMLDivElement;
    let width = $state(1);
    let height = $state(1);
    let resizeObserver: ResizeObserver;

    let displayName = $derived(plotName || `Plot ${plotId}`);

    onMount(() => {
        resizeObserver = new ResizeObserver((entries) => {
            if (entries.length > 0) {
                const entry = entries[0];
                width = entry.contentRect.width;
                height = entry.contentRect.height;
            }
        });

        if (containerRef) {
            resizeObserver.observe(containerRef);
        }
    });

    onDestroy(() => {
        resizeObserver?.disconnect();
    });
</script>

<div bind:this={containerRef} class="plot-instance static-plot-instance">
    <PanZoomImage
        description={displayName}
        {width}
        {height}
        {imageUri}
        {zoom}
    />
</div>

<style>
    .static-plot-instance {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    }
</style>
