<!--
    RuntimeStartup.svelte
    
    Displays runtime startup message (copyright, etc.).
    Mirrors: positron/.../components/runtimeStartup.tsx
-->
<script lang="ts">
    import type { RuntimeItemStartup } from "./classes";
    import ConsoleOutputLines from "./ConsoleOutputLines.svelte";

    interface RuntimeStartupProps {
        runtimeItemStartup: RuntimeItemStartup;
    }

    let { runtimeItemStartup }: RuntimeStartupProps = $props();
</script>

<div class="runtime-startup">
    <ConsoleOutputLines outputLines={runtimeItemStartup.outputLines} />
</div>

<style>
    /* Positron runtimeStartup.css pattern */
    .runtime-startup {
        color: var(--vscode-descriptionForeground);
    }
</style>
