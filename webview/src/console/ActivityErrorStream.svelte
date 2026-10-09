<!--
    ActivityErrorStream.svelte
    
    Renders stderr stream output with ANSI styling.
    Mirrors: positron/.../components/activityErrorStream.tsx
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
    <div class="activity-error-stream">
        <ConsoleOutputLines {outputLines} />
    </div>
{/if}

<style>
    .activity-error-stream {
        color: var(
            --vscode-positronConsole-errorForeground,
            var(--vscode-errorForeground)
        );
    }
</style>
