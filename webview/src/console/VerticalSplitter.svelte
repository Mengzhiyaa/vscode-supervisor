<script lang="ts">
    import { localize } from "$lib/localization";
    let {
        sashSize = 4,
        onBeginResize,
        onResize,
    }: {
        sashSize?: number;
        onBeginResize: () => {
            minimumWidth: number;
            maximumWidth: number;
            startingWidth: number;
        };
        onResize: (newWidth: number) => void;
    } = $props();

    let splitterRef = $state<HTMLButtonElement>();
    let isDragging = $state(false);
    let hovered = $state(false);
    let startX = 0;
    let startWidth = 0;
    let minWidth = 0;
    let maxWidth = 0;

    function clampWidth(width: number): number {
        return Math.max(minWidth, Math.min(maxWidth, width));
    }

    function handlePointerDown(event: PointerEvent): void {
        if (event.button !== 0) return;
        event.preventDefault();
        const params = onBeginResize();
        startX = event.clientX;
        startWidth = params.startingWidth;
        minWidth = params.minimumWidth;
        maxWidth = params.maximumWidth;
        isDragging = true;
        splitterRef?.setPointerCapture(event.pointerId);
    }

    function handlePointerMove(event: PointerEvent): void {
        if (!isDragging) return;
        onResize(clampWidth(startWidth + event.clientX - startX));
    }

    function handlePointerUp(event: PointerEvent): void {
        if (!isDragging) return;
        isDragging = false;
        if (splitterRef?.hasPointerCapture(event.pointerId)) {
            splitterRef.releasePointerCapture(event.pointerId);
        }
    }

    function handleKeyDown(event: KeyboardEvent): void {
        const params = onBeginResize();
        minWidth = params.minimumWidth;
        maxWidth = params.maximumWidth;
        let nextWidth = params.startingWidth;
        if (event.key === "ArrowLeft") nextWidth -= event.shiftKey ? 20 : 4;
        else if (event.key === "ArrowRight") nextWidth += event.shiftKey ? 20 : 4;
        else if (event.key === "Home") nextWidth = minWidth;
        else if (event.key === "End") nextWidth = maxWidth;
        else return;
        event.preventDefault();
        onResize(clampWidth(nextWidth));
    }
</script>

<button
    type="button"
    bind:this={splitterRef}
    class="vertical-splitter"
    class:dragging={isDragging}
    class:hovered
    aria-label={localize("console.resizeSessionList", "Resize console session list")}
    style:width={`${Math.max(1, Math.min(20, sashSize))}px`}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
    onpointerenter={() => (hovered = true)}
    onpointerleave={() => (hovered = false)}
    onkeydown={handleKeyDown}
>
    <div class="divider"></div>
</button>

<style>
    .vertical-splitter {
        position: relative;
        flex-shrink: 0;
        cursor: col-resize;
        touch-action: none;
        outline: none;
        padding: 0;
        border: 0;
        background: transparent;
    }

    .divider {
        position: absolute;
        inset: 0 auto 0 50%;
        width: 1px;
        transform: translateX(-50%);
        background: var(--vscode-terminal-border, var(--vscode-panel-border));
        transition: width 80ms, background-color 80ms 300ms;
    }

    .vertical-splitter.hovered .divider,
    .vertical-splitter.dragging .divider,
    .vertical-splitter:focus-visible .divider {
        width: 2px;
        background: var(--vscode-focusBorder);
        transition-delay: 0ms;
    }
</style>
