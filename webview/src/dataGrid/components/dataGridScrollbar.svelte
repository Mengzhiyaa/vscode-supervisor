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
        onDidChangeScrollOffset?: (scrollOffset: number) => void;
    }

    let {
        orientation,
        totalSize,
        viewportSize,
        scrollPosition,
        onDidChangeScrollOffset,
    }: Props = $props();

    const maximumScrollPosition = $derived(
        Math.max(0, totalSize - viewportSize),
    );
    const thumbSize = $derived(
        maximumScrollPosition > 0
            ? Math.min(
                  viewportSize,
                  Math.max(30, (viewportSize / totalSize) * viewportSize),
              )
            : 0,
    );
    const thumbPosition = $derived(
        maximumScrollPosition > 0
            ? (pinToRange(scrollPosition, 0, maximumScrollPosition) /
                  maximumScrollPosition) *
                  (viewportSize - thumbSize)
            : 0,
    );
    const showScrollbar = $derived(maximumScrollPosition > 0);

    let trackRef: HTMLDivElement;
    let isDragging = $state(false);
    let dragPointerId = $state<number | undefined>(undefined);
    let dragStartPos = $state(0);
    let dragStartScroll = $state(0);

    function handleTrackClick(event: MouseEvent) {
        if (event.target === trackRef) {
            const rect = trackRef.getBoundingClientRect();
            const clickPos =
                orientation === "horizontal"
                    ? event.clientX - rect.left
                    : event.clientY - rect.top;

            if (clickPos < thumbPosition) {
                emitScroll(scrollPosition - viewportSize);
            } else if (clickPos > thumbPosition + thumbSize) {
                emitScroll(scrollPosition + viewportSize);
            }
        }
    }

    function handleTrackKeyDown(event: KeyboardEvent) {
        const step = 50;
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
            event.preventDefault();
            emitScroll(Math.max(0, scrollPosition - step));
        } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
            event.preventDefault();
            emitScroll(scrollPosition + step);
        }
    }

    function handleThumbPointerDown(event: PointerEvent) {
        if (event.pointerType === "mouse" && event.buttons !== 1) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        isDragging = true;
        dragPointerId = event.pointerId;
        dragStartPos =
            orientation === "horizontal" ? event.clientX : event.clientY;
        dragStartScroll = scrollPosition;
        const target = event.currentTarget as HTMLButtonElement;
        target.setPointerCapture(event.pointerId);
    }

    function handleThumbPointerMove(event: PointerEvent) {
        if (!isDragging || event.pointerId !== dragPointerId) {
            return;
        }

        const currentPos =
            orientation === "horizontal" ? event.clientX : event.clientY;
        const delta = currentPos - dragStartPos;
        const draggableSize = viewportSize - thumbSize;
        if (draggableSize <= 0) {
            return;
        }

        emitScroll(
            dragStartScroll +
                (delta / draggableSize) * maximumScrollPosition,
        );
    }

    function handleThumbPointerUp(event: PointerEvent) {
        if (event.pointerId !== dragPointerId) {
            return;
        }

        handleThumbPointerMove(event);
        isDragging = false;
        dragPointerId = undefined;
        const target = event.currentTarget as HTMLButtonElement;
        if (target.hasPointerCapture(event.pointerId)) {
            target.releasePointerCapture(event.pointerId);
        }
    }

    function handleLostPointerCapture(event: PointerEvent) {
        if (event.pointerId === dragPointerId) {
            isDragging = false;
            dragPointerId = undefined;
        }
    }

    function pinToRange(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    function emitScroll(newPosition: number) {
        onDidChangeScrollOffset?.(
            pinToRange(newPosition, 0, maximumScrollPosition),
        );
    }

    function handleWheel(event: WheelEvent) {
        event.preventDefault();
        const delta =
            orientation === "horizontal" ? event.deltaX : event.deltaY;
        emitScroll(scrollPosition + delta);
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
    aria-valuenow={pinToRange(scrollPosition, 0, maximumScrollPosition)}
    aria-valuemin={0}
    aria-valuemax={maximumScrollPosition}
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
        onpointerdown={handleThumbPointerDown}
        onpointermove={handleThumbPointerMove}
        onpointerup={handleThumbPointerUp}
        onpointercancel={handleThumbPointerUp}
        onlostpointercapture={handleLostPointerCapture}
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
