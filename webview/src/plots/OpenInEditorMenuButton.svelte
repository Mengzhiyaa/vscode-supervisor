<!--
  OpenInEditorMenuButton.svelte
  1:1 Positron replication - Menu button to open plot in editor
-->
<script lang="ts">
    import ContextMenu from "../shared/ContextMenu.svelte";
    import type { EditorTarget } from "./types";

    // Props using Svelte 5 runes
    interface Props {
        defaultTarget?: EditorTarget;
        tooltip?: string;
        ariaLabel?: string;
        onopenInEditor?: (target: EditorTarget) => void;
    }

    let {
        defaultTarget = "newWindow",
        tooltip = "Open in editor",
        ariaLabel = "Open in editor",
        onopenInEditor,
    }: Props = $props();

    // Labels matching Positron
    const targetLabels: Record<EditorTarget, string> = {
        newWindow: "Open in new window",
        activeGroup: "Open in editor tab",
        sideGroup: "Open in editor tab to the Side",
    };

    const targets: EditorTarget[] = ["newWindow", "activeGroup", "sideGroup"];

    let menuOpen = $state(false);
    let dropdownButtonElement = $state<HTMLButtonElement | null>(null);
    // svelte-ignore state_referenced_locally
    let currentDefault = $state<EditorTarget>(defaultTarget);

    // Sync currentDefault when defaultTarget prop changes
    $effect(() => {
        currentDefault = defaultTarget;
    });

    function toggleMenu() {
        menuOpen = !menuOpen;
    }

    function handleDefaultAction() {
        onopenInEditor?.(currentDefault);
    }

    function selectTarget(target: EditorTarget) {
        currentDefault = target;
        onopenInEditor?.(target);
        menuOpen = false;
    }
</script>

<div class="open-in-editor-menu">
    <div class="split-button">
        <button
            type="button"
            class="main-button"
            title={tooltip}
            aria-label={ariaLabel}
            onclick={handleDefaultAction}
        >
            <span class="codicon codicon-go-to-file"></span>
        </button>
        <button
            bind:this={dropdownButtonElement}
            type="button"
            class="dropdown-button"
            title="Select where to open plot"
            aria-haspopup="menu"
            aria-expanded={menuOpen ? "true" : "false"}
            onclick={(e) => {
                e.stopPropagation();
                toggleMenu();
            }}
        >
            <span class="codicon codicon-chevron-down"></span>
        </button>
    </div>

    {#if menuOpen && dropdownButtonElement}
        <ContextMenu
            entries={targets.map((target) => ({
                id: target,
                label: targetLabels[target],
                checked: currentDefault === target,
                onSelected: () => {
                    selectTarget(target);
                },
            }))}
            anchorEl={dropdownButtonElement}
            align="right"
            onclose={() => {
                menuOpen = false;
            }}
        />
    {/if}
</div>

<style>
    .open-in-editor-menu {
        position: relative;
    }

    .split-button {
        display: flex;
        align-items: center;
        margin: 0 1px;
        border-radius: 4px;
    }

    .main-button {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 24px;
        min-width: 0;
        padding: 0;
        margin: 0;
        border: none;
        background: transparent;
        color: var(--vscode-foreground);
        cursor: pointer;
        border-radius: 4px;
    }

    .dropdown-button {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 24px;
        width: 10px;
        min-width: 10px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--vscode-foreground);
        cursor: pointer;
        border-radius: 4px;
    }

    .main-button:hover,
    .dropdown-button:hover {
        background-color: var(--vscode-toolbar-hoverBackground);
    }

    .codicon {
        font-size: 14px;
        padding: 0 1px;
    }

    .dropdown-button .codicon-chevron-down {
        padding: 0;
        font-size: 12px;
    }
</style>
