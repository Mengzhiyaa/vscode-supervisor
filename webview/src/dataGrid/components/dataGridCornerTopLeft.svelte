<!--
  dataGridCornerTopLeft.svelte - Top-left corner component
  Port from Positron's dataGridCornerTopLeft.tsx
-->
<script lang="ts">
    import VerticalSplitter from "../../dataExplorer/components/splitters/verticalSplitter.svelte";
    import { getPositronDataGridContext } from "../positronDataGridContext";

    const { instance } = getPositronDataGridContext();

    const tooltipText = "Scroll to top-left";

    async function handleClick(event?: MouseEvent) {
        if (event?.target instanceof Element && event.target.closest('[role="separator"]')) {
            return;
        }
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

    const updateTrigger = instance.updateTrigger;
    const rowHeadersWidth = $derived.by(() => {
        $updateTrigger;
        return instance.rowHeadersWidth;
    });
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
        if (event.target !== event.currentTarget) {
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void handleClick();
        }
    }}
>
    <div class="border-overlay"></div>
    {#if instance.rowHeadersResize}
        <div class="data-grid-vertical-splitter">
            <VerticalSplitter
                rootClass="data-grid-vertical-splitter"
                resizeAriaLabel="Resize row header width"
                onBeginResize={() => ({
                    minimumWidth: 20,
                    maximumWidth: instance.maximumColumnWidth,
                    startingWidth: rowHeadersWidth,
                })}
                onResize={(width) => { void instance.setRowHeadersWidth(width); }}
            />
        </div>
    {/if}
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

    .data-grid-corner-top-left .data-grid-vertical-splitter {
        grid-column: splitter / end-columns;
        align-self: stretch;
    }

</style>
