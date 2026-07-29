<!--
  positronDataGrid.svelte - Main grid component (Svelte 5 runes mode)
  Port from Positron's positronDataGrid.tsx
-->
<script lang="ts">
    import type {
        DataGridInstance,
        ClipboardData,
    } from "./classes/dataGridInstance";
    import { setPositronDataGridContext } from "./positronDataGridContext";
    import DataGridWaffle from "./components/dataGridWaffle.svelte";

    interface Props {
        instance: DataGridInstance;
        onCopy?: (clipboardData: ClipboardData) => void;
        onFocusChange?: (focused: boolean) => void;
        gridRole?: string;
    }

    let { instance, onCopy, onFocusChange, gridRole }: Props = $props();

    // Set context - instance must be provided (DataGridInstance is abstract)
    // Use a getter to avoid capturing only the initial prop value.
    setPositronDataGridContext(() => instance);

    let containerWidth = $state(0);
    let containerHeight = $state(0);

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

    $effect(() => {
        if (containerWidth <= 0 || containerHeight <= 0) {
            return;
        }

        void instance.setSize(containerWidth, containerHeight);
    });
</script>

<div
    class="data-grid"
    bind:clientWidth={containerWidth}
    bind:clientHeight={containerHeight}
    data-grid-role={gridRole}
>
    <DataGridWaffle {onFocusChange} onCopy={handleCopy} />
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
