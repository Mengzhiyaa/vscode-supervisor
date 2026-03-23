<script lang="ts">
    import OutputRun from "./OutputRun.svelte";
    import { RuntimeItemPendingInput } from "./classes";

    interface RuntimePendingInputProps {
        readonly runtimeItemPendingInput: RuntimeItemPendingInput;
        readonly charWidth?: number;
    }

    let { runtimeItemPendingInput, charWidth = 0 }: RuntimePendingInputProps =
        $props();

    const promptWidthPx = $derived(
        charWidth > 0
            ? `${runtimeItemPendingInput.inputPrompt.length * charWidth}px`
            : undefined,
    );
</script>

<div class="pending-input">
    {#each runtimeItemPendingInput.outputLines as outputLine (outputLine.id)}
        <div class="pending-line">
            <span class="prompt" style:width={promptWidthPx}
                >{runtimeItemPendingInput.inputPrompt}&nbsp;</span
            >
            {#each outputLine.outputRuns as outputRun (outputRun.id)}
                <OutputRun {outputRun} />
            {/each}
        </div>
    {/each}
</div>

<style>
    .pending-input {
        opacity: 0.65;
        position: relative;
        font-family: var(--console-content-font-family);
        font-size: var(--console-content-font-size);
        line-height: var(--console-line-height, 1.35);
    }

    .pending-line {
        white-space: normal;
        line-height: var(--console-line-height, 1.35);
    }

    .prompt {
        user-select: none;
        display: inline-block;
        padding-right: var(--console-char-width, 1ch);
        white-space: pre;
    }
</style>
