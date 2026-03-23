<!--
    RuntimeStartupProgress.svelte
    
    Displays startup progress indicator for a session.
    Mirrors: positron/.../components/runtimeStartupProgress.tsx
-->
<script lang="ts">
    interface Props {
        runtimeStartupEvent: {
            runtimeName: string;
            base64EncodedIconSvg?: string;
            newSession: boolean;
        };
    }

    let { runtimeStartupEvent }: Props = $props();

    const statusText = $derived(
        runtimeStartupEvent.newSession ? "Preparing" : "Reconnecting",
    );
</script>

<div class="runtime-startup-progress">
    {#if runtimeStartupEvent.base64EncodedIconSvg}
        <img
            class="runtime-startup-progress-icon"
            src="data:image/svg+xml;base64,{runtimeStartupEvent.base64EncodedIconSvg}"
            alt=""
        />
    {/if}
    <div class="runtime-name">{runtimeStartupEvent.runtimeName}</div>
    <div class="action">{statusText}</div>
</div>

<style>
    .runtime-startup-progress {
        display: flex;
        flex-direction: column;
    }

    .action,
    .runtime-name {
        margin: 2px;
        text-transform: uppercase;
        text-align: center;
    }

    .action {
        font-size: 11px;
    }

    .runtime-name {
        font-weight: bold;
    }

    .runtime-startup-progress-icon {
        height: 50px;
    }
</style>
