<!--
    ActivityInput.svelte
    
    Renders a user input code block with prompt and syntax highlighting.
    Mirrors: positron/.../components/activityInput.tsx
-->
<script lang="ts">
    import { onMount } from "svelte";
    import { monaco, ensureMonacoRuntime } from "$lib/monaco/setup";
    import {
        ensureLanguageTextMateTokenizerReady,
        loadLanguageMonacoSupportModule,
    } from "$lib/monaco/languageSupport";
    import { colorizeActivityInputLines } from "$lib/monaco/activityInputColorizer";
    import { ActivityItemInput, ActivityItemInputState } from "./classes";
    import OutputRun from "./OutputRun.svelte";

    interface Props {
        activityItemInput: ActivityItemInput;
        languageId?: string;
        languageAssetsVersion?: number;
        charWidth?: number;
    }

    let {
        activityItemInput,
        languageId = "plaintext",
        languageAssetsVersion = 0,
        charWidth = 0,
    }: Props = $props();

    /**
     * Calculate prompt width in pixels.
     * Just uses the character count of the longest prompt.
     * The space after the prompt is handled by padding-right in CSS.
     */
    const promptWidthPx = $derived(
        charWidth > 0
            ? `${
                  Math.max(
                      activityItemInput.inputPrompt.length,
                      activityItemInput.continuationPrompt.length,
                  ) * charWidth
              }px`
            : undefined,
    );

    // State for colorized HTML lines
    let colorizedLines: string[] = $state([]);
    let isColorized = $state(false);
    let colorizeVersion = 0;
    // svelte-ignore state_referenced_locally
    let inputState = $state(activityItemInput.state);

    // Track activityItemInput prop changes (e.g. when restoreConsoleState
    // replaces all objects) and re-register the onStateChanged listener on
    // the new object.  Also sync inputState immediately from the new object
    // so the green execution bar correctly reflects the current state.
    $effect(() => {
        // Read the prop to establish a reactive dependency.
        const item = activityItemInput;
        // Sync state from the (possibly new) object.
        inputState = item.state;
        // Re-register the listener on the (possibly new) object.
        const dispose = item.onStateChanged(() => {
            inputState = item.state;
        });
        return () => {
            dispose();
        };
    });

    /**
     * Build plain code lines when no ANSI formatting is present.
     * Mirrors Positron's guard before tokenization.
     */
    function getPlainCodeLines(): string[] | null {
        const lines: string[] = [];
        for (const line of activityItemInput.codeOutputLines) {
            const runs = line.outputRuns;
            if (runs.length === 0) {
                lines.push("");
            } else if (runs.length === 1 && runs[0].format === undefined) {
                lines.push(runs[0].text);
            } else {
                return null;
            }
        }
        return lines;
    }

    /**
     * Get the prompt text for a given line index.
     * Returns just the prompt symbol without trailing space.
     * The space is handled by CSS padding-right.
     */
    function getPromptText(index: number): string {
        return index === 0
            ? activityItemInput.inputPrompt
            : activityItemInput.continuationPrompt;
    }

    // Tokenize and colorize using Monaco (Positron 1:1 path)
    async function colorizeCode() {
        const currentVersion = ++colorizeVersion;

        const plainLines = getPlainCodeLines();
        if (!plainLines) {
            colorizedLines = [];
            isColorized = false;
            return;
        }

        try {
            await ensureMonacoRuntime();

            const languageSupport =
                await loadLanguageMonacoSupportModule(languageId);
            languageSupport?.registerLanguage(monaco);
            await ensureLanguageTextMateTokenizerReady(monaco, languageId);

            const result = await colorizeActivityInputLines(
                plainLines,
                languageId,
            );

            // Ignore stale async results.
            if (currentVersion !== colorizeVersion) {
                return;
            }

            colorizedLines = result;
            isColorized = result.length > 0;
        } catch (e) {
            console.warn("Failed to colorize code:", e);
            colorizedLines = [];
            isColorized = false;
        }
    }

    onMount(() => {
        // Attempt to colorize on mount
        colorizeCode();
    });

    // Re-colorize when code changes
    $effect(() => {
        // Track dependency on codeOutputLines
        void activityItemInput.codeOutputLines;
        void languageId;
        void languageAssetsVersion;
        colorizeCode();
    });
</script>

<div
    class="activity-input"
    class:executing={inputState === ActivityItemInputState.Executing}
    class:cancelled={inputState === ActivityItemInputState.Cancelled}
>
    <div class="progress-bar"></div>

    {#if isColorized && colorizedLines.length > 0}
        <!-- Colorized output using Monaco tokenization -->
        {#each colorizedLines as html, lineIndex}
            <div class="input-line">
                <span class="prompt" style:width={promptWidthPx}
                    >{getPromptText(lineIndex)}</span
                ><span class="code colorized">{@html html}</span>
            </div>
        {/each}
    {:else}
        <!-- Fallback: Plain text output -->
        {#each activityItemInput.codeOutputLines as line, lineIndex (line.id)}
            <div class="input-line">
                <span class="prompt" style:width={promptWidthPx}
                    >{getPromptText(lineIndex)}</span
                >{#each line.outputRuns as run (run.id)}<OutputRun
                    outputRun={run}
                />{/each}
            </div>
        {/each}
    {/if}
</div>

<style>
    .activity-input {
        position: relative;
        font-family: var(--console-content-font-family);
        font-size: var(--console-content-font-size);
        line-height: var(--console-line-height, 1.35);
        white-space: normal;
    }

    /* Progress bar for execution state (Positron pattern) */
    .activity-input .progress-bar {
        width: 4px;
        height: 100%;
        position: absolute;
        top: 0;
        left: -10px;
        opacity: 0;
    }

    /* Positron fadeIn animation */
    @keyframes positronActivityInput-fadeIn {
        0% {
            opacity: 0;
        }
        100% {
            opacity: 1;
        }
    }

    /* Positron revealFadeInOut animation */
    @keyframes positronActivityInput-revealFadeInOut {
        0% {
            opacity: 0;
        }
        15% {
            opacity: 1;
        }
        85% {
            opacity: 1;
        }
        100% {
            opacity: 0;
        }
    }

    .activity-input.executing .progress-bar {
        background-color: var(
            --vscode-positronConsole-ansiGreen,
            var(--vscode-terminal-ansiGreen)
        );
        opacity: 0;
        animation: positronActivityInput-fadeIn 0.25s ease-in 0.25s 1 forwards;
    }

    /* .activity-input.revealed .progress-bar {
        background-color: var(--vscode-focusBorder);
        opacity: 0;
        animation: positronActivityInput-revealFadeInOut 2s ease-in-out 1
            forwards;
    } */

    .input-line {
        white-space: var(--console-output-white-space, pre);
        line-height: var(--console-line-height, 1.35);
    }

    .prompt {
        user-select: none;
        display: inline-block;
        box-sizing: content-box;
        text-align: right;
        /* Width is set inline from Monaco-measured character width. */
        /* Padding provides the space after the prompt, matching Monaco's lineDecorationsWidth. */
        padding-right: var(--console-char-width, 1ch);
    }

    :global(.activity-input.revealed) .progress-bar {
        background-color: var(--vscode-focusBorder);
        opacity: 0;
        animation: positronActivityInput-revealFadeInOut 2s ease-in-out 1
            forwards;
    }

    .activity-input.cancelled {
        color: var(
            --vscode-positronActionBar-disabledForeground,
            var(--vscode-disabledForeground)
        );
    }

    .code {
        white-space: var(--console-output-white-space, pre-wrap);
    }

    /* Ensure Monaco-generated spans display correctly */
    .code.colorized :global(span) {
        font-family: inherit;
    }
</style>
