<!--
  RuntimeIcon.svelte
  1:1 Positron replication - Displays runtime icon based on session mode
-->
<script lang="ts">
    import type { SessionMode } from "../types/console";

    // Props using Svelte 5 runes
    interface Props {
        base64EncodedIconSvg?: string;
        sessionMode?: SessionMode;
    }

    let { base64EncodedIconSvg, sessionMode = "console" }: Props = $props();

    let isNotebook = $derived(sessionMode === "notebook");
</script>

{#if isNotebook}
    <span class="icon codicon codicon-notebook"></span>
{:else if base64EncodedIconSvg}
    <img
        class="icon"
        src="data:image/svg+xml;base64,{base64EncodedIconSvg}"
        alt="Runtime icon"
    />
{/if}

<style>
    .icon {
        width: 15px;
        height: 15px;
        margin: 0 6px;
        flex-shrink: 0;
    }

    .codicon-notebook {
        font-size: 15px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
</style>
