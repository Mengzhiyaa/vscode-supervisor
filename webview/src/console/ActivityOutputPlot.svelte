<!--
    ActivityOutputPlot.svelte
    
    Renders plot/image output from a language runtime.
    Mirrors: positron/.../components/activityOutputPlot.tsx
-->
<script lang="ts">
    import { localize } from "$lib/localization";
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

<ConsoleOutputLines outputLines={activityItemOutputPlot.outputLines} />

<button
    class="activity-output-plot"
    onclick={handleClick}
    title={localize("console.plot.select", "Select this plot in the Plots pane")}
    type="button"
>
    <img
        src={activityItemOutputPlot.plotUri}
        alt={localize("console.plot.output", "Plot output")}
        class="plot-image"
    />
    <span class="inspect-icon codicon codicon-positron-search"></span>
</button>

<style>
    .activity-output-plot {
        display: inline-block;
        position: relative;
        cursor: pointer;
        border: none;
        padding: 0;
        background: transparent;
        overflow: hidden;
    }

    .activity-output-plot:hover img {
        outline: 1px solid var(--vscode-tab-border);
        outline-offset: -1px;
    }

    .activity-output-plot:hover .inspect-icon {
        display: block;
    }

    .activity-output-plot:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
    }

    .plot-image {
        max-width: 100%;
        max-height: 300px;
        display: block;
        padding: 5px;
        border-radius: 4px;
    }

    .inspect-icon {
        position: absolute;
        top: 3px;
        right: 3px;
        display: none;
        color: var(--vscode-textLink-foreground);
    }
</style>
