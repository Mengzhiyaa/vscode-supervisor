<!--
    RuntimeStarted.svelte
    
    Displays "R x.x.x started" message.
    Mirrors: positron/.../components/runtimeStarted.tsx
-->
<script lang="ts">
    import type { RuntimeItemStarted } from "./classes";
    import ConsoleOutputLines from "./ConsoleOutputLines.svelte";

    interface RuntimeStartedProps {
        runtimeItemStarted: RuntimeItemStarted;
    }

    let { runtimeItemStarted }: RuntimeStartedProps = $props();
</script>

<ConsoleOutputLines outputLines={runtimeItemStarted.outputLines} />

<style>
    /* RuntimeStarted uses ConsoleOutputLines styling */
</style>
