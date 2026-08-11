<!--
  StartupStatus.svelte
  1:1 Positron replication - Shows startup status in console before runtime starts
-->
<script lang="ts">
    import RuntimeStartupProgress from "./RuntimeStartupProgress.svelte";
    import type { RuntimeStartupPhase } from "../types/console";
    import { localize } from "$lib/localization";

    interface Props {
        startupPhase?: RuntimeStartupPhase;
        discoveredCount?: number;
        expectedCount?: number;
        latestRuntimePath?: string;
        runtimeStartupEvent?: {
            runtimeName: string;
            languageName: string;
            base64EncodedIconSvg?: string;
            newSession: boolean;
        };
        onTrustWorkspace?: () => void;
    }

    let {
        startupPhase = "initializing",
        discoveredCount = 0,
        expectedCount = 0,
        latestRuntimePath,
        runtimeStartupEvent,
        onTrustWorkspace,
    }: Props = $props();

    const messages = {
        initializing: localize("console.initializing", "Waiting for extensions"),
        awaitingTrust: localize(
            "console.awaitingTrust",
            "Cannot start consoles in Restricted Mode.",
        ),
        trustFolder: localize("console.trustFolder", "Trust this folder"),
        newFolderTasks: localize("console.newFolderTasks", "Setting up workspace"),
        reconnecting: localize("console.reconnecting", "Reconnecting"),
        starting: localize("console.starting", "Starting"),
        discovering: localize("console.discovering", "Discovering interpreters"),
    };

    const progressPercent = $derived(
        expectedCount > 0
            ? Math.min(100, (discoveredCount / expectedCount) * 100)
            : undefined,
    );
</script>

<div class="startup-status">
    {#if startupPhase !== "awaitingTrust"}
        <div class="progress" data-testid="startup-progress-bar">
            <div
                class:infinite={progressPercent === undefined}
                class="progress-bar"
                style:width={progressPercent === undefined
                    ? undefined
                    : `${progressPercent}%`}
            ></div>
        </div>
    {/if}

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
        <div class="awaiting">
            {messages.awaitingTrust}
            <button type="button" class="trust-link" onclick={onTrustWorkspace}>
                {messages.trustFolder}
            </button>
            {localize("console.enableConsoles", "to enable consoles.")}
        </div>
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
            ...
        </div>
        {#if latestRuntimePath}
            <div class="discovery-path" title={latestRuntimePath}>
                {latestRuntimePath}
            </div>
        {/if}
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
        width: 0;
        height: 100%;
        background: var(--vscode-progressBar-background);
        transition: width 120ms linear;
    }

    .progress-bar.infinite {
        width: 35%;
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

    .trust-link {
        margin: 0 4px;
        padding: 0;
        border: 0;
        color: var(--vscode-textLink-foreground);
        background: transparent;
        cursor: pointer;
        font: inherit;
    }

    .trust-link:hover {
        color: var(--vscode-textLink-activeForeground);
        text-decoration: underline;
    }

    .discovery-path {
        max-width: min(560px, calc(100% - 32px));
        margin-top: 4px;
        overflow: hidden;
        color: var(--vscode-descriptionForeground);
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
