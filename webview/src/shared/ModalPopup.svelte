<!--
  ModalPopup.svelte
  Shared anchored modal popup extracted from data explorer's ModalPopup.
-->
<svelte:options css="injected" />

<script lang="ts">
    import { onMount } from "svelte";

    const LAYOUT_OFFSET = 2;
    const LAYOUT_MARGIN = 10;
    const DEFAULT_FOCUSABLE_ELEMENT_SELECTORS =
        'a[href]:not([disabled]), button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    type PopupAlignment = "auto" | "left" | "right";
    type PopupPosition = "auto" | "top" | "bottom";
    type KeyboardNavigationStyle = "dialog" | "menu";
    type PopupDimension = number | "auto";
    type PopupMaxDimension = number | "none";
    type PopupShadow = "top" | "bottom";

    interface Props {
        anchorElement: HTMLElement;
        width?: PopupDimension;
        height?: PopupDimension;
        minHeight?: number;
        maxHeight?: PopupMaxDimension;
        fixedHeight?: boolean;
        popupAlignment?: PopupAlignment;
        popupPosition?: PopupPosition;
        keyboardNavigationStyle?: KeyboardNavigationStyle;
        focusableElementSelectors?: string;
        onClose?: () => void;
        children?: import("svelte").Snippet;
    }

    interface PopupLayout {
        top: number | "auto";
        right: number | "auto";
        bottom: number | "auto";
        left: number | "auto";
        width: PopupDimension;
        height: PopupDimension;
        minHeight: PopupDimension;
        maxHeight: PopupMaxDimension;
        shadow: PopupShadow;
    }

    let {
        anchorElement,
        width = 275,
        height = "auto",
        minHeight,
        maxHeight = 400,
        fixedHeight = false,
        popupAlignment = "auto",
        popupPosition = "auto",
        keyboardNavigationStyle = "dialog",
        focusableElementSelectors,
        onClose,
        children,
    }: Props = $props();

    let popupContainerRef = $state<HTMLDivElement | null>(null);
    let popupRef = $state<HTMLDivElement | null>(null);
    let popupChildrenRef = $state<HTMLDivElement | null>(null);

    function createPopupLayout(): PopupLayout {
        return {
            top: -10000,
            right: "auto",
            bottom: "auto",
            left: -10000,
            width,
            height,
            minHeight: minHeight ?? "auto",
            maxHeight,
            shadow: "bottom",
        };
    }

    let popupLayout = $state<PopupLayout>(createPopupLayout());

    const popupStyle = $derived.by(() => {
        const formatDimension = (
            value: number | "auto" | "none",
            fallback = "auto",
        ) => {
            if (typeof value === "number") {
                return `${value}px`;
            }
            return value ?? fallback;
        };

        return [
            `top: ${formatDimension(popupLayout.top)}`,
            `right: ${formatDimension(popupLayout.right)}`,
            `bottom: ${formatDimension(popupLayout.bottom)}`,
            `left: ${formatDimension(popupLayout.left)}`,
            `width: ${formatDimension(popupLayout.width)}`,
            `height: ${formatDimension(popupLayout.height)}`,
            `min-height: ${formatDimension(popupLayout.minHeight)}`,
            `max-height: ${formatDimension(popupLayout.maxHeight, "none")}`,
        ].join("; ");
    });

    function closePopup() {
        onClose?.();
    }

    function getFocusableElements() {
        if (!popupContainerRef) {
            return [] as HTMLElement[];
        }

        return Array.from(
            popupContainerRef.querySelectorAll<HTMLElement>(
                focusableElementSelectors ??
                    DEFAULT_FOCUSABLE_ELEMENT_SELECTORS,
            ),
        );
    }

    function navigateFocusableElements(
        direction: "next" | "previous",
        wrap: boolean,
    ) {
        const focusableElements = getFocusableElements();
        if (focusableElements.length === 0) {
            return;
        }

        const firstFocusableElement = focusableElements[0];
        const lastFocusableElement =
            focusableElements[focusableElements.length - 1];
        const activeElement =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
        const focusableElementIndex = activeElement
            ? focusableElements.findIndex(
                  (focusableElement) => focusableElement === activeElement,
              )
            : -1;

        if (direction === "next") {
            if (
                focusableElementIndex === -1 ||
                (wrap && activeElement === lastFocusableElement)
            ) {
                firstFocusableElement.focus();
                return;
            }

            if (focusableElementIndex < focusableElements.length - 1) {
                focusableElements[focusableElementIndex + 1]?.focus();
            }
            return;
        }

        if (
            focusableElementIndex === -1 ||
            (wrap && activeElement === firstFocusableElement)
        ) {
            lastFocusableElement.focus();
            return;
        }

        if (focusableElementIndex > 0) {
            focusableElements[focusableElementIndex - 1]?.focus();
        }
    }

    function constrainedMinHeight(availableHeight: number) {
        if (minHeight === undefined) {
            return "auto" as const;
        }

        return Math.min(Math.max(availableHeight, 0), minHeight);
    }

    function constrainedMaxHeight(availableHeight: number) {
        const safeAvailableHeight = Math.max(availableHeight, 0);
        return typeof maxHeight === "number"
            ? Math.min(safeAvailableHeight, maxHeight)
            : safeAvailableHeight;
    }

    function isTextEditableElement(element: HTMLElement | null): boolean {
        if (!element) {
            return false;
        }

        if (element instanceof HTMLTextAreaElement) {
            return !element.readOnly && !element.disabled;
        }

        if (element instanceof HTMLInputElement) {
            if (element.readOnly || element.disabled) {
                return false;
            }

            const nonTextInputTypes = new Set([
                "button",
                "checkbox",
                "color",
                "file",
                "hidden",
                "image",
                "radio",
                "range",
                "reset",
                "submit",
            ]);

            return !nonTextInputTypes.has(element.type);
        }

        return element.isContentEditable;
    }

    function updatePopupLayout() {
        if (!anchorElement || !popupRef || !popupChildrenRef) {
            return;
        }

        const popupChildren = popupChildrenRef;

        const { clientWidth: documentWidth, clientHeight: documentHeight } =
            document.documentElement;
        const anchorRect = anchorElement.getBoundingClientRect();
        const anchorX = anchorRect.left;
        const anchorY = anchorRect.top;
        const anchorWidth = anchorRect.width;
        const anchorHeight = anchorRect.height;

        const leftAreaWidth = anchorX + anchorWidth - LAYOUT_MARGIN;
        const rightAreaWidth = documentWidth - anchorX - LAYOUT_MARGIN;

        const nextPopupLayout = createPopupLayout();

        const numericWidth =
            typeof width === "number"
                ? width
                : Math.max(
                      popupRef.offsetWidth,
                      popupChildrenRef.offsetWidth,
                      anchorWidth,
                  );

        const positionLeft = () => {
            nextPopupLayout.left = Math.max(
                LAYOUT_MARGIN,
                Math.min(
                    anchorX,
                    documentWidth - numericWidth - LAYOUT_MARGIN,
                ),
            );
            nextPopupLayout.right = "auto";
        };

        const positionRight = () => {
            nextPopupLayout.left = Math.max(
                LAYOUT_MARGIN,
                Math.min(
                    anchorX + anchorWidth - numericWidth,
                    documentWidth - numericWidth - LAYOUT_MARGIN,
                ),
            );
            nextPopupLayout.right = "auto";
        };

        if (popupAlignment === "left") {
            positionLeft();
        } else if (popupAlignment === "right") {
            positionRight();
        } else if (leftAreaWidth > rightAreaWidth) {
            positionRight();
        } else {
            positionLeft();
        }

        const topAreaHeight = anchorY - LAYOUT_OFFSET - LAYOUT_MARGIN;
        const bottomAreaHeight =
            documentHeight -
            (anchorY + anchorHeight + LAYOUT_OFFSET + LAYOUT_MARGIN);

        if (height === "auto") {
            const layoutHeight = popupChildrenRef.offsetHeight + 2;

            const positionBottom = () => {
                nextPopupLayout.top = anchorY + anchorHeight + LAYOUT_OFFSET;
                nextPopupLayout.bottom = "auto";
                if (fixedHeight) {
                    nextPopupLayout.top = Math.min(
                        nextPopupLayout.top,
                        documentHeight -
                            popupChildren.offsetHeight -
                            2 -
                            LAYOUT_MARGIN,
                    );
                } else {
                    nextPopupLayout.minHeight = constrainedMinHeight(
                        bottomAreaHeight,
                    );
                    nextPopupLayout.maxHeight = constrainedMaxHeight(
                        documentHeight -
                            (nextPopupLayout.top as number) -
                            LAYOUT_MARGIN,
                    );
                }
                nextPopupLayout.shadow = "bottom";
            };

            const positionTop = () => {
                const drawHeight = Math.min(
                    topAreaHeight,
                    typeof maxHeight === "number" ? maxHeight : layoutHeight,
                    layoutHeight,
                );
                nextPopupLayout.top = Math.max(
                    anchorY - drawHeight - LAYOUT_OFFSET,
                    LAYOUT_MARGIN,
                );
                nextPopupLayout.bottom = "auto";
                nextPopupLayout.minHeight = constrainedMinHeight(drawHeight);
                nextPopupLayout.maxHeight = constrainedMaxHeight(drawHeight);
                nextPopupLayout.shadow = "top";
            };

            if (popupPosition === "bottom") {
                positionBottom();
            } else if (popupPosition === "top") {
                positionTop();
            } else if (layoutHeight <= bottomAreaHeight) {
                positionBottom();
            } else if (layoutHeight <= topAreaHeight) {
                positionTop();
            } else if (bottomAreaHeight > topAreaHeight) {
                positionBottom();
            } else {
                positionTop();
            }
        } else {
            const positionBottom = () => {
                nextPopupLayout.top = anchorY + anchorHeight + LAYOUT_OFFSET;
                nextPopupLayout.bottom = "auto";
                nextPopupLayout.minHeight = constrainedMinHeight(
                    bottomAreaHeight,
                );
                nextPopupLayout.maxHeight = constrainedMaxHeight(
                    bottomAreaHeight,
                );
                nextPopupLayout.shadow = "bottom";
            };

            const positionTop = () => {
                const drawHeight = Math.min(topAreaHeight, height);
                nextPopupLayout.top = Math.max(
                    anchorY - drawHeight - LAYOUT_OFFSET,
                    LAYOUT_MARGIN,
                );
                nextPopupLayout.bottom = "auto";
                nextPopupLayout.minHeight = constrainedMinHeight(drawHeight);
                nextPopupLayout.maxHeight = constrainedMaxHeight(drawHeight);
                nextPopupLayout.shadow = "top";
            };

            if (popupPosition === "bottom") {
                positionBottom();
            } else if (popupPosition === "top") {
                positionTop();
            } else if (bottomAreaHeight > topAreaHeight) {
                positionBottom();
            } else {
                positionTop();
            }
        }

        popupLayout = nextPopupLayout;
    }

    function handleClickOutside(event: MouseEvent) {
        if (!popupRef || !anchorElement) {
            return;
        }

        const target = event.target as Node | null;
        if (!target) {
            return;
        }

        if (popupRef.contains(target) || anchorElement.contains(target)) {
            return;
        }

        closePopup();
    }

    function handleKeyDown(event: KeyboardEvent) {
        const activeElement =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;

        switch (event.key) {
            case "Escape":
                event.preventDefault();
                event.stopPropagation();
                closePopup();
                break;

            case "Tab":
                if (keyboardNavigationStyle !== "dialog") {
                    break;
                }
                event.preventDefault();
                event.stopPropagation();
                navigateFocusableElements(
                    event.shiftKey ? "previous" : "next",
                    true,
                );
                break;

            case "ArrowUp":
                if (keyboardNavigationStyle !== "menu") {
                    break;
                }
                if (isTextEditableElement(activeElement)) {
                    break;
                }
                event.preventDefault();
                event.stopPropagation();
                navigateFocusableElements("previous", false);
                break;

            case "ArrowDown":
                if (keyboardNavigationStyle !== "menu") {
                    break;
                }
                if (isTextEditableElement(activeElement)) {
                    break;
                }
                event.preventDefault();
                event.stopPropagation();
                navigateFocusableElements("next", false);
                break;
        }
    }

    function handleWindowChange() {
        updatePopupLayout();
    }

    $effect(() => {
        anchorElement;
        width;
        height;
        minHeight;
        maxHeight;
        fixedHeight;
        popupAlignment;
        popupPosition;

        if (!popupRef || !popupChildrenRef) {
            return;
        }

        requestAnimationFrame(() => {
            updatePopupLayout();
        });
    });

    $effect(() => {
        if (!popupRef || !popupChildrenRef) {
            return;
        }

        const resizeObserver = new ResizeObserver(() => {
            updatePopupLayout();
        });

        resizeObserver.observe(popupRef);
        resizeObserver.observe(popupChildrenRef);
        resizeObserver.observe(anchorElement);

        return () => {
            resizeObserver.disconnect();
        };
    });

    onMount(() => {
        requestAnimationFrame(() => {
            updatePopupLayout();
        });

        document.addEventListener("mousedown", handleClickOutside, true);
        document.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("resize", handleWindowChange, true);
        window.addEventListener("scroll", handleWindowChange, true);

        return () => {
            document.removeEventListener(
                "mousedown",
                handleClickOutside,
                true,
            );
            document.removeEventListener("keydown", handleKeyDown, true);
            window.removeEventListener("resize", handleWindowChange, true);
            window.removeEventListener("scroll", handleWindowChange, true);
        };
    });
</script>

<div
    class="positron-modal-popup-container"
    bind:this={popupContainerRef}
    role="dialog"
    tabindex="-1"
    aria-modal="true"
>
    <div
        class="positron-modal-popup"
        class:shadow-top={popupLayout.shadow === "top"}
        class:shadow-bottom={popupLayout.shadow === "bottom"}
        bind:this={popupRef}
        style={popupStyle}
    >
        <div class="positron-modal-popup-children" bind:this={popupChildrenRef}>
            {#if children}
                {@render children()}
            {/if}
        </div>
    </div>
</div>

<style>
    .positron-modal-popup-container {
        inset: 0;
        z-index: 10000;
        position: fixed;
        pointer-events: none;
        outline: none !important;
    }

    .positron-modal-popup-container .positron-modal-popup {
        display: flex;
        overflow: auto;
        position: absolute;
        pointer-events: auto;
        border-radius: 4px;
        width: min-content;
        height: min-content;
        box-sizing: border-box;
        color: var(
            --vscode-positronModalDialog-foreground,
            var(--vscode-editorWidget-foreground)
        );
        border: 1px solid
            var(
                --vscode-positronModalDialog-border,
                var(--vscode-editorWidget-border)
            );
        background-color: var(
            --vscode-positronModalDialog-background,
            var(--vscode-editorWidget-background)
        );
    }

    .positron-modal-popup-container
        .positron-modal-popup
        .positron-modal-popup-children {
        width: 100%;
        height: 100%;
    }

    .positron-modal-popup-container .positron-modal-popup.shadow-top {
        box-shadow: 0 -4px 10px 0 rgba(0, 0, 0, 0.1);
    }

    .positron-modal-popup-container .positron-modal-popup.shadow-bottom {
        box-shadow: 0 4px 10px 0 rgba(0, 0, 0, 0.1);
    }
</style>
