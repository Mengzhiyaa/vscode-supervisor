<script lang="ts">
    import type { RuntimeItemOffline } from "./classes";
    import ConsoleOutputLines from "./ConsoleOutputLines.svelte";

    /**
     * RuntimeOffline Component (1:1 Positron)
     * Displays when the runtime is offline/disconnected
     */
    interface RuntimeOfflineProps {
        readonly runtimeItemOffline: RuntimeItemOffline;
        readonly onReconnect?: () => void;
    }

    let {
        runtimeItemOffline,
        onReconnect = undefined,
    }: RuntimeOfflineProps = $props();
</script>

<div class="runtime-offline">
    <div class="offline-content">
        <div class="offline-title">
            <ConsoleOutputLines outputLines={runtimeItemOffline.outputLines} />
        </div>
    </div>
    {#if onReconnect}
        <button class="offline-reconnect" onclick={onReconnect}>
            Reconnect
        </button>
    {/if}
</div>

<style>
    .runtime-offline {
        margin-bottom: 2px;
        padding-bottom: 4px;
        border-bottom: 1px solid #758286;
    }

    .offline-content {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .offline-title {
        color: var(--vscode-descriptionForeground);
    }

    .offline-reconnect {
        margin-top: 8px;
        width: fit-content;
        padding: 4px 10px;
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 4px;
        cursor: pointer;
    }

    .offline-reconnect:hover {
        background-color: var(--vscode-button-hoverBackground);
    }
</style>
