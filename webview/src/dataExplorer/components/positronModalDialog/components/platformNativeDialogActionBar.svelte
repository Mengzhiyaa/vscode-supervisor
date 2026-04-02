<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        primaryButton?: Snippet;
        secondaryButton?: Snippet;
    }

    let { primaryButton, secondaryButton }: Props = $props();

    const isWindows =
        typeof navigator !== "undefined" &&
        navigator.platform.toLowerCase().includes("win");
</script>

{#if isWindows}
    {#if primaryButton}
        {@render primaryButton()}
    {/if}
    {#if secondaryButton}
        {@render secondaryButton()}
    {/if}
{:else}
    {#if secondaryButton}
        {@render secondaryButton()}
    {/if}
    {#if primaryButton}
        {@render primaryButton()}
    {/if}
{/if}
