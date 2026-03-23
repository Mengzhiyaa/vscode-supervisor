<!--
    HistoryBrowserPopup.svelte
    
    Popup displaying scrollable list of history items.
    Mirrors: positron/.../components/historyBrowserPopup.tsx
-->
<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { HistoryMatch } from "./history";
    import HistoryCompletionItem from "./HistoryCompletionItem.svelte";

    interface Props {
        /** The list of history items to display */
        items: HistoryMatch[];
        /** The index of the selected item */
        selectedIndex: number;
        /** The bottom position of the popup in pixels */
        bottomPx: number;
        /** The left position of the popup in pixels */
        leftPx: number;
        /** Callback when user selects an item with mouse */
        onSelected: (index: number) => void;
        /** Callback when the popup is dismissed */
        onDismissed: () => void;
    }

    let {
        items,
        selectedIndex,
        bottomPx,
        leftPx,
        onSelected,
        onDismissed,
    }: Props = $props();

    let popupRef: HTMLDivElement;

    // Scroll selected item into view when selection changes
    $effect(() => {
        if (popupRef) {
            const selectedChild = popupRef.querySelector(".selected");
            if (selectedChild) {
                selectedChild.scrollIntoView({ block: "nearest" });
            }
        }
    });

    // Click handler to dismiss popup when clicking outside
    function handleWindowClick(ev: MouseEvent) {
        const target = ev.target as HTMLElement;
        if (popupRef && !popupRef.contains(target)) {
            onDismissed();
        }
    }

    onMount(() => {
        window.addEventListener("click", handleWindowClick);
    });

    onDestroy(() => {
        window.removeEventListener("click", handleWindowClick);
    });

    const noMatchMessage = "No matching history items";
</script>

<div
    bind:this={popupRef}
    class="history-browser-popup suggest-widget"
    style:bottom="{bottomPx}px"
    style:left="{leftPx}px"
    role="listbox"
    aria-label="History browser"
>
    {#if items.length === 0}
        <div class="no-results">{noMatchMessage}</div>
    {:else}
        <ul>
            {#each items as item, index (item.input)}
                <HistoryCompletionItem
                    match={item}
                    selected={selectedIndex === index}
                    onSelected={() => onSelected(index)}
                />
            {/each}
        </ul>
    {/if}
</div>

<style>
    .history-browser-popup {
        position: absolute;
        z-index: 1000;
        background: var(--vscode-editorSuggestWidget-background);
        border: 1px solid var(--vscode-editorSuggestWidget-border);
        border-radius: 3px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.36);
        max-height: 300px;
        min-width: 200px;
        max-width: 600px;
        overflow-y: auto;
    }

    .no-results {
        padding: 8px 12px;
        color: var(--vscode-editorSuggestWidget-foreground);
        font-style: italic;
        opacity: 0.8;
    }

    ul {
        list-style: none;
        margin: 0;
        padding: 4px 0;
    }
</style>
