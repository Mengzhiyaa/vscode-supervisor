<!--
    CurrentWorkingDirectory.svelte
    
    Displays the current working directory with folder icon.
    Mirrors: positron/.../components/currentWorkingDirectory.tsx
-->
<script lang="ts">
    import { onDestroy } from "svelte";
    import ContextMenu, {
        type ContextMenuEntry,
    } from "../shared/ContextMenu.svelte";

    interface CurrentWorkingDirectoryProps {
        readonly directoryLabel: string;
    }

    let { directoryLabel }: CurrentWorkingDirectoryProps = $props();

    // Localized strings
    const positronCurrentWorkingDirectory = "Current Working Directory";
    const positronCopy = "Copy";
    const positronDoubleClickToCopyPath = "Double-click to copy path";
    const positronPathCopied = "Path copied";

    let copied = $state(false);
    let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
    let containerEl = $state<HTMLDivElement | null>(null);
    let showContextMenu = $state(false);
    let contextMenuX = $state(0);
    let contextMenuY = $state(0);

    const tooltip = $derived(
        directoryLabel
            ? `${directoryLabel}\n${
                  copied ? positronPathCopied : positronDoubleClickToCopyPath
              }`
            : "",
    );
    const contextMenuEntries = $derived.by(
        (): ContextMenuEntry[] => [
            {
                label: positronCopy,
                icon: "copy",
                disabled: !directoryLabel,
                onSelected: () => {
                    void copyDirectoryLabel();
                },
            },
        ],
    );

    function resetCopiedState() {
        if (copyResetTimer) {
            clearTimeout(copyResetTimer);
        }

        copyResetTimer = setTimeout(() => {
            copied = false;
        }, 1500);
    }

    async function handleDoubleClick(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        showContextMenu = false;

        await copyDirectoryLabel();
    }

    async function handleKeyDown(event: KeyboardEvent) {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        showContextMenu = false;

        await copyDirectoryLabel();
    }

    function handleMouseDown(event: MouseEvent) {
        event.stopPropagation();

        if (event.button !== 2) {
            showContextMenu = false;
            return;
        }

        event.preventDefault();
        contextMenuX = event.clientX;
        contextMenuY = event.clientY;
        showContextMenu = true;
    }

    async function copyDirectoryLabel() {
        if (!directoryLabel) {
            return;
        }

        try {
            await navigator.clipboard.writeText(directoryLabel);
            copied = true;
            window.getSelection()?.removeAllRanges();
            resetCopiedState();
        } catch (error) {
            copied = false;
            console.error("Failed to copy working directory path:", error);
        }
    }

    onDestroy(() => {
        if (copyResetTimer) {
            clearTimeout(copyResetTimer);
        }
    });
</script>

<div
    bind:this={containerEl}
    class="current-working-directory-label"
    aria-label={positronCurrentWorkingDirectory}
    role="button"
    tabindex="0"
    title={tooltip}
    onmousedown={handleMouseDown}
    oncontextmenu={(event) => event.preventDefault()}
    ondblclick={handleDoubleClick}
    onkeydown={handleKeyDown}
>
    <span class="codicon codicon-folder" role="presentation"></span>
    <span class="label">{directoryLabel}</span>
</div>

{#if showContextMenu && containerEl}
    <ContextMenu
        entries={contextMenuEntries}
        anchorEl={containerEl}
        anchorPoint={{ x: contextMenuX, y: contextMenuY }}
        onclose={() => {
            showContextMenu = false;
        }}
    />
{/if}

<style>
    /* Positron currentWorkingDirectory.css pattern */
    .current-working-directory-label {
        display: flex;
        font-size: 12px;
        overflow: hidden;
        align-items: center;
        white-space: nowrap;
        color: var(
            --vscode-positronActionBar-foreground,
            var(--vscode-foreground)
        );
        cursor: default;
    }

    .current-working-directory-label:focus {
        outline: none;
    }

    .current-working-directory-label:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
        border-radius: 3px;
    }

    .current-working-directory-label .codicon {
        padding-top: 1px;
        flex-shrink: 0;
        color: inherit;
    }

    .label {
        overflow: hidden;
        padding-left: 5px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
