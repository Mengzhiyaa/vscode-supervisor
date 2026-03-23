<!--
  DataGridColumnHeader.svelte - Individual column header (Svelte 5 runes mode)
  Port from Positron's dataGridColumnHeader.tsx
-->
<script lang="ts">
    import { getDataGridContext } from "../context";
    import { ColumnSelectionState } from "../dataGridInstance";
    import { selectionType } from "../utilities/mouseUtilities";
    import { renderLeadingTrailingWhitespace } from "../../dataExplorer/components/tableDataCell";

    interface Props {
        columnIndex: number;
        left: number;
        width: number;
        pinned?: boolean;
    }

    let {
        columnIndex,
        left,
        width,
        pinned = false,
    }: Props = $props();

    const { instance } = getDataGridContext();
    const updateTrigger = instance.updateTrigger;

    let headerRef = $state<HTMLDivElement | undefined>(undefined);
    let sortButtonRef = $state<HTMLButtonElement | undefined>(undefined);
    let titleRef = $state<HTMLDivElement | undefined>(undefined);

    const columnData = $derived.by(() => {
        $updateTrigger;
        return instance.column(columnIndex);
    });

    const columnName = $derived(columnData?.name ?? `Column ${columnIndex + 1}`);
    const columnDescription = $derived(columnData?.description ?? "");

    const columnLabel = $derived.by(() => {
        return (
            (instance as {
                getSchemaColumn?: (
                    index: number,
                ) => { description?: string } | undefined;
            }).getSchemaColumn?.(columnIndex)?.description ?? ""
        );
    });

    const headerTooltip = $derived.by(() => {
        if (columnDescription && columnLabel) {
            return `Type: ${columnDescription}
${columnLabel}`;
        }

        if (columnDescription) {
            return `Type: ${columnDescription}`;
        }

        return columnLabel || undefined;
    });

    const renderedColumnName = $derived.by(() =>
        renderLeadingTrailingWhitespace(columnName),
    );

    const columnSortKey = $derived.by(() => {
        $updateTrigger;
        return instance.getSortKey(columnIndex);
    });

    const columnSelectionState = $derived.by(() => {
        $updateTrigger;
        return instance.columnSelectionState(columnIndex);
    });

    const selected = $derived(
        (columnSelectionState & ColumnSelectionState.Selected) !== 0,
    );

    async function mouseDownHandler(event: MouseEvent) {
        event.stopPropagation();

        if (event.button === 0) {
            if (
                (event.target as HTMLElement).closest(
                    ".sort-button, .resize-handle",
                )
            ) {
                return;
            }
        }

        const startingRect = headerRef?.getBoundingClientRect();

        if (instance.selection) {
            if (columnSelectionState === ColumnSelectionState.None) {
                await instance.mouseSelectColumn(columnIndex, selectionType(event));
            } else {
                await instance.scrollToColumn(columnIndex);
            }
        }

        if (event.button === 2) {
            const endingRect = headerRef?.getBoundingClientRect();
            if (startingRect && endingRect) {
                await instance.showColumnContextMenu(
                    columnIndex,
                    headerRef!,
                    {
                        clientX:
                            event.clientX +
                            endingRect.left -
                            startingRect.left,
                        clientY: event.clientY,
                    },
                );
            }
        }
    }

    function dropdownMouseDown(event: MouseEvent) {
        event.stopPropagation();
    }

    async function dropdownPressed(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        const controlRef = sortButtonRef ?? headerRef;
        if (controlRef) {
            await instance.showColumnContextMenu(columnIndex, controlRef);
        }
    }

    function titleMouseOver() {
        if (!columnData || !instance.hoverManager || !titleRef || !headerTooltip) {
            return;
        }

        instance.hoverManager.showHover(titleRef, headerTooltip);
    }

    function titleMouseLeave() {
        instance.hoverManager?.hideHover();
    }

    function renderNamePart(
        part: string | { kind: "whitespace"; text: string },
    ): { text: string; whitespace: boolean } {
        if (typeof part === "string") {
            return { text: part, whitespace: false };
        }

        return { text: part.text, whitespace: true };
    }

    let isResizing = $state(false);
    let resizeStartX = $state(0);
    let resizeStartWidth = $state(0);

    function handleResizeStart(event: MouseEvent) {
        if (!instance.columnResize) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        isResizing = true;
        resizeStartX = event.clientX;
        resizeStartWidth = width;

        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeEnd);
    }

    function handleResizeMove(event: MouseEvent) {
        if (!isResizing) {
            return;
        }

        const delta = event.clientX - resizeStartX;
        const newWidth = Math.max(
            instance.minimumColumnWidth,
            Math.min(instance.maximumColumnWidth, resizeStartWidth + delta),
        );

        void instance.setColumnWidth(columnIndex, newWidth);
    }

    function handleResizeEnd() {
        isResizing = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeEnd);
    }
</script>

<div
    bind:this={headerRef}
    class="data-grid-column-header"
    class:pinned
    role="presentation"
    data-column-index={columnIndex}
    style:left="{left}px"
    style:width="{width}px"
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
                class:selected-left={
                    (columnSelectionState & ColumnSelectionState.SelectedLeft) !==
                    0
                }
                class:selected-right={
                    (columnSelectionState & ColumnSelectionState.SelectedRight) !==
                    0
                }
            ></div>
        {/if}
    {/if}

    <div
        class="content"
        style:padding-left="{instance.horizontalCellPadding}px"
        style:padding-right="{instance.horizontalCellPadding}px"
    >
        <div class="title-description">
            <div
                bind:this={titleRef}
                class="title"
                role="presentation"
                title={!instance.hoverManager ? headerTooltip : undefined}
                onmouseenter={titleMouseOver}
                onmouseleave={titleMouseLeave}
            >
                {#each renderedColumnName as part, index (index)}
                    {@const renderedPart = renderNamePart(part)}
                    <span class:whitespace={renderedPart.whitespace}
                        >{renderedPart.text}</span
                    >
                {/each}
            </div>

            {#if columnDescription}
                <div class="description">{columnDescription}</div>
            {/if}
        </div>

        {#if columnSortKey}
            <div class="sort-indicator">
                <div
                    class="sort-icon codicon"
                    class:codicon-arrow-up={columnSortKey.ascending}
                    class:codicon-arrow-down={!columnSortKey.ascending}
                    style:font-size="16px"
                ></div>
                <div class="sort-index">{columnSortKey.sortIndex + 1}</div>
            </div>
        {/if}

        <button
            bind:this={sortButtonRef}
            class="sort-button"
            tabindex="-1"
            onmousedown={dropdownMouseDown}
            onclick={dropdownPressed}
            aria-label="Sort options"
        >
            <div
                class="codicon codicon-positron-vertical-ellipsis"
                style:font-size="18px"
            ></div>
        </button>
    </div>

    {#if instance.columnResize}
        <button
            type="button"
            class="resize-handle"
            tabindex="-1"
            aria-label="Resize column"
            onmousedown={handleResizeStart}
        ></button>
    {/if}
</div>

<style>
    .data-grid-column-header {
        top: 0;
        bottom: 0;
        display: grid;
        position: absolute;
        grid-template-columns: [content] 1fr [right-gutter] 1px [end];
        background-color: var(
            --vscode-positronDataGrid-contrastBackground,
            var(--vscode-editorWidget-background)
        );
    }

    .data-grid-column-header:not(.pinned) {
        z-index: 0;
    }

    .data-grid-column-header.pinned {
        z-index: 1;
    }

    .data-grid-column-header .pinned-indicator {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 2px;
        background-color: var(
            --vscode-positronDataGrid-selectionBorder,
            var(--vscode-focusBorder)
        );
    }

    .data-grid-column-header .border-overlay {
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

    .data-grid-column-header .selection-overlay {
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
        border-top: 1px solid
            var(
                --vscode-positronDataGrid-selectionBorder,
                var(--vscode-focusBorder)
            );
        border-bottom: 1px solid
            var(
                --vscode-positronDataGrid-selectionInnerBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-column-header .selection-overlay:not(.focused) {
        opacity: 50%;
    }

    .data-grid-column-header .selection-overlay.selected-left {
        border-left: 1px solid
            var(
                --vscode-positronDataGrid-selectionBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-column-header .selection-overlay.selected-right {
        border-right: 1px solid
            var(
                --vscode-positronDataGrid-selectionBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-column-header .selection-overlay:not(.selected-right) {
        border-right: 1px solid
            var(
                --vscode-positronDataGrid-selectionInnerBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-column-header .content {
        display: grid;
        position: relative;
        align-items: center;
        grid-column: content / right-gutter;
        grid-template-columns:
            [title-description] minmax(0, 1fr)
            [sort-indicator] min-content
            [button] 20px
            [button-end];
    }

    .data-grid-column-header .content .title-description {
        margin-bottom: 1px;
        grid-column: title-description / sort-indicator;
        min-width: 0;
    }

    .data-grid-column-header .content .title-description .title {
        overflow: hidden;
        white-space: nowrap;
        line-height: normal;
        text-overflow: ellipsis;
        font-size: var(
            --positron-data-grid-column-header-title-font-size,
            12px
        );
        font-weight: var(
            --positron-data-grid-column-header-title-font-weight,
            600
        );
    }

    .data-grid-column-header .content .title-description .title .whitespace {
        opacity: 50%;
    }

    .data-grid-column-header .content .title-description .description {
        opacity: 80%;
        overflow: hidden;
        white-space: nowrap;
        line-height: normal;
        text-overflow: ellipsis;
        font-size: var(
            --positron-data-grid-column-header-description-font-size,
            11px
        );
    }

    .data-grid-column-header .content .sort-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .data-grid-column-header .content .sort-indicator .sort-icon {
        margin: 0;
    }

    .data-grid-column-header .content .sort-indicator .sort-index {
        margin: 0 3px;
        color: var(
            --vscode-positronDataGrid-sortIndexForeground,
            var(--vscode-descriptionForeground)
        );
        font-size: var(
            --positron-data-grid-column-header-sort-index-font-size,
            10px
        );
        font-weight: var(
            --positron-data-grid-column-header-sort-index-font-weight,
            600
        );
        font-variant-numeric: var(
            --positron-data-grid-column-header-sort-index-font-variant-numeric,
            tabular-nums
        );
    }

    .data-grid-column-header .content .sort-button {
        z-index: 1;
        width: 20px;
        height: 20px;
        display: flex;
        cursor: pointer;
        border-radius: 4px;
        align-items: center;
        box-sizing: border-box;
        justify-content: center;
        grid-column: button / button-end;
        border: 1px solid transparent;
        background: transparent;
        color: inherit;
        padding: 0;
    }

    .data-grid-column-header .content .sort-button:focus {
        outline: none !important;
    }

    .data-grid-column-header .content .sort-button:focus-visible {
        border-radius: 4px;
        outline: 1px solid var(--vscode-focusBorder) !important;
    }

    .data-grid-column-header .content .sort-button:hover {
        border: 1px solid
            var(
                --vscode-positronDataGrid-selectionBorder,
                var(--vscode-focusBorder)
            );
    }

    .data-grid-column-header .content .sort-button:active {
        border: 1px solid
            var(
                --vscode-positronDataGrid-selectionBorder,
                var(--vscode-focusBorder)
            );
        background-color: var(
            --vscode-positronDataGrid-selectionBackground,
            var(--vscode-list-activeSelectionBackground)
        );
    }

    .data-grid-column-header .resize-handle {
        grid-column: right-gutter / end;
        border: 0;
        cursor: col-resize;
        width: 1px;
        padding: 0;
        top: 0;
        right: 0;
        bottom: 0;
        position: absolute;
        background-color: transparent;
    }

    .data-grid-column-header .resize-handle:hover {
        background-color: var(
            --vscode-sash-hoverBorder,
            var(--vscode-focusBorder)
        );
    }
</style>
