<!--
  VariableGroup.svelte
  1:1 Positron replication - Expandable/collapsible variable group
-->
<script lang="ts">
    // Props using Svelte 5 runes
    interface Props {
        groupId: string;
        title: string;
        expanded?: boolean;
        selected?: boolean;
        focused?: boolean;
        style?: string;
        onselect?: () => void;
        ondeselect?: () => void;
        ontoggleExpand?: () => void;
        oncontextMenu?: (data: { x: number; y: number }) => void;
    }

    let {
        groupId,
        title,
        expanded = true,
        selected = false,
        focused = false,
        style = "",
        onselect,
        ondeselect,
        ontoggleExpand,
        oncontextMenu,
    }: Props = $props();

    // Detect platform for modifier key
    const isMac =
        typeof navigator !== "undefined" &&
        navigator.platform.toLowerCase().includes("mac");

    function handleMouseDown(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        switch (event.button) {
            case 0: // Main button
                if (selected && (isMac ? event.metaKey : event.ctrlKey)) {
                    ondeselect?.();
                } else {
                    onselect?.();
                    if (isMac && event.ctrlKey) {
                        oncontextMenu?.({ x: event.clientX, y: event.clientY });
                    }
                }
                break;
            case 2: // Secondary button
                onselect?.();
                oncontextMenu?.({ x: event.clientX, y: event.clientY });
                break;
        }
    }

    function handleChevronMouseDown(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
    }

    function handleChevronMouseUp(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        ontoggleExpand?.();
    }
</script>

<div
    class="variable-group"
    class:selected
    class:focused
    {style}
    data-group-id={groupId}
    role="treeitem"
    tabindex="-1"
    aria-expanded={expanded}
    aria-selected={selected}
    onmousedown={handleMouseDown}
>
    <div
        class="expand-collapse-area"
        role="button"
        tabindex="-1"
        onmousedown={handleChevronMouseDown}
        onmouseup={handleChevronMouseUp}
    >
        <div
            class="expand-collapse-icon codicon"
            class:codicon-chevron-down={expanded}
            class:codicon-chevron-right={!expanded}
        ></div>
    </div>
    <div class="title">{title}</div>
</div>

<style>
    /* Variable Group - Matching Positron variableGroup.css exactly */
    .variable-group {
        display: flex;
        border: none;
        font-size: 11px;
        cursor: pointer;
        padding-right: 8px;
        align-items: center;
        box-sizing: border-box;
        text-transform: uppercase;
        background: var(
            --vscode-positronVariables-headerBackground,
            var(--vscode-sideBarSectionHeader-background)
        );
        border-top: 0.5px solid
            var(--vscode-positronVariables-border, var(--vscode-panel-border));
        border-bottom: 0.5px solid
            var(--vscode-positronVariables-border, var(--vscode-panel-border));
        user-select: none;
        -webkit-user-select: none;
    }

    .variable-group:hover {
        background: var(
            --vscode-positronVariables-rowHoverBackground,
            var(--vscode-list-hoverBackground)
        );
    }

    .variable-group.selected {
        color: var(
            --vscode-positronVariables-inactiveSelectionForeground,
            var(--vscode-list-inactiveSelectionForeground)
        );
        background: var(
            --vscode-positronVariables-inactiveSelectionBackground,
            var(--vscode-list-inactiveSelectionBackground)
        );
    }

    .variable-group.focused.selected {
        color: var(
            --vscode-positronVariables-activeSelectionForeground,
            var(--vscode-list-activeSelectionForeground)
        );
        background: var(
            --vscode-positronVariables-activeSelectionBackground,
            var(--vscode-list-activeSelectionBackground)
        );
    }

    .expand-collapse-area {
        width: 26px;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .expand-collapse-icon {
        font-size: 16px;
    }

    .variable-group.focused.selected .expand-collapse-icon {
        color: var(
            --vscode-positronVariables-activeSelectionForeground,
            var(--vscode-list-activeSelectionForeground)
        );
    }

    .title {
        font-weight: 700;
    }
</style>
