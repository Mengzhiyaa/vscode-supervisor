<!--
  DataGrid.svelte - Main grid component (Svelte 5 runes mode)
  Port from Positron's positronDataGrid.tsx
-->
<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { DataGridInstance, ClipboardData } from "./dataGridInstance";
    import { setDataGridContext } from "./context";
    import DataGridWaffle from "./components/DataGridWaffle.svelte";

    interface Props {
        instance: DataGridInstance;
        onCopy?: (clipboardData: ClipboardData) => void;
        onFocusChange?: (focused: boolean) => void;
        gridRole?: string;
    }

    let { instance, onCopy, onFocusChange, gridRole }: Props = $props();

    // Set context - instance must be provided (DataGridInstance is abstract)
    // Use a getter to avoid capturing only the initial prop value.
    setDataGridContext(() => instance);

    // Container reference
    let containerRef: HTMLDivElement;

    // Track resize
    let resizeObserver: ResizeObserver | undefined;

    // Handle clipboard copy (triggered from context menu or keyboard)
    function handleCopy() {
        const clipboardData = instance.getClipboardData();
        if (!clipboardData) {
            return;
        }

        if (onCopy) {
            onCopy(clipboardData);
            return;
        }

        const copyCapableInstance = instance as {
            copyClipboardData?: (data: ClipboardData) => void;
        };
        copyCapableInstance.copyClipboardData?.(clipboardData);
    }

    // Handle keyboard events
    function handleKeyDown(event: KeyboardEvent) {
        // Handle Ctrl+C / Cmd+C for copy
        if ((event.ctrlKey || event.metaKey) && event.key === "c") {
            event.preventDefault();
            handleCopy();
        }
    }

    onMount(() => {
        // Set up resize observer
        resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                instance.setSize(
                    entry.contentRect.width,
                    entry.contentRect.height,
                );
            }
        });
        resizeObserver.observe(containerRef);

        // Initial size
        instance.setSize(containerRef.clientWidth, containerRef.clientHeight);
    });

    onDestroy(() => {
        resizeObserver?.disconnect();
    });
</script>

<div
    class="data-grid"
    bind:this={containerRef}
    data-grid-role={gridRole}
    onkeydown={handleKeyDown}
    tabindex="0"
    role="grid"
>
    <DataGridWaffle {onFocusChange} />
</div>

<style>
    .data-grid {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: var(--vscode-editor-font-size, 13px);
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        outline: none;
    }

    .data-grid:focus {
        outline: none !important;
    }

    .data-grid:focus-visible {
        outline: none !important;
    }
</style>
