<script lang="ts">
    import type { ANSIOutputLine } from "$lib/ansi/ansiOutput";
    import { localize } from "$lib/localization";
    import OutputRun from "./OutputRun.svelte";
    import { splitOutputLine } from "./utils/fileLinkDetector";

    let { line }: { line: ANSIOutputLine } = $props();
    const segments = $derived(splitOutputLine(line));
</script>

{#each segments as segment}
    {#if segment.location}
        <span
            class="console-file-link"
            data-console-file-path={segment.location.path}
            data-console-file-line={segment.location.line}
            data-console-file-column={segment.location.column}
            title={localize("console.openFileLink", "Ctrl/Cmd+click to open file")}
        >{#each segment.runs as run (run.id)}<OutputRun outputRun={run} detectLinks={false} />{/each}</span>
    {:else}
        {#each segment.runs as run (run.id)}<OutputRun outputRun={run} />{/each}
    {/if}
{/each}

<style>
    .console-file-link {
        color: var(--vscode-textLink-foreground);
        text-decoration: underline dotted;
        cursor: pointer;
    }

    .console-file-link:hover {
        color: var(--vscode-textLink-activeForeground);
    }

    .console-file-link :global(.output-run) {
        color: inherit !important;
    }
</style>
