<!--
  dataGridScrollbar.svelte - Custom scrollbar component (Svelte 5 runes mode)
  Port from Positron's dataGridScrollbar.tsx
-->
<script lang="ts">
    interface Props {
        orientation: "horizontal" | "vertical";
        totalSize: number;
        viewportSize: number;
        scrollPosition: number;
        onscroll?: (
            event: CustomEvent<{ scrollTop: number; scrollLeft: number }>,
        ) => void;
    }

    let {
        orientation,
        totalSize,
        viewportSize,
        scrollPosition,
        onscroll,
    }: Props = $props();

    // Calculate thumb size and position
    const thumbSize = $derived(
        totalSize > 0
            ? Math.max(30, (viewportSize / totalSize) * viewportSize)
            : 0,
    );
    const thumbPosition = $derived(
        totalSize > viewportSize
            ? (scrollPosition / (totalSize - viewportSize)) *
                  (viewportSize - thumbSize)
            : 0,
    );
    const showScrollbar = $derived(totalSize > viewportSize);

    let trackRef: HTMLDivElement;
    let isDragging = $state(false);
    let dragStartPos = $state(0);
    let dragStartScroll = $state(0);

    function handleTrackClick(event: MouseEvent) {
        if (event.target === trackRef) {
            const rect = trackRef.getBoundingClientRect();
            const clickPos =
                orientation === "horizontal"
                    ? event.clientX - rect.left
                    : event.clientY - rect.top;

            const newScrollRatio = clickPos / viewportSize;
            const newScroll = newScrollRatio * (totalSize - viewportSize);

            emitScroll(newScroll);
        }
    }

    function handleTrackKeyDown(event: KeyboardEvent) {
        const step = 50;
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
            event.preventDefault();
            emitScroll(Math.max(0, scrollPosition - step));
        } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
            event.preventDefault();
            emitScroll(
                Math.min(totalSize - viewportSize, scrollPosition + step),
            );
        }
    }

    function handleThumbMouseDown(event: MouseEvent) {
        event.preventDefault();
        isDragging = true;
        dragStartPos =
            orientation === "horizontal" ? event.clientX : event.clientY;
        dragStartScroll = scrollPosition;

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
    }

    function handleMouseMove(event: MouseEvent) {
        if (!isDragging) return;

        const currentPos =
            orientation === "horizontal" ? event.clientX : event.clientY;
        const delta = currentPos - dragStartPos;
        const scrollDelta =
            (delta / (viewportSize - thumbSize)) * (totalSize - viewportSize);
        const newScroll = Math.max(
            0,
            Math.min(totalSize - viewportSize, dragStartScroll + scrollDelta),
        );

        emitScroll(newScroll);
    }

    function handleMouseUp() {
        isDragging = false;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
    }

    function emitScroll(newPosition: number) {
        if (onscroll) {
            const detail =
                orientation === "horizontal"
                    ? { scrollTop: scrollPosition, scrollLeft: newPosition }
                    : { scrollTop: newPosition, scrollLeft: scrollPosition };
            onscroll(new CustomEvent("scroll", { detail }));
        }
    }

    function handleWheel(event: WheelEvent) {
        event.preventDefault();
        const delta =
            orientation === "horizontal" ? event.deltaX : event.deltaY;
        const newScroll = Math.max(
            0,
            Math.min(totalSize - viewportSize, scrollPosition + delta),
        );
        emitScroll(newScroll);
    }
</script>

<div
    class="scrollbar"
    class:horizontal={orientation === "horizontal"}
    class:vertical={orientation === "vertical"}
    class:hidden={!showScrollbar}
    bind:this={trackRef}
    onclick={handleTrackClick}
    onkeydown={handleTrackKeyDown}
    onwheel={handleWheel}
    role="scrollbar"
    aria-orientation={orientation}
    aria-valuenow={scrollPosition}
    aria-valuemin={0}
    aria-valuemax={totalSize - viewportSize}
    aria-controls="grid-data-area"
    tabindex="0"
>
    <button
        type="button"
        class="thumb"
        style="{orientation === 'horizontal'
            ? 'left'
            : 'top'}: {thumbPosition}px; {orientation === 'horizontal'
            ? 'width'
            : 'height'}: {thumbSize}px;"
        tabindex="-1"
        aria-label="Scroll thumb"
        onmousedown={handleThumbMouseDown}
    ></button>
</div>

<style>
    .scrollbar {
        position: relative;
        background: var(--vscode-scrollbarSlider-background);
    }

    .scrollbar.horizontal {
        height: 100%;
        width: 100%;
    }

    .scrollbar.vertical {
        width: 100%;
        height: 100%;
    }

    .scrollbar.hidden {
        display: none;
    }

    .thumb {
        position: absolute;
        border: 0;
        background: var(--vscode-scrollbarSlider-hoverBackground);
        border-radius: 3px;
        cursor: pointer;
        padding: 0;
    }

    .scrollbar.horizontal .thumb {
        top: 2px;
        bottom: 2px;
    }

    .scrollbar.vertical .thumb {
        left: 2px;
        right: 2px;
    }

    .thumb:hover {
        background: var(--vscode-scrollbarSlider-activeBackground);
    }
</style>
