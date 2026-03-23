<!--
  RuntimeStatus.svelte
  1:1 Positron replication - Runtime status icon with color coding
-->
<script lang="ts">
    import type { RuntimeStatusType } from "../types/console";
    import {
        runtimeStatusToIcon,
        runtimeStatusToColor,
    } from "../types/console";

    // Props using Svelte 5 runes
    interface Props {
        status?: RuntimeStatusType;
    }

    let { status = "Idle" }: Props = $props();

    let iconClass = $derived(runtimeStatusToIcon[status]);
    let iconColor = $derived(runtimeStatusToColor[status]);
    let shouldAnimate = $derived(status === "Active");
</script>

<span
    class="runtime-status-icon codicon {iconClass}"
    class:animate-spin={shouldAnimate}
    style="color: {iconColor}"
></span>

<style>
    .runtime-status-icon {
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .animate-spin {
        animation: runtime-spin 1.5s linear infinite;
    }

    @keyframes runtime-spin {
        100% {
            transform: rotate(360deg);
        }
    }
</style>
