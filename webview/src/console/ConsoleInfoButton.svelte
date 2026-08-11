<!--
    ConsoleInfoButton.svelte
    
    Button that shows console/session information in a popup.
    Mirrors: positron/.../components/consoleInstanceInfoButton.tsx
-->
<script lang="ts">
    import ActionBarButton from "../shared/ActionBarButton.svelte";
    import ModalPopup from "../shared/ModalPopup.svelte";
    import { getRpcConnection } from "../lib/rpc/client";
    import { localize } from "../lib/localization";
    import type { ConsoleState } from "../types/console";
    import { getRuntimeDisplayPath } from "./utils/runtimeDisplayPath";

    type SessionOutputChannel = "console" | "kernel" | "lsp";

    interface SessionInfo {
        id: string;
        name: string;
        runtimeName: string;
        state: ConsoleState;
        runtimeState: ConsoleState;
        runtimePath?: string;
        runtimeDisplayPath?: string;
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
        session?.name || session?.runtimeName || "",
    );
    const displayPath = $derived(
        getRuntimeDisplayPath(session?.runtimePath, session?.runtimeDisplayPath),
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
                return localize("console.state.uninitialized", "Uninitialized");
            case "ready":
                return localize("console.state.ready", "Ready");
            case "busy":
                return localize("console.state.busy", "Busy");
            case "interrupting":
                return localize("console.state.interrupting", "Interrupting");
            case "starting":
                return localize("console.state.starting", "Starting");
            case "restarting":
                return localize("console.state.restarting", "Restarting");
            case "exiting":
                return localize("console.state.exiting", "Shutting Down");
            case "exited":
                return localize("console.state.exited", "Exited");
            case "offline":
                return localize("console.state.offline", "Offline");
            case "disconnected":
                return localize("console.state.disconnected", "Disconnected");
            default:
                return state;
        }
    }

    function getOutputChannelLabel(channel: SessionOutputChannel): string {
        const channelName = localize(
            `console.info.channel.${channel}`,
            channel === "kernel"
                ? "Kernel"
                : channel === "console"
                  ? "Supervisor"
                  : "LSP",
        );
        return localize(
            "console.info.showOutputChannel",
            "Show {0} Output Channel",
            channelName,
        );
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
        ariaLabel={localize("console.info.title", "Console Information")}
        tooltip={localize("console.info.title", "Console Information")}
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
                                {localize(
                                    "console.info.sessionId",
                                    "Session ID: {0}",
                                    session.id,
                                )}
                            </p>
                            <p class="line" data-testid="session-state">
                                {localize(
                                    "console.info.state",
                                    "State: {0}",
                                    getStateLabel(session.runtimeState),
                                )}
                            </p>
                        </div>

                        <div class="top-separator">
                            {#if displayPath}
                                <p class="line path" data-testid="session-path">
                                    {localize(
                                        "console.info.runtimePath",
                                        "Path: {0}",
                                        displayPath,
                                    )}
                                </p>
                            {/if}
                            {#if session.runtimeSource}
                                <p class="line" data-testid="session-source">
                                    {localize(
                                        "console.info.runtimeSource",
                                        "Source: {0}",
                                        session.runtimeSource,
                                    )}
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
