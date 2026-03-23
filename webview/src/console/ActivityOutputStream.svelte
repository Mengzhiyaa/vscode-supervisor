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
</script>

<ConsoleOutputLines outputLines={$outputLinesStore} />
