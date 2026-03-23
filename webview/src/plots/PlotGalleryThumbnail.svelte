<!--
  PlotGalleryThumbnail.svelte
  1:1 Positron replication - Wrapper component for plot thumbnails in gallery
-->
<script lang="ts">
    import type { Snippet } from "svelte";

    // Props using Svelte 5 runes
    interface Props {
        plotId: string;
        plotName?: string;
        selected?: boolean;
        onselect?: (plotId: string) => void;
        onremove?: (plotId: string) => void;
        onfocusPrevious?: (plotId: string) => void;
        onfocusNext?: (plotId: string) => void;
        children?: Snippet;
    }

    let {
        plotId,
        plotName,
        selected = false,
        onselect,
        onremove,
        onfocusPrevious,
        onfocusNext,
        children,
    }: Props = $props();

    let thumbnailButtonRef: HTMLButtonElement;
    let removeButtonRef: HTMLButtonElement;

    const removePlotTitle = "Remove plot";

    function selectPlot() {
        onselect?.(plotId);
    }

    function removePlot() {
        onremove?.(plotId);
    }

    function handleKeyDown(e: KeyboardEvent) {
        switch (e.key) {
            case "ArrowLeft":
            case "ArrowUp":
            case "k":
            case "h":
                e.preventDefault();
                onfocusPrevious?.(plotId);
                break;
            case "ArrowRight":
            case "ArrowDown":
            case "j":
            case "l":
                e.preventDefault();
                onfocusNext?.(plotId);
                break;
            case "Delete":
            case "Backspace":
            case "x":
                e.preventDefault();
                removePlot();
                break;
            case "Enter":
            case " ":
                if (e.target === removeButtonRef) {
                    removePlot();
                } else {
                    selectPlot();
                    thumbnailButtonRef?.focus();
                }
                break;
        }
    }

    // Focus this thumbnail (called from parent)
    export function focus() {
        thumbnailButtonRef?.focus();
    }
</script>

<div class="plot-thumbnail" class:selected>
    <button
        bind:this={thumbnailButtonRef}
        data-plot-id={plotId}
        class="plot-thumbnail-button"
        onclick={selectPlot}
        onkeydown={handleKeyDown}
    >
        <div class="image-wrapper">
            {#if children}
                {@render children()}
            {/if}
        </div>
        {#if plotName}
            <div class="plot-thumbnail-name" title={plotName}>
                <span class="plot-thumbnail-name-text">{plotName}</span>
            </div>
        {/if}
    </button>
    <button
        bind:this={removeButtonRef}
        class="plot-close codicon codicon-close"
        tabindex={selected ? 0 : -1}
        title={removePlotTitle}
        onclick={removePlot}
    ></button>
</div>

<style>
    /* Positron-style gallery thumbnail styling */
    .plot-thumbnail {
        display: flex;
        justify-content: center;
        align-items: center;
        position: relative;
        padding: 0;
        opacity: 0.75;
        transition: opacity 0.2s ease-in-out;
    }

    .plot-thumbnail.selected {
        opacity: 1;
        cursor: pointer;
    }

    .plot-thumbnail:hover {
        opacity: 1;
        transition: opacity 0.2s ease-in-out;
    }

    .plot-thumbnail-button {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 4px;
        border: 1px solid transparent;
        background: none;
        cursor: pointer;
        height: 100%;
        width: 100%;
        box-sizing: border-box;
        overflow: hidden;
    }

    .image-wrapper {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 0;
        overflow: hidden;
    }

    .plot-thumbnail .image-wrapper :global(img) {
        max-width: 100%;
        max-height: 64px;
        border-radius: 3px;
        border: 1px dotted var(--vscode-editorWidget-border);
    }

    .plot-thumbnail-button:not(:has(.plot-thumbnail-name)) .image-wrapper :global(img) {
        max-height: 82px;
    }

    .plot-thumbnail.selected .image-wrapper {
        border: none;
    }

    .plot-thumbnail-name {
        padding: 1px 4px;
        background-color: var(--vscode-list-inactiveSelectionBackground);
        color: var(--vscode-list-inactiveSelectionForeground);
        border: 1px solid var(--vscode-editorWidget-border);
        border-radius: 3px;
        font-size: 9px;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        z-index: 1;
        flex-shrink: 0;
        margin-top: 2px;
    }

    .plot-thumbnail.selected .plot-thumbnail-name {
        background-color: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
        border-color: var(--vscode-focusBorder);
    }

    .plot-thumbnail-name-text {
        display: block;
        max-width: 72px;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .plot-close {
        position: absolute;
        top: 3px;
        right: 3px;
        padding: 2px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid;
        border-radius: 3px;
        color: var(--vscode-button-foreground);
        background-color: var(--vscode-button-background);
        border-color: var(--vscode-button-border, transparent);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s ease-in-out;
        font-size: 12px;
    }

    .plot-thumbnail:hover .plot-close {
        opacity: 0.75;
        transition: opacity 0.2s ease-in-out;
    }

    .plot-close:hover {
        opacity: 1 !important;
    }

    .plot-close:focus {
        outline: 1px solid var(--vscode-focusBorder);
        opacity: 1;
    }
</style>
