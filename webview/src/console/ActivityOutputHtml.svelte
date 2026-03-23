<!--
    ActivityOutputHtml.svelte
    
    Renders HTML output from a language runtime.
    Mirrors: positron/.../components/activityOutputHtml.tsx
-->
<script lang="ts">
    import type { ActivityItemOutputHtml } from "./classes";

    interface Props {
        activityItemOutputHtml: ActivityItemOutputHtml;
    }

    let { activityItemOutputHtml }: Props = $props();
</script>

<div class="activity-output-html">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html activityItemOutputHtml.html}
</div>

<style>
    .activity-output-html {
        padding: 4px 0;
        overflow-x: auto;
    }

    .activity-output-html :global(table) {
        border-collapse: collapse;
        font-size: var(--console-content-font-size);
        font-family: var(--console-content-font-family);
    }

    .activity-output-html :global(th),
    .activity-output-html :global(td) {
        padding: 4px 8px;
        border: 1px solid var(--vscode-panel-border);
    }

    .activity-output-html :global(th) {
        background: var(--vscode-sideBarSectionHeader-background);
        font-weight: 600;
    }

    .activity-output-html :global(tr:nth-child(even)) {
        background: var(--vscode-list-hoverBackground);
    }

    .activity-output-html :global(a) {
        color: var(--vscode-textLink-foreground);
    }

    .activity-output-html :global(a:hover) {
        color: var(--vscode-textLink-activeForeground);
    }
</style>
