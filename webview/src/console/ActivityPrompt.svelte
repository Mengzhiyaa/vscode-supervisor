<!--
    ActivityPrompt.svelte
    
    Renders an inline input prompt from the kernel (e.g., R's readline()).
    Mirrors: positron/.../components/activityPrompt.tsx
-->
<script lang="ts">
    import { onMount } from "svelte";
    import { getRpcConnection } from "$lib/rpc/client";
    import ConsoleOutputLines from "./ConsoleOutputLines.svelte";
    import OutputRun from "./OutputRun.svelte";
    import { ActivityItemPrompt, ActivityItemPromptState } from "./classes";

    interface Props {
        activityItemPrompt: ActivityItemPrompt;
    }

    let { activityItemPrompt }: Props = $props();

    // svelte-ignore non_reactive_update
    let inputRef: HTMLInputElement;
    let inputValue = $state("");
    let promptState = $state<ActivityItemPromptState>(
        ActivityItemPromptState.Unanswered,
    );
    let promptAnswer = $state("");

    // Sync local prompt state when props change
    $effect(() => {
        promptState = activityItemPrompt.state;
        promptAnswer = activityItemPrompt.answer ?? "";
    });

    onMount(() => {
        // Keep prompts visible, but only take keyboard focus when the console
        // already owns focus.
        readyInput();
    });

    /**
     * Readies the input by scrolling it into view and optionally focusing.
     */
    function readyInput() {
        if (inputRef) {
            inputRef.scrollIntoView({ behavior: "auto" });
            if (shouldAutoFocusPrompt()) {
                inputRef.focus();
            }
        }
    }

    function shouldAutoFocusPrompt(): boolean {
        const activeElement = document.activeElement;
        if (!(activeElement instanceof HTMLElement)) {
            return false;
        }

        return !!activeElement.closest(
            ".console-instance, .console-input, .activity-prompt",
        );
    }

    /**
     * Handles keyboard events on the input.
     */
    function handleKeyDown(e: KeyboardEvent) {
        // Keep prompt input events inside the prompt so the outer console
        // container does not redirect typing/focus back to Monaco.
        e.stopPropagation();

        const noModifierKey =
            !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
        const onlyCtrlKey = e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

        if (noModifierKey && e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            submitAnswer();
        } else if (onlyCtrlKey && e.key === "c") {
            e.preventDefault();
            e.stopPropagation();
            interruptPrompt();
        }
    }

    /**
     * Submits the answer to the prompt.
     */
    async function submitAnswer() {
        const connection = getRpcConnection();
        if (connection) {
            try {
                await connection.sendRequest("console/replyPrompt", {
                    id: activityItemPrompt.id,
                    value: inputValue,
                    sessionId: activityItemPrompt.sessionId,
                });
                // Update local state for immediate UI feedback
                promptState = ActivityItemPromptState.Answered;
                activityItemPrompt.state = ActivityItemPromptState.Answered;
                if (!activityItemPrompt.password) {
                    promptAnswer = inputValue;
                    activityItemPrompt.answer = inputValue;
                }
            } catch (err) {
                console.error("Failed to reply to prompt:", err);
            }
        }
    }

    /**
     * Interrupts the prompt (Ctrl+C).
     */
    async function interruptPrompt() {
        const connection = getRpcConnection();
        if (connection) {
            try {
                await connection.sendRequest("console/interrupt", {
                    sessionId: activityItemPrompt.sessionId,
                });
                promptState = ActivityItemPromptState.Interrupted;
                activityItemPrompt.state = ActivityItemPromptState.Interrupted;
            } catch (err) {
                console.error("Failed to interrupt prompt:", err);
            }
        }
    }

    function stopPromptPropagation(e: Event) {
        e.stopPropagation();
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="activity-prompt"
    data-session-id={activityItemPrompt.sessionId}
    data-prompt-state={promptState}
    onmousedown={stopPromptPropagation}
    onclick={stopPromptPropagation}
    oncontextmenu={stopPromptPropagation}
>
    <!-- Render prompt text lines (except last which is inline with input) -->
    {#if activityItemPrompt.outputLines.length > 1}
        <ConsoleOutputLines
            outputLines={activityItemPrompt.outputLines.slice(0, -1)}
        />
    {/if}

    <!-- Last line with inline input -->
    <div class="prompt-line">
        <!-- Render last prompt line inline -->
        {#each activityItemPrompt.outputLines.slice(-1) as outputLine (outputLine.id)}
            {#each outputLine.outputRuns as outputRun (outputRun.id)}
                <OutputRun {outputRun} />
            {/each}
        {/each}

        <!-- Input or answer display based on state -->
        {#if promptState === ActivityItemPromptState.Unanswered}
            <input
                bind:this={inputRef}
                bind:value={inputValue}
                class="prompt-input"
                type={activityItemPrompt.password ? "password" : "text"}
                onkeydown={handleKeyDown}
                onmousedown={stopPromptPropagation}
                onclick={stopPromptPropagation}
            />
        {:else if promptState === ActivityItemPromptState.Answered}
            {#if !activityItemPrompt.password}
                <span class="prompt-answer">{promptAnswer}</span>
            {/if}
        {:else if promptState === ActivityItemPromptState.Interrupted}
            <span class="prompt-interrupted">^C</span>
        {/if}
    </div>
</div>

<style>
    .activity-prompt {
        font-family: var(--console-content-font-family);
        font-size: var(--console-content-font-size);
    }

    .prompt-line {
        display: flex;
        white-space: pre;
        margin-right: 10px;
        align-items: center;
        flex-wrap: wrap;
    }

    .prompt-input {
        flex: 1;
        min-width: 100px;
        background: transparent;
        border: none;
        outline: none;
        color: var(--vscode-editor-foreground);
        font-family: inherit;
        font-size: inherit;
        padding: 0;
        margin: 0;
    }

    .prompt-input:focus {
        outline: none;
    }

    .prompt-answer {
        color: var(--vscode-editor-foreground);
    }

    .prompt-interrupted {
        color: var(--vscode-terminal-ansiRed);
        font-weight: bold;
    }
</style>
