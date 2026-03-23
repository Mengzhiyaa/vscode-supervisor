<!--
  SummaryRowSortDropdown.svelte - Sort dropdown for summary rows
  Port from Positron's summaryRowSortDropdown.tsx
-->
<script lang="ts">
    import ActionBarMenuButton from "../../../../../shared/ActionBarMenuButton.svelte";
    import { localize } from "../../../../nls";
    import type { SearchSchemaSortOrder } from "../../../../types";

    interface Props {
        currentSort: SearchSchemaSortOrder;
        disabled?: boolean;
        onSortChanged: (sortOption: SearchSchemaSortOrder) => void;
    }

    let { currentSort, disabled = false, onSortChanged }: Props = $props();

    const sortSummaryLabel = localize(
        "positron.dataExplorer.sort",
        "Sort summary row data",
    );

    const sortOptions: Array<{
        id: SearchSchemaSortOrder;
        label: string;
        option: SearchSchemaSortOrder;
    }> = [
        {
            id: "original",
            label: localize(
                "positron.dataExplorer.sortByOriginal",
                "Sort by Original",
            ),
            option: "original",
        },
        {
            id: "ascending_name",
            label: localize(
                "positron.dataExplorer.sortByNameAsc",
                "Sort by Name, Ascending",
            ),
            option: "ascending_name",
        },
        {
            id: "descending_name",
            label: localize(
                "positron.dataExplorer.sortByNameDesc",
                "Sort by Name, Descending",
            ),
            option: "descending_name",
        },
        {
            id: "ascending_type",
            label: localize(
                "positron.dataExplorer.sortByTypeAsc",
                "Sort by Type, Ascending",
            ),
            option: "ascending_type",
        },
        {
            id: "descending_type",
            label: localize(
                "positron.dataExplorer.sortByTypeDesc",
                "Sort by Type, Descending",
            ),
            option: "descending_type",
        },
    ];

    const sortLabelMap = new Map(
        sortOptions.map((option) => [option.id, option.label]),
    );

    const currentSortLabel = $derived(
        sortLabelMap.get(currentSort) ??
            localize(
                "positron.dataExplorer.sortByOriginal",
                "Sort by Original",
            ),
    );
</script>

<ActionBarMenuButton
    label={currentSortLabel}
    tooltip={sortSummaryLabel}
    ariaLabel={sortSummaryLabel}
    {disabled}
    buttonClass="summary-sort-button"
    actions={() =>
        sortOptions.map((option) => ({
            id: option.id,
            label: option.label,
            checked: currentSort === option.option,
            disabled,
            onSelected: () => onSortChanged(option.option),
        }))}
/>
