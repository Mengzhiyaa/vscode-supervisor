<!--
  layoutMenuButton.svelte
  Layout menu for the data explorer action bar.
  Mirrors Positron's layoutMenuButton.tsx.
-->
<script lang="ts">
    import ActionBarMenuButton from "../../../../shared/ActionBarMenuButton.svelte";
    import { getDataExplorerContext } from "../../../positronDataExplorerContext";
    import { localize } from "../../../nls";
    import { PositronDataExplorerLayout } from "../../../types";

    const context = getDataExplorerContext();
    const { instance, stores } = context;
    const { state: explorerState } = stores;
    const currentLayout = $derived(
        $explorerState.layout ?? PositronDataExplorerLayout.SummaryOnLeft,
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

<ActionBarMenuButton
    icon={selectLayoutIcon(currentLayout)}
    label={layoutButtonTitle}
    tooltip={layoutButtonDescription}
    ariaLabel={layoutButtonDescription}
    actions={() => [
        {
            id: "SummaryOnLeft",
            label: summaryOnLeftLabel,
            checked: currentLayout === PositronDataExplorerLayout.SummaryOnLeft,
            onSelected: () => {
                instance.layout = PositronDataExplorerLayout.SummaryOnLeft;
            },
        },
        {
            id: "SummaryOnRight",
            label: summaryOnRightLabel,
            checked:
                currentLayout === PositronDataExplorerLayout.SummaryOnRight,
            onSelected: () => {
                instance.layout = PositronDataExplorerLayout.SummaryOnRight;
            },
        },
    ]}
/>
