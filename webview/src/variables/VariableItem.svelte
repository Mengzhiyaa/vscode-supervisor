<script lang="ts">
    import VerticalSplitter from "./VerticalSplitter.svelte";

    interface Props {
        id: string;
        indentLevel: number;
        displayName: string;
        displayValue: string;
        hasChildren: boolean;
        hasViewer?: boolean;
        isExpanded?: boolean;
        kind?: string;
        nameColumnWidth: number;
        detailsColumnWidth: number;
        rightColumnVisible: boolean;
        selected?: boolean;
        focused?: boolean;
        recent?: boolean;
        viewerLoading?: boolean;
        rightText?: string;
        onselect?: (id: string) => void;
        ondeselect?: () => void;
        ontoggleExpand?: (id: string) => void;
        onview?: (id: string) => void;
        oncontextMenu?: (id: string, x: number, y: number) => void;
        onBeginResizeNameColumn: () => {
            minimumWidth: number;
            maximumWidth: number;
            startingWidth: number;
        };
        onResizeNameColumn: (newNameColumnWidth: number) => void;
    }

    let {
        id,
        indentLevel,
        displayName,
        displayValue,
        hasChildren,
        hasViewer = false,
        isExpanded = false,
        kind,
        nameColumnWidth,
        detailsColumnWidth,
        rightColumnVisible,
        selected = false,
        focused = false,
        recent = false,
        viewerLoading = false,
        rightText = "",
        onselect,
        ondeselect,
        ontoggleExpand,
        onview,
        oncontextMenu,
        onBeginResizeNameColumn,
        onResizeNameColumn,
    }: Props = $props();

    const isMac =
        typeof navigator !== "undefined" &&
        navigator.platform.toLowerCase().includes("mac");

    const indentMargin = $derived(indentLevel * 20);

    function handleMouseDown(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        switch (event.button) {
            case 0:
                if (selected && (isMac ? event.metaKey : event.ctrlKey)) {
                    ondeselect?.();
                } else {
                    onselect?.(id);
                    if (isMac && event.ctrlKey) {
                        oncontextMenu?.(id, event.clientX, event.clientY);
                    }
                }
                break;
            case 2:
                onselect?.(id);
                oncontextMenu?.(id, event.clientX, event.clientY);
                break;
        }
    }

    function handleDoubleClick(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        if (hasViewer) {
            onview?.(id);
        }
    }

    function handleToggle(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        if (hasChildren) {
            ontoggleExpand?.(id);
        }
    }
</script>

<div
    class="variable-item"
    class:selected
    class:focused
    class:recent
    role="button"
    tabindex="0"
    onmousedown={handleMouseDown}
    ondblclick={handleDoubleClick}
    onkeydown={(e) => e.key === "Enter" && onselect?.(id)}
>
    <div
        class="name-column"
        style="width: {nameColumnWidth}px; min-width: {nameColumnWidth}px;"
    >
        <div class="name-column-indenter" style="margin-left: {indentMargin}px;">
            <div class="gutter">
                <button
                    class="expand-collapse-area"
                    onclick={handleToggle}
                    disabled={!hasChildren}
                >
                    {#if hasChildren}
                        <span
                            class="expand-collapse-icon codicon codicon-chevron-{isExpanded
                                ? 'down'
                                : 'right'}"
                        ></span>
                    {/if}
                </button>
            </div>
            <div class="name-value">{displayName}</div>
        </div>
    </div>

    <VerticalSplitter
        onBeginResize={onBeginResizeNameColumn}
        onResize={onResizeNameColumn}
    />

    <div
        class="details-column"
        style="width: {detailsColumnWidth - 6}px; min-width: {detailsColumnWidth -
            6}px;"
    >
        <div class="value" title={displayValue}>{displayValue}</div>
        {#if hasViewer}
            <div class="right-column">
                <button
                    class="viewer-icon"
                    class:enabled={!viewerLoading}
                    class:disabled={viewerLoading}
                    title={viewerLoading
                        ? "Loading..."
                        : kind === "table"
                          ? "View Data Table"
                          : kind === "connection"
                            ? "View Connection"
                            : "View"}
                    disabled={viewerLoading}
                    onclick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onview?.(id);
                    }}
                >
                    <span
                        class="codicon codicon-{viewerLoading
                            ? 'loading spin'
                            : kind === 'table'
                              ? 'table'
                              : kind === 'connection'
                                ? 'database'
                                : 'open-preview'}"
                    ></span>
                </button>
            </div>
        {:else if rightColumnVisible}
            <div class="right-column">
                {rightText}
            </div>
        {/if}
    </div>
</div>

<style>
    .variable-item {
        display: flex;
        cursor: pointer;
        box-sizing: border-box;
        border-top: 0.5px solid
            var(--vscode-positronVariables-border, var(--vscode-panel-border));
        border-bottom: 0.5px solid
            var(--vscode-positronVariables-border, var(--vscode-panel-border));
        min-height: 26px;
    }

    .variable-item:hover {
        background: var(
            --vscode-positronVariables-rowHoverBackground,
            var(--vscode-list-hoverBackground)
        );
    }

    .variable-item.selected {
        color: var(
            --vscode-positronVariables-inactiveSelectionForeground,
            var(--vscode-list-inactiveSelectionForeground)
        );
        background: var(
            --vscode-positronVariables-inactiveSelectionBackground,
            var(--vscode-list-inactiveSelectionBackground)
        );
    }

    .variable-item.focused.selected {
        color: var(
            --vscode-positronVariables-activeSelectionForeground,
            var(--vscode-list-activeSelectionForeground)
        );
        background: var(
            --vscode-positronVariables-activeSelectionBackground,
            var(--vscode-list-activeSelectionBackground)
        );
    }

    .variable-item.recent {
        animation: positronVariableItem-pulseUpdate 2s;
    }

    .variable-item.recent.selected {
        animation: positronVariableItem-pulseUpdateSelected 2s;
    }

    @keyframes positronVariableItem-pulseUpdate {
        0% {
            background-color: var(
                --vscode-positronVariables-activeSelectionBackground,
                var(--vscode-list-activeSelectionBackground)
            );
        }

        100% {
            background-color: transparent;
        }
    }

    @keyframes positronVariableItem-pulseUpdateSelected {
        0% {
            background-color: var(
                --vscode-positronVariables-activeSelectionBackground,
                var(--vscode-list-activeSelectionBackground)
            );
        }

        100% {
            background-color: var(
                --vscode-positronVariables-inactiveSelectionBackground,
                var(--vscode-list-inactiveSelectionBackground)
            );
        }
    }

    .name-column {
        display: flex;
        flex-shrink: 0;
        overflow: hidden;
        align-items: center;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .name-column-indenter {
        display: flex;
    }

    .gutter {
        display: flex;
        align-items: center;
    }

    .expand-collapse-area {
        width: 26px;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: inherit;
        padding: 0;
    }

    .name-value {
        display: flex;
        align-items: center;
    }

    .details-column {
        display: flex;
        align-items: center;
    }

    .value {
        flex-grow: 1;
        flex-shrink: 1;
        overflow: hidden;
        white-space: nowrap;
        margin: 0 10px 0 8px;
        text-overflow: ellipsis;
    }

    .right-column {
        opacity: 0.75;
        flex: 0 0 auto;
        margin: 0 10px 0 0;
    }

    .viewer-icon {
        display: flex;
        cursor: pointer;
        transition: background-color 0.2s ease, border-color 0.2s ease;
        border-radius: 4px;
        padding: 4px;
        border: 1px solid transparent;
        background-color: transparent;
        color: inherit;
    }

    .viewer-icon.enabled:hover {
        border: 1px solid var(--vscode-button-foreground, #ffffff);
        background-color: var(--vscode-button-background, #b7c7d1);
    }

    .viewer-icon.disabled {
        cursor: auto;
        opacity: 0.6;
    }
</style>
