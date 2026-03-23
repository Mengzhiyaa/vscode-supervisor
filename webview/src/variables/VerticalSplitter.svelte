<script lang="ts">
    import { onMount } from "svelte";

    interface VerticalSplitterResizeParams {
        minimumWidth: number;
        maximumWidth: number;
        startingWidth: number;
    }

    interface Props {
        onBeginResize: () => VerticalSplitterResizeParams;
        onResize: (width: number) => void;
        showSash?: boolean;
    }

    const KEYBOARD_RESIZE_STEP = 8;

    let {
        onBeginResize,
        onResize,
        showSash = true,
    }: Props = $props();

    let sashRef = $state<HTMLButtonElement | undefined>();
    let hovering = $state(false);
    let resizing = $state(false);
    let sashWidth = $state(4);

    const isMacintosh =
        typeof navigator !== "undefined" &&
        navigator.platform.toLowerCase().includes("mac");
    const resizeCursor = isMacintosh ? "col-resize" : "ew-resize";

    onMount(() => {
        sashWidth = getSashWidth();
    });

    function getSashWidth(): number {
        const style = getComputedStyle(document.documentElement);
        const configuredSashSize = Number.parseInt(
            style.getPropertyValue("--vscode-sash-size"),
            10,
        );
        if (Number.isNaN(configuredSashSize) || configuredSashSize <= 0) {
            return 4;
        }
        return configuredSashSize;
    }

    function isPointInsideSash(x: number, y: number): boolean {
        if (!sashRef) {
            return false;
        }

        const rect = sashRef.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const resizeParams = onBeginResize();
        const delta = event.key === "ArrowRight" ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP;
        const width = Math.max(
            resizeParams.minimumWidth,
            Math.min(
                resizeParams.maximumWidth,
                resizeParams.startingWidth + delta,
            ),
        );

        onResize(width);
    }

    function handlePointerEnter() {
        hovering = true;
    }

    function handlePointerLeave() {
        if (!resizing) {
            hovering = false;
        }
    }

    function handlePointerDown(event: PointerEvent) {
        const isNonLeftMouseClick =
            event.pointerType === "mouse" && event.buttons !== 1;
        if (isNonLeftMouseClick) {
            return;
        }

        sashWidth = getSashWidth();

        event.preventDefault();
        event.stopPropagation();

        const resizeParams = onBeginResize();
        const startX = event.clientX;
        const target = document.body;
        const styleElement = document.createElement("style");
        target.appendChild(styleElement);

        const pointerMoveHandler = (moveEvent: PointerEvent) => {
            moveEvent.preventDefault();
            moveEvent.stopPropagation();

            const delta = Math.trunc(moveEvent.clientX - startX);
            let width = resizeParams.startingWidth + delta;
            let cursor = resizeCursor;

            if (width < resizeParams.minimumWidth / 2) {
                width = resizeParams.minimumWidth;
                cursor = resizeCursor;
            } else if (width < resizeParams.minimumWidth) {
                width = resizeParams.minimumWidth;
                cursor = "e-resize";
            } else if (width > resizeParams.maximumWidth) {
                width = resizeParams.maximumWidth;
                cursor = "w-resize";
            }

            styleElement.textContent = `* { cursor: ${cursor} !important; }`;
            onResize(width);
        };

        const lostPointerCaptureHandler = (upEvent: PointerEvent) => {
            pointerMoveHandler(upEvent);

            target.removeEventListener("pointermove", pointerMoveHandler);
            target.removeEventListener(
                "lostpointercapture",
                lostPointerCaptureHandler,
            );
            target.removeChild(styleElement);

            resizing = false;
            hovering = isPointInsideSash(upEvent.clientX, upEvent.clientY);
        };

        resizing = true;
        target.setPointerCapture(event.pointerId);
        target.addEventListener("pointermove", pointerMoveHandler);
        target.addEventListener("lostpointercapture", lostPointerCaptureHandler);
    }
</script>

<div class="vertical-splitter">
    <button
        type="button"
        bind:this={sashRef}
        class="sash"
        aria-label="Resize name column"
        style="left: {-(sashWidth / 2)}px; width: {sashWidth}px; cursor: {resizeCursor};"
        onpointerdown={handlePointerDown}
        onpointerenter={handlePointerEnter}
        onpointerleave={handlePointerLeave}
        onkeydown={handleKeyDown}
    >
        {#if showSash && (hovering || resizing)}
            <div
                class="sash-indicator"
                class:hovering={hovering}
                class:resizing={resizing}
                style="width: {Math.max(2, Math.trunc(sashWidth / 2))}px;"
            ></div>
        {/if}
    </button>
</div>

<style>
    .vertical-splitter {
        width: 1px;
        height: 100%;
        position: relative;
        flex-shrink: 0;
        background-origin: border-box;
        background: var(
            --vscode-positronVariables-border,
            var(--vscode-panel-border)
        );
    }

    .sash {
        border: none;
        padding: 0;
        appearance: none;
        background: transparent;
        position: absolute;
        z-index: 25;
        top: 0;
        height: 100%;
        display: flex;
        justify-content: center;
    }

    .sash-indicator {
        height: 100%;
    }

    .sash-indicator.hovering {
        transition: background-color 0.1s ease-out;
        background: var(--vscode-focusBorder);
    }

    .sash-indicator.resizing {
        background: var(--vscode-focusBorder);
    }
</style>
