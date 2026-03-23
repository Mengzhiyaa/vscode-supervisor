<!--
  ColumnSelectorCell.svelte - Column selector cell component (Svelte 5 runes mode)
  Port from Positron's columnSelectorCell.tsx
-->
<script lang="ts">
    import type { SchemaColumn } from "../../../dataGrid/types";
    import { getColumnTypeIcon } from "./columnSchemaUtilities";

    interface Props {
        columnSchema: SchemaColumn;
        isSelected: boolean;
        onPressed: () => void;
    }

    let { columnSchema, isSelected, onPressed }: Props = $props();
</script>

<button
    class="column-selector-cell"
    class:selected={isSelected}
    onclick={onPressed}
    role="option"
    aria-selected={isSelected}
>
    {#if isSelected}
        <div class="cursor-background"></div>
    {/if}

    <div class="info">
        <div
            class="data-type-icon codicon {getColumnTypeIcon(columnSchema)}"
        ></div>
        <div class="column-name">
            {columnSchema.column_name}
        </div>
    </div>
</button>

<style>
    .column-selector-cell {
        top: 0;
        right: 0;
        left: 0;
        z-index: 0;
        margin: 0;
        border: none;
        display: grid;
        cursor: pointer;
        padding: 0;
        font: inherit;
        font-size: 12px;
        line-height: 16px;
        overflow: hidden;
        position: relative;
        text-align: left;
        appearance: none;
        -webkit-appearance: none;
        color: var(--vscode-positronDropDownListBox-foreground);
        background-color: transparent;
        min-height: 26px;
    }

    .column-selector-cell:hover {
        border-radius: 4px;
        color: var(--vscode-positronDropDownListBox-hoverForeground);
        background: var(--vscode-positronDropDownListBox-hoverBackground);
    }

    .column-selector-cell:focus {
        outline: none;
    }

    .column-selector-cell:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        border-radius: 4px;
    }

    .column-selector-cell .cursor-background {
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        z-index: -1;
        position: absolute;
        border-radius: 4px;
        background-color: var(--vscode-positronDataExplorer-selectionBackground);
    }

    .column-selector-cell .info {
        display: grid;
        align-items: center;
        grid-template-columns:
            [left-gutter] 4px
            [icon] 25px
            [title] 1fr
            [right-gutter] 4px
            [end];
    }

    .column-selector-cell .info .data-type-icon {
        width: 25px;
        height: 25px;
        opacity: 80%;
        display: flex;
        font-size: 16px;
        align-items: center;
        justify-content: center;
        grid-column: icon / title;
    }

    .column-selector-cell .info .column-name {
        display: flex;
        font-weight: 600;
        overflow: hidden;
        align-items: center;
        white-space: nowrap;
        text-overflow: ellipsis;
        justify-content: left;
        grid-column: title / right-gutter;
    }
</style>
