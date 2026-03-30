<!--
    ConsoleInstanceItems.svelte
    
    Renders the list of runtime items (execution activities, messages, etc.)
    Mirrors: positron/.../components/consoleInstanceItems.tsx
-->
<script lang="ts">
    import ConsoleOutputLines from "./ConsoleOutputLines.svelte";
    import RuntimeActivity from "./RuntimeActivity.svelte";
    import RuntimeStarted from "./RuntimeStarted.svelte";
    import RuntimeStarting from "./RuntimeStarting.svelte";
    import RuntimeStartup from "./RuntimeStartup.svelte";
    import RuntimeOffline from "./RuntimeOffline.svelte";
    import RuntimePendingInput from "./RuntimePendingInput.svelte";
    import RuntimeRestartButton from "./RuntimeRestartButton.svelte";
    import RuntimeRestarting from "./RuntimeRestarting.svelte";
    import RuntimeStartupFailure from "./RuntimeStartupFailure.svelte";
    import type { ConsoleInstanceModel } from "./models/consoleInstance";
    import {
        RuntimeItemActivity,
        RuntimeItemStarted,
        RuntimeItemStartup,
        RuntimeItemExited,
        RuntimeItemOffline,
        RuntimeItemPendingInput,
        RuntimeItemStarting,
        RuntimeItemTrace,
        RuntimeItemReconnected,
        RuntimeItemStartupFailure,
        RuntimeItemRestarting,
        RuntimeItemRestartButton,
    } from "./classes";

    interface Props {
        consoleInstance: ConsoleInstanceModel;
        languageAssetsVersion?: number;
        onReconnect?: () => void;
        onRestart?: () => void;
        charWidth?: number;
    }

    let {
        consoleInstance,
        languageAssetsVersion = 0,
        onReconnect = undefined,
        onRestart = undefined,
        charWidth = 0,
    }: Props = $props();

    const visibleRuntimeItems = $derived(
        consoleInstance.runtimeItems.filter((runtimeItem) => !runtimeItem.isHidden),
    );
    const trace = $derived(consoleInstance.trace);
    const disconnected = $derived(consoleInstance.disconnected);
    const languageId = $derived(consoleInstance.languageId);
    const languageName = $derived(
        consoleInstance.runtimeName || consoleInstance.sessionName || "R",
    );

    function formatTraceTimestamp(timestamp: Date): string {
        const toTwoDigits = (value: number) =>
            value < 10 ? `0${value}` : `${value}`;
        const toFourDigits = (value: number) =>
            value < 10
                ? `000${value}`
                : value < 100
                  ? `00${value}`
                  : value < 1000
                    ? `0${value}`
                    : `${value}`;

        return `${toTwoDigits(timestamp.getHours())}:${toTwoDigits(
                timestamp.getMinutes(),
            )}:${toTwoDigits(timestamp.getSeconds())}.${toFourDigits(
                timestamp.getMilliseconds(),
            )}`;
    }
</script>

<div class="console-instance-items">
    <div class="top-spacer"></div>

    {#each visibleRuntimeItems as runtimeItem (runtimeItem.id)}
        {#if runtimeItem instanceof RuntimeItemActivity}
            <RuntimeActivity
                runtimeItemActivity={runtimeItem}
                {languageId}
                {languageAssetsVersion}
                {charWidth}
            />
        {:else if runtimeItem instanceof RuntimeItemStarted}
            <RuntimeStarted runtimeItemStarted={runtimeItem} />
        {:else if runtimeItem instanceof RuntimeItemStartup}
            <RuntimeStartup runtimeItemStartup={runtimeItem} />
        {:else if runtimeItem instanceof RuntimeItemOffline}
            <RuntimeOffline
                runtimeItemOffline={runtimeItem}
                {onReconnect}
            />
        {:else if runtimeItem instanceof RuntimeItemPendingInput}
            <RuntimePendingInput
                runtimeItemPendingInput={runtimeItem}
                {charWidth}
            />
        {:else if runtimeItem instanceof RuntimeItemRestarting}
            <RuntimeRestarting runtimeItemRestarting={runtimeItem} />
        {:else if runtimeItem instanceof RuntimeItemStarting}
            <RuntimeStarting runtimeItemStarting={runtimeItem} />
        {:else if runtimeItem instanceof RuntimeItemExited}
            <div class="runtime-exited">
                <div class="exited-message">
                    <ConsoleOutputLines outputLines={runtimeItem.outputLines} />
                </div>
                <!-- Restart button for exited sessions -->
                {#if onRestart}
                    <RuntimeRestartButton
                        {languageName}
                        disabled={false}
                        onrestart={onRestart}
                    />
                {/if}
            </div>
        {:else if runtimeItem instanceof RuntimeItemTrace}
            {#if trace}
                <div class="runtime-trace">
                    <div class="trace-timestamp">
                        {formatTraceTimestamp(runtimeItem.timestamp)}
                    </div>
                    <ConsoleOutputLines outputLines={runtimeItem.outputLines} />
                </div>
            {/if}
        {:else if runtimeItem instanceof RuntimeItemReconnected}
            <!-- Positron does not render a reconnected banner item here. -->
        {:else if runtimeItem instanceof RuntimeItemRestartButton}
            <RuntimeRestartButton
                {languageName}
                disabled={false}
                onrestart={() => runtimeItem.onRestart()}
            />
        {:else if runtimeItem instanceof RuntimeItemStartupFailure}
            <RuntimeStartupFailure runtimeItemStartupFailure={runtimeItem} />
        {:else}
            <!-- Handle other RuntimeItem types in future -->
            <div class="runtime-item-unknown">Unknown runtime item type</div>
        {/if}
    {/each}

    {#if disconnected}
        <div class="console-item-starting disconnected-banner">
            <span class="codicon codicon-loading codicon-modifier-spin"></span>
            <span>Extensions restarting...</span>
        </div>
    {/if}
</div>

<style>
    .console-instance-items {
        display: flex;
        flex-direction: column;
        white-space: normal;
    }

    .top-spacer {
        min-height: 10px;
        flex-shrink: 0;
        user-select: none;
        -webkit-user-select: none;
    }

    .runtime-item-unknown {
        padding: 4px 8px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
    }

    .runtime-exited {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        margin-bottom: 2px;
        padding-bottom: 4px;
        color: var(--vscode-descriptionForeground);
        border-bottom: 1px solid #758286;
    }

    .exited-message {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .runtime-trace {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 2px 0;
        padding: 4px;
        font-size: 10px;
        line-height: normal;
        background: var(--vscode-positronConsole-traceBackground);
    }

    .trace-timestamp {
        font-family: var(--console-content-font-family);
        white-space: pre;
    }

    .console-item-starting {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
        color: var(--vscode-descriptionForeground);
    }

    .disconnected-banner {
        margin-top: 2px;
    }

</style>
