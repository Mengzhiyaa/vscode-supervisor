<!--
  VariableOverflow.svelte
  1:1 Positron replication - Shows "... more values" for truncated lists
-->
<script lang="ts">
    import { localize } from "$lib/localization";
    import VerticalSplitter from "./VerticalSplitter.svelte";

    interface Props {
        entryId: string;
        overflowValues: number;
        indentLevel?: number;
        nameColumnWidth?: number;
        detailsColumnWidth?: number;
        selected?: boolean;
        focused?: boolean;
        disabled?: boolean;
        style?: string;
        onselect?: () => void;
        ondeselect?: () => void;
        onBeginResizeNameColumn: () => {
            minimumWidth: number;
            maximumWidth: number;
            startingWidth: number;
        };
        onResizeNameColumn: (newNameColumnWidth: number) => void;
    }

    let {
        entryId,
        overflowValues,
        indentLevel = 0,
        nameColumnWidth = 150,
        detailsColumnWidth = 200,
        selected = false,
        focused = false,
        disabled = false,
        style = "",
        onselect,
        ondeselect,
        onBeginResizeNameColumn,
        onResizeNameColumn,
    }: Props = $props();

    // Detect platform for modifier key
    const isMac =
        typeof navigator !== "undefined" &&
        navigator.platform.toLowerCase().includes("mac");

    let valueText = $derived(
        localize(
            "variables.moreValues",
            "{0} more values",
            overflowValues.toLocaleString(),
        ),
    );
    let indentMargin = $derived(indentLevel * 20);

    function handleMouseDown(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        if (disabled) return;

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
    id={`variable-entry-${entryId}`}
    class="variable-overflow"
    class:selected
    class:focused
    class:disabled
    {style}
    role="treeitem"
    tabindex="-1"
    aria-selected={selected}
    aria-disabled={disabled}
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
            <div class="gutter"></div>
            <div class="name-value">…</div>
        </div>
    </div>
    <VerticalSplitter
        onBeginResize={onBeginResizeNameColumn}
        onResize={onResizeNameColumn}
    />
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
        box-sizing: border-box;
        min-height: 26px;
        height: 26px;
        cursor: pointer;
        user-select: none;
        border-top: 0.5px solid
            var(--vscode-positronVariables-border, var(--vscode-tree-tableColumnsBorder));
        border-bottom: 0.5px solid
            var(--vscode-positronVariables-border, var(--vscode-tree-tableColumnsBorder));
    }

    .variable-overflow:hover {
        background-color: var(
            --vscode-positronVariables-rowHoverBackground,
            var(--vscode-list-hoverBackground)
        );
    }

    .variable-overflow.selected {
        background-color: var(--vscode-list-inactiveSelectionBackground);
        color: var(--vscode-list-inactiveSelectionForeground);
    }

    .variable-overflow.focused.selected {
        background-color: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
    }

    .variable-overflow.disabled {
        cursor: default;
        opacity: 0.5;
    }

    .name-column {
        display: flex;
        align-items: center;
        overflow: hidden;
    }

    .name-column-indenter {
        display: flex;
        align-items: center;
        min-width: 0;
    }

    .gutter {
        width: 26px;
        min-width: 26px;
    }

    .name-value {
        color: var(--vscode-descriptionForeground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .details-column {
        display: flex;
        align-items: center;
        min-width: 0;
    }

    .value {
        color: var(--vscode-descriptionForeground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
