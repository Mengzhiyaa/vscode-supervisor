<script lang="ts">
    import { ANSIOutput, type ANSIOutputLine } from "$lib/ansi/ansiOutput";
    import OutputRun from "./OutputRun.svelte";

    interface Output {
        type: string;
        content: string;
        mimeType?: string;
        id?: string;
    }

    interface Props {
        outputs: Output[];
        sessionName?: string;
    }

    let { outputs, sessionName = "Session" }: Props = $props();

    let outputContainer: HTMLDivElement;

    // Cache parsed ANSI lines using WeakMap to avoid mutating props
    const ansiCache = new WeakMap<Output, ANSIOutputLine[]>();

    // Auto-scroll to bottom when new output arrives
    $effect(() => {
        if (outputs.length > 0 && outputContainer) {
            outputContainer.scrollTop = outputContainer.scrollHeight;
        }
    });

    /**
     * Parse content as ANSI and cache the result using WeakMap.
     * This avoids mutating the output prop which causes state_unsafe_mutation.
     */
    function getAnsiLines(output: Output): ANSIOutputLine[] {
        let cached = ansiCache.get(output);
        if (!cached) {
            cached = ANSIOutput.processOutput(output.content);
            ansiCache.set(output, cached);
        }
        return cached;
    }

    /**
     * Check if content contains ANSI escape sequences.
     */
    function hasAnsiCodes(content: string): boolean {
        return content.includes("\x1b[") || content.includes("\x1b]");
    }

    function isImageMimeType(mimeType?: string): boolean {
        return mimeType?.startsWith("image/") ?? false;
    }

    function isHtmlMimeType(mimeType?: string): boolean {
        return mimeType === "text/html";
    }

    function formatError(content: string): {
        name: string;
        message: string;
        traceback: string[];
    } {
        // Try to parse as structured error
        const lines = content.split("\n");
        const firstLine = lines[0] || "";
        const colonIdx = firstLine.indexOf(":");

        if (colonIdx > 0) {
            return {
                name: firstLine.substring(0, colonIdx),
                message: firstLine.substring(colonIdx + 1).trim(),
                traceback: lines.slice(1),
            };
        }

        return {
            name: "Error",
            message: content,
            traceback: [],
        };
    }
</script>

<div class="output-container" bind:this={outputContainer}>
    {#each outputs as output, i (i)}
        <div class="output-item output-{output.type}">
            {#if output.type === "input"}
                <div class="input-line">
                    <span class="prompt">&gt;</span>
                    <pre class="code">{output.content}</pre>
                </div>
            {:else if output.type === "stdout"}
                {#if hasAnsiCodes(output.content)}
                    <div class="stdout ansi-output">
                        {#each getAnsiLines(output) as line (line.id)}
                            <div class="ansi-line">
                                {#each line.outputRuns as run (run.id)}
                                    <OutputRun outputRun={run} />
                                {/each}
                            </div>
                        {/each}
                    </div>
                {:else}
                    <pre class="stdout">{output.content}</pre>
                {/if}
            {:else if output.type === "stderr"}
                {#if hasAnsiCodes(output.content)}
                    <div class="stderr ansi-output">
                        {#each getAnsiLines(output) as line (line.id)}
                            <div class="ansi-line">
                                {#each line.outputRuns as run (run.id)}
                                    <OutputRun outputRun={run} />
                                {/each}
                            </div>
                        {/each}
                    </div>
                {:else}
                    <pre class="stderr">{output.content}</pre>
                {/if}
            {:else if output.type === "error"}
                {@const err = formatError(output.content)}
                <div class="error-block">
                    <div class="error-header">
                        <span class="error-name">{err.name}</span>
                        <span class="error-message">{err.message}</span>
                    </div>
                    {#if err.traceback.length > 0}
                        <pre class="error-traceback">{err.traceback.join(
                                "\n",
                            )}</pre>
                    {/if}
                </div>
            {:else if output.type === "display"}
                <div class="display-block">
                    {#if isImageMimeType(output.mimeType)}
                        <img
                            src={output.content.startsWith("data:")
                                ? output.content
                                : `data:${output.mimeType};base64,${output.content}`}
                            alt="Plot output"
                            class="display-image"
                        />
                    {:else if isHtmlMimeType(output.mimeType)}
                        {@html output.content}
                    {:else}
                        <pre>{output.content}</pre>
                    {/if}
                </div>
            {:else}
                <pre>{output.content}</pre>
            {/if}
        </div>
    {/each}

    {#if outputs.length === 0}
        <div class="empty-state">
            <span class="icon">📊</span>
            <span class="text">{sessionName} ready. Enter code below.</span>
        </div>
    {/if}
</div>

<style>
    .output-container {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        font-family: var(--console-content-font-family);
        font-size: var(--console-content-font-size);
    }

    .output-item {
        margin-bottom: 4px;
    }

    .input-line {
        display: flex;
        align-items: flex-start;
    }

    .prompt {
        color: var(--vscode-terminal-ansiBrightBlue);
        font-weight: bold;
        padding-right: 8px;
        user-select: none;
    }

    .code {
        margin: 0;
        color: var(--vscode-editor-foreground);
        font-family: inherit;
    }

    .stdout {
        margin: 0;
        color: var(--vscode-terminal-foreground);
        white-space: pre-wrap;
        word-wrap: break-word;
    }

    .stderr {
        margin: 0;
        color: var(--vscode-terminal-ansiYellow);
        white-space: pre-wrap;
        word-wrap: break-word;
    }

    .error-block {
        background: rgba(255, 0, 0, 0.1);
        border-left: 3px solid var(--vscode-terminal-ansiRed);
        padding: 8px;
        border-radius: 0 4px 4px 0;
    }

    .error-header {
        display: flex;
        gap: 8px;
        align-items: baseline;
    }

    .error-name {
        color: var(--vscode-terminal-ansiRed);
        font-weight: bold;
    }

    .error-message {
        color: var(--vscode-terminal-ansiRed);
    }

    .error-traceback {
        margin: 4px 0 0 0;
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
        white-space: pre-wrap;
    }

    .display-block {
        padding: 8px;
        background: var(--vscode-textBlockQuote-background);
        border-radius: 4px;
        overflow: hidden;
    }

    .display-image {
        max-width: 100%;
        height: auto;
        border-radius: 4px;
    }

    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--vscode-descriptionForeground);
        gap: 8px;
    }

    .empty-state .icon {
        font-size: 32px;
    }

    .empty-state .text {
        font-size: 0.9em;
    }

    /* ANSI output styles */
    .ansi-output {
        font-family: var(--console-content-font-family);
        white-space: pre-wrap;
        word-wrap: break-word;
    }

    .ansi-line {
        min-height: 1.2em;
    }
</style>
