<!--
    RuntimeStartupFailure.svelte

    Displays startup failure message with details.
    Mirrors: positron/.../components/runtimeStartupFailure.tsx
-->
<script lang="ts">
    import ConsoleOutputLines from "./ConsoleOutputLines.svelte";
    import type { RuntimeItemStartupFailure } from "./classes";

    interface Props {
        runtimeItemStartupFailure: RuntimeItemStartupFailure;
    }

    let { runtimeItemStartupFailure }: Props = $props();
</script>

<div class="runtime-startup-failure">
    <div class="message">{runtimeItemStartupFailure.message}</div>
    <ConsoleOutputLines outputLines={runtimeItemStartupFailure.outputLines} />
</div>

<style>
    .runtime-startup-failure {
        color: red;
        padding-top: 1em;
        padding-bottom: 1em;
    }

    .message {
        font-weight: bold;
    }
</style>
