/*---------------------------------------------------------------------------------------------
 *  SimpleHoverManager - lightweight hover manager for DataGrid tooltips
 *--------------------------------------------------------------------------------------------*/

import type { DataGridHoverManager } from '../dataGridInstance';

let sharedTooltip: HTMLDivElement | undefined;
const INSTANT_HOVER_TIME_LIMIT = 200;

function ensureTooltip(): HTMLDivElement {
    if (sharedTooltip && document.body.contains(sharedTooltip)) {
        return sharedTooltip;
    }

    sharedTooltip = document.createElement('div');
    sharedTooltip.className = 'positron-tooltip';
    sharedTooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(sharedTooltip);
    return sharedTooltip;
}

function positionTooltip(anchor: HTMLElement, tooltip: HTMLDivElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const gap = 6;

    let top = anchorRect.bottom + gap;
    let left = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2;

    if (top + tooltipRect.height > window.innerHeight - 4) {
        top = anchorRect.top - tooltipRect.height - gap;
    }

    top = Math.max(4, Math.min(top, window.innerHeight - tooltipRect.height - 4));
    left = Math.max(4, Math.min(left, window.innerWidth - tooltipRect.width - 4));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
}

export class SimpleHoverManager implements DataGridHoverManager {
    private _lastAnchor: HTMLElement | undefined;
    private _disposed = false;
    private _hoverDelay: number;
    private _hoverLeaveTime = 0;
    private _showTimeout: ReturnType<typeof setTimeout> | undefined;

    constructor(hoverDelay = 500) {
        this._hoverDelay = hoverDelay;
        document.addEventListener("keydown", this._onKeyDown, true);
    }

    private readonly _onKeyDown = () => {
        this.hideHover();
    };

    private get isInstantlyHovering() {
        return Date.now() - this._hoverLeaveTime < INSTANT_HOVER_TIME_LIMIT;
    }

    setCustomHoverDelay(hoverDelay: number): void {
        this._hoverDelay = hoverDelay;
    }

    private clearPendingShow(): void {
        if (!this._showTimeout) {
            return;
        }

        clearTimeout(this._showTimeout);
        this._showTimeout = undefined;
    }

    showHover(anchorElement: HTMLElement, content: string): void {
        if (this._disposed || !content) {
            return;
        }

        this.hideHover();

        const showHoverNow = () => {
            if (this._disposed || !this._lastAnchor) {
                return;
            }

            const tooltip = ensureTooltip();
            tooltip.textContent = content;
            tooltip.classList.add('visible');

            requestAnimationFrame(() => {
                if (!this._disposed && this._lastAnchor === anchorElement) {
                    positionTooltip(anchorElement, tooltip);
                }
            });
        };

        this._lastAnchor = anchorElement;

        if (this.isInstantlyHovering || this._hoverDelay <= 0) {
            showHoverNow();
            return;
        }

        this._showTimeout = setTimeout(() => {
            this._showTimeout = undefined;
            showHoverNow();
        }, this._hoverDelay);
    }

    hideHover(): void {
        if (this._disposed) {
            return;
        }

        this.clearPendingShow();

        if (sharedTooltip?.classList.contains('visible')) {
            this._hoverLeaveTime = Date.now();
        }

        sharedTooltip?.classList.remove('visible');
        this._lastAnchor = undefined;
    }

    dispose(): void {
        this.hideHover();
        this.clearPendingShow();
        document.removeEventListener("keydown", this._onKeyDown, true);
        this._disposed = true;
    }
}
