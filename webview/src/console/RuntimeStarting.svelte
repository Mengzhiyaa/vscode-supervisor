<!--
    RuntimeStarting.svelte

    Displays a session-scoped starting/restarting/reconnecting runtime item.
    Mirrors: positron/.../components/runtimeStarting.tsx
-->
<script lang="ts">
    import type { RuntimeItemStarting } from "./classes";
    import ConsoleOutputLines from "./ConsoleOutputLines.svelte";

    interface RuntimeStartingProps {
        runtimeItemStarting: RuntimeItemStarting;
    }

    let { runtimeItemStarting }: RuntimeStartingProps = $props();
</script>

<div class="runtime-starting">
    <div class="left-bar"></div>
    <div class="starting-message">
        <ConsoleOutputLines outputLines={runtimeItemStarting.outputLines} />
    </div>
</div>

<style>
    .runtime-starting {
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

    .starting-message {
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
