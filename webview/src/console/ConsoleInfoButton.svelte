<!--
    ConsoleInfoButton.svelte
    
    Button that shows console/session information in a popup.
    Mirrors: positron/.../components/consoleInstanceInfoButton.tsx
-->
<script lang="ts">
    import ActionBarButton from "../shared/ActionBarButton.svelte";
    import ModalPopup from "../shared/ModalPopup.svelte";
    import { getRpcConnection } from "../lib/rpc/client";
    import type { ConsoleState } from "../types/console";

    type SessionOutputChannel = "console" | "kernel" | "lsp";

    interface SessionInfo {
        id: string;
        name: string;
        runtimeName: string;
        state: ConsoleState;
        runtimePath?: string;
        runtimeVersion?: string;
        runtimeSource?: string;
    }

    interface Props {
        session: SessionInfo | undefined;
    }

    let { session }: Props = $props();

    let showPopup = $state(false);
    let anchorElement = $state<HTMLDivElement | null>(null);
    let outputChannels = $state<SessionOutputChannel[]>([]);
    const sessionLabel = $derived(
        session?.name || session?.runtimeVersion || session?.runtimeName || "",
    );
    const outputChannelOrder: SessionOutputChannel[] = [
        "kernel",
        "console",
        "lsp",
    ];

    // Handle button click
    function handleClick() {
        if (!session) return;
        showPopup = !showPopup;
    }

    function handleClose() {
        showPopup = false;
        outputChannels = [];
    }

    $effect(() => {
        if (!session && showPopup) {
            showPopup = false;
        }
    });

    $effect(() => {
        const sessionId = session?.id;
        if (showPopup && sessionId) {
            void loadOutputChannels();
        }
    });

    // State label mapping
    function getStateLabel(state: ConsoleState): string {
        switch (state) {
            case "uninitialized":
                return "Uninitialized";
            case "ready":
                return "Ready";
            case "busy":
                return "Busy";
            case "interrupting":
                return "Interrupting";
            case "starting":
                return "Starting";
            case "restarting":
                return "Restarting";
            case "exiting":
                return "Shutting Down";
            case "exited":
                return "Exited";
            case "offline":
                return "Offline";
            case "disconnected":
                return "Disconnected";
            default:
                return state;
        }
    }

    function getOutputChannelLabel(channel: SessionOutputChannel): string {
        switch (channel) {
            case "kernel":
                return "Show Kernel Output Channel";
            case "console":
                return "Show Supervisor Output Channel";
            case "lsp":
                return "Show LSP Output Channel";
        }
    }

    async function loadOutputChannels() {
        if (!session) {
            outputChannels = [];
            return;
        }

        try {
            const result = (await getRpcConnection().sendRequest(
                "session/listOutputChannels",
                { sessionId: session.id },
            )) as { channels?: SessionOutputChannel[] } | undefined;

            const channels = Array.isArray(result?.channels)
                ? result.channels
                : [];

            outputChannels = [...channels].sort(
                (left, right) =>
                    outputChannelOrder.indexOf(left) -
                    outputChannelOrder.indexOf(right),
            );
        } catch (error) {
            console.warn("Failed to load console info output channels:", error);
            outputChannels = [];
        }
    }

    async function showOutputChannel(channel: SessionOutputChannel) {
        if (!session) {
            return;
        }

        try {
            await getRpcConnection().sendRequest("session/showOutputChannel", {
                sessionId: session.id,
                channel,
            });
            handleClose();
        } catch (error) {
            console.error("Failed to show output channel:", error);
        }
    }
</script>

<div class="console-info-button-container" bind:this={anchorElement}>
    <ActionBarButton
        icon="info"
        ariaLabel="Console Information"
        tooltip="Console Information"
        disabled={!session}
        onclick={handleClick}
    />

    {#if showPopup && session && anchorElement}
        <ModalPopup
            {anchorElement}
            width={400}
            popupAlignment="auto"
            popupPosition="auto"
            onClose={handleClose}
        >
            <div class="positron-modal-popup-children console-info-popup-children">
                <div class="console-instance-info">
                    <div class="content">
                        <p class="line" data-testid="session-name">
                            {sessionLabel}
                        </p>

                        <div class="top-separator">
                            <p class="line session-id" data-testid="session-id">
                                Session ID: {session.id}
                            </p>
                            <p class="line" data-testid="session-state">
                                State: {getStateLabel(session.state)}
                            </p>
                        </div>

                        <div class="top-separator">
                            <p class="line" data-testid="runtime-name">
                                Runtime: {session.runtimeName}
                            </p>
                            {#if session.runtimeVersion}
                                <p class="line" data-testid="runtime-version">
                                    Version: {session.runtimeVersion}
                                </p>
                            {/if}
                            {#if session.runtimePath}
                                <p class="line path" data-testid="runtime-path">
                                    Path: {session.runtimePath}
                                </p>
                            {/if}
                            {#if session.runtimeSource}
                                <p class="line" data-testid="runtime-source">
                                    Source: {session.runtimeSource}
                                </p>
                            {/if}
                        </div>
                    </div>

                    {#if outputChannels.length > 0}
                        <div class="top-separator actions">
                            {#each outputChannels as channel (channel)}
                                <button
                                    type="button"
                                    class="link"
                                    onclick={() => void showOutputChannel(channel)}
                                >
                                    {getOutputChannelLabel(channel)}
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
        </ModalPopup>
    {/if}
</div>

<style>
    .console-info-button-container {
        display: flex;
    }

    :global(.positron-modal-popup:has(.console-info-popup-children)) {
        display: flex;
        background: var(--vscode-editorHoverWidget-background);
        border-color: var(--vscode-editorHoverWidget-border);
        overflow: hidden;
    }

    .console-info-popup-children {
        width: 100%;
        height: 100%;
        background: var(--vscode-editorHoverWidget-background);
    }

    .console-instance-info {
        background: var(--vscode-editorHoverWidget-background);
        color: var(--vscode-editorHoverWidget-foreground);
        width: 100%;
        line-height: 1.35;
        font-size: 12px;
    }

    .top-separator {
        border-top: 1px solid var(--vscode-editorHoverWidget-border);
    }

    .actions {
        background-color: var(
            --vscode-editorHoverWidget-statusBarBackground
        );
        padding-bottom: 4px;
    }

    .content .line {
        margin: 8px 0;
        padding: 0 8px;
        overflow-wrap: break-word;
        user-select: text;
        line-height: 16px;
    }

    .session-id,
    .path {
        font-family: var(--console-content-font-family);
    }

    .link {
        display: block;
        width: 100%;
        color: var(--vscode-textLink-foreground);
        cursor: pointer;
        font-size: 12px;
        line-height: 22px;
        padding: 0 8px;
        text-decoration: underline;
        text-align: left;
        border: none;
        background: transparent;
        font-family: inherit;
    }
</style>
