<!--
  StaticPlotInstance.svelte
  1:1 Positron replication - Renders a static (unchanging) plot
-->
<script lang="ts">
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

    let width = $state(1);
    let height = $state(1);

    let displayName = $derived(plotName || `Plot ${plotId}`);
</script>

<div
    bind:clientWidth={width}
    bind:clientHeight={height}
    class="plot-instance static-plot-instance"
>
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
