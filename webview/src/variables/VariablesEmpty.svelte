<!--
  VariablesEmpty.svelte
  1:1 Positron replication - Empty state for variables panel
-->
<script lang="ts">
    import { localize } from "$lib/localization";
    // Props using Svelte 5 runes
    interface Props {
        initializing?: boolean;
        hasFilter?: boolean;
        message?: string;
    }

    let { initializing = false, hasFilter = false, message }: Props = $props();

    // Localized strings (matching Positron)
    const noVariablesTitle = localize("variables.noVariables", "No variables have been created.");
    const noMatchingTitle = localize("variables.noMatches", "No variables match the current filter.");

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
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 20px;
    }

    .title {
        font-size: 13px;
        color: var(--vscode-descriptionForeground);
        text-align: center;
    }
</style>
