<script lang="ts">
    /**
     * VerticalSplitter.svelte - Resizable divider between panels
     * Based on Positron's VerticalSplitter
     */

    // Props
    let {
        onBeginResize,
        onResize,
    }: {
        onBeginResize: () => {
            minimumWidth: number;
            maximumWidth: number;
            startingWidth: number;
        };
        onResize: (newWidth: number) => void;
    } = $props();

    // State
    let isDragging = $state(false);
    let startX = $state(0);
    let startWidth = $state(0);
    let minWidth = $state(0);
    let maxWidth = $state(0);

    /**
     * Handle mouse down to start resize
     */
    function handleMouseDown(e: MouseEvent) {
        e.preventDefault();

        const params = onBeginResize();
        startX = e.clientX;
        startWidth = params.startingWidth;
        minWidth = params.minimumWidth;
        maxWidth = params.maximumWidth;
        isDragging = true;

        // Add global listeners
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
    }

    /**
     * Handle mouse move during resize
     */
    function handleMouseMove(e: MouseEvent) {
        if (!isDragging) return;

        const delta = e.clientX - startX;
        const newWidth = Math.max(
            minWidth,
            Math.min(maxWidth, startWidth + delta),
        );
        onResize(newWidth);
    }

    /**
     * Handle mouse up to end resize
     */
    function handleMouseUp() {
        isDragging = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
    }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
    class="vertical-splitter"
    class:dragging={isDragging}
    role="separator"
    aria-orientation="vertical"
    onmousedown={handleMouseDown}
></div>

<style>
    .vertical-splitter {
        width: 4px;
        cursor: col-resize;
        background: var(--vscode-terminal-border);
        flex-shrink: 0;
        transition: background-color 0.1s;
    }

    .vertical-splitter:hover,
    .vertical-splitter.dragging {
        background: var(--vscode-focusBorder);
    }
</style>
