<script lang="ts">
    import { onMount } from "svelte";
    import type { Snippet } from "svelte";

    interface Props {
        title: string;
        width: number;
        height: number;
        onCancel?: () => void;
        closeOnClickOutside?: boolean;
        children: Snippet;
        footer?: Snippet;
    }

    let {
        title,
        width,
        height,
        onCancel,
        closeOnClickOutside = true,
        children,
        footer,
    }: Props = $props();

    const GUTTER = 10;
    const titleId = `positron-modal-dialog-${Math.random()
        .toString(36)
        .slice(2)}`;

    let containerRef = $state<HTMLDivElement | null>(null);
    let dialogLeft = $state(0);
    let dialogTop = $state(0);
    let dragging = $state(false);
    let positioned = $state(false);
    let dragStartX = 0;
    let dragStartY = 0;
    let dragOffsetLeft = 0;
    let dragOffsetTop = 0;

    function clampPosition(left: number, top: number) {
        if (!containerRef) {
            return { left, top };
        }

        return {
            left: Math.min(
                Math.max(left, GUTTER),
                Math.max(
                    GUTTER,
                    containerRef.clientWidth - width - GUTTER,
                ),
            ),
            top: Math.min(
                Math.max(top, GUTTER),
                Math.max(
                    GUTTER,
                    containerRef.clientHeight - height - GUTTER,
                ),
            ),
        };
    }

    function centerDialog() {
        if (!containerRef) {
            return;
        }

        const centered = clampPosition(
            Math.round((containerRef.clientWidth - width) / 2),
            Math.round((containerRef.clientHeight - height) / 2),
        );

        dialogLeft = centered.left;
        dialogTop = centered.top;
        positioned = true;
    }

    function handleBackdropClick(event: MouseEvent) {
        if (!closeOnClickOutside) {
            return;
        }

        if (event.target !== event.currentTarget) {
            return;
        }

        onCancel?.();
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (event.key !== "Escape") {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        onCancel?.();
    }

    function handleTitleBarMouseDown(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        dragStartX = event.clientX;
        dragStartY = event.clientY;
        dragOffsetLeft = dialogLeft;
        dragOffsetTop = dialogTop;
        dragging = true;

        const body = window.document.body;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            moveEvent.preventDefault();
            moveEvent.stopPropagation();

            const next = clampPosition(
                dragOffsetLeft + (moveEvent.clientX - dragStartX),
                dragOffsetTop + (moveEvent.clientY - dragStartY),
            );

            dialogLeft = next.left;
            dialogTop = next.top;
        };

        const handleMouseUp = (upEvent: MouseEvent) => {
            upEvent.preventDefault();
            upEvent.stopPropagation();

            body.removeEventListener("mousemove", handleMouseMove, false);
            body.removeEventListener("mouseup", handleMouseUp, false);
            dragging = false;
        };

        body.addEventListener("mousemove", handleMouseMove, false);
        body.addEventListener("mouseup", handleMouseUp, false);
    }

    onMount(() => {
        centerDialog();

        const resizeObserver = new ResizeObserver(() => {
            if (dragging) {
                return;
            }

            centerDialog();
        });

        if (containerRef) {
            resizeObserver.observe(containerRef);
        }

        return () => {
            resizeObserver.disconnect();
        };
    });
</script>

<div
    bind:this={containerRef}
    class="positron-modal-dialog-container"
    role="presentation"
    tabindex="-1"
    onclick={handleBackdropClick}
    onkeydown={handleKeyDown}
>
    <div
        class="positron-modal-dialog-box"
        class:positioned
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={`width: ${width}px; height: ${height}px; left: ${dialogLeft}px; top: ${dialogTop}px;`}
    >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="simple-title-bar" onmousedown={handleTitleBarMouseDown}>
            <div class="simple-title-bar-title" id={titleId}>
                {title}
            </div>
        </div>

        <div class="content-area">
            {@render children()}
        </div>

        <div class="ok-cancel-action-bar">
            {#if footer}
                {@render footer()}
            {/if}
        </div>
    </div>
</div>

<style>
    .positron-modal-dialog-container {
        inset: 0;
        z-index: 40;
        position: absolute;
        outline: none !important;
        background: rgba(0, 0, 0, 0.2);
    }

    .positron-modal-dialog-box {
        --_positron-modal-action-bar-height: 64px;
        display: flex;
        overflow: hidden;
        position: absolute;
        visibility: hidden;
        border-radius: 5px;
        color: var(--vscode-positronModalDialog-foreground);
        background: var(--vscode-positronModalDialog-background);
        border: 1px solid var(--vscode-positronModalDialog-border);
        box-shadow:
            0 4px 8px 0 rgba(0, 0, 0, 0.1),
            0 6px 20px 0 rgba(0, 0, 0, 0.1);
    }

    .positron-modal-dialog-box.positioned {
        visibility: visible;
    }

    .positron-modal-dialog-box .simple-title-bar {
        position: absolute;
        inset: 0 0 auto 0;
        height: 32px;
        display: flex;
        cursor: move;
        padding: 0 16px;
        align-items: center;
        color: var(--vscode-positronModalDialog-foreground);
        background: var(--vscode-positronModalDialog-titleBarBackground);
    }

    .positron-modal-dialog-box .simple-title-bar .simple-title-bar-title {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: var(--vscode-positronModalDialog-titleBarForeground);
    }

    .positron-modal-dialog-box .content-area {
        top: 32px;
        left: 0;
        right: 0;
        bottom: 64px;
        padding: 16px;
        position: absolute;
        overflow: auto;
        white-space: pre-line;
    }

    .positron-modal-dialog-box .ok-cancel-action-bar {
        left: 0;
        right: 0;
        bottom: 0;
        gap: 10px;
        height: var(--_positron-modal-action-bar-height);
        display: flex;
        margin: 0 16px;
        position: absolute;
        align-items: center;
        justify-content: end;
    }

    .positron-modal-dialog-box .ok-cancel-action-bar :global(.action-bar-button) {
        width: 80px;
        height: 32px;
    }

    .positron-modal-dialog-box :global(.action-bar-button) {
        display: flex;
        cursor: pointer;
        border-radius: 5px;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--vscode-positronModalDialog-buttonBorder);
        color: var(--vscode-positronModalDialog-buttonForeground);
        background: var(--vscode-positronModalDialog-buttonBackground);
    }

    .positron-modal-dialog-box :global(.action-bar-button:hover:not(:disabled)) {
        background: var(--vscode-positronModalDialog-buttonHoverBackground);
    }

    .positron-modal-dialog-box :global(.action-bar-button.default) {
        color: var(--vscode-positronModalDialog-defaultButtonForeground);
        background: var(--vscode-positronModalDialog-defaultButtonBackground);
    }

    .positron-modal-dialog-box :global(.action-bar-button.default:hover:not(:disabled)) {
        background: var(--vscode-positronModalDialog-defaultButtonHoverBackground);
    }

    .positron-modal-dialog-box :global(.action-bar-button:disabled) {
        cursor: default;
        opacity: 0.6;
    }

    .positron-modal-dialog-box :global(.action-bar-button:focus) {
        outline: none;
    }

    .positron-modal-dialog-box :global(.action-bar-button:focus-visible) {
        outline-offset: 2px;
        outline: 1px solid var(--vscode-focusBorder);
    }

</style>
