<!--
  dataGridRowHeader.svelte - Individual row header (Svelte 5 runes mode)
  Port from Positron's dataGridRowHeader.tsx
-->
<script lang="ts">
    import { getPositronDataGridContext } from "../positronDataGridContext";
    import { RowSelectionState } from "../classes/dataGridInstance";
    import { selectionType } from "../utilities/mouseUtilities";

    interface Props {
        rowIndex: number;
        top: number;
        height: number;
        pinned?: boolean;
    }

    let {
        rowIndex,
        top,
        height,
        pinned = false,
    }: Props = $props();

    const { instance } = getPositronDataGridContext();
    const updateTrigger = instance.updateTrigger;

    let headerRef = $state<HTMLDivElement | undefined>(undefined);

    const rowSelectionState = $derived.by(() => {
        $updateTrigger;
        return instance.rowSelectionState(rowIndex);
    });

    const selected = $derived(
        (rowSelectionState & RowSelectionState.Selected) !== 0,
    );

    const rowHeaderText = $derived.by(() => {
        $updateTrigger;
        return instance.rowHeader(rowIndex);
    });

    async function mouseDownHandler(event: MouseEvent) {
        event.stopPropagation();

        const startingRect = headerRef?.getBoundingClientRect();

        if (rowSelectionState === RowSelectionState.None && instance.selection) {
            await instance.mouseSelectRow(rowIndex, selectionType(event));
        } else {
            await instance.scrollToRow(rowIndex);
        }

        if (event.button === 2) {
            const endingRect = headerRef?.getBoundingClientRect();

            if (startingRect && endingRect) {
                await instance.showRowContextMenu(rowIndex, headerRef!, {
                    clientX: event.clientX,
                    clientY: event.clientY + endingRect.top - startingRect.top,
                });
            }
        }
    }

    let resizingWidth = $state(false);
    let widthStartX = $state(0);
    let widthStartValue = $state(0);

    function beginWidthResize(event: MouseEvent) {
        if (!instance.rowHeadersResize) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        resizingWidth = true;
        widthStartX = event.clientX;
        widthStartValue = instance.rowHeadersWidth;

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

        void instance.setRowHeadersWidth(nextWidth);
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
    bind:this={headerRef}
    class="data-grid-row-header"
    class:pinned
    role="presentation"
    data-row-index={rowIndex}
    style:top="{top}px"
    style:height="{height}px"
    onmousedown={mouseDownHandler}
>
    {#if pinned}
        <div class="pinned-indicator"></div>
    {/if}

    {#if instance.cellBorders}
        <div class="border-overlay"></div>

        {#if selected}
            <div
                class="selection-overlay"
                class:focused={instance.focused}
                class:selected-top={
                    (rowSelectionState & RowSelectionState.SelectedTop) !== 0
                }
                class:selected-bottom={
                    (rowSelectionState & RowSelectionState.SelectedBottom) !== 0
                }
            ></div>
        {/if}
    {/if}

    <div class="content">{rowHeaderText}</div>

    <button
        type="button"
        class="vertical-splitter"
        class:active={resizingWidth}
        tabindex="-1"
        aria-label="Resize row header width"
        onmousedown={beginWidthResize}
    ></button>

    {#if instance.rowResize}
        <button
            type="button"
            class="horizontal-splitter"
            class:active={resizingHeight}
            tabindex="-1"
            aria-label="Resize row height"
            onmousedown={beginHeightResize}
        ></button>
    {/if}
</div>

<style>
    .data-grid-row-header {
        left: 0;
        right: 0;
        display: grid;
        position: absolute;
        align-items: center;
        justify-content: center;
        grid-template-rows: [content] 1fr [splitter] 1px [end];
        grid-template-columns: [content] 1fr [splitter] 1px [end];
        background-color: var(
            --vscode-positronDataGrid-contrastBackground,
            var(--vscode-editorWidget-background)
        );
    }

    .data-grid-row-header:not(.pinned) {
        z-index: 0;
    }

    .data-grid-row-header.pinned {
        z-index: 1;
    }

    .data-grid-row-header .pinned-indicator {
        position: absolute;
        top: 0;
        left: 0;
        width: 2px;
        height: 100%;
        background-color: var(
            --vscode-positronDataGrid-selectionBorder,
            var(--vscode-focusBorder)
        );
    }

    .data-grid-row-header .border-overlay {
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

    .data-grid-row-header .selection-overlay {
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
        border-left: 1px solid
            var(
                --vscode-positronDataGrid-selectionBorder,
                var(--vscode-focusBorder)
            );
        border-right: 1px solid
            var(
                --vscode-positronDataGrid-selectionInnerBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-row-header .selection-overlay:not(.focused) {
        opacity: 50%;
    }

    .data-grid-row-header .selection-overlay.selected-top {
        border-top: 1px solid
            var(
                --vscode-positronDataGrid-selectionBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-row-header .selection-overlay.selected-bottom {
        border-bottom: 1px solid
            var(
                --vscode-positronDataGrid-selectionBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-row-header .selection-overlay:not(.selected-bottom) {
        border-bottom: 1px solid
            var(
                --vscode-positronDataGrid-selectionInnerBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-row-header .content {
        overflow: hidden;
        position: relative;
        grid-row: content / splitter;
        grid-column: content / splitter;
        display: flex;
        align-items: center;
        justify-content: center;
        font-variant-numeric: tabular-nums;
        font-size: 11px;
    }

    .data-grid-row-header .vertical-splitter {
        grid-row: content / end;
        grid-column: splitter / end;
        border: 0;
        cursor: col-resize;
        padding: 0;
        background-color: transparent;
    }

    .data-grid-row-header .horizontal-splitter {
        grid-row: splitter / end;
        grid-column: content / end;
        border: 0;
        cursor: row-resize;
        padding: 0;
        background-color: transparent;
    }

    .data-grid-row-header .vertical-splitter:hover,
    .data-grid-row-header .vertical-splitter.active,
    .data-grid-row-header .horizontal-splitter:hover,
    .data-grid-row-header .horizontal-splitter.active {
        background-color: var(
            --vscode-sash-hoverBorder,
            var(--vscode-focusBorder)
        );
    }
</style>
