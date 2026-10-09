<!--
    ActivityOutputStream.svelte
    
    Renders stdout stream output with ANSI styling.
    Mirrors: positron/.../components/activityOutputStream.tsx
-->
<script lang="ts">
    import { ActivityItemStream } from "./classes";
    import ConsoleOutputLines from "./ConsoleOutputLines.svelte";

    interface Props {
        activityItemStream: ActivityItemStream;
    }

    let { activityItemStream }: Props = $props();
    let outputLinesStore = $derived(activityItemStream.outputLinesStore);
    let outputLines = $derived($outputLinesStore);
</script>

{#if outputLines.some((line) => line.outputRuns.length > 0)}
    <ConsoleOutputLines {outputLines} />
{/if}
