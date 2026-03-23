<!--
  ConsoleInstanceState.svelte
  1:1 Positron replication - Maps console state to runtime status icon
-->
<script lang="ts">
    import RuntimeStatus from "./RuntimeStatus.svelte";
    import type { ConsoleState } from "../types/console";
    import { consoleStateToRuntimeStatus } from "../types/console";

    // Props using Svelte 5 runes
    interface Props {
        state?: ConsoleState;
    }

    let { state = "ready" }: Props = $props();

    let runtimeStatus = $derived(consoleStateToRuntimeStatus[state]);
</script>

<RuntimeStatus status={runtimeStatus} />
