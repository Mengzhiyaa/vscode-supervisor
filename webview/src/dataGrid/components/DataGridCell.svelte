<!--
  DataGridCell.svelte - Individual data cell (Svelte 5 runes mode)
  Port from Positron's dataGridRowCell.tsx
-->
<script lang="ts">
    import { getDataGridContext } from "../context";
    import {
        CellSelectionState,
        type DataGridCellComponent,
    } from "../dataGridInstance";
    import { selectionType } from "../utilities/mouseUtilities";
    import { renderLeadingTrailingWhitespace } from "../../dataExplorer/components/tableDataCell";
    import { DataColumnAlignment } from "../interfaces";

    interface Props {
        columnIndex: number;
        rowIndex: number;
        left: number;
        width: number;
        height: number;
        pinned?: boolean;
    }

    let {
        columnIndex,
        rowIndex,
        left,
        width,
        height,
        pinned = false,
    }: Props = $props();

    const { instance } = getDataGridContext();
    const updateTrigger = instance.updateTrigger;

    let cellRef = $state<HTMLDivElement | undefined>(undefined);
    let contentRef = $state<HTMLDivElement | undefined>(undefined);

    const cellContent = $derived.by(() => {
        $updateTrigger;
        return instance.cell(columnIndex, rowIndex);
    });

    const customCell = $derived.by(() => {
        if (cellContent && typeof cellContent === "object") {
            const candidate = cellContent as DataGridCellComponent;
            if (candidate.kind === "component") {
                return candidate;
            }
        }

        return null;
    });

    const CustomCellComponent = $derived(customCell?.component);
    const customCellProps = $derived(
        (customCell?.props ?? {}) as Record<string, unknown>,
    );

    const value = $derived.by(() => {
        $updateTrigger;

        if (typeof cellContent === "string") {
            return cellContent;
        }

        return instance.getCellData(rowIndex, columnIndex) ?? "";
    });

    const formattedValue = $derived.by(() =>
        value.replace(/\r/g, "\\r").replace(/\n/g, "\\n"),
    );

    const renderedValueParts = $derived.by(() =>
        renderLeadingTrailingWhitespace(formattedValue),
    );

    const isSpecialValue = $derived.by(() => {
        if (customCell) {
            return false;
        }

        return (
            formattedValue === "" ||
            formattedValue === "NA" ||
            formattedValue === "NaN" ||
            formattedValue === "NULL" ||
            formattedValue === "<NA>"
        );
    });

    const cellSelectionState = $derived.by(() => {
        $updateTrigger;
        return instance.cellSelectionState(columnIndex, rowIndex);
    });

    const selected = $derived(
        (cellSelectionState & CellSelectionState.Selected) !== 0,
    );

    const isCursorCell = $derived.by(() => {
        $updateTrigger;

        return (
            instance.internalCursor &&
            columnIndex === instance.cursorColumnIndex &&
            rowIndex === instance.cursorRowIndex
        );
    });

    const columnAlignment = $derived.by(() => {
        $updateTrigger;

        const alignment = instance.column(columnIndex)?.alignment;
        switch (alignment) {
            case DataColumnAlignment.Center:
                return "center";
            case DataColumnAlignment.Right:
                return "right";
            case DataColumnAlignment.Left:
            default:
                return "left";
        }
    });

    const customWidth = $derived.by(() => {
        $updateTrigger;
        return instance.getCustomColumnWidth(columnIndex) ?? width;
    });

    function renderPart(
        part: string | { kind: "whitespace"; text: string },
    ): { text: string; whitespace: boolean } {
        if (typeof part === "string") {
            return { text: part, whitespace: false };
        }

        return { text: part.text, whitespace: true };
    }

    async function mouseDownHandler(event: MouseEvent) {
        event.stopPropagation();

        const startingRect = cellRef?.getBoundingClientRect();

        if (instance.selection) {
            if (cellSelectionState === CellSelectionState.None || event.button === 0) {
                await instance.mouseSelectCell(
                    columnIndex,
                    rowIndex,
                    pinned,
                    selectionType(event),
                );
            } else if (!pinned) {
                await instance.scrollToCell(columnIndex, rowIndex);
            }
        }

        if (event.button === 2) {
            const endingRect = cellRef?.getBoundingClientRect();

            if (startingRect && endingRect) {
                await instance.showCellContextMenu(columnIndex, rowIndex, cellRef!, {
                    clientX:
                        event.clientX + endingRect.left - startingRect.left,
                    clientY: event.clientY + endingRect.top - startingRect.top,
                });
            }
        }
    }

    function mouseEnterHandler() {
        if (customCell || !instance.hoverManager || !contentRef) {
            return;
        }

        if (formattedValue && contentRef.offsetWidth < contentRef.scrollWidth) {
            instance.hoverManager.showHover(contentRef, value);
        }
    }

    function mouseLeaveHandler() {
        instance.hoverManager?.hideHover();
    }

    let resizingWidth = $state(false);
    let widthStartX = $state(0);
    let widthStartValue = $state(0);

    function beginWidthResize(event: MouseEvent) {
        if (!instance.columnResize) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        resizingWidth = true;
        widthStartX = event.clientX;
        widthStartValue = width;

        window.addEventListener("mousemove", onWidthResize);
        window.addEventListener("mouseup", endWidthResize);
    }

    function onWidthResize(event: MouseEvent) {
        if (!resizingWidth) {
            return;
        }

        const delta = event.clientX - widthStartX;
        const nextWidth = Math.max(
            instance.minimumColumnWidth,
            Math.min(instance.maximumColumnWidth, widthStartValue + delta),
        );

        void instance.setColumnWidth(columnIndex, nextWidth);
    }

    function endWidthResize() {
        resizingWidth = false;
        window.removeEventListener("mousemove", onWidthResize);
        window.removeEventListener("mouseup", endWidthResize);
    }

    let resizingHeight = $state(false);
    let heightStartY = $state(0);
    let heightStartValue = $state(0);

    function beginHeightResize(event: MouseEvent) {
        if (!instance.rowResize) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        resizingHeight = true;
        heightStartY = event.clientY;
        heightStartValue = height;

        window.addEventListener("mousemove", onHeightResize);
        window.addEventListener("mouseup", endHeightResize);
    }

    function onHeightResize(event: MouseEvent) {
        if (!resizingHeight) {
            return;
        }

        const delta = event.clientY - heightStartY;
        const nextHeight = Math.max(
            instance.minimumRowHeight,
            Math.min(90, heightStartValue + delta),
        );

        void instance.setRowHeight(rowIndex, nextHeight);
    }

    function endHeightResize() {
        resizingHeight = false;
        window.removeEventListener("mousemove", onHeightResize);
        window.removeEventListener("mouseup", endHeightResize);
    }
</script>

<div
    bind:this={cellRef}
    class="data-grid-row-cell"
    class:pinned
    role="presentation"
    data-column-index={columnIndex}
    data-row-index={rowIndex}
    style:height="{height}px"
    style:left="{left}px"
    style:width="{customWidth}px"
    onmousedown={mouseDownHandler}
    onmouseenter={mouseEnterHandler}
    onmouseleave={mouseLeaveHandler}
    oncontextmenu={(event) => event.preventDefault()}
>
    {#if instance.cellBorders}
        <div class="border-overlay">
            {#if !selected && isCursorCell}
                <div
                    class="cursor-border"
                    class:dimmed={!instance.focused}
                    style:top="{instance.cursorOffset}px"
                    style:right="{instance.cursorOffset}px"
                    style:bottom="{instance.cursorOffset}px"
                    style:left="{instance.cursorOffset}px"
                ></div>
            {/if}
        </div>

        {#if selected}
            <div
                class="selection-overlay"
                class:focused={instance.focused}
                class:selected-top={
                    (cellSelectionState & CellSelectionState.SelectedTop) !== 0
                }
                class:selected-bottom={
                    (cellSelectionState & CellSelectionState.SelectedBottom) !==
                    0
                }
                class:selected-left={
                    (cellSelectionState & CellSelectionState.SelectedLeft) !== 0
                }
                class:selected-right={
                    (cellSelectionState & CellSelectionState.SelectedRight) !==
                    0
                }
            >
                {#if isCursorCell}
                    <div
                        class="cursor-border"
                        style:top="{instance.cursorOffset}px"
                        style:right="{instance.cursorOffset}px"
                        style:bottom="{instance.cursorOffset}px"
                        style:left="{instance.cursorOffset}px"
                    ></div>
                {/if}
            </div>
        {/if}
    {/if}

    <div
        class="content"
        id="data-grid-row-cell-content-{columnIndex}-{rowIndex}"
        style:padding-left="{instance.horizontalCellPadding}px"
        style:padding-right="{instance.horizontalCellPadding}px"
    >
        {#if customCell}
            {#if CustomCellComponent}
                <CustomCellComponent {...customCellProps} />
            {/if}
        {:else}
            <div class="text-container {columnAlignment}">
                <div
                    bind:this={contentRef}
                    class="text-value"
                    class:special-value={isSpecialValue}
                    title={!instance.hoverManager ? value : undefined}
                >
                    {#each renderedValueParts as part, index (index)}
                        {@const renderedPart = renderPart(part)}
                        <span class:whitespace={renderedPart.whitespace}
                            >{renderedPart.text}</span
                        >
                    {/each}
                </div>
            </div>
        {/if}
    </div>

    {#if instance.columnResize}
        <button
            type="button"
            class="vertical-splitter"
            class:active={resizingWidth}
            tabindex="-1"
            aria-label="Resize column"
            onmousedown={beginWidthResize}
        ></button>
    {/if}

    {#if instance.rowResize}
        <button
            type="button"
            class="horizontal-splitter"
            class:active={resizingHeight}
            tabindex="-1"
            aria-label="Resize row"
            onmousedown={beginHeightResize}
        ></button>
    {/if}
</div>

<style>
    .data-grid-row-cell {
        position: absolute;
        background-color: var(
            --vscode-positronDataGrid-background,
            var(--vscode-editor-background)
        );
    }

    .data-grid-row-cell:not(.pinned) {
        z-index: 0;
    }

    .data-grid-row-cell.pinned {
        z-index: 1;
    }

    .data-grid-row-cell .border-overlay {
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        position: absolute;
        box-sizing: border-box;
        border-right: 1px solid
            var(
                --vscode-positronDataGrid-border,
                var(--vscode-editorGroup-border)
            );
        border-bottom: 1px solid
            var(
                --vscode-positronDataGrid-border,
                var(--vscode-editorGroup-border)
            );
    }

    .data-grid-row-cell .selection-overlay {
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        position: absolute;
        box-sizing: border-box;
        background-color: var(
            --vscode-positronDataGrid-selectionBackground,
            var(--vscode-list-activeSelectionBackground)
        );
    }

    .data-grid-row-cell .selection-overlay:not(.focused) {
        opacity: 50%;
    }

    .data-grid-row-cell .selection-overlay.selected-top {
        border-top: 1px solid
            var(
                --vscode-positronDataGrid-selectionBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-row-cell .selection-overlay.selected-right {
        border-right: 1px solid
            var(
                --vscode-positronDataGrid-selectionBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-row-cell .selection-overlay:not(.selected-right) {
        border-right: 1px solid
            var(
                --vscode-positronDataGrid-selectionInnerBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-row-cell .selection-overlay.selected-bottom {
        border-bottom: 1px solid
            var(
                --vscode-positronDataGrid-selectionBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-row-cell .selection-overlay:not(.selected-bottom) {
        border-bottom: 1px solid
            var(
                --vscode-positronDataGrid-selectionInnerBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-row-cell .selection-overlay.selected-left {
        border-left: 1px solid
            var(
                --vscode-positronDataGrid-selectionBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-row-cell .cursor-border {
        position: absolute;
        box-sizing: border-box;
        border: 1.5px solid
            var(--vscode-positronDataGrid-cursorBorder, var(--vscode-focusBorder));
    }

    .data-grid-row-cell .cursor-border.dimmed {
        opacity: 50%;
    }

    .data-grid-row-cell .content {
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        position: absolute;
        overflow: hidden;
    }

    .data-grid-row-cell .content .text-container {
        height: 100%;
        display: flex;
        align-items: center;
    }

    .data-grid-row-cell .content .text-container.left {
        justify-content: left;
    }

    .data-grid-row-cell .content .text-container.center {
        justify-content: center;
    }

    .data-grid-row-cell .content .text-container.right {
        justify-content: right;
        font-variant-numeric: tabular-nums;
    }

    .data-grid-row-cell .content .text-container .text-value {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        white-space-collapse: preserve;
    }

    .data-grid-row-cell .content .text-container .text-value.special-value {
        opacity: 0.6;
    }

    .data-grid-row-cell .content .text-container .text-value .whitespace {
        opacity: 0.5;
    }

    .data-grid-row-cell .vertical-splitter {
        top: 0;
        right: 0;
        bottom: 0;
        border: 0;
        width: 1px;
        padding: 0;
        position: absolute;
        cursor: col-resize;
        background-color: transparent;
    }

    .data-grid-row-cell .horizontal-splitter {
        right: 0;
        bottom: 0;
        left: 0;
        border: 0;
        height: 1px;
        padding: 0;
        position: absolute;
        cursor: row-resize;
        background-color: transparent;
    }

    .data-grid-row-cell .vertical-splitter:hover,
    .data-grid-row-cell .vertical-splitter.active,
    .data-grid-row-cell .horizontal-splitter:hover,
    .data-grid-row-cell .horizontal-splitter.active {
        background-color: var(
            --vscode-sash-hoverBorder,
            var(--vscode-focusBorder)
        );
    }
</style>
