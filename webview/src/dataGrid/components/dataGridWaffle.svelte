<!--
  dataGridWaffle.svelte - Grid layout container with virtual scrolling
  Port from Positron's dataGridWaffle.tsx (Svelte 5 runes mode)
-->
<script lang="ts">
    import { getPositronDataGridContext } from "../positronDataGridContext";
    import {
        ExtendColumnSelectionBy,
        ExtendRowSelectionBy,
        type ColumnDescriptors,
        type DataGridContextMenuAnchorPoint,
        type DataGridContextMenuRequest,
        type RowDescriptors,
    } from "../classes/dataGridInstance";
    import DataGridColumnHeaders from "./dataGridColumnHeaders.svelte";
    import DataGridRowHeaders from "./dataGridRowHeaders.svelte";
    import DataGridRow from "./dataGridRow.svelte";
    import DataGridScrollbar from "./dataGridScrollbar.svelte";
    import DataGridCornerTopLeft from "./dataGridCornerTopLeft.svelte";
    import DataGridScrollbarCorner from "./dataGridScrollbarCorner.svelte";
    import ContextMenu, { type ContextMenuItem } from "./ContextMenu.svelte";

    interface Props {
        onFocusChange?: (focused: boolean) => void;
    }

    let { onFocusChange }: Props = $props();

    const { instance } = getPositronDataGridContext();
    const updateTrigger = instance.updateTrigger;
    const viewport = instance.viewport;

    const width = $derived.by(() => {
        $updateTrigger;
        return $viewport.width;
    });

    const height = $derived.by(() => {
        $updateTrigger;
        return $viewport.height;
    });

    const columnDescriptors = $derived.by((): ColumnDescriptors => {
        $updateTrigger;
        return instance.getColumnDescriptors(instance.horizontalScrollOffset, width);
    });

    const rowDescriptors = $derived.by((): RowDescriptors => {
        $updateTrigger;
        return instance.getRowDescriptors(instance.verticalScrollOffset, height);
    });

    let lastWheelEvent = $state(0);

    let contextMenuVisible = $state(false);
    let contextMenuX = $state(0);
    let contextMenuY = $state(0);
    let contextMenuItems = $state<ContextMenuItem[]>([]);
    let contextMenuAnchorElement = $state<HTMLElement | null>(null);
    let waffleRef = $state<HTMLDivElement | undefined>(undefined);

    function resolveAnchorPoint(
        anchorElement: HTMLElement,
        anchorPoint?: DataGridContextMenuAnchorPoint,
    ) {
        if (anchorPoint) {
            return anchorPoint;
        }

        const rect = anchorElement.getBoundingClientRect();
        return {
            clientX: rect.left + rect.width / 2,
            clientY: rect.bottom,
        };
    }

    function showContextMenu(request: DataGridContextMenuRequest) {
        const anchorPoint = resolveAnchorPoint(
            request.anchorElement,
            request.anchorPoint,
        );
        contextMenuAnchorElement = request.anchorElement;
        contextMenuX = anchorPoint.clientX;
        contextMenuY = anchorPoint.clientY;
        contextMenuItems = request.items;
        contextMenuVisible = true;
    }

    $effect(() => {
        const disposable = instance.onDidRequestContextMenu((request) => {
            showContextMenu(request);
        });

        return () => {
            disposable.dispose();
        };
    });

    function findAnchorElement(selector: string): HTMLElement | undefined {
        return waffleRef?.querySelector(selector) ?? undefined;
    }

    function centeredPoint(anchorElement: HTMLElement) {
        const rect = anchorElement.getBoundingClientRect();
        return {
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
        };
    }

    async function showContextMenuForCursor(kind: "column" | "row" | "cell") {
        if (kind === "column") {
            const anchorElement = findAnchorElement(
                `.data-grid-column-header[data-column-index="${instance.cursorColumnIndex}"]`,
            );
            if (!anchorElement) {
                return;
            }

            await instance.showColumnContextMenu(
                instance.cursorColumnIndex,
                anchorElement,
                centeredPoint(anchorElement),
            );
            return;
        }

        if (kind === "row") {
            const anchorElement = findAnchorElement(
                `.data-grid-row-header[data-row-index="${instance.cursorRowIndex}"]`,
            );
            if (!anchorElement) {
                return;
            }

            await instance.showRowContextMenu(
                instance.cursorRowIndex,
                anchorElement,
                centeredPoint(anchorElement),
            );
            return;
        }

        const anchorElement = findAnchorElement(
            `.data-grid-row-cell[data-column-index="${instance.cursorColumnIndex}"][data-row-index="${instance.cursorRowIndex}"]`,
        );
        if (!anchorElement) {
            return;
        }

        await instance.showCellContextMenu(
            instance.cursorColumnIndex,
            instance.cursorRowIndex,
            anchorElement,
            centeredPoint(anchorElement),
        );
    }

    function closeContextMenu() {
        contextMenuVisible = false;
        contextMenuAnchorElement = null;
    }

    function pinToRange(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    function isSummaryPanelInstance(value: unknown): value is {
        canToggleColumnExpansion: (rowIndex: number) => boolean;
        toggleExpandColumn: (rowIndex: number) => Promise<void> | void;
    } {
        const candidate = value as {
            canToggleColumnExpansion?: unknown;
            toggleExpandColumn?: unknown;
        };

        return (
            typeof candidate?.canToggleColumnExpansion === "function" &&
            typeof candidate?.toggleExpandColumn === "function"
        );
    }

    const isMacintosh =
        typeof navigator !== "undefined" &&
        navigator.platform.toLowerCase().includes("mac");

    async function handleKeyDown(event: KeyboardEvent) {
        if (event.timeStamp - lastWheelEvent < 250) {
            return;
        }

        const consumeEvent = () => {
            event.preventDefault();
            event.stopPropagation();
        };

        switch (event.code) {
            case "F10": {
                if (!event.shiftKey) {
                    break;
                }

                consumeEvent();

                if (event.altKey) {
                    await showContextMenuForCursor("row");
                } else if (event.ctrlKey || event.metaKey) {
                    await showContextMenuForCursor("column");
                } else {
                    await showContextMenuForCursor("cell");
                }

                break;
            }

            case "Tab": {
                const isSummaryPanel = isSummaryPanelInstance(instance);

                if (isSummaryPanel) {
                    consumeEvent();

                    if (instance.showCursor()) {
                        return;
                    }

                    if (event.shiftKey) {
                        instance.moveCursorUp();
                    } else {
                        instance.moveCursorDown();
                    }
                }

                break;
            }

            case "Space": {
                if (instance.showCursor()) {
                    return;
                }

                if (instance.selection) {
                    consumeEvent();

                    if (event.ctrlKey && !event.shiftKey) {
                        instance.selectColumn(instance.cursorColumnIndex);
                    } else if (event.shiftKey && !event.ctrlKey) {
                        instance.selectRow(instance.cursorRowIndex);
                    } else if (event.ctrlKey && event.shiftKey) {
                        instance.selectAll();
                    }
                }

                break;
            }

            case "Enter": {
                const isSummaryPanel = isSummaryPanelInstance(instance);

                if (isSummaryPanel) {
                    consumeEvent();

                    if (instance.showCursor()) {
                        return;
                    }

                    if (
                        instance.canToggleColumnExpansion(
                            instance.cursorRowIndex,
                        )
                    ) {
                        await instance.toggleExpandColumn(
                            instance.cursorRowIndex,
                        );
                    }
                }

                break;
            }

            case "Home": {
                consumeEvent();

                if (instance.showCursor()) {
                    return;
                }

                if (event.shiftKey) {
                    instance.extendRowSelectionUp(ExtendRowSelectionBy.Screen);
                    return;
                }

                if (isMacintosh && event.ctrlKey) {
                    return;
                }

                if (isMacintosh ? event.metaKey : event.ctrlKey) {
                    instance.clearSelection();
                    await instance.setScrollOffsets(0, 0);
                    instance.setCursorPosition(
                        instance.firstColumnIndex,
                        instance.firstRowIndex,
                    );
                    return;
                }

                instance.clearSelection();
                await instance.setHorizontalScrollOffset(0);
                instance.setCursorColumn(instance.firstColumnIndex);
                break;
            }

            case "End": {
                consumeEvent();

                if (instance.showCursor()) {
                    return;
                }

                if (event.shiftKey) {
                    instance.extendRowSelectionDown(
                        ExtendRowSelectionBy.Screen,
                    );
                    return;
                }

                if (isMacintosh && event.ctrlKey) {
                    return;
                }

                if (isMacintosh ? event.metaKey : event.ctrlKey) {
                    instance.clearSelection();
                    await instance.setScrollOffsets(
                        instance.maximumHorizontalScrollOffset,
                        instance.maximumVerticalScrollOffset,
                    );
                    instance.setCursorPosition(
                        instance.lastColummIndex,
                        instance.lastRowIndex,
                    );
                    return;
                }

                instance.clearSelection();
                await instance.setHorizontalScrollOffset(
                    instance.maximumHorizontalScrollOffset,
                );
                instance.setCursorColumn(instance.lastColummIndex);
                break;
            }

            case "PageUp": {
                consumeEvent();

                if (instance.showCursor()) {
                    return;
                }

                if (isMacintosh ? event.metaKey : event.ctrlKey) {
                    return;
                }

                if (event.shiftKey) {
                    instance.extendRowSelectionUp(ExtendRowSelectionBy.Page);
                    return;
                }

                instance.clearSelection();
                await instance.scrollPageUp();
                break;
            }

            case "PageDown": {
                consumeEvent();

                if (instance.showCursor()) {
                    return;
                }

                if (isMacintosh ? event.metaKey : event.ctrlKey) {
                    return;
                }

                if (event.shiftKey) {
                    instance.extendRowSelectionDown(
                        ExtendRowSelectionBy.Page,
                    );
                    return;
                }

                instance.clearSelection();
                await instance.scrollPageDown();
                break;
            }

            case "ArrowUp": {
                consumeEvent();

                if (instance.showCursor()) {
                    return;
                }

                if (isMacintosh ? event.metaKey : event.ctrlKey) {
                    return;
                }

                if (instance.selection) {
                    if (event.shiftKey) {
                        instance.extendRowSelectionUp(ExtendRowSelectionBy.Row);
                        return;
                    }

                    instance.clearSelection();
                }

                instance.moveCursorUp();
                break;
            }

            case "ArrowDown": {
                consumeEvent();

                if (instance.showCursor()) {
                    return;
                }

                if (isMacintosh ? event.metaKey : event.ctrlKey) {
                    return;
                }

                if (instance.selection) {
                    if (event.shiftKey) {
                        instance.extendRowSelectionDown(
                            ExtendRowSelectionBy.Row,
                        );
                        return;
                    }

                    instance.clearSelection();
                }

                instance.moveCursorDown();
                break;
            }

            case "ArrowLeft": {
                consumeEvent();

                if (instance.showCursor()) {
                    return;
                }

                if (isMacintosh ? event.metaKey : event.ctrlKey) {
                    return;
                }

                if (instance.selection) {
                    if (event.shiftKey) {
                        instance.extendColumnSelectionLeft(
                            ExtendColumnSelectionBy.Column,
                        );
                        return;
                    }

                    instance.clearSelection();
                }

                instance.moveCursorLeft();
                break;
            }

            case "ArrowRight": {
                consumeEvent();

                if (instance.showCursor()) {
                    return;
                }

                if (isMacintosh ? event.metaKey : event.ctrlKey) {
                    return;
                }

                if (instance.selection) {
                    if (event.shiftKey) {
                        instance.extendColumnSelectionRight(
                            ExtendColumnSelectionBy.Column,
                        );
                        return;
                    }

                    instance.clearSelection();
                }

                instance.moveCursorRight();
                break;
            }
        }
    }

    async function handleWheel(event: WheelEvent) {
        lastWheelEvent = event.timeStamp;

        let deltaX = event.deltaX;
        let deltaY = event.deltaY;

        {
            const bias = 1.1;
            const absDeltaX = Math.abs(deltaX);
            const absDeltaY = Math.abs(deltaY);

            if (absDeltaX > absDeltaY * bias) {
                deltaY = 0;
            } else if (absDeltaY > absDeltaX * bias) {
                deltaX = 0;
            }
        }

        if (event.altKey) {
            deltaX *= 10;
            deltaY *= 10;
        }

        await instance.setScrollOffsets(
            pinToRange(
                instance.horizontalScrollOffset + deltaX,
                0,
                instance.maximumHorizontalScrollOffset,
            ),
            pinToRange(
                instance.verticalScrollOffset + deltaY,
                0,
                instance.maximumVerticalScrollOffset,
            ),
        );
    }
</script>

<div
    bind:this={waffleRef}
    class="data-grid-waffle"
    role="grid"
    tabindex="0"
    onblur={() => {
        instance.setFocused(false);
        onFocusChange?.(false);
    }}
    onfocus={() => {
        instance.setFocused(true);
        onFocusChange?.(true);
    }}
    onkeydown={handleKeyDown}
    onwheel={handleWheel}
>
    {#if instance.columnHeaders && instance.rowHeaders && instance.columns !== 0}
        <DataGridCornerTopLeft />
    {/if}

    {#if instance.columnHeaders}
        <DataGridColumnHeaders
            {columnDescriptors}
            height={instance.columnHeadersHeight}
            width={width - instance.rowHeadersWidth}
        />
    {/if}

    {#if instance.rowHeaders}
        <DataGridRowHeaders
            height={height - instance.columnHeadersHeight}
            {rowDescriptors}
        />
    {/if}

    {#if instance.horizontalScrollbar}
        <div
            class="scrollbar-horizontal"
            style:left="{instance.rowHeadersWidth}px"
            style:height="{instance.scrollbarThickness}px"
        >
            <DataGridScrollbar
                orientation="horizontal"
                totalSize={instance.scrollWidth}
                viewportSize={instance.layoutWidth}
                scrollPosition={instance.horizontalScrollOffset}
                onscroll={(event) =>
                    instance.setScrollOffsets(
                        event.detail.scrollLeft,
                        event.detail.scrollTop,
                    )}
            />
        </div>
    {/if}

    {#if instance.verticalScrollbar}
        <div
            class="scrollbar-vertical"
            style:top="{instance.columnHeadersHeight}px"
            style:width="{instance.scrollbarThickness}px"
        >
            <DataGridScrollbar
                orientation="vertical"
                totalSize={instance.scrollHeight}
                viewportSize={instance.layoutHeight}
                scrollPosition={instance.verticalScrollOffset}
                onscroll={(event) =>
                    instance.setScrollOffsets(
                        event.detail.scrollLeft,
                        event.detail.scrollTop,
                    )}
            />
        </div>
    {/if}

    {#if instance.horizontalScrollbar && instance.verticalScrollbar}
        <DataGridScrollbarCorner />
    {/if}

    <div
        class="data-grid-rows-container"
        style:width="{width - instance.rowHeadersWidth}px"
        style:height="{height - instance.columnHeadersHeight}px"
    >
        <div class="data-grid-rows" style:margin="{instance.rowsMargin}px">
            {#each rowDescriptors.pinnedRowDescriptors as row (
                `pinned-row-${row.rowIndex}`
            )}
                <DataGridRow
                    {columnDescriptors}
                    height={row.height}
                    pinned={true}
                    rowIndex={row.rowIndex}
                    top={row.top}
                    {width}
                />
            {/each}

            {#each rowDescriptors.unpinnedRowDescriptors as row (
                `unpinned-row-${row.rowIndex}`
            )}
                <DataGridRow
                    {columnDescriptors}
                    height={row.height}
                    pinned={false}
                    rowIndex={row.rowIndex}
                    top={row.top - instance.verticalScrollOffset}
                    {width}
                />
            {/each}
        </div>
    </div>
</div>

{#if contextMenuVisible}
    <ContextMenu
        anchorElement={contextMenuAnchorElement}
        x={contextMenuX}
        y={contextMenuY}
        items={contextMenuItems}
        onClose={closeContextMenu}
    />
{/if}

<style>
    .data-grid-waffle {
        width: 100%;
        height: 100%;
        min-height: 0;
        min-width: 0;
        display: grid;
        overflow: hidden;
        position: relative;
        box-sizing: border-box;
        transform: translate3d(0px, 0px, 0px);
        grid-template-rows: [headers] min-content [waffle] 1fr [end-waffle];
        grid-template-columns: [headers] min-content [waffle] 1fr [end-waffle];
    }

    .data-grid-waffle:focus {
        outline: none !important;
    }

    .data-grid-rows-container {
        overflow: hidden;
        position: relative;
        box-sizing: border-box;
        grid-row: waffle / end-waffle;
        grid-column: waffle / end-waffle;
    }

    .data-grid-rows {
        position: relative;
    }

    .scrollbar-horizontal {
        position: absolute;
        bottom: 0;
        right: 0;
        z-index: 24;
    }

    .scrollbar-vertical {
        position: absolute;
        right: 0;
        bottom: 0;
        z-index: 24;
    }
</style>
