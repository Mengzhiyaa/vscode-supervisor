<!--
  dataGridScrollbarCorner.svelte - Scrollbar corner component
  Port from Positron's dataGridScrollbarCorner.tsx
-->
<script lang="ts">
    import { getPositronDataGridContext } from "../positronDataGridContext";

    const { instance } = getPositronDataGridContext();

    const tooltipText = "Scroll to bottom-right";

    async function handleClick() {
        await instance.setScrollOffsets(
            instance.maximumHorizontalScrollOffset,
            instance.maximumVerticalScrollOffset,
        );
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
</script>

<div
    class="data-grid-scrollbar-corner"
    style:width="{instance.scrollbarThickness}px"
    style:height="{instance.scrollbarThickness}px"
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
></div>

<style>
    .data-grid-scrollbar-corner {
        right: 0;
        bottom: 0;
        z-index: 28;
        cursor: pointer;
        position: absolute;
        box-sizing: border-box;
        background-color: var(
            --vscode-positronDataGrid-background,
            var(--vscode-editorWidget-background)
        );
        border-top: 1px solid
            var(
                --vscode-positronDataGrid-border,
                var(--vscode-editorGroup-border)
            );
        border-left: 1px solid
            var(
                --vscode-positronDataGrid-border,
                var(--vscode-editorGroup-border)
            );
    }
</style>
