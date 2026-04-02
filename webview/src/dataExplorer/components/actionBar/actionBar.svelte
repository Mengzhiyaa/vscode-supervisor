<!--
  actionBar.svelte
  Top action bar for the data explorer panel.
  Mirrors Positron's actionBar.tsx.
-->
<script lang="ts">
    import ActionBarButton from "../../../shared/ActionBarButton.svelte";
    import LayoutMenuButton from "./components/layoutMenuButton.svelte";
    import { getDataExplorerContext } from "../../positronDataExplorerContext";
    import { localize } from "../../nls";

    const context = getDataExplorerContext();
    const { instance, postMessage, stores } = context;
    const { state: explorerState } = stores;
    const moveToNewWindowDisabled = $derived(
        $explorerState.inNewWindow ?? false,
    );

    const clearSortButtonDescription = localize(
        "positron.clearSortButtonDescription",
        "Clear sorting",
    );
    const clearSortButtonTitle = localize(
        "positron.clearSortButtonTitle",
        "Clear Sorting",
    );
    const moveIntoNewWindowButtonDescription = localize(
        "positron.moveIntoNewWindowButtonDescription",
        "Move into New Window",
    );
</script>

<div class="action-bar">
    <div class="positron-action-bar border-bottom data-explorer-action-bar">
        <div class="action-bar-region left">
            <ActionBarButton
                icon="positron-clear-sorting"
                label={clearSortButtonTitle}
                ariaLabel={clearSortButtonDescription}
                tooltip={clearSortButtonDescription}
                onclick={() => {
                    void instance.clearColumnSorting();
                }}
            />
        </div>
        <div class="action-bar-region right">
            <LayoutMenuButton />
            <ActionBarButton
                icon="positron-open-in-new-window"
                ariaLabel={moveIntoNewWindowButtonDescription}
                tooltip={moveIntoNewWindowButtonDescription}
                disabled={moveToNewWindowDisabled}
                onclick={() => {
                    postMessage({ type: "moveToNewWindow" });
                }}
            />
        </div>
    </div>
</div>

<style>
    .action-bar {
        height: var(--vscode-positronActionBar-height);
        grid-row: action-bar / data-explorer-panel;
        grid-column: content / end-columns;
        --vscode-positronActionBar-background: var(
            --vscode-positronDataExplorer-contrastBackground
        );
    }

    .data-explorer-action-bar {
        padding-left: 8px;
        padding-right: 8px;
    }
</style>
