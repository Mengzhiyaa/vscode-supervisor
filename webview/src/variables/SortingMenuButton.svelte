<script lang="ts">
    import ActionBarMenuButton from "../shared/ActionBarMenuButton.svelte";
    import type { VariablesSorting } from "../types/variables";
    import { localize } from "$lib/localization";

    interface Props {
        currentSorting?: VariablesSorting;
        highlightRecent?: boolean;
        onselectSorting?: (sorting: VariablesSorting) => void;
        ontoggleHighlightRecent?: () => void;
    }

    let {
        currentSorting = "name",
        highlightRecent = false,
        onselectSorting,
        ontoggleHighlightRecent,
    }: Props = $props();

    const sortingLabels: Record<VariablesSorting, string> = {
        name: localize("variables.name", "Name"),
        size: localize("variables.size", "Size"),
        recent: localize("variables.recent", "Recent"),
    };

    function actions() {
        return [
            ...(["name", "size", "recent"] as VariablesSorting[]).map(
                (sorting) => ({
                    id: sorting,
                    label: sortingLabels[sorting],
                    checked: currentSorting === sorting,
                    onSelected: () => onselectSorting?.(sorting),
                }),
            ),
            { id: "separator", label: "", separator: true },
            {
                id: "highlight-recent",
                label: localize("variables.highlightRecent", "Highlight recent values"),
                checked: highlightRecent,
                onSelected: () => ontoggleHighlightRecent?.(),
            },
        ];
    }
</script>

<ActionBarMenuButton
    icon="positron-variables-sorting"
    tooltip={localize("variables.sorting", "Change how variables are sorted")}
    ariaLabel={localize("variables.sorting", "Change how variables are sorted")}
    {actions}
/>
