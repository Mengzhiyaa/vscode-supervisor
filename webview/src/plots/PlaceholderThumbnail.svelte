<!--
  PlaceholderThumbnail.svelte
  1:1 Positron replication - Placeholder for plot thumbnail while loading
-->
<script lang="ts">
    // No props needed - this is a simple placeholder component
</script>

<div class="plot-thumbnail-placeholder">
    <span class="codicon codicon-graph"></span>
</div>

<style>
    .plot-thumbnail-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        background-color: var(--vscode-editor-background);
        border-radius: 4px;
    }

    .codicon-graph {
        font-size: 24px;
        color: var(--vscode-descriptionForeground);
        opacity: 0.5;
    }
</style>
