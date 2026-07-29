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

    const positronDataExplorerSummarySort = localize(
        "positron.dataExplorer.sort",
        "Sort summary row data",
    );
    const positronSortByOriginal = localize(
        "positron.dataExplorer.sortByOriginal",
        "Sort by Original",
    );
    const positronSortByNameAsc = localize(
        "positron.dataExplorer.sortByNameAsc",
        "Sort by Name, Ascending",
    );
    const positronSortByNameDesc = localize(
        "positron.dataExplorer.sortByNameDesc",
        "Sort by Name, Descending",
    );
    const positronSortByTypeAsc = localize(
        "positron.dataExplorer.sortByTypeAsc",
        "Sort by Type, Ascending",
    );
    const positronSortByTypeDesc = localize(
        "positron.dataExplorer.sortByTypeDesc",
        "Sort by Type, Descending",
    );

    const sortOptions: Array<{
        id: SearchSchemaSortOrder;
        label: string;
        option: SearchSchemaSortOrder;
    }> = [
        {
            id: "original",
            label: positronSortByOriginal,
            option: "original",
        },
        {
            id: "ascending_name",
            label: positronSortByNameAsc,
            option: "ascending_name",
        },
        {
            id: "descending_name",
            label: positronSortByNameDesc,
            option: "descending_name",
        },
        {
            id: "ascending_type",
            label: positronSortByTypeAsc,
            option: "ascending_type",
        },
        {
            id: "descending_type",
            label: positronSortByTypeDesc,
            option: "descending_type",
        },
    ];

    const sortLabelMap = new Map(
        sortOptions.map((option) => [option.id, option.label]),
    );

    const currentSortLabel = $derived(
        sortLabelMap.get(currentSort) ?? positronSortByOriginal,
    );
</script>

<ActionBarMenuButton
    label={currentSortLabel}
    tooltip={positronDataExplorerSummarySort}
    ariaLabel={positronDataExplorerSummarySort}
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
