<!--
    RuntimeActivity.svelte
    
    Renders a single RuntimeItemActivity with its activity items.
    Mirrors: positron/.../components/runtimeActivity.tsx
-->
<script lang="ts">
    import ActivityInput from "./ActivityInput.svelte";
    import ActivityOutputStream from "./ActivityOutputStream.svelte";
    import ActivityErrorStream from "./ActivityErrorStream.svelte";
    import ActivityErrorMessage from "./ActivityErrorMessage.svelte";
    import ActivityOutputHtml from "./ActivityOutputHtml.svelte";
    import ActivityOutputMessage from "./ActivityOutputMessage.svelte";
    import ActivityOutputPlot from "./ActivityOutputPlot.svelte";
    import ActivityPrompt from "./ActivityPrompt.svelte";
    import {
        RuntimeItemActivity,
        ActivityItemInput,
        ActivityItemStream,
        ActivityItemStreamType,
        ActivityItemErrorMessage,
        ActivityItemOutputHtml,
        ActivityItemOutputMessage,
        ActivityItemOutputPlot,
        ActivityItemPrompt,
    } from "./classes";

    interface Props {
        runtimeItemActivity: RuntimeItemActivity;
        charWidth?: number;
    }

    let { runtimeItemActivity, charWidth = 0 }: Props = $props();
    let activityItemsStore = $derived(runtimeItemActivity.activityItemsStore);

    // Pre-filter visible items using $derived for better reactivity and performance
    let visibleActivityItems = $derived(
        $activityItemsStore.filter((item) => !item.isHidden),
    );
</script>

<div class="runtime-activity" data-execution-id={runtimeItemActivity.id}>
    {#each visibleActivityItems as activityItem (activityItem.id)}
        {#if activityItem instanceof ActivityItemInput}
            <ActivityInput activityItemInput={activityItem} {charWidth} />
        {:else if activityItem instanceof ActivityItemStream}
            {#if activityItem.type === ActivityItemStreamType.OUTPUT}
                <ActivityOutputStream activityItemStream={activityItem} />
            {:else if activityItem.type === ActivityItemStreamType.ERROR}
                <ActivityErrorStream activityItemStream={activityItem} />
            {/if}
        {:else if activityItem instanceof ActivityItemErrorMessage}
            <ActivityErrorMessage activityItemErrorMessage={activityItem} />
        {:else if activityItem instanceof ActivityItemOutputHtml}
            <ActivityOutputHtml activityItemOutputHtml={activityItem} />
        {:else if activityItem instanceof ActivityItemOutputMessage}
            <ActivityOutputMessage activityItemOutputMessage={activityItem} />
        {:else if activityItem instanceof ActivityItemOutputPlot}
            <ActivityOutputPlot activityItemOutputPlot={activityItem} />
        {:else if activityItem instanceof ActivityItemPrompt}
            <ActivityPrompt activityItemPrompt={activityItem} />
        {:else}
            <!-- Unknown activity item type -->
            <div class="activity-item-unknown">Unknown activity item</div>
        {/if}
    {/each}
</div>

<style>
    .runtime-activity {
        white-space: normal;
    }

    .activity-item-unknown {
        padding: 4px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
    }
</style>
