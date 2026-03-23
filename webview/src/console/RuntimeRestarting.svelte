<!--
    RuntimeRestarting.svelte
    
    Animated indicator displayed while the R kernel is restarting.
    Mirrors: positron/.../components/runtimeStarting.tsx + runtimeStarting.css
-->
<script lang="ts">
    import type { RuntimeItemRestarting } from "./classes";

    interface Props {
        runtimeItemRestarting: RuntimeItemRestarting;
    }

    let { runtimeItemRestarting }: Props = $props();
</script>

<div class="runtime-restarting">
    <div class="left-bar"></div>
    <div class="restarting-message">
        {runtimeItemRestarting.sessionName} restarting.
    </div>
</div>

<style>
    .runtime-restarting {
        display: grid;
        margin-left: -10px;
        grid-template-columns: 10px 1fr;
    }

    .left-bar {
        width: 4px;
        display: flex;
        opacity: 0.75;
        background-image: repeating-linear-gradient(
            45deg,
            var(--vscode-positronConsole-ansiBrightBlue),
            var(--vscode-positronConsole-ansiBrightBlue) 3px,
            transparent 3px,
            transparent 6px
        );
        background-size: 8.49px 8.49px;
        animation: move-stripes 1s linear infinite;
    }

    .restarting-message {
        padding: 4px 0;
        display: flex;
        color: var(--vscode-descriptionForeground);
    }

    @keyframes move-stripes {
        0% {
            background-position: 0 0;
        }

        100% {
            background-position: 8.49px 0;
        }
    }
</style>
