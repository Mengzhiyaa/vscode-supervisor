<!--
  VerticalSplitter.svelte - Resizable vertical splitter (Positron-style behavior parity)
-->
<script lang="ts">
    import { onMount } from "svelte";

    const EXPAND_COLLAPSE_BUTTON_TOP = 4;
    const EXPAND_COLLAPSE_BUTTON_SIZE = 25;

    interface ResizeParams {
        minimumWidth: number;
        maximumWidth: number;
        startingWidth: number;
    }

    interface Props {
        alwaysShowExpandCollapseButton?: boolean;
        collapsible?: boolean;
        invert?: boolean;
        isCollapsed?: boolean;
        showSash?: boolean;
        onBeginResize: () => ResizeParams;
        onCollapsedChanged?: (collapsed: boolean) => void;
        onInvert?: (invert: boolean) => void;
        onResize: (newWidth: number) => void;
    }

    let {
        alwaysShowExpandCollapseButton = false,
        collapsible = false,
        invert = false,
        isCollapsed = false,
        showSash = true,
        onBeginResize,
        onCollapsedChanged,
        onInvert,
        onResize,
    }: Props = $props();

    let sashRef = $state<HTMLDivElement | undefined>(undefined);
    let buttonRef = $state<HTMLButtonElement | undefined>(undefined);

    let hovering = $state(false);
    let resizing = $state(false);
    let collapsed = $state(false);
    let highlightExpandCollapse = $state(false);

    let splitterWidth = $state(1);
    let sashWidth = $state(4);
    let sashIndicatorWidth = $state(4);
    let hoverDelay = $state(300);

    let hoverTimer: ReturnType<typeof setTimeout> | undefined;

    const isMacintosh =
        typeof navigator !== "undefined" &&
        navigator.platform.toLowerCase().includes("mac");

    function getRootNumberVar(name: string, fallback: number): number {
        if (typeof window === "undefined") {
            return fallback;
        }
        const style = getComputedStyle(document.documentElement);
        const raw = style.getPropertyValue(name).trim();
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    function getConfiguredSashSize(): number {
        return getRootNumberVar("--vscode-sash-size", 4);
    }

    function getConfiguredHoverDelay(): number {
        return getRootNumberVar("--vscode-sash-hoverDelay", 300);
    }

    function syncConfigurationValues() {
        const baseSashSize = getConfiguredSashSize();
        splitterWidth = collapsible ? baseSashSize * 2 : 1;
        sashWidth = collapsible ? baseSashSize * 2 : baseSashSize;
        sashIndicatorWidth = baseSashSize;
        hoverDelay = getConfiguredHoverDelay();
    }

    function clearHoverTimer() {
        if (hoverTimer) {
            clearTimeout(hoverTimer);
            hoverTimer = undefined;
        }
    }

    function delayHoverUpdate(nextHovering: boolean) {
        clearHoverTimer();
        hoverTimer = setTimeout(() => {
            hovering = nextHovering;
        }, hoverDelay);
    }

    function isPointInsideElement(
        x: number,
        y: number,
        element?: HTMLElement,
    ): boolean {
        if (!element) {
            return false;
        }
        const rect = element.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    function updateHighlightFromPointer(clientY: number) {
        if (!sashRef) {
            highlightExpandCollapse = false;
            return;
        }

        const rect = sashRef.getBoundingClientRect();
        const top = rect.top + EXPAND_COLLAPSE_BUTTON_TOP;
        const bottom = top + EXPAND_COLLAPSE_BUTTON_SIZE;
        highlightExpandCollapse = clientY >= top && clientY <= bottom;
    }

    function setCollapsed(next: boolean) {
        if (collapsed === next) {
            return;
        }
        collapsed = next;
        onCollapsedChanged?.(next);
    }

    function handleExpandCollapsePressed() {
        setCollapsed(!collapsed);
        clearHoverTimer();
        hovering = false;
        highlightExpandCollapse = false;
    }

    function handleSashDoubleClick(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        onInvert?.(!invert);
    }

    function handleButtonPointerEnter() {
        clearHoverTimer();
        hovering = true;
        highlightExpandCollapse = true;
    }

    function handleButtonPointerLeave() {
        delayHoverUpdate(false);
        highlightExpandCollapse = false;
    }

    function handleSashPointerEnter(event: PointerEvent) {
        delayHoverUpdate(true);
        updateHighlightFromPointer(event.clientY);
    }

    function handleSashPointerLeave() {
        if (!resizing) {
            delayHoverUpdate(false);
        }
    }

    function handleSashPointerDown(event: PointerEvent) {
        const isNonLeftMouseClick =
            event.pointerType === "mouse" && event.buttons !== 1;
        if (isNonLeftMouseClick) {
            return;
        }

        if (isPointInsideElement(event.clientX, event.clientY, buttonRef)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        syncConfigurationValues();

        const resizeParams = onBeginResize();
        const startingWidth = collapsed ? sashWidth : resizeParams.startingWidth;
        const startX = event.clientX;
        const target = document.body;
        const styleElement = document.createElement("style");
        target.appendChild(styleElement);

        const pointerMoveHandler = (moveEvent: PointerEvent) => {
            moveEvent.preventDefault();
            moveEvent.stopPropagation();

            const delta = Math.trunc(moveEvent.clientX - startX);
            let newWidth = !invert ? startingWidth + delta : startingWidth - delta;

            let newCollapsed = false;
            let cursor = isMacintosh ? "col-resize" : "ew-resize";

            if (newWidth < resizeParams.minimumWidth / 2) {
                newWidth = resizeParams.minimumWidth;
                newCollapsed = true;
            } else if (newWidth < resizeParams.minimumWidth) {
                newWidth = resizeParams.minimumWidth;
                cursor = !invert ? "e-resize" : "w-resize";
            } else if (newWidth > resizeParams.maximumWidth) {
                newWidth = resizeParams.maximumWidth;
                cursor = !invert ? "w-resize" : "e-resize";
            }

            styleElement.textContent = `* { cursor: ${cursor} !important; }`;
            onResize(newWidth);

            if (newCollapsed !== collapsed) {
                setCollapsed(newCollapsed);
            }
        };

        const pointerUpHandler = (upEvent: PointerEvent) => {
            pointerMoveHandler(upEvent);

            target.removeEventListener("pointermove", pointerMoveHandler);
            target.removeEventListener("pointerup", pointerUpHandler);

            styleElement.remove();

            resizing = false;
            clearHoverTimer();
            hovering = isPointInsideElement(upEvent.clientX, upEvent.clientY, sashRef);
            updateHighlightFromPointer(upEvent.clientY);
        };

        resizing = true;

        target.addEventListener("pointermove", pointerMoveHandler);
        target.addEventListener("pointerup", pointerUpHandler, { once: true });
    }

    $effect(() => {
        collapsed = isCollapsed;
    });

    $effect(() => {
        syncConfigurationValues();
    });

    const showExpandCollapseButton = $derived(
        collapsible &&
            (alwaysShowExpandCollapseButton || hovering || resizing || collapsed),
    );

    const buttonChevronClass = $derived.by(() => {
        if (!collapsed) {
            return !invert ? "codicon-chevron-left" : "codicon-chevron-right";
        }
        return !invert ? "codicon-chevron-right" : "codicon-chevron-left";
    });

    const sashStyle = $derived.by(() => {
        const left = collapsible ? -1 : -(sashWidth / 2);
        const width = collapsible ? sashWidth + 2 : sashWidth;
        return `left: ${left}px; width: ${width}px;`;
    });

    const splitterStyle = $derived(`width: ${splitterWidth}px;`);

    onMount(() => {
        syncConfigurationValues();
        return () => {
            clearHoverTimer();
        };
    });
</script>

<div
    class="vertical-splitter"
    class:collapsible={collapsible}
    class:show-sash={showSash}
    style={splitterStyle}
>
    <div
        bind:this={sashRef}
        class="sash"
        style={sashStyle}
        onpointerdown={handleSashPointerDown}
        onpointerenter={handleSashPointerEnter}
        onpointerleave={handleSashPointerLeave}
        ondblclick={handleSashDoubleClick}
        role="presentation"
    >
        {#if showSash && (hovering || resizing)}
            <div
                class="sash-indicator"
                class:hovering={showSash && hovering}
                class:resizing={showSash && resizing}
                style={`width: ${sashIndicatorWidth}px;`}
            ></div>
        {/if}
    </div>

    {#if showExpandCollapseButton}
        <button
            bind:this={buttonRef}
            type="button"
            class="expand-collapse-button"
            style={`top: ${EXPAND_COLLAPSE_BUTTON_TOP}px; width: ${EXPAND_COLLAPSE_BUTTON_SIZE}px; height: ${EXPAND_COLLAPSE_BUTTON_SIZE}px;`}
            onclick={handleExpandCollapsePressed}
            title={collapsed ? "Expand Summary" : "Collapse Summary"}
            aria-label={collapsed ? "Expand Summary" : "Collapse Summary"}
        >
            <div
                class={`expand-collapse-button-face codicon ${buttonChevronClass}`}
                class:highlighted={highlightExpandCollapse}
                style={`width: ${EXPAND_COLLAPSE_BUTTON_SIZE}px; height: ${EXPAND_COLLAPSE_BUTTON_SIZE}px;`}
                onpointerenter={handleButtonPointerEnter}
                onpointerleave={handleButtonPointerLeave}
                role="presentation"
            ></div>
        </button>
    {/if}
</div>

<style>
    .vertical-splitter {
        height: 100%;
        position: relative;
        background-origin: border-box;
        overflow: visible;
    }

    .vertical-splitter.collapsible.show-sash {
        border-left: 1px solid var(--vscode-positronDataExplorer-border, var(--vscode-editorGroup-border));
        border-right: 1px solid var(--vscode-positronDataExplorer-border, var(--vscode-editorGroup-border));
        background-color: var(--vscode-positronDataExplorer-contrastBackground, var(--vscode-editor-background));
    }

    :global(:not(.mac)) .vertical-splitter .sash {
        cursor: ew-resize;
    }

    :global(.mac) .vertical-splitter .sash {
        cursor: col-resize;
    }

    .vertical-splitter .sash {
        z-index: 25;
        height: 100%;
        display: flex;
        position: relative;
        justify-content: center;
    }

    .vertical-splitter .sash .sash-indicator {
        height: 100%;
        position: relative;
    }

    .vertical-splitter .sash .sash-indicator.hovering {
        transition: background-color 0.1s ease-out;
        background-color: var(--vscode-focusBorder);
    }

    .vertical-splitter .sash .sash-indicator.resizing {
        background-color: var(--vscode-focusBorder);
    }

    .vertical-splitter .expand-collapse-button {
        right: 50%;
        z-index: 100;
        cursor: pointer;
        overflow: visible;
        position: absolute;
        transform: translateX(50%);
        border: none;
        background: transparent;
        padding: 0;
    }

    .vertical-splitter .expand-collapse-button:focus {
        outline: none;
    }

    .vertical-splitter .expand-collapse-button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
        border-radius: 50%;
    }

    .vertical-splitter .expand-collapse-button .expand-collapse-button-face {
        top: 0;
        left: 0;
        display: flex;
        position: absolute;
        border-radius: 50%;
        font-weight: bolder;
        align-items: center;
        box-sizing: border-box;
        justify-content: center;
        color: var(--vscode-positronSplitterExpandCollapseButton-foreground, var(--vscode-foreground));
        border: 1px solid var(--vscode-positronSplitterExpandCollapseButton-foreground, var(--vscode-editorGroup-border));
        background-color: var(--vscode-positronSplitterExpandCollapseButton-background, var(--vscode-editor-background));
    }

    .vertical-splitter .expand-collapse-button .expand-collapse-button-face.highlighted {
        color: var(--vscode-positronSplitterExpandCollapseButton-background, var(--vscode-editor-background));
        background-color: var(--vscode-positronSplitterExpandCollapseButton-foreground, var(--vscode-foreground));
    }
</style>
