<script lang="ts">
    /**
     * PlotProgressBar component.
     * A progress bar component for showing plot rendering progress.
     * Matches Positron's ProgressBar usage in DynamicPlotInstance.
     *
     * Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
     * Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
     */

    import { onMount, onDestroy } from "svelte";

    interface Props {
        /** Whether to show infinite progress (no estimated time) */
        infinite?: boolean;
        /** Total work units (milliseconds for render estimate) */
        total?: number;
        /** Whether the progress is complete */
        done?: boolean;
    }

    let { infinite = false, total = 0, done = false }: Props = $props();

    let startTime: number = Date.now();
    let animationFrame: number | undefined;
    let progress = $state(0);

    // Update progress based on elapsed time
    function updateProgress() {
        if (done || infinite) {
            return;
        }

        const elapsed = Date.now() - startTime;
        if (total > 0) {
            progress = Math.min((elapsed / total) * 100, 100);
        }

        if (!done && progress < 100) {
            animationFrame = requestAnimationFrame(updateProgress);
        }
    }

    onMount(() => {
        startTime = Date.now();
        if (!infinite && total > 0) {
            animationFrame = requestAnimationFrame(updateProgress);
        }
    });

    onDestroy(() => {
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
        }
    });

    // Effect to handle done state
    $effect(() => {
        if (done) {
            progress = 100;
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
            }
        }
    });
</script>

<div class="plot-progress-bar">
    {#if infinite}
        <div class="progress-bar-infinite"></div>
    {:else}
        <div class="progress-bar-determinate" style="width: {progress}%;"></div>
    {/if}
</div>

<style>
    .plot-progress-bar {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        z-index: 10;
        overflow: hidden;
    }

    .progress-bar-determinate {
        height: 100%;
        background: var(--vscode-progressBar-background);
        transition: width 0.1s ease-out;
    }

    .progress-bar-infinite {
        height: 100%;
        width: 30%;
        background: var(--vscode-progressBar-background);
        animation: infinite-progress 1.5s ease-in-out infinite;
    }

    @keyframes infinite-progress {
        0% {
            transform: translateX(-100%);
        }
        100% {
            transform: translateX(400%);
        }
    }
</style>
