<!--
  VariablesEmpty.svelte
  1:1 Positron replication - Empty state for variables panel
-->
<script lang="ts">
    // Props using Svelte 5 runes
    interface Props {
        initializing?: boolean;
        hasFilter?: boolean;
        message?: string;
    }

    let { initializing = false, hasFilter = false, message }: Props = $props();

    // Localized strings (matching Positron)
    const noVariablesTitle = "No variables have been created.";
    const noMatchingTitle = "No variables match the current filter.";

    // Use custom message if provided, otherwise use default based on filter state
    let displayMessage = $derived(
        message ?? (hasFilter ? noMatchingTitle : noVariablesTitle),
    );
</script>

<div class="variables-empty">
    {#if initializing}
        <div class="title">...</div>
    {:else}
        <div class="title">
            {displayMessage}
        </div>
    {/if}
</div>

<style>
    .variables-empty {
        display: flex;
        align-items: flex-start;
        padding: 22px 20px 20px;
        height: 100%;
    }

    .title {
        font-size: 13px;
        color: var(--vscode-descriptionForeground);
    }
</style>
