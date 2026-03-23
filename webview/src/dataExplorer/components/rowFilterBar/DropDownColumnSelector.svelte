<!--
  DropDownColumnSelector.svelte - Drop-down column selector button (Svelte 5 runes mode)
  Port from Positron's dropDownColumnSelector.tsx
-->
<script lang="ts">
    import type { SchemaColumn } from "../../../dataGrid/types";
    import { getColumnTypeIcon } from "./columnSchemaUtilities";
    import ColumnSelectorPopup from "./ColumnSelectorPopup.svelte";

    interface Props {
        columns: SchemaColumn[];
        title?: string;
        selectedColumnSchema?: SchemaColumn;
        onSelectedColumnSchemaChanged: (
            selectedColumnSchema: SchemaColumn,
        ) => void;
    }

    let {
        columns,
        title = "Select Column",
        selectedColumnSchema = undefined,
        onSelectedColumnSchemaChanged,
    }: Props = $props();

    let buttonRef = $state<HTMLButtonElement | null>(null);
    let showPopup = $state(false);
    let focusInput = $state(false);
    let initialSearchText = $state<string | undefined>(undefined);

    function openPopup(openSearchInput: boolean, initialText?: string) {
        showPopup = true;
        focusInput = openSearchInput;
        initialSearchText = initialText;
    }

    function handlePressed() {
        if (showPopup) {
            showPopup = false;
            return;
        }

        openPopup(false);
    }

    function handleMouseDown(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
    }

    function handleItemSelected(columnSchema: SchemaColumn) {
        showPopup = false;
        focusInput = false;
        initialSearchText = undefined;
        selectedColumnSchema = columnSchema;
        onSelectedColumnSchemaChanged(columnSchema);
        buttonRef?.focus();
    }

    function handleClose() {
        showPopup = false;
        focusInput = false;
        initialSearchText = undefined;
        buttonRef?.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (event.key.trim().length !== 1 || showPopup) {
            return;
        }

        openPopup(true, event.key);
    }

    export function focus() {
        buttonRef?.focus();
    }
</script>

<button
    class="drop-down-column-selector"
    bind:this={buttonRef}
    onclick={handlePressed}
    onkeydown={handleKeyDown}
    onmousedown={handleMouseDown}
    aria-haspopup="dialog"
    aria-expanded={showPopup}
    type="button"
>
    {#if !selectedColumnSchema}
        <div class="title">{title}</div>
    {:else}
        <div class="column-schema-title">
            <div class="left-gutter"></div>
            <div
                class="data-type-icon codicon {getColumnTypeIcon(
                    selectedColumnSchema,
                )}"
            ></div>
            <div class="column-name">{selectedColumnSchema.column_name}</div>
            <div class="right-gutter"></div>
        </div>
    {/if}

    <div class="chevron" aria-hidden="true">
        <div class="codicon codicon-chevron-down"></div>
    </div>
</button>

{#if showPopup && buttonRef}
    <ColumnSelectorPopup
        anchorElement={buttonRef}
        {columns}
        {selectedColumnSchema}
        {focusInput}
        {initialSearchText}
        onItemSelected={handleItemSelected}
        onClose={handleClose}
    />
{/if}

<style>
    .drop-down-column-selector {
        width: 100%;
        padding: 4px;
        display: grid;
        margin: 0;
        font: inherit;
        font-size: 12px;
        line-height: 16px;
        border-radius: 4px;
        min-height: 26px;
        align-items: center;
        text-align: inherit;
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        grid-template-columns: [title] 1fr [chevron] 22px [end];
        color: var(--vscode-positronDropDownListBox-foreground);
        border: 1px solid var(--vscode-positronDropDownListBox-border);
    }

    .drop-down-column-selector:focus {
        outline: none !important;
    }

    .drop-down-column-selector:focus-visible {
        outline: 1px solid var(--vscode-focusBorder) !important;
        outline-offset: 0;
    }

    .drop-down-column-selector:disabled {
        opacity: 50%;
    }

    .drop-down-column-selector .title {
        display: flex;
        padding-left: 6px;
        align-items: center;
        overflow: hidden;
        text-overflow: ellipsis;
        grid-column: title / chevron;
        color: var(--vscode-positronContextMenu-foreground);
        white-space: nowrap;
    }

    .drop-down-column-selector .column-schema-title {
        display: grid;
        align-items: center;
        overflow: hidden;
        grid-column: title / chevron;
        grid-template-columns:
            [left-gutter] 4px
            [icon] 25px
            [title] 1fr
            [right-gutter] 4px
            [end];
    }

    .drop-down-column-selector .column-schema-title .left-gutter {
        grid-column: left-gutter / icon;
    }

    .drop-down-column-selector .column-schema-title .data-type-icon {
        width: 25px;
        opacity: 80%;
        display: flex;
        font-size: 16px;
        align-items: center;
        justify-content: center;
        grid-column: icon / title;
    }

    .drop-down-column-selector .column-schema-title .column-name {
        display: flex;
        font-weight: 600;
        overflow: hidden;
        align-items: center;
        white-space: nowrap;
        text-overflow: ellipsis;
        justify-content: left;
        grid-column: title / right-gutter;
    }

    .drop-down-column-selector .column-schema-title .right-gutter {
        grid-column: right-gutter / end;
    }

    .drop-down-column-selector .chevron {
        display: flex;
        align-items: center;
        justify-content: center;
        grid-column: chevron / end;
    }

    .drop-down-column-selector .chevron .codicon {
        font-size: 16px;
    }
</style>
