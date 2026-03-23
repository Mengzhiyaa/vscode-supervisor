<script lang="ts">
    /**
     * DynamicPlotThumbnail component.
     * A thumbnail component for dynamic plots that updates from render events.
     * Matches Positron's DynamicPlotThumbnail component.
     *
     * Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
     * Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
     */

    import PlaceholderThumbnail from "./PlaceholderThumbnail.svelte";

    /**
     * DynamicPlotThumbnailProps interface.
     */
    interface Props {
        /** The plot ID */
        plotId: string;
        /** Optional plot name for accessibility */
        plotName?: string;
        /** The current thumbnail URI (if available) */
        thumbnailUri?: string;
        /** Cached thumbnail URI fallback */
        cachedThumbnailUri?: string;
    }

    let { plotId, plotName, thumbnailUri, cachedThumbnailUri }: Props =
        $props();

    let uri = $state("");

    // Keep local URI in sync with provided thumbnail updates.
    // Thumbnail updates flow from App.svelte which listens to
    // plots/renderCompleted and updates the thumbnailUri prop.
    $effect(() => {
        if (thumbnailUri || cachedThumbnailUri) {
            uri = thumbnailUri || cachedThumbnailUri || "";
            return;
        }

        if (!uri) {
            uri = "";
        }
    });

    let altText = $derived(plotName || `Plot ${plotId}`);
</script>

{#if uri}
    <img alt={altText} class="plot" src={uri} draggable="false" />
{:else}
    <PlaceholderThumbnail />
{/if}

<style>
    .plot {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }
</style>
