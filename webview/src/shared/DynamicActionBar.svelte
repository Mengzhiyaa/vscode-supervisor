<!--
  DynamicActionBar.svelte
  Svelte port of Positron's PositronDynamicActionBar.
  
  Measures available width via ResizeObserver, lays out actions using CSS Grid,
  and overflows excess actions into a context menu.
-->
<script lang="ts">
    import { onMount } from 'svelte';
    import '../shared/actionBar.css';
    import ContextMenu, {
        type ContextMenuEntry,
        type ContextMenuItem,
    } from './ContextMenu.svelte';

    /** Width constants matching Positron's defaults */
    const BUTTON_WIDTH = 24;
    const DEFAULT_SEPARATOR_WIDTH = 7;

    /**
     * A single action in the DynamicActionBar.
     * Each action has a fixed pixel width (icon + padding), optional measured
     * text, a separator flag, and the Svelte snippet to render.
     */
    export interface DynamicAction {
        /** Fixed pixel width (icon + padding, NOT including text) */
        fixedWidth: number;
        /** Optional label text whose width will be measured and added */
        text?: string;
        /**
         * Optional minimum width for truncatable actions. When space is tight,
         * the action will shrink toward this width before it is hidden.
         */
        minWidth?: number;
        /** Whether a separator should follow this action */
        separator: boolean;
        /** The Svelte component/snippet to render inline */
        component: import('svelte').Snippet;
        /** Menu item definition when this action overflows */
        overflowMenuItem?: {
            label: string;
            icon?: string;
            disabled?: boolean;
            onSelected: () => void;
        };
    }

    interface Props {
        leftActions?: DynamicAction[];
        rightActions?: DynamicAction[];
        paddingLeft?: number;
        paddingRight?: number;
        separatorWidth?: number;
        borderTop?: boolean;
        borderBottom?: boolean;
    }

    let {
        leftActions = [],
        rightActions = [],
        paddingLeft = 8,
        paddingRight = 8,
        separatorWidth = DEFAULT_SEPARATOR_WIDTH,
        borderTop = false,
        borderBottom = false,
    }: Props = $props();

    let barEl = $state<HTMLDivElement | null>(null);
    let exemplarEl = $state<HTMLDivElement | null>(null);
    let overflowBtnEl = $state<HTMLButtonElement | null>(null);
    let containerWidth = $state(0);
    let showOverflowMenu = $state(false);
    let suppressOverflowClick = $state(false);

    // --- ResizeObserver to track container width ---
    onMount(() => {
        if (!barEl) return;
        containerWidth = barEl.offsetWidth;
        const ro = new ResizeObserver(() => {
            if (barEl) containerWidth = barEl.offsetWidth;
        });
        ro.observe(barEl);
        return () => ro.disconnect();
    });

    // --- Text measurement helper using Canvas ---
    function measureTextWidth(text: string): number {
        if (!exemplarEl) return 0;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return 0;
        const style = getComputedStyle(exemplarEl);
        ctx.font = style.font;
        const w = Math.ceil(ctx.measureText(text).width);
        canvas.remove();
        return w;
    }

    // --- Layout computation ---
    interface GridEntry {
        width: number;
        minWidth: number;
        action: DynamicAction;
    }

    interface GridItem {
        type: 'action' | 'separator' | 'overflow';
        action?: DynamicAction;
    }

    const layout = $derived.by(() => {
        function getPreferredWidth(action: DynamicAction): number {
            let width = action.fixedWidth;
            if (action.text) {
                width += measureTextWidth(action.text);
            }
            return width;
        }

        interface LayoutPassResult {
            leftGridEntries: GridEntry[];
            rightGridEntries: GridEntry[];
            leftOverflowActions: DynamicAction[];
            rightOverflowActions: DynamicAction[];
            hasOverflow: boolean;
        }

        function runLayoutPass(reserveOverflowButton: boolean): LayoutPassResult {
            let availableWidth =
                Math.max(containerWidth - paddingLeft - paddingRight, 0) -
                (reserveOverflowButton ? BUTTON_WIDTH : 0);

            interface SideLayoutResult {
                gridEntries: GridEntry[];
                hiddenActions: DynamicAction[];
                remainingWidth: number;
            }

            function layoutActions(actions: DynamicAction[]): SideLayoutResult {
                const gridEntries: GridEntry[] = [];
                const hiddenActions: DynamicAction[] = [];

                let appendSep = false;
                let remainingWidth = Math.max(availableWidth, 0);

                for (const action of actions) {
                    const appliedSeparatorWidth = appendSep ? separatorWidth : 0;
                    const preferredWidth = getPreferredWidth(action);
                    const minWidth = Math.min(
                        preferredWidth,
                        Math.max(action.minWidth ?? preferredWidth, 0),
                    );

                    if (appliedSeparatorWidth + preferredWidth <= remainingWidth) {
                        gridEntries.push({
                            width: preferredWidth,
                            minWidth,
                            action,
                        });
                        remainingWidth -= appliedSeparatorWidth + preferredWidth;
                        appendSep = action.separator;
                        continue;
                    }

                    const requiredShrink =
                        appliedSeparatorWidth + preferredWidth - remainingWidth;
                    const shrinkableEntries = gridEntries.filter(
                        (entry) => entry.width > entry.minWidth,
                    );
                    const totalShrinkCapacity =
                        (preferredWidth - minWidth) +
                        shrinkableEntries.reduce(
                            (sum, entry) => sum + (entry.width - entry.minWidth),
                            0,
                        );

                    if (requiredShrink > totalShrinkCapacity) {
                        hiddenActions.push(action);
                        continue;
                    }

                    let nextWidth = preferredWidth;
                    let remainingShrink = requiredShrink;
                    let reclaimedWidth = 0;

                    const currentShrink = Math.min(
                        remainingShrink,
                        nextWidth - minWidth,
                    );
                    nextWidth -= currentShrink;
                    remainingShrink -= currentShrink;

                    for (
                        let index = shrinkableEntries.length - 1;
                        index >= 0 && remainingShrink > 0;
                        index--
                    ) {
                        const entry = shrinkableEntries[index];
                        const entryShrink = Math.min(
                            remainingShrink,
                            entry.width - entry.minWidth,
                        );
                        entry.width -= entryShrink;
                        reclaimedWidth += entryShrink;
                        remainingShrink -= entryShrink;
                    }

                    gridEntries.push({
                        width: nextWidth,
                        minWidth,
                        action,
                    });
                    remainingWidth =
                        remainingWidth +
                        reclaimedWidth -
                        appliedSeparatorWidth -
                        nextWidth;
                    appendSep = action.separator;
                }

                availableWidth = remainingWidth;
                return {
                    gridEntries,
                    hiddenActions,
                    remainingWidth,
                };
            }

            // Layout right first (higher priority), then left.
            const rightLayout = layoutActions(rightActions);
            const leftLayout = layoutActions(leftActions);
            const leftOverflowActions = leftLayout.hiddenActions.filter(
                (action) => action.overflowMenuItem,
            );
            const rightOverflowActions = rightLayout.hiddenActions.filter(
                (action) => action.overflowMenuItem,
            );

            return {
                leftGridEntries: leftLayout.gridEntries,
                rightGridEntries: rightLayout.gridEntries,
                leftOverflowActions,
                rightOverflowActions,
                hasOverflow:
                    leftOverflowActions.length + rightOverflowActions.length > 0,
            };
        }

        const initialLayout = runLayoutPass(false);
        const resolvedLayout = initialLayout.hasOverflow
            ? runLayoutPass(true)
            : initialLayout;
        const {
            leftGridEntries,
            rightGridEntries,
            leftOverflowActions,
            rightOverflowActions,
            hasOverflow,
        } = resolvedLayout;

        // Build grid columns and entries
        function buildGrid(entries: GridEntry[]) {
            const cols: string[] = [];
            const items: GridItem[] = [];
            let appendSep = false;
            for (const entry of entries) {
                if (appendSep) {
                    cols.push(`${separatorWidth}px`);
                    items.push({ type: 'separator' });
                }
                cols.push(`${entry.width}px`);
                items.push({ type: 'action', action: entry.action });
                appendSep = entry.action.separator;
            }
            return { cols, items };
        }

        const leftGrid = buildGrid(leftGridEntries);
        const rightGrid = buildGrid(rightGridEntries);

        const overflowActions = [...rightOverflowActions, ...leftOverflowActions];

        // Add the overflow button only when the final layout actually needs it.
        if (hasOverflow) {
            rightGrid.cols.push(`${BUTTON_WIDTH}px`);
            rightGrid.items.push({ type: 'overflow' });
        }

        // Build final gridTemplateColumns
        const gridTemplateColumns = [
            ...leftGrid.cols,
            '1fr',
            ...rightGrid.cols,
        ].join(' ');

        return {
            gridTemplateColumns,
            leftItems: leftGrid.items,
            rightItems: rightGrid.items,
            overflowActions,
            hasOverflow,
            leftOverflowActions,
            rightOverflowActions,
        };
    });

    // --- Overflow menu entries ---
    const overflowMenuEntries = $derived.by((): ContextMenuEntry[] => {
        const entries: ContextMenuEntry[] = [];
        const appendEntries = (
            actions: DynamicAction[],
            addLeadingSeparator: boolean,
        ) => {
            let shouldAddLeadingSeparator = addLeadingSeparator;
            actions.forEach((action, index) => {
                if (!action.overflowMenuItem) {
                    return;
                }

                if (shouldAddLeadingSeparator) {
                    entries.push({ separator: true });
                    shouldAddLeadingSeparator = false;
                }

                entries.push({
                    label: action.overflowMenuItem.label,
                    icon: action.overflowMenuItem.icon,
                    disabled: action.overflowMenuItem.disabled,
                    onSelected: action.overflowMenuItem.onSelected,
                } as ContextMenuItem);

                if (action.separator && index < actions.length - 1) {
                    entries.push({ separator: true });
                }
            });
        };

        appendEntries(layout.leftOverflowActions, false);
        appendEntries(
            layout.rightOverflowActions,
            entries.length > 0 && layout.rightOverflowActions.length > 0,
        );

        while (entries[0] && 'separator' in entries[0]) {
            entries.shift();
        }
        while (entries.at(-1) && 'separator' in entries.at(-1)!) {
            entries.pop();
        }
        return entries;
    });

    function toggleOverflow() {
        if (!overflowMenuEntries.length) {
            return;
        }

        showOverflowMenu = !showOverflowMenu;
    }

    function handleOverflowMouseDown(event: MouseEvent) {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        suppressOverflowClick = true;
        toggleOverflow();
    }

    function handleOverflowClick(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        if (suppressOverflowClick) {
            suppressOverflowClick = false;
            return;
        }

        toggleOverflow();
    }

    function handleOverflowKeyDown(event: KeyboardEvent) {
        switch (event.key) {
            case 'Enter':
            case ' ':
            case 'ArrowDown':
                event.preventDefault();
                event.stopPropagation();
                suppressOverflowClick = true;
                if (!showOverflowMenu) {
                    toggleOverflow();
                }
                break;
            case 'Escape':
                if (!showOverflowMenu) {
                    break;
                }
                event.preventDefault();
                event.stopPropagation();
                showOverflowMenu = false;
                break;
        }
    }
</script>

<!-- Off-screen element for text measurement font reference -->
<div
    bind:this={exemplarEl}
    class="exemplar"
    aria-hidden="true"
></div>

<div
    bind:this={barEl}
    class="positron-dynamic-action-bar"
    class:border-top={borderTop}
    class:border-bottom={borderBottom}
    role="toolbar"
    style:padding-left={`${paddingLeft}px`}
    style:padding-right={`${paddingRight}px`}
    style:grid-template-columns={layout.gridTemplateColumns}
>
    <!-- Left actions -->
    {#each layout.leftItems as item}
        {#if item.type === 'separator'}
            <div class="container">
                <div class="action-bar-separator"></div>
            </div>
        {:else if item.action}
            <div class="container">
                {@render item.action.component()}
            </div>
        {/if}
    {/each}

    <!-- Spacer -->
    <div></div>

    <!-- Right actions + optional overflow -->
    {#each layout.rightItems as item}
        {#if item.type === 'separator'}
            <div class="container">
                <div class="action-bar-separator"></div>
            </div>
        {:else if item.action}
            <div class="container">
                {@render item.action.component()}
            </div>
        {:else if item.type === 'overflow' && layout.hasOverflow}
            <!-- Overflow button -->
            <div class="container">
                <button
                    bind:this={overflowBtnEl}
                    class="action-bar-button"
                    title="More actions"
                    aria-label="More actions"
                    type="button"
                    aria-expanded={showOverflowMenu}
                    aria-haspopup="menu"
                    onmousedown={handleOverflowMouseDown}
                    onclick={handleOverflowClick}
                    onkeydown={handleOverflowKeyDown}
                >
                    <span class="codicon codicon-toolbar-more"></span>
                </button>
            </div>
        {/if}
    {/each}
</div>

{#if showOverflowMenu && overflowBtnEl}
    <ContextMenu
        entries={overflowMenuEntries}
        anchorEl={overflowBtnEl}
        onclose={() => (showOverflowMenu = false)}
    />
{/if}
