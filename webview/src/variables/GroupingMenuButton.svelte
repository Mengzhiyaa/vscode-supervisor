<script lang="ts">
    import ActionBarMenuButton from "../shared/ActionBarMenuButton.svelte";
    import type { VariablesGrouping } from "../types/variables";
    import { localize } from "$lib/localization";

    interface Props {
        currentGrouping?: VariablesGrouping;
        onselectGrouping?: (grouping: VariablesGrouping) => void;
    }

    let { currentGrouping = "none", onselectGrouping }: Props = $props();

    const groupingLabels: Record<VariablesGrouping, string> = {
        none: localize("variables.none", "None"),
        kind: localize("variables.kind", "Kind"),
        size: localize("variables.size", "Size"),
    };

    function actions() {
        return (["none", "kind", "size"] as VariablesGrouping[]).flatMap(
            (grouping, index) => [
                ...(index === 1
                    ? [{ id: "separator", label: "", separator: true }]
                    : []),
                {
                    id: grouping,
                    label: groupingLabels[grouping],
                    checked: currentGrouping === grouping,
                    onSelected: () => onselectGrouping?.(grouping),
                },
            ],
        );
    }
</script>

<ActionBarMenuButton
    icon="positron-variables-grouping"
    tooltip={localize("variables.grouping", "Change how variables are grouped")}
    ariaLabel={localize("variables.grouping", "Change how variables are grouped")}
    {actions}
/>
