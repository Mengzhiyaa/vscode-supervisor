<!--
    ConsoleOutputLines.svelte
    
    Renders console output lines with ANSI styling.
    Mirrors: positron/.../components/consoleOutputLines.tsx
-->
<script lang="ts">
    import OutputRun from "./OutputRun.svelte";
    import type { OutputLine } from "./classes";

    interface ConsoleOutputLinesProps {
        outputLines: readonly OutputLine[];
    }

    let { outputLines }: ConsoleOutputLinesProps = $props();
</script>

<div class="console-output-lines">
    {#each outputLines as line (line.id)}
        {#if line.outputRuns.length === 0}
            <br />
        {:else}
            <div class="output-line">
                {#each line.outputRuns as run (run.id)}
                    <OutputRun outputRun={run} />
                {/each}
            </div>
        {/if}
    {/each}
</div>

<style>
    /* Positron consoleOutputLines pattern */
    .console-output-lines {
        font-family: var(--console-content-font-family);
        font-size: var(--console-content-font-size);
        line-height: var(--console-line-height, 1.35);
        white-space: normal;
    }

    .output-line {
        white-space: var(--console-output-white-space, pre);
        line-height: var(--console-line-height, 1.35);
    }
</style>
