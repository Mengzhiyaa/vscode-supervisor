<!--
  verticalSplitter.svelte - Resizable vertical splitter (Positron-style behavior parity)
-->
<script lang="ts">
    const EXPAND_COLLAPSE_BUTTON_TOP = 4;
    const EXPAND_COLLAPSE_BUTTON_SIZE = 25;

    interface ResizeParams {
        minimumWidth: number;
        maximumWidth: number;
        startingWidth: number;
    }

    interface Props {
        collapseAriaLabel?: string;
        alwaysShowExpandCollapseButton?: boolean;
        collapsible?: boolean;
        expandAriaLabel?: string;
        invert?: boolean;
        isCollapsed?: boolean;
        showSash?: boolean;
        onBeginResize: () => ResizeParams;
        onCollapsedChanged?: (collapsed: boolean) => void;
        onInvert?: (invert: boolean) => void;
        onResize: (newWidth: number) => void;
        resizeAriaLabel?: string;
    }

    let {
        collapseAriaLabel = "Collapse",
        alwaysShowExpandCollapseButton = false,
        collapsible = false,
        expandAriaLabel = "Expand",
        invert = false,
        isCollapsed = false,
        showSash = true,
        onBeginResize,
        onCollapsedChanged,
        onInvert,
        onResize,
        resizeAriaLabel = "Resize summary panel",
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
    const sashResizeParams = $derived.by(() => onBeginResize());

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

    function handleSashKeyDown(event: KeyboardEvent) {
        if (event.target !== sashRef) {
            return;
        }
        const resizeParams = onBeginResize();
        if (event.key === "Home") {
            event.preventDefault();
            setCollapsed(true);
            return;
        }
        if (event.key === "End") {
            event.preventDefault();
            setCollapsed(false);
            onResize(resizeParams.maximumWidth);
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            onInvert?.(!invert);
            return;
        }
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
            return;
        }
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const delta = direction * (event.shiftKey ? 50 : 10) * (invert ? -1 : 1);
        const width = Math.max(
            resizeParams.minimumWidth,
            Math.min(resizeParams.maximumWidth, resizeParams.startingWidth + delta),
        );
        setCollapsed(false);
        onResize(width);
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
        return `width: ${width}px; left: ${left}px;`;
    });
</script>

<div class="vertical-splitter" style={`width: ${splitterWidth}px;`}>
    {#if showSash}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
            bind:this={sashRef}
            class="sash"
            class:hovering
            class:resizing
            class:collapsible
            style={sashStyle}
            onpointerenter={handleSashPointerEnter}
            onpointerleave={handleSashPointerLeave}
            onpointerdown={handleSashPointerDown}
            ondblclick={handleSashDoubleClick}
            onkeydown={handleSashKeyDown}
            role="separator"
            aria-orientation="vertical"
            aria-label={resizeAriaLabel}
            aria-valuemin={sashResizeParams.minimumWidth}
            aria-valuemax={sashResizeParams.maximumWidth}
            aria-valuenow={collapsed
                ? sashResizeParams.minimumWidth
                : sashResizeParams.startingWidth}
            tabindex="0"
        >
            <div
                class="sash-indicator"
                style={`width: ${sashIndicatorWidth}px;`}
            ></div>

            {#if showExpandCollapseButton}
                <button
                    bind:this={buttonRef}
                    type="button"
                    class="expand-collapse-button"
                    class:highlight={highlightExpandCollapse}
                    onclick={handleExpandCollapsePressed}
                    onpointerenter={handleButtonPointerEnter}
                    onpointerleave={handleButtonPointerLeave}
                    aria-label={
                        collapsed ? expandAriaLabel : collapseAriaLabel
                    }
                >
                    <span class={`codicon ${buttonChevronClass}`}></span>
                </button>
            {/if}
        </div>
    {/if}
</div>

<style>
    .vertical-splitter {
        position: relative;
        height: 100%;
        flex: 0 0 auto;
    }

    .sash {
        position: absolute;
        inset: 0 auto 0 50%;
        transform: translateX(-50%);
        display: flex;
        justify-content: center;
        cursor: ew-resize;
        touch-action: none;
    }

    .sash::before {
        content: "";
        position: absolute;
        inset: 0;
        background: transparent;
    }

    .sash-indicator {
        height: 100%;
        background: transparent;
    }

    .sash.hovering .sash-indicator,
    .sash.resizing .sash-indicator,
    .sash:focus-visible .sash-indicator {
        background: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
    }

    .expand-collapse-button {
        position: absolute;
        top: 4px;
        left: 50%;
        width: 25px;
        height: 25px;
        border: 0;
        display: flex;
        padding: 0;
        cursor: pointer;
        border-radius: 4px;
        align-items: center;
        justify-content: center;
        transform: translateX(-50%);
        color: var(--vscode-icon-foreground, var(--vscode-foreground));
        background: transparent;
    }

    .expand-collapse-button:hover,
    .expand-collapse-button.highlight {
        background: var(
            --vscode-toolbar-hoverBackground,
            rgba(127, 127, 127, 0.15)
        );
    }

    .expand-collapse-button:focus {
        outline: none;
    }

    .expand-collapse-button:focus-visible {
        outline-offset: 2px;
        outline: 1px solid var(--vscode-focusBorder);
    }

    @media (forced-colors: active) {
        .sash:hover .sash-indicator,
        .sash:focus-visible .sash-indicator,
        .sash.resizing .sash-indicator {
            background: Highlight;
        }
        .expand-collapse-button:focus-visible {
            outline: 2px solid Highlight;
        }
    }
</style>
