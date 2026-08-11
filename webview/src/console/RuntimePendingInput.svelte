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
        overflow: hidden;
    }

    .pending-input.submitting::after {
        position: absolute;
        inset: 0;
        content: "";
        pointer-events: none;
        background: repeating-linear-gradient(
            -45deg,
            transparent 0 6px,
            color-mix(in srgb, var(--vscode-testing-iconPassed, #2eb77c) 28%, transparent) 6px 12px
        );
        animation: submitting-barber-pole 500ms linear infinite;
    }

    @keyframes submitting-barber-pole {
        to {
            transform: translateX(17px);
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
