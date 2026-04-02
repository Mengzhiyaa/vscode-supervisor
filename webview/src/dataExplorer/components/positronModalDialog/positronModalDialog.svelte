<script lang="ts">
    import type { Snippet } from "svelte";
    import { onMount } from "svelte";
    import DraggableTitleBar from "./components/draggableTitleBar.svelte";

    const FOCUSABLE_ELEMENT_SELECTORS =
        "a[href]:not([disabled])," +
        "button:not([disabled])," +
        "textarea:not([disabled])," +
        "input[type='text']:not([disabled])," +
        "input[type='number']:not([disabled])," +
        "input[type='radio']:not([disabled])," +
        "input[type='checkbox']:not([disabled])," +
        "select:not([disabled])";
    const GUTTER = 40;

    interface Props {
        title: string;
        width: number;
        height: number;
        onCancel?: () => void;
        closeOnClickOutside?: boolean;
        children: Snippet;
    }

    let {
        title,
        width,
        height,
        onCancel,
        closeOnClickOutside = true,
        children,
    }: Props = $props();

    const titleId = `positron-modal-dialog-${Math.random()
        .toString(36)
        .slice(2)}`;

    let dialogContainerRef = $state<HTMLDivElement | null>(null);
    let dialogBoxRef = $state<HTMLDivElement | null>(null);
    let dragging = $state(false);
    let dragOffsetLeft = $state(0);
    let dragOffsetTop = $state(0);
    let dialogLeft = $state(0);
    let dialogTop = $state(0);
    let positioned = $state(false);

    function clamp(left: number, top: number) {
        if (!dialogContainerRef) {
            return { left, top };
        }

        return {
            left: Math.min(
                Math.max(left, GUTTER),
                Math.max(dialogContainerRef.clientWidth - width - GUTTER, GUTTER),
            ),
            top: Math.min(
                Math.max(top, GUTTER),
                Math.max(dialogContainerRef.clientHeight - height - GUTTER, GUTTER),
            ),
        };
    }

    function centerDialog() {
        if (!dialogContainerRef) {
            return;
        }

        const centered = clamp(
            dialogContainerRef.clientWidth / 2 - width / 2,
            dialogContainerRef.clientHeight / 2 - height / 2,
        );

        dialogLeft = centered.left;
        dialogTop = centered.top;
        positioned = true;
    }

    function handleBackdropClick(event: MouseEvent) {
        if (!closeOnClickOutside || event.target !== dialogContainerRef) {
            return;
        }

        onCancel?.();
    }

    function getFocusableElements() {
        return Array.from(
            dialogBoxRef?.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENT_SELECTORS) ??
                [],
        );
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (!dialogBoxRef) {
            return;
        }

        switch (event.key) {
            case "Enter": {
                const activeElement = document.activeElement;
                if (activeElement instanceof HTMLTextAreaElement) {
                    return;
                }

                const defaultButton =
                    dialogBoxRef.querySelector<HTMLButtonElement>(
                        "button.default:not([disabled])",
                    );
                if (!defaultButton) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                defaultButton.click();
                return;
            }
            case "Escape": {
                event.preventDefault();
                event.stopPropagation();
                onCancel?.();
                return;
            }
            case "Tab": {
                const focusableElements = getFocusableElements();
                if (focusableElements.length === 0) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }

                const firstFocusableElement = focusableElements[0];
                const lastFocusableElement =
                    focusableElements[focusableElements.length - 1];
                const activeElement = document.activeElement;
                const activeElementIndex = focusableElements.findIndex(
                    (element) => element === activeElement,
                );

                if (!event.shiftKey) {
                    if (
                        activeElementIndex === -1 ||
                        activeElement === lastFocusableElement
                    ) {
                        event.preventDefault();
                        event.stopPropagation();
                        firstFocusableElement.focus();
                    }
                } else if (
                    activeElementIndex === -1 ||
                    activeElement === firstFocusableElement
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    lastFocusableElement.focus();
                }
            }
        }
    }

    function startDragHandler() {
        if (!dialogContainerRef) {
            return;
        }

        if (
            dialogLeft + width >= dialogContainerRef.clientWidth ||
            dialogTop + height >= dialogContainerRef.clientHeight
        ) {
            return;
        }

        dragOffsetLeft = dialogLeft;
        dragOffsetTop = dialogTop;
        dragging = true;
    }

    function dragHandler(x: number, y: number) {
        if (!dragging) {
            return;
        }

        const clamped = clamp(dragOffsetLeft + x, dragOffsetTop + y);
        dialogLeft = clamped.left;
        dialogTop = clamped.top;
    }

    function stopDragHandler(x: number, y: number) {
        if (!dragging) {
            return;
        }

        const clamped = clamp(dragOffsetLeft + x, dragOffsetTop + y);
        dialogLeft = clamped.left;
        dialogTop = clamped.top;
        dragging = false;
    }

    onMount(() => {
        centerDialog();

        const resizeObserver = new ResizeObserver(() => {
            if (!positioned) {
                centerDialog();
                return;
            }

            if (dragging) {
                return;
            }

            const clamped = clamp(dialogLeft, dialogTop);
            dialogLeft = clamped.left;
            dialogTop = clamped.top;
        });

        if (dialogContainerRef) {
            resizeObserver.observe(dialogContainerRef);
        }

        return () => {
            resizeObserver.disconnect();
        };
    });
</script>

<div
    bind:this={dialogContainerRef}
    class="positron-modal-dialog-container"
    role="presentation"
    tabindex="-1"
    onclick={handleBackdropClick}
    onkeydown={handleKeyDown}
>
    <div
        bind:this={dialogBoxRef}
        class="positron-modal-dialog-box"
        class:positioned
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={`left: ${dialogLeft}px; top: ${dialogTop}px; width: ${width}px; height: ${height}px;`}
    >
        <DraggableTitleBar
            {title}
            onStartDrag={startDragHandler}
            onDrag={dragHandler}
            onStopDrag={stopDragHandler}
        />
        <div id={titleId} class="screen-reader-title">{title}</div>
        {@render children()}
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

    .positron-modal-dialog-box :global(.content-area) {
        top: 32px;
        left: 0;
        right: 0;
        bottom: 64px;
        padding: 16px;
        position: absolute;
        overflow: auto;
        white-space: pre-line;
    }

    .positron-modal-dialog-box :global(.ok-cancel-action-bar) {
        left: 0;
        right: 0;
        bottom: 0;
        gap: 10px;
        height: 64px;
        display: flex;
        margin: 0 16px;
        position: absolute;
        align-items: center;
        justify-content: end;
    }

    .positron-modal-dialog-box :global(.ok-cancel-action-bar .action-bar-button) {
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

    .positron-modal-dialog-box
        :global(.action-bar-button:hover:not(:disabled)) {
        background: var(--vscode-positronModalDialog-buttonHoverBackground);
    }

    .positron-modal-dialog-box :global(.action-bar-button.default) {
        color: var(--vscode-positronModalDialog-defaultButtonForeground);
        background: var(--vscode-positronModalDialog-defaultButtonBackground);
    }

    .positron-modal-dialog-box
        :global(.action-bar-button.default:hover:not(:disabled)) {
        background: var(
            --vscode-positronModalDialog-defaultButtonHoverBackground
        );
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

    .screen-reader-title {
        width: 1px;
        height: 1px;
        padding: 0;
        overflow: hidden;
        position: absolute;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        clip-path: inset(50%);
        border: 0;
        margin: -1px;
    }
</style>
