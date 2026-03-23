<!--
    ActivityErrorMessage.svelte
    
    Renders an error message with name, message, and traceback.
    Mirrors: positron/.../components/activityErrorMessage.tsx
-->
<script lang="ts">
    import { ActivityItemErrorMessage } from "./classes";
    import ConsoleOutputLines from "./ConsoleOutputLines.svelte";

    interface Props {
        activityItemErrorMessage: ActivityItemErrorMessage;
    }

    let { activityItemErrorMessage }: Props = $props();

    // State hooks (Positron pattern)
    let showTraceback = $state(false);

    // Reference to component for scroll into view
    let activityErrorMessageRef: HTMLDivElement;

    // Traceback toggle handler (Positron pressedTracebackHandler pattern)
    function pressedTracebackHandler() {
        showTraceback = !showTraceback;

        // Ensure that the component is scrolled into view when traceback is showing
        if (showTraceback) {
            setTimeout(() => {
                activityErrorMessageRef?.scrollIntoView({ behavior: "auto" });
            }, 0);
        }
    }
</script>

<div class="activity-error-message" bind:this={activityErrorMessageRef}>
    <div class="error-bar"></div>
    <div class="error-information">
        <!-- Error message -->
        {#if activityItemErrorMessage.messageOutputLines.length > 0}
            <ConsoleOutputLines
                outputLines={activityItemErrorMessage.messageOutputLines}
            />
        {/if}

        <!-- Error footer with traceback toggle -->
        <div class="error-footer">
            <div class="traceback">
                <div class="actions">
                    <!-- Traceback toggle button (Positron pattern) -->
                    {#if activityItemErrorMessage.tracebackOutputLines.length > 0}
                        <button
                            class="toggle-traceback"
                            onclick={pressedTracebackHandler}
                            type="button"
                        >
                            {#if showTraceback}
                                <div
                                    class="expansion-indicator codicon codicon-chevron-down"
                                ></div>
                                <div class="link-text">Hide Traceback</div>
                            {:else}
                                <div
                                    class="expansion-indicator codicon codicon-chevron-right"
                                ></div>
                                <div class="link-text">Show Traceback</div>
                            {/if}
                        </button>
                    {/if}
                </div>

                <!-- Traceback lines (shown when expanded) -->
                {#if showTraceback}
                    <div class="traceback-lines">
                        <div></div>
                        <div>
                            <ConsoleOutputLines
                                outputLines={activityItemErrorMessage.tracebackOutputLines}
                            />
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>

<style>
    /* Positron activityErrorMessage.css pattern */
    .activity-error-message {
        display: grid;
        margin-left: -10px;
        grid-template-columns: 10px 1fr;
        background: var(
            --vscode-positronConsole-errorBackground,
            rgba(255, 0, 0, 0.1)
        );
    }

    .error-bar {
        width: 4px;
        display: flex;
        opacity: 0.75;
        background-color: var(
            --vscode-positronConsole-ansiRed,
            var(--vscode-terminal-ansiRed)
        );
    }

    .error-information {
        padding: 4px 0;
    }

    .traceback .actions {
        display: flex;
        align-items: flex-start;
        gap: 8px;
    }

    .toggle-traceback {
        display: grid;
        cursor: pointer;
        grid-template-columns: 2ch 1fr;
        background: transparent;
        border: none;
        padding: 0;
        font-family: inherit;
        font-size: inherit;
        color: inherit;
    }

    .toggle-traceback .expansion-indicator {
        display: flex;
        margin-left: 0px;
        align-items: center;
    }

    .toggle-traceback .link-text {
        text-decoration: underline;
        color: var(--vscode-textLink-foreground);
    }

    .traceback-lines {
        display: grid;
        grid-template-columns: 2ch 1fr;
        margin-top: 4px;
        font-size: 0.9em;
        color: var(--vscode-descriptionForeground);
    }
</style>
