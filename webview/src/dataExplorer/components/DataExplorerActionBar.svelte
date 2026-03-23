<!--
  DataExplorerActionBar.svelte
  Top action bar for the data explorer panel.
  Mirrors Positron's actionBar.tsx and layoutMenuButton.tsx.
-->
<script lang="ts">
    import ActionBarButton from "../../shared/ActionBarButton.svelte";
    import ActionBarMenuButton from "../../shared/ActionBarMenuButton.svelte";
    import { localize } from "../nls";
    import { PositronDataExplorerLayout } from "../types";

    interface Props {
        layout: PositronDataExplorerLayout;
        moveToNewWindowDisabled?: boolean;
        onClearSorting?: () => void;
        onLayoutChange?: (layout: PositronDataExplorerLayout) => void;
        onMoveToNewWindow?: () => void;
    }

    let {
        layout,
        moveToNewWindowDisabled = false,
        onClearSorting,
        onLayoutChange,
        onMoveToNewWindow,
    }: Props = $props();

    const clearSortButtonDescription = localize(
        "positron.clearSortButtonDescription",
        "Clear sorting",
    );
    const clearSortButtonTitle = localize(
        "positron.clearSortButtonTitle",
        "Clear Sorting",
    );
    const layoutButtonTitle = localize(
        "positron.layoutButtonTitle",
        "Layout",
    );
    const layoutButtonDescription = localize(
        "positron.layoutButtonDescription",
        "Change layout",
    );
    const summaryOnLeftLabel = localize(
        "positron.summaryOnLeft",
        "Summary on Left",
    );
    const summaryOnRightLabel = localize(
        "positron.summaryOnRight",
        "Summary on Right",
    );
    const moveIntoNewWindowButtonDescription = localize(
        "positron.moveIntoNewWindowButtonDescription",
        "Move into New Window",
    );

    function selectLayoutIcon(value: PositronDataExplorerLayout): string {
        switch (value) {
            case PositronDataExplorerLayout.SummaryOnRight:
                return "positron-data-explorer-summary-on-right";
            case PositronDataExplorerLayout.SummaryOnLeft:
            default:
                return "positron-data-explorer-summary-on-left";
        }
    }
</script>

<div class="action-bar">
    <div class="positron-action-bar border-bottom data-explorer-action-bar">
        <div class="action-bar-region left">
            <ActionBarButton
                icon="positron-clear-sorting"
                label={clearSortButtonTitle}
                ariaLabel={clearSortButtonDescription}
                tooltip={clearSortButtonDescription}
                onclick={() => onClearSorting?.()}
            />
        </div>
        <div class="action-bar-region right">
            <ActionBarMenuButton
                icon={selectLayoutIcon(layout)}
                label={layoutButtonTitle}
                tooltip={layoutButtonDescription}
                ariaLabel={layoutButtonDescription}
                actions={() => [
                    {
                        id: "summary-on-left",
                        label: summaryOnLeftLabel,
                        checked:
                            layout ===
                            PositronDataExplorerLayout.SummaryOnLeft,
                        onSelected: () =>
                            onLayoutChange?.(
                                PositronDataExplorerLayout.SummaryOnLeft,
                            ),
                    },
                    {
                        id: "summary-on-right",
                        label: summaryOnRightLabel,
                        checked:
                            layout ===
                            PositronDataExplorerLayout.SummaryOnRight,
                        onSelected: () =>
                            onLayoutChange?.(
                                PositronDataExplorerLayout.SummaryOnRight,
                            ),
                    },
                ]}
            />
            <ActionBarButton
                icon="positron-open-in-new-window"
                ariaLabel={moveIntoNewWindowButtonDescription}
                tooltip={moveIntoNewWindowButtonDescription}
                disabled={moveToNewWindowDisabled}
                onclick={() => onMoveToNewWindow?.()}
            />
        </div>
    </div>
</div>

<style>
    .action-bar {
        height: var(--vscode-positronActionBar-height);
        grid-row: action-bar / filter-bar;
        --vscode-positronActionBar-background: var(
            --vscode-positronDataExplorer-contrastBackground
        );
    }

    .data-explorer-action-bar {
        padding-left: 8px;
        padding-right: 8px;
    }
</style>
