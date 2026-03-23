<!--
    ActivityOutputMessage.svelte
    
    Renders text/plain output with ANSI formatting from a language runtime.
    Mirrors: positron/.../components/activityOutputMessage.tsx
-->
<script lang="ts">
    import type { ActivityItemOutputMessage } from "./classes";
    import ConsoleOutputLines from "./ConsoleOutputLines.svelte";

    interface Props {
        activityItemOutputMessage: ActivityItemOutputMessage;
    }

    let { activityItemOutputMessage }: Props = $props();
</script>

<ConsoleOutputLines outputLines={activityItemOutputMessage.outputLines} />
