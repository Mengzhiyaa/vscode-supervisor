<!--
    ActivityOutputPlot.svelte
    
    Renders plot/image output from a language runtime.
    Mirrors: positron/.../components/activityOutputPlot.tsx
-->
<script lang="ts">
    import type { ActivityItemOutputPlot } from "./classes";
    import ConsoleOutputLines from "./ConsoleOutputLines.svelte";

    interface Props {
        activityItemOutputPlot: ActivityItemOutputPlot;
    }

    let { activityItemOutputPlot }: Props = $props();

    function handleClick() {
        activityItemOutputPlot.onSelected();
    }
</script>

<div class="activity-output-plot">
    <!-- Render any text caption/output lines first -->
    <ConsoleOutputLines outputLines={activityItemOutputPlot.outputLines} />

    <!-- Render the plot image -->
    <button
        class="plot-container"
        onclick={handleClick}
        title="Select this plot in the Plots pane"
        type="button"
    >
        <img
            src={activityItemOutputPlot.plotUri}
            alt="Plot output"
            class="plot-image"
        />
        <span class="inspect-icon codicon codicon-search"></span>
    </button>
</div>

<style>
    .activity-output-plot {
        padding: 4px 0;
    }

    .plot-container {
        display: inline-block;
        position: relative;
        cursor: pointer;
        border: none;
        padding: 0;
        background: transparent;
        border-radius: 4px;
        overflow: hidden;
    }

    .plot-container:hover {
        outline: 2px solid var(--vscode-focusBorder);
    }

    .plot-container:hover .inspect-icon {
        opacity: 1;
    }

    .plot-image {
        max-width: 100%;
        max-height: 300px;
        display: block;
    }

    .inspect-icon {
        position: absolute;
        top: 8px;
        right: 8px;
        padding: 4px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-radius: 2px;
        opacity: 0;
        transition: opacity 0.2s;
    }
</style>
