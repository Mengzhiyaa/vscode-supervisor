<!--
  ActionBars.svelte
  Variables panel action bars — primary bar uses DynamicActionBar for overflow.
  Mirrors: positron/positronVariables/browser/components/actionBars.tsx
-->
<script lang="ts">
    import "../shared/actionBar.css";
    import ActionBarButton from "../shared/ActionBarButton.svelte";
    import ActionBarFilter from "../shared/ActionBarFilter.svelte";
    import DynamicActionBar, {
        type DynamicAction,
    } from "../shared/DynamicActionBar.svelte";
    import GroupingMenuButton from "./GroupingMenuButton.svelte";
    import SortingMenuButton from "./SortingMenuButton.svelte";
    import VariablesInstanceMenuButton from "./VariablesInstanceMenuButton.svelte";
    import type {
        VariablesInstance,
        VariablesGrouping,
        VariablesSorting,
    } from "../types/variables";

    // Props using Svelte 5 runes
    interface Props {
        filterText?: string;
        grouping?: VariablesGrouping;
        sorting?: VariablesSorting;
        highlightRecent?: boolean;
        instances?: VariablesInstance[];
        activeInstanceId?: string;
        hasActiveInstance?: boolean;
        onrefresh?: () => void;
        ondeleteAll?: () => void;
        onfilterChange?: (text: string) => void;
        ongroupingChange?: (grouping: VariablesGrouping) => void;
        onsortingChange?: (sorting: VariablesSorting) => void;
        onhighlightRecentChange?: (value: boolean) => void;
        onselectInstance?: (id: string) => void;
    }

    let {
        filterText = "",
        grouping = "none",
        sorting = "name",
        highlightRecent = false,
        instances = [],
        activeInstanceId,
        hasActiveInstance = true,
        onrefresh,
        ondeleteAll,
        onfilterChange,
        ongroupingChange,
        onsortingChange,
        onhighlightRecentChange,
        onselectInstance,
    }: Props = $props();

    // Localized strings (matching Positron)
    const refreshObjectsLabel = "Refresh objects";
    const deleteAllObjectsLabel = "Delete all objects";

    function handleFilterTextChanged(value: string) {
        onfilterChange?.(value);
    }

    function handleRefresh() {
        onrefresh?.();
    }

    function handleDeleteAll() {
        ondeleteAll?.();
    }

    // --- DynamicActionBar actions for primary row ---
    const leftActions: DynamicAction[] = $derived([
        {
            fixedWidth: 36,
            separator: false,
            component: groupingMenuSnippet,
        },
        {
            fixedWidth: 36,
            separator: false,
            component: sortingMenuSnippet,
        },
    ]);

    const rightActions: DynamicAction[] = $derived([
        {
            fixedWidth: 24,
            separator: true,
            component: refreshSnippet,
            overflowMenuItem: {
                label: refreshObjectsLabel,
                icon: "positron-refresh",
                onSelected: handleRefresh,
            },
        },
        {
            fixedWidth: 24,
            separator: false,
            component: deleteAllSnippet,
            overflowMenuItem: {
                label: deleteAllObjectsLabel,
                icon: "clear-all",
                onSelected: handleDeleteAll,
            },
        },
    ]);
</script>

{#snippet groupingMenuSnippet()}
    <GroupingMenuButton
        currentGrouping={grouping}
        onselectGrouping={(g) => ongroupingChange?.(g)}
    />
{/snippet}

{#snippet sortingMenuSnippet()}
    <SortingMenuButton
        currentSorting={sorting}
        {highlightRecent}
        onselectSorting={(s) => onsortingChange?.(s)}
        ontoggleHighlightRecent={() => onhighlightRecentChange?.(!highlightRecent)}
    />
{/snippet}

{#snippet refreshSnippet()}
    <ActionBarButton
        icon="positron-refresh"
        ariaLabel={refreshObjectsLabel}
        tooltip={refreshObjectsLabel}
        onclick={handleRefresh}
    />
{/snippet}

{#snippet deleteAllSnippet()}
    <ActionBarButton
        icon="clear-all"
        ariaLabel={deleteAllObjectsLabel}
        tooltip={deleteAllObjectsLabel}
        onclick={handleDeleteAll}
    />
{/snippet}

{#if hasActiveInstance}
    <div class="action-bars">
        <!-- Primary action bar (with overflow) -->
        <DynamicActionBar
            {leftActions}
            {rightActions}
            paddingLeft={8}
            paddingRight={8}
            borderTop={true}
            borderBottom={true}
        />

        <!-- Secondary action bar -->
        <div
            class="positron-action-bar border-bottom secondary"
            style="padding-left: 8px; padding-right: 8px;"
        >
            <div class="action-bar-region left">
                <VariablesInstanceMenuButton
                    {instances}
                    {activeInstanceId}
                    {onselectInstance}
                />
            </div>
            <div class="action-bar-region right">
                <ActionBarFilter
                    width={150}
                    {filterText}
                    onfilterTextChanged={handleFilterTextChanged}
                />
            </div>
        </div>
    </div>
{/if}

<style>
    .action-bars {
        display: flex;
        flex-direction: column;
    }

    .secondary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: var(--vscode-positronActionBar-height, 28px);
        gap: 4px;
    }
</style>
