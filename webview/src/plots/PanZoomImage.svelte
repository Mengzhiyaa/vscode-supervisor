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

    // State
    let naturalWidth = $state(0);
    let naturalHeight = $state(0);
    let scrollableElement: HTMLDivElement;

    // Handle mouse pan state
    let isPanning = $state(false);
    let panStartX = 0;
    let panStartY = 0;
    let scrollStartX = 0;
    let scrollStartY = 0;

    const isFit = $derived(zoom === ZoomLevel.Fit);
    const adjustedWidth = $derived(
        isFit ? naturalWidth : naturalWidth * zoom,
    );
    const adjustedHeight = $derived(
        isFit ? naturalHeight : naturalHeight * zoom,
    );
    const scrollableWidth = $derived(isFit ? width : adjustedWidth);
    const scrollableHeight = $derived(isFit ? height : adjustedHeight);
    const imageWidth = $derived(isFit ? "100%" : `${adjustedWidth}px`);
    const imageHeight = $derived(isFit ? "100%" : `${adjustedHeight}px`);
    const imageCursor = $derived(
        isFit ? "default" : isPanning ? "grabbing" : "grab",
    );
    const imagePosition = $derived.by(() => {
        const centeredHorizontally = adjustedWidth < width;
        const centeredVertically = adjustedHeight < height;

        return {
            top: centeredVertically ? "50%" : "0",
            left: centeredHorizontally ? "50%" : "0",
            transform:
                centeredHorizontally && centeredVertically
                    ? "translate(-50%, -50%)"
                    : centeredHorizontally
                      ? "translate(-50%, 0)"
                      : centeredVertically
                        ? "translate(0, -50%)"
                        : "none",
        };
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
    }

    function handleMouseLeave() {
        isPanning = false;
    }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
    class="pan-zoom-image-scrollable"
    style:width="{width}px"
    style:height="{height}px"
    style:overflow={isFit ? "hidden" : "auto"}
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
        style:width="{scrollableWidth}px"
        style:height="{scrollableHeight}px"
    >
        <img
            alt={description}
            class="plot"
            style:width={imageWidth}
            style:height={imageHeight}
            style:object-fit={isFit ? "contain" : null}
            style:cursor={imageCursor}
            style:position="relative"
            style:top={imagePosition.top}
            style:left={imagePosition.left}
            style:transform={imagePosition.transform}
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

</style>
