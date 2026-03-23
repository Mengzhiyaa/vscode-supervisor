<!--
  StaticPlotThumbnail.svelte
  1:1 Positron replication - Thumbnail for static plot
-->
<script lang="ts">
    // Props using Svelte 5 runes
    interface Props {
        plotId: string;
        plotName?: string;
        imageUri: string;
    }

    let { plotId, plotName, imageUri }: Props = $props();

    let altText = $derived(plotName || `Plot ${plotId}`);
</script>

<img class="plot" src={imageUri} alt={altText} />

<style>
    .plot {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
    }
</style>
