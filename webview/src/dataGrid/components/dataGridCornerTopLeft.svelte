<!--
  dataGridCornerTopLeft.svelte - Top-left corner component
  Port from Positron's dataGridCornerTopLeft.tsx
-->
<script lang="ts">
    import { getPositronDataGridContext } from "../positronDataGridContext";

    const { instance } = getPositronDataGridContext();

    const tooltipText = "Scroll to top-left";

    async function handleClick() {
        await instance.setScrollOffsets(0, 0);
    }

    function handleMouseOver(event: MouseEvent) {
        const target = event.currentTarget as HTMLElement;
        if (!instance.hoverManager || !target) {
            return;
        }

        instance.hoverManager.showHover(target, tooltipText);
    }

    function handleMouseLeave() {
        instance.hoverManager?.hideHover();
    }

    let resizing = $state(false);
    let startX = $state(0);
    let startingWidth = $state(0);

    function beginResize(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        resizing = true;
        startX = event.clientX;
        startingWidth = instance.rowHeadersWidth;

        window.addEventListener("mousemove", onResize);
        window.addEventListener("mouseup", endResize);
    }

    function onResize(event: MouseEvent) {
        if (!resizing) {
            return;
        }

        const delta = event.clientX - startX;
        const nextWidth = Math.max(
            20,
            Math.min(instance.maximumColumnWidth, startingWidth + delta),
        );

        void instance.setRowHeadersWidth(nextWidth);
    }

    function endResize() {
        resizing = false;
        window.removeEventListener("mousemove", onResize);
        window.removeEventListener("mouseup", endResize);
    }
</script>

<div
    class="data-grid-corner-top-left"
    title={!instance.hoverManager ? tooltipText : undefined}
    onclick={handleClick}
    onmouseenter={handleMouseOver}
    onmouseleave={handleMouseLeave}
    role="button"
    tabindex="0"
    onkeydown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void handleClick();
        }
    }}
>
    <div class="border-overlay"></div>
    <button
        type="button"
        class="vertical-splitter"
        class:active={resizing}
        tabindex="-1"
        aria-label="Resize row header width"
        onmousedown={beginResize}
    ></button>
</div>

<style>
    .data-grid-corner-top-left {
        display: grid;
        cursor: pointer;
        position: relative;
        box-sizing: border-box;
        grid-row: headers / waffle;
        grid-column: headers / waffle;
        grid-template-columns: [content] 1fr [splitter] 1px [end-columns];
        background-color: var(
            --vscode-positronDataGrid-contrastBackground,
            var(--vscode-editorWidget-background)
        );
    }

    .data-grid-corner-top-left .border-overlay {
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

    .data-grid-corner-top-left .vertical-splitter {
        grid-column: splitter / end-columns;
        border: 0;
        cursor: col-resize;
        padding: 0;
        background-color: transparent;
    }

    .data-grid-corner-top-left .vertical-splitter:hover,
    .data-grid-corner-top-left .vertical-splitter.active {
        background-color: var(
            --vscode-sash-hoverBorder,
            var(--vscode-focusBorder)
        );
    }
</style>
