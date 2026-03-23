<!--
  WebviewPlotThumbnail.svelte
  1:1 Positron replication - Thumbnail for webview-based plot
-->
<script lang="ts">
    import PlaceholderThumbnail from "./PlaceholderThumbnail.svelte";

    // Props using Svelte 5 runes
    interface Props {
        plotId: string;
        thumbnailUri?: string;
        cachedThumbnailUri?: string;
    }

    let {
        plotId,
        thumbnailUri,
        cachedThumbnailUri,
    }: Props = $props();

    // svelte-ignore state_referenced_locally
    let currentUri = $state(thumbnailUri || cachedThumbnailUri);

    // Sync currentUri when thumbnailUri or cachedThumbnailUri props change
    $effect(() => {
        if (thumbnailUri || cachedThumbnailUri) {
            currentUri = thumbnailUri || cachedThumbnailUri;
        }
    });


    let altText = $derived(`Plot ${plotId}`);
</script>

{#if currentUri}
    <img src={currentUri} alt={altText} class="plot-thumbnail-image" />
{:else}
    <PlaceholderThumbnail />
{/if}

<style>
    .plot-thumbnail-image {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
    }
</style>
