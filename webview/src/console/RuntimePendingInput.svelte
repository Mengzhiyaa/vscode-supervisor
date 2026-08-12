<script lang="ts">
    import { localize } from "$lib/localization";
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

<div
    class="pending-input"
    class:submitting={runtimeItemPendingInput.submitting}
    aria-label={runtimeItemPendingInput.submitting
        ? localize("console.submittingCode", "Submitting code")
        : undefined}
>
    {#if runtimeItemPendingInput.submitting}
        <div class="pending-input-submitting-bar"></div>
    {/if}
    {#each runtimeItemPendingInput.outputLines as outputLine (outputLine.id)}
        <div class="pending-line">
            <span class="prompt" style:width={promptWidthPx}
                >{runtimeItemPendingInput.inputPrompt}</span
            >{#each outputLine.outputRuns as outputRun (outputRun.id)}<OutputRun
                {outputRun}
            />{/each}
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

    .pending-input.submitting {
        opacity: 1;
    }

    .pending-input-submitting-bar {
        position: absolute;
        top: 0;
        left: -10px;
        bottom: 0;
        width: 4px;
        pointer-events: none;
        background-image: repeating-linear-gradient(
            45deg,
            var(--vscode-positronConsole-ansiBrightGreen),
            var(--vscode-positronConsole-ansiBrightGreen) 3px,
            transparent 3px,
            transparent 6px
        );
        background-size: 8.49px 8.49px;
        animation: pending-input-submitting-move-stripes 1s linear infinite;
    }

    @keyframes pending-input-submitting-move-stripes {
        from {
            background-position: 0 0;
        }

        to {
            background-position: 8.49px 0;
        }
    }

    .pending-line {
        white-space: normal;
        line-height: var(--console-line-height, 1.35);
    }

    .prompt {
        user-select: none;
        display: inline-block;
        box-sizing: content-box;
        padding-right: var(--console-char-width, 1ch);
        white-space: pre;
    }
</style>
