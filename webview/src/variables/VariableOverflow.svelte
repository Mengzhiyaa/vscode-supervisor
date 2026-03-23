<!--
  VariableOverflow.svelte
  1:1 Positron replication - Shows "... more values" for truncated lists
-->
<script lang="ts">
    // Props using Svelte 5 runes
    interface Props {
        overflowValues: number;
        indentLevel?: number;
        nameColumnWidth?: number;
        detailsColumnWidth?: number;
        selected?: boolean;
        focused?: boolean;
        style?: string;
        onselect?: () => void;
        ondeselect?: () => void;
    }

    let {
        overflowValues,
        indentLevel = 0,
        nameColumnWidth = 150,
        detailsColumnWidth = 200,
        selected = false,
        focused = false,
        style = "",
        onselect,
        ondeselect,
    }: Props = $props();

    // Detect platform for modifier key
    const isMac =
        typeof navigator !== "undefined" &&
        navigator.platform.toLowerCase().includes("mac");

    let valueText = $derived(`${overflowValues.toLocaleString()} more values`);
    let indentMargin = $derived(indentLevel * 20);

    function handleMouseDown(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        switch (event.button) {
            case 0: // Main button
                if (selected && (isMac ? event.metaKey : event.ctrlKey)) {
                    ondeselect?.();
                } else {
                    onselect?.();
                }
                break;
            case 2: // Secondary button
                onselect?.();
                break;
        }
    }
</script>

<div
    class="variable-overflow"
    class:selected
    class:focused
    {style}
    role="treeitem"
    tabindex="-1"
    aria-selected={selected}
    onmousedown={handleMouseDown}
>
    <div
        class="name-column"
        style="width: {nameColumnWidth}px; min-width: {nameColumnWidth}px;"
    >
        <div
            class="name-column-indenter"
            style="margin-left: {indentMargin}px;"
        >
            <div class="name-value">[...]</div>
        </div>
    </div>
    <div class="splitter"></div>
    <div
        class="details-column"
        style="width: {detailsColumnWidth -
            6}px; min-width: {detailsColumnWidth - 6}px;"
    >
        <div class="value">{valueText}</div>
    </div>
</div>

<style>
    .variable-overflow {
        display: flex;
        align-items: center;
        height: 22px;
        cursor: pointer;
        user-select: none;
    }

    .variable-overflow:hover {
        background-color: var(--vscode-list-hoverBackground);
    }

    .variable-overflow.selected {
        background-color: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
    }

    .variable-overflow.focused {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
    }

    .name-column {
        display: flex;
        align-items: center;
        padding: 0 4px;
    }

    .name-column-indenter {
        display: flex;
        align-items: center;
    }

    .name-value {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
    }

    .splitter {
        width: 1px;
        height: 100%;
        background-color: var(--vscode-panel-border);
        cursor: col-resize;
    }

    .details-column {
        display: flex;
        align-items: center;
        padding: 0 4px;
    }

    .value {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
    }
</style>
