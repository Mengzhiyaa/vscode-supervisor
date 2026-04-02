<!--
  statsValue.svelte - Statistical value renderer
  Port from Positron's statsValue.tsx
-->
<script lang="ts">
    import { localize } from "../nls";

    interface Props {
        stats?: unknown;
        value?: number | string;
    }

    let { stats, value }: Props = $props();

    const naLabel = localize("positronNA", "N/A");
</script>

{#if stats === undefined}
    <div class="value-placeholder">\u22ef</div>
{:else}
    <div class="value">{value ?? naLabel}</div>
{/if}
