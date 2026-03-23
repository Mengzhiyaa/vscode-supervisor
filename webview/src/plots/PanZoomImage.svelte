<script lang="ts">
    /**
     * PanZoomImage component.
     * A component to pan the image and set the image zoom (scale multiplier).
     * Matches Positron's PanZoomImage component.
     *
     * Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
     * Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
     */

    import { ZoomLevel } from "./types";

    /**
     * PanZoomImageProps interface matching Positron's PanZoomImageProps.
     */
    interface Props {
        width: number;
        height: number;
        imageUri: string;
        description: string;
        zoom: ZoomLevel;
    }

    let { width, height, imageUri, description, zoom }: Props = $props();

    // State - initialized to defaults, synced from props via effect
    let naturalWidth = $state(0);
    let naturalHeight = $state(0);
    let scrollableWidth = $state(0);
    let scrollableHeight = $state(0);
    let imageElement: HTMLImageElement;
    let scrollableElement: HTMLDivElement;

    // Handle mouse pan state
    let isPanning = $state(false);
    let panStartX = 0;
    let panStartY = 0;
    let scrollStartX = 0;
    let scrollStartY = 0;

    // Update image size and position based on zoom level
    $effect(() => {
        void imageUri;

        if (!imageElement) {
            return;
        }

        // Scale by the zoom level
        // If the zoom level is Fit, then the image should fill the container using CSS
        const adjustedWidth =
            zoom === ZoomLevel.Fit ? naturalWidth : naturalWidth * zoom;
        const adjustedHeight =
            zoom === ZoomLevel.Fit ? naturalHeight : naturalHeight * zoom;

        if (zoom === ZoomLevel.Fit) {
            imageElement.style.width = "100%";
            imageElement.style.height = "100%";
            imageElement.style.objectFit = "contain";
            imageElement.style.cursor = "default";
            scrollableWidth = width;
            scrollableHeight = height;
        } else {
            imageElement.style.width = `${adjustedWidth}px`;
            imageElement.style.height = `${adjustedHeight}px`;
            imageElement.style.objectFit = "";
            imageElement.style.cursor = isPanning ? "grabbing" : "grab";
            scrollableWidth = adjustedWidth;
            scrollableHeight = adjustedHeight;
        }

        imageElement.style.position = "relative";

        // Center the image if smaller than container
        if (adjustedWidth < width && adjustedHeight < height) {
            imageElement.style.top = "50%";
            imageElement.style.left = "50%";
            imageElement.style.transform = "translate(-50%, -50%)";
        } else if (adjustedWidth < width) {
            imageElement.style.top = "0";
            imageElement.style.left = "50%";
            imageElement.style.transform = "translate(-50%, 0)";
        } else if (adjustedHeight < height) {
            imageElement.style.top = "50%";
            imageElement.style.left = "0";
            imageElement.style.transform = "translate(0, -50%)";
        } else {
            imageElement.style.top = "0";
            imageElement.style.left = "0";
            imageElement.style.transform = "none";
        }
    });

    // Handle image load to get natural dimensions
    function handleImageLoad(event: Event) {
        const img = event.target as HTMLImageElement;
        naturalWidth = img.naturalWidth;
        naturalHeight = img.naturalHeight;
    }

    // Mouse pan handlers
    function handleMouseDown(event: MouseEvent) {
        if (zoom === ZoomLevel.Fit) {
            return;
        }
        isPanning = true;
        if (imageElement) {
            imageElement.style.cursor = "grabbing";
        }
        panStartX = event.clientX;
        panStartY = event.clientY;
        scrollStartX = scrollableElement?.scrollLeft || 0;
        scrollStartY = scrollableElement?.scrollTop || 0;
        event.preventDefault();
    }

    function handleMouseMove(event: MouseEvent) {
        if (!isPanning || !scrollableElement) {
            return;
        }
        const deltaX = event.clientX - panStartX;
        const deltaY = event.clientY - panStartY;
        scrollableElement.scrollLeft = scrollStartX - deltaX;
        scrollableElement.scrollTop = scrollStartY - deltaY;
    }

    function handleMouseUp() {
        isPanning = false;
        if (zoom !== ZoomLevel.Fit && imageElement) {
            imageElement.style.cursor = "grab";
        }
    }

    function handleMouseLeave() {
        isPanning = false;
        if (zoom !== ZoomLevel.Fit && imageElement) {
            imageElement.style.cursor = "grab";
        }
    }

    // Compute scrollable container style
    function getScrollableStyle(): string {
        if (zoom === ZoomLevel.Fit) {
            return `width: ${width}px; height: ${height}px; overflow: hidden;`;
        }

        return `width: ${width}px; height: ${height}px; overflow: auto;`;
    }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
    class="pan-zoom-image-scrollable"
    style={getScrollableStyle()}
    bind:this={scrollableElement}
    onmousedown={handleMouseDown}
    onmousemove={handleMouseMove}
    onmouseup={handleMouseUp}
    onmouseleave={handleMouseLeave}
    role="application"
    tabindex="0"
    aria-label={description}
>
    <div
        class="pan-zoom-image-content"
        style="width: {scrollableWidth}px; height: {scrollableHeight}px;"
    >
        <img
            bind:this={imageElement}
            alt={description}
            class="plot"
            class:panning={isPanning}
            draggable="false"
            src={imageUri}
            onload={handleImageLoad}
        />
    </div>
</div>

<style>
    .pan-zoom-image-scrollable {
        overflow: auto;
        position: relative;
    }

    .pan-zoom-image-scrollable::-webkit-scrollbar {
        width: 10px;
        height: 10px;
    }

    .pan-zoom-image-scrollable::-webkit-scrollbar-track {
        background: transparent;
    }

    .pan-zoom-image-scrollable::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-background);
        border-radius: 5px;
    }

    .pan-zoom-image-scrollable::-webkit-scrollbar-thumb:hover {
        background: var(--vscode-scrollbarSlider-hoverBackground);
    }

    .pan-zoom-image-content {
        display: flex;
        justify-content: center;
        align-items: center;
        min-width: 100%;
        min-height: 100%;
    }

    img.plot {
        display: block;
        user-select: none;
    }

    img.plot.panning {
        cursor: grabbing;
    }

    img.plot:not(.panning) {
        cursor: grab;
    }
</style>
