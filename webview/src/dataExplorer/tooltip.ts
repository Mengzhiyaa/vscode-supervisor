/*---------------------------------------------------------------------------------------------
 *  Tooltip - Svelte action for VS Code-styled tooltips
 *  Provides enhanced tooltips matching VS Code's hover style
 *--------------------------------------------------------------------------------------------*/

/**
 * Tooltip configuration
 */
interface TooltipOptions {
    /** Tooltip text */
    content: string;
    /** Placement relative to element */
    placement?: 'top' | 'bottom' | 'left' | 'right';
    /** Delay before showing (ms) */
    delay?: number;
}

/** Singleton tooltip element shared across all usages */
let tooltipEl: HTMLDivElement | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;
let showTimeout: ReturnType<typeof setTimeout> | null = null;

function ensureTooltipEl(): HTMLDivElement {
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'positron-tooltip';
        tooltipEl.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
}

function positionTooltip(
    el: HTMLElement,
    tooltip: HTMLDivElement,
    placement: 'top' | 'bottom' | 'left' | 'right',
) {
    const rect = el.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const gap = 6;

    let top: number;
    let left: number;

    switch (placement) {
        case 'top':
            top = rect.top - tooltipRect.height - gap;
            left = rect.left + (rect.width - tooltipRect.width) / 2;
            break;
        case 'bottom':
            top = rect.bottom + gap;
            left = rect.left + (rect.width - tooltipRect.width) / 2;
            break;
        case 'left':
            top = rect.top + (rect.height - tooltipRect.height) / 2;
            left = rect.left - tooltipRect.width - gap;
            break;
        case 'right':
            top = rect.top + (rect.height - tooltipRect.height) / 2;
            left = rect.right + gap;
            break;
    }

    // Clamp to viewport
    top = Math.max(4, Math.min(top, window.innerHeight - tooltipRect.height - 4));
    left = Math.max(4, Math.min(left, window.innerWidth - tooltipRect.width - 4));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
}

function showTooltip(el: HTMLElement, content: string, placement: 'top' | 'bottom' | 'left' | 'right') {
    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }
    const tooltip = ensureTooltipEl();
    tooltip.textContent = content;
    tooltip.classList.add('visible');

    // Position after making visible so we get accurate dimensions
    requestAnimationFrame(() => {
        positionTooltip(el, tooltip, placement);
    });
}

function hideTooltip() {
    if (showTimeout) {
        clearTimeout(showTimeout);
        showTimeout = null;
    }
    if (tooltipEl) {
        tooltipEl.classList.remove('visible');
    }
}

/**
 * Svelte action for adding tooltips to elements.
 * Removes the native title attribute and provides a styled tooltip instead.
 *
 * Usage:
 * ```svelte
 * <button use:tooltip={{ content: 'My tooltip', placement: 'bottom' }}>
 * ```
 */
export function tooltip(node: HTMLElement, options: TooltipOptions | string) {
    let opts = normalizeOptions(options);

    // Remove native title to prevent double tooltip
    const originalTitle = node.getAttribute('title');
    if (originalTitle && !opts.content) {
        opts.content = originalTitle;
    }
    node.removeAttribute('title');

    function handleMouseEnter() {
        if (!opts.content) return;
        if (showTimeout) clearTimeout(showTimeout);
        showTimeout = setTimeout(() => {
            showTooltip(node, opts.content, opts.placement ?? 'bottom');
        }, opts.delay ?? 500);
    }

    function handleMouseLeave() {
        hideTooltip();
    }

    function handleFocusIn() {
        if (!opts.content) return;
        showTooltip(node, opts.content, opts.placement ?? 'bottom');
    }

    function handleFocusOut() {
        hideTooltip();
    }

    node.addEventListener('mouseenter', handleMouseEnter);
    node.addEventListener('mouseleave', handleMouseLeave);
    node.addEventListener('focusin', handleFocusIn);
    node.addEventListener('focusout', handleFocusOut);

    return {
        update(newOptions: TooltipOptions | string) {
            opts = normalizeOptions(newOptions);
            node.removeAttribute('title');
        },
        destroy() {
            node.removeEventListener('mouseenter', handleMouseEnter);
            node.removeEventListener('mouseleave', handleMouseLeave);
            node.removeEventListener('focusin', handleFocusIn);
            node.removeEventListener('focusout', handleFocusOut);
            hideTooltip();
        },
    };
}

function normalizeOptions(options: TooltipOptions | string): TooltipOptions {
    if (typeof options === 'string') {
        return { content: options };
    }
    return options;
}
