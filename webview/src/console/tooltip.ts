/*---------------------------------------------------------------------------------------------
 *  Console tooltip - Svelte action for VS Code-styled tooltips
 *--------------------------------------------------------------------------------------------*/

interface TooltipOptions {
    content: string;
    placement?: "top" | "bottom" | "left" | "right";
    delay?: number;
}

let tooltipEl: HTMLDivElement | null = null;
let showTimeout: ReturnType<typeof setTimeout> | null = null;

function ensureTooltipEl(): HTMLDivElement {
    if (!tooltipEl) {
        tooltipEl = document.createElement("div");
        tooltipEl.className = "ark-tooltip";
        tooltipEl.setAttribute("role", "tooltip");
        document.body.appendChild(tooltipEl);
    }

    return tooltipEl;
}

function positionTooltip(
    node: HTMLElement,
    tooltip: HTMLDivElement,
    placement: "top" | "bottom" | "left" | "right",
) {
    const rect = node.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const gap = 6;

    let top = rect.bottom + gap;
    let left = rect.left + (rect.width - tooltipRect.width) / 2;

    if (placement === "top") {
        top = rect.top - tooltipRect.height - gap;
    } else if (placement === "left") {
        top = rect.top + (rect.height - tooltipRect.height) / 2;
        left = rect.left - tooltipRect.width - gap;
    } else if (placement === "right") {
        top = rect.top + (rect.height - tooltipRect.height) / 2;
        left = rect.right + gap;
    }

    top = Math.max(4, Math.min(top, window.innerHeight - tooltipRect.height - 4));
    left = Math.max(4, Math.min(left, window.innerWidth - tooltipRect.width - 4));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
}

function showTooltip(
    node: HTMLElement,
    content: string,
    placement: "top" | "bottom" | "left" | "right",
) {
    const tooltip = ensureTooltipEl();
    tooltip.textContent = content;
    tooltip.classList.add("visible");

    requestAnimationFrame(() => {
        positionTooltip(node, tooltip, placement);
    });
}

function hideTooltip() {
    if (showTimeout) {
        clearTimeout(showTimeout);
        showTimeout = null;
    }

    if (tooltipEl) {
        tooltipEl.classList.remove("visible");
    }
}

function normalizeOptions(options: TooltipOptions | string): TooltipOptions {
    if (typeof options === "string") {
        return { content: options };
    }

    return options;
}

export function tooltip(node: HTMLElement, options: TooltipOptions | string) {
    let opts = normalizeOptions(options);

    const originalTitle = node.getAttribute("title");
    if (originalTitle && !opts.content) {
        opts.content = originalTitle;
    }
    node.removeAttribute("title");

    function handleMouseEnter() {
        if (!opts.content) return;

        if (showTimeout) {
            clearTimeout(showTimeout);
        }

        showTimeout = setTimeout(() => {
            showTooltip(node, opts.content, opts.placement ?? "bottom");
        }, opts.delay ?? 120);
    }

    function handleMouseLeave() {
        hideTooltip();
    }

    function handleFocusIn() {
        if (!opts.content) return;
        showTooltip(node, opts.content, opts.placement ?? "bottom");
    }

    function handleFocusOut() {
        hideTooltip();
    }

    node.addEventListener("mouseenter", handleMouseEnter);
    node.addEventListener("mouseleave", handleMouseLeave);
    node.addEventListener("focusin", handleFocusIn);
    node.addEventListener("focusout", handleFocusOut);

    return {
        update(newOptions: TooltipOptions | string) {
            opts = normalizeOptions(newOptions);
            node.removeAttribute("title");
        },
        destroy() {
            node.removeEventListener("mouseenter", handleMouseEnter);
            node.removeEventListener("mouseleave", handleMouseLeave);
            node.removeEventListener("focusin", handleFocusIn);
            node.removeEventListener("focusout", handleFocusOut);
            hideTooltip();
        },
    };
}
