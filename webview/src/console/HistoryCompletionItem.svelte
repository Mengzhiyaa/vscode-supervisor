<!--
    HistoryCompletionItem.svelte
    
    Individual history item in the history browser popup.
    Mirrors: positron/.../components/historyCompletionItem.tsx
-->
<script lang="ts">
    import type { HistoryMatch } from "./history";

    interface Props {
        match: HistoryMatch;
        selected: boolean;
        onSelected: () => void;
    }

    let { match, selected, onSelected }: Props = $props();

    /**
     * Renders the input text with the matched portion highlighted.
     */
    function getHighlightedParts(): {
        before: string;
        highlight: string;
        after: string;
    } {
        const { input, highlightStart, highlightEnd } = match;
        return {
            before: input.substring(0, highlightStart),
            highlight: input.substring(highlightStart, highlightEnd),
            after: input.substring(highlightEnd),
        };
    }

    const parts = $derived(getHighlightedParts());
</script>

<li
    class="history-completion-item"
    class:selected
    onclick={onSelected}
    onkeydown={(e) => e.key === "Enter" && onSelected()}
    role="option"
    aria-selected={selected}
    tabindex="-1"
>
    <span class="history-item-text">
        <span class="text-before">{parts.before}</span>
        <span class="text-highlight">{parts.highlight}</span>
        <span class="text-after">{parts.after}</span>
    </span>
</li>

<style>
    .history-completion-item {
        display: flex;
        align-items: center;
        padding: 4px 8px;
        cursor: pointer;
        white-space: pre;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: var(--console-content-font-family);
        font-size: var(--console-content-font-size);
    }

    .history-completion-item:hover {
        background: var(--vscode-list-hoverBackground);
    }

    .history-completion-item.selected {
        background: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
    }

    .history-item-text {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .text-highlight {
        font-weight: bold;
        color: var(
            --vscode-editorLightBulb-foreground,
            var(--vscode-editor-foreground)
        );
    }

    .history-completion-item.selected .text-highlight {
        color: var(--vscode-list-activeSelectionForeground);
    }
</style>
