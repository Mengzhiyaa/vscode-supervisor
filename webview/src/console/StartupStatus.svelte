<!--
  StartupStatus.svelte
  1:1 Positron replication - Shows startup status in console before runtime starts
-->
<script lang="ts">
    import RuntimeStartupProgress from "./RuntimeStartupProgress.svelte";
    import type { RuntimeStartupPhase } from "../types/console";

    interface Props {
        startupPhase?: RuntimeStartupPhase;
        discoveredCount?: number;
        runtimeStartupEvent?: {
            runtimeName: string;
            languageName: string;
            base64EncodedIconSvg?: string;
            newSession: boolean;
        };
    }

    let {
        startupPhase = "initializing",
        discoveredCount = 0,
        runtimeStartupEvent,
    }: Props = $props();

    const messages = {
        initializing: "Starting up",
        awaitingTrust: "Consoles cannot start until the workspace is trusted",
        newFolderTasks: "Setting up workspace",
        reconnecting: "Reconnecting",
        starting: "Starting",
        discovering: "Discovering interpreters",
    };
</script>

<div class="startup-status">
    <div class="progress">
        <div class="progress-bar"></div>
    </div>

    {#if runtimeStartupEvent}
        <RuntimeStartupProgress {runtimeStartupEvent} />
    {/if}

    {#if startupPhase === "initializing"}
        <div class="initializing">{messages.initializing}...</div>
    {/if}

    {#if startupPhase === "reconnecting" && !runtimeStartupEvent}
        <div class="reconnecting">{messages.reconnecting}...</div>
    {/if}

    {#if startupPhase === "awaitingTrust"}
        <div class="awaiting">{messages.awaitingTrust}...</div>
    {/if}

    {#if startupPhase === "newFolderTasks"}
        <div class="new-folder-tasks">{messages.newFolderTasks}...</div>
    {/if}

    {#if startupPhase === "starting" && !runtimeStartupEvent}
        <div class="starting">{messages.starting}...</div>
    {/if}

    {#if startupPhase === "discovering" && !runtimeStartupEvent}
        <div class="discovery">
            {messages.discovering}
            {#if discoveredCount > 0}
                <span> ({discoveredCount})</span>
            {/if}...
        </div>
    {/if}
</div>

<style>
    .startup-status {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        width: 100%;
        position: relative;
        margin-top: 5px;
    }

    .progress {
        position: relative;
        width: min(240px, calc(100% - 32px));
        height: 2px;
        margin-bottom: 10px;
        background-color: color-mix(
            in srgb,
            var(--vscode-progressBar-background) 25%,
            transparent
        );
        overflow: hidden;
    }

    .progress-bar {
        position: absolute;
        inset: 0 auto 0 0;
        width: 35%;
        height: 100%;
        background: var(--vscode-progressBar-background);
        animation: loading 1.2s linear infinite;
    }

    @keyframes loading {
        0% {
            transform: translateX(-100%);
        }
        100% {
            transform: translateX(285%);
        }
    }

    .initializing,
    .reconnecting,
    .awaiting,
    .new-folder-tasks,
    .starting,
    .discovery {
        text-align: center;
    }
</style>
