<!--
  RowFilterBar.svelte - Row filter bar container (Svelte 5 runes mode)
  Port from Positron's rowFilterBar.tsx
-->
<script lang="ts">
    import { tick } from "svelte";
    import { getDataExplorerContext } from "../../../../positronDataExplorerContext";
    import RowFilterWidget from "./components/rowFilterWidget.svelte";
    import AddEditRowFilterModalPopup from "../addEditRowFilterModalPopup/addEditRowFilterModalPopup.svelte";
    import {
        getRowFilterDescriptor,
        type RowFilterDescriptor,
    } from "../addEditRowFilterModalPopup/rowFilterDescriptor";
    import type { SchemaColumn } from "../../../../../dataGrid/types";
    import { MAX_ADVANCED_LAYOUT_ENTRY_COUNT } from "../../../../../dataGrid/classes/layoutManager";
    import PositronContextMenu, {
        type ContextMenuItem as PositronContextMenuItem,
    } from "../../../../../dataGrid/components/ContextMenu.svelte";
    import PositronModalDialog from "../../../positronModalDialog/positronModalDialog.svelte";
    import ContentArea from "../../../positronModalDialog/components/contentArea.svelte";
    import PlatformNativeDialogActionBar from "../../../positronModalDialog/components/platformNativeDialogActionBar.svelte";
    import { localize } from "../../../../nls";

    const MAX_ROW_FILTERS = 15;

    const context = getDataExplorerContext();
    const {
        stores,
        postMessage,
        invalidateTableData,
    } = context;
    const tableDataDataGridInstance = $derived(
        context.instance.tableDataDataGridInstance,
    );
    const {
        rowFilters,
        columns,
        pendingAddFilterRequest,
        state: explorerState,
    } = stores;

    let showModal = $state(false);
    let editingFilter = $state<RowFilterDescriptor | undefined>(undefined);
    let editingFilterId = $state<string | undefined>(undefined);
    let selectedColumn = $state<SchemaColumn | undefined>(undefined);
    let lastRequestId = $state(-1);
    let rowFiltersHidden = $state(false);
    let modalAnchorElement = $state<HTMLElement | null>(null);
    let showFilterLimitDialog = $state(false);

    let showMenu = $state(false);
    let menuItems = $state<PositronContextMenuItem[]>([]);
    let menuX = $state(0);
    let menuY = $state(0);

    let manageButtonRef = $state<HTMLButtonElement | null>(null);
    let addFilterButtonRef = $state<HTMLButtonElement | null>(null);
    let filterEntriesRef = $state<HTMLDivElement | null>(null);
    let pendingRemovalFocus = $state<
        | {
              removedFilterId: string;
              targetFilterId?: string;
          }
        | null
    >(null);

    const totalColumns = $derived(
        $explorerState.backendState?.table_shape.num_columns ?? 0,
    );

    const disableFiltering = $derived(
        totalColumns >= MAX_ADVANCED_LAYOUT_ENTRY_COUNT,
    );

    const canFilter = $derived.by(() => {
        const supportStatus =
            $explorerState.backendState?.supported_features?.set_row_filters
                ?.support_status ?? "unsupported";
        return supportStatus.toLowerCase() === "supported" && !disableFiltering;
    });

    const rowFilterDescriptors = $derived(
        $rowFilters.map((filter) => ({
            filter,
            descriptor: getRowFilterDescriptor(filter),
        })),
    );

    const hasFilters = $derived(rowFilterDescriptors.length > 0);
    const atFilterLimit = $derived(
        rowFilterDescriptors.length >= MAX_ROW_FILTERS,
    );

    function showHover(anchorElement: HTMLElement, content: string) {
        if (!tableDataDataGridInstance?.hoverManager) {
            return;
        }

        tableDataDataGridInstance.hoverManager.showHover(anchorElement, content);
    }

    function hideHover() {
        tableDataDataGridInstance?.hoverManager?.hideHover();
    }

    function handleAddFilter(anchor?: HTMLElement | null) {
        if (!canFilter) {
            return;
        }

        if (atFilterLimit) {
            showFilterLimitMessage();
            return;
        }

        requestCompleteSchema();
        editingFilter = undefined;
        editingFilterId = undefined;
        selectedColumn = undefined;
        modalAnchorElement = anchor ?? addFilterButtonRef ?? null;
        showModal = true;
    }

    function restoreModalAnchorFocus(anchor: HTMLElement | null | undefined) {
        if (!anchor?.isConnected) {
            return;
        }

        queueMicrotask(() => {
            if (anchor.isConnected) {
                anchor.focus();
            }
        });
    }

    function handleApplyFilter(filter: RowFilterDescriptor) {
        const anchor = modalAnchorElement;
        const backendFilter = {
            ...filter.backendFilter,
            filter_id: editingFilterId ?? filter.backendFilter.filter_id,
        };

        if (editingFilterId) {
            invalidateTableData?.();
            postMessage({
                type: "updateFilter",
                filter: backendFilter,
            });
        } else {
            invalidateTableData?.();
            postMessage({
                type: "addFilter",
                filter: backendFilter,
            });
        }

        showModal = false;
        editingFilter = undefined;
        editingFilterId = undefined;
        selectedColumn = undefined;
        modalAnchorElement = null;
        restoreModalAnchorFocus(anchor);
    }

    function handleCancelModal(options?: { restoreFocus?: boolean }) {
        const anchor = modalAnchorElement;
        showModal = false;
        editingFilter = undefined;
        editingFilterId = undefined;
        selectedColumn = undefined;
        modalAnchorElement = null;
        if (options?.restoreFocus) {
            restoreModalAnchorFocus(anchor);
        }
    }

    function handleRemoveFilter(
        filterId: string,
        options?: { restoreFocus?: boolean },
    ) {
        if (options?.restoreFocus) {
            const currentIndex = rowFilterDescriptors.findIndex(
                (entry) => entry.filter.filter_id === filterId,
            );
            const targetFilterId =
                rowFilterDescriptors[currentIndex + 1]?.filter.filter_id ??
                rowFilterDescriptors[currentIndex - 1]?.filter.filter_id;

            pendingRemovalFocus = {
                removedFilterId: filterId,
                targetFilterId,
            };
        }

        invalidateTableData?.();
        postMessage({ type: "removeFilter", filterId });
    }

    function handleEditFilter(
        filter: import("../../../../../dataGrid/types").RowFilter,
        descriptor: RowFilterDescriptor,
        anchor?: HTMLElement | null,
    ) {
        editingFilterId = filter.filter_id;
        editingFilter = descriptor;
        selectedColumn = filter.column_schema;
        requestCompleteSchema();
        modalAnchorElement = anchor ?? addFilterButtonRef ?? null;
        showModal = true;
    }

    function handleClearAllFilters() {
        invalidateTableData?.();
        postMessage({ type: "clearFilters" });
    }

    function showFilterLimitMessage() {
        showFilterLimitDialog = true;
    }

    function closeFilterLimitDialog() {
        showFilterLimitDialog = false;
    }

    function handleManageMenu() {
        if (!manageButtonRef) {
            return;
        }

        const rect = manageButtonRef.getBoundingClientRect();
        menuX = rect.left;
        menuY = rect.bottom + 2;

        menuItems = [
            {
                id: "add-filter",
                icon: "positron-add-filter",
                label: localize("positron.addFilter", "Add Filter"),
                disabled: !canFilter,
                onClick: () => handleAddFilter(manageButtonRef),
            },
            { id: "sep-add", label: "", separator: true },
            rowFiltersHidden
                ? {
                      id: "show-filters",
                      icon: "positron-show-filters",
                      label: localize("positron.showFilters", "Show Filters"),
                      onClick: () => {
                          rowFiltersHidden = false;
                      },
                  }
                : {
                      id: "hide-filters",
                      icon: "positron-hide-filters",
                      label: localize("positron.hideFilters", "Hide Filters"),
                      disabled: !hasFilters,
                      onClick: () => {
                          rowFiltersHidden = true;
                      },
                  },
            { id: "sep-visibility", label: "", separator: true },
            {
                id: "clear-filters",
                icon: "positron-clear-row-filters",
                label: localize("positron.clearFilters", "Clear Filters"),
                disabled: !hasFilters,
                onClick: handleClearAllFilters,
            },
        ];

        showMenu = !showMenu;
    }

    function closeMenu() {
        showMenu = false;
    }

    const schemaColumns = $derived.by(() =>
        [...($columns ?? [])]
            .map(
                (column: SchemaColumn, index: number) =>
                    ({
                        column_name: column.column_name,
                        column_index: column.column_index ?? index,
                        type_name: column.type_name ?? "unknown",
                        type_display:
                            column.type_display ??
                            column.type_name ??
                            "unknown",
                        description: column.description,
                    }) as SchemaColumn,
            )
            .sort((left, right) => left.column_index - right.column_index),
    );

    function requestCompleteSchema() {
        if (!canFilter || totalColumns === 0 || schemaColumns.length >= totalColumns) {
            return;
        }

        postMessage({
            type: "requestSchema",
            columns: Array.from({ length: totalColumns }, (_, index) => index),
        });
    }

    $effect(() => {
        const { columnIndex, columnSchema, requestId } =
            $pendingAddFilterRequest;
        if (requestId === lastRequestId) {
            return;
        }

        if (columnIndex === null || columnIndex === undefined) {
            return;
        }

        if (!canFilter) {
            return;
        }

        if (atFilterLimit) {
            lastRequestId = requestId;
            showFilterLimitMessage();
            return;
        }

        requestCompleteSchema();

        const match =
            columnSchema ??
            schemaColumns.find(
                (column: SchemaColumn) =>
                    column.column_index === columnIndex,
            );

        if (!match) {
            if (schemaColumns.length >= totalColumns) {
                lastRequestId = requestId;
            }
            return;
        }

        lastRequestId = requestId;
        editingFilter = undefined;
        editingFilterId = undefined;
        selectedColumn = match;
        // Match Positron by anchoring context-menu initiated add-filter flows
        // to the dedicated add-filter button in the row filter bar.
        modalAnchorElement = addFilterButtonRef ?? null;
        showModal = true;
    });

    $effect(() => {
        const pending = pendingRemovalFocus;
        if (!pending) {
            return;
        }

        if (
            rowFilterDescriptors.some(
                (entry) => entry.filter.filter_id === pending.removedFilterId,
            )
        ) {
            return;
        }

        pendingRemovalFocus = null;

        void tick().then(() => {
            const targetElement =
                (pending.targetFilterId
                    ? filterEntriesRef?.querySelector<HTMLElement>(
                          `[data-filter-id="${pending.targetFilterId}"]`,
                      )
                    : null) ??
                addFilterButtonRef ??
                manageButtonRef;

            targetElement?.focus();
        });
    });
</script>

<div class="row-filter-bar" class:has-filters={hasFilters}>
    <button
        type="button"
        class="row-filter-button"
        bind:this={manageButtonRef}
        onclick={handleManageMenu}
        onmouseenter={(event) =>
            showHover(
                event.currentTarget as HTMLElement,
                localize("positron.manageFilters", "Manage Filters"),
            )}
        onmouseleave={hideHover}
        onfocus={(event) =>
            showHover(
                event.currentTarget as HTMLElement,
                localize("positron.manageFilters", "Manage Filters"),
            )}
        onblur={hideHover}
        title={tableDataDataGridInstance?.hoverManager
            ? undefined
            : localize("positron.manageFilters", "Manage Filters")}
        aria-label={localize("positron.manageFilters", "Manage Filters")}
        disabled={!canFilter}
    >
        <span class="codicon codicon-positron-row-filter"></span>
        {#if hasFilters}
            <span class="counter">{$rowFilters.length}</span>
        {/if}
    </button>

    <div class="filter-entries" bind:this={filterEntriesRef}>
        {#if !rowFiltersHidden}
            {#each rowFilterDescriptors as entry (entry.filter.filter_id)}
                <RowFilterWidget
                    filterId={entry.filter.filter_id}
                    rowFilter={entry.descriptor}
                    onClear={(options) =>
                        handleRemoveFilter(
                            entry.filter.filter_id,
                            options,
                        )}
                    onEdit={(anchor) =>
                        handleEditFilter(
                            entry.filter,
                            entry.descriptor,
                            anchor,
                        )}
                />
            {/each}
        {/if}

        <button
            type="button"
            class="add-row-filter-button"
            bind:this={addFilterButtonRef}
            onclick={() => handleAddFilter(addFilterButtonRef)}
            onmouseenter={(event) =>
                showHover(
                    event.currentTarget as HTMLElement,
                    localize("positron.addFilter", "Add Filter"),
                )}
            onmouseleave={hideHover}
            onfocus={(event) =>
                showHover(
                    event.currentTarget as HTMLElement,
                    localize("positron.addFilter", "Add Filter"),
                )}
            onblur={hideHover}
            title={tableDataDataGridInstance?.hoverManager
                ? undefined
                : localize("positron.addFilter", "Add Filter")}
            aria-label={localize("positron.addFilter", "Add Filter")}
            disabled={!canFilter}
        >
            <span class="codicon codicon-positron-add-filter"></span>
        </button>
    </div>

    {#if showFilterLimitDialog}
        <PositronModalDialog
            title={localize("positron.addFilter", "Add Filter")}
            width={350}
            height={150}
            onCancel={closeFilterLimitDialog}
        >
            <ContentArea>
                <div class="filter-limit-dialog-message">
                    {localize(
                        "positron.dataExplorer.filtering.filterLimit",
                        "The maximum number of filters has been reached.",
                    )}
                </div>
            </ContentArea>

            <div class="ok-cancel-action-bar">
                <PlatformNativeDialogActionBar>
                    {#snippet primaryButton()}
                        <button
                            type="button"
                            class="action-bar-button default"
                            onclick={closeFilterLimitDialog}
                        >
                            {localize("positronOK", "OK")}
                        </button>
                    {/snippet}
                </PlatformNativeDialogActionBar>
            </div>
        </PositronModalDialog>
    {/if}

    {#if showMenu && manageButtonRef}
        <PositronContextMenu
            anchorElement={manageButtonRef}
            x={menuX}
            y={menuY}
            items={menuItems}
            onClose={closeMenu}
        />
    {/if}

    {#if showModal && modalAnchorElement}
        <AddEditRowFilterModalPopup
            anchorElement={modalAnchorElement}
            columns={schemaColumns}
            {selectedColumn}
            editFilter={editingFilter}
            onApply={handleApplyFilter}
            onCancel={handleCancelModal}
        />
    {/if}
</div>

<style>
    .row-filter-bar {
        padding: 4px 8px;
        display: grid;
        grid-row: filter-bar / data-explorer;
        border-bottom: 1px solid var(--vscode-positronDataExplorer-border);
        grid-template-columns: [icon] 24px [gutter] 8px [filters] 1fr [end];
        background-color: var(
            --vscode-positronDataExplorer-contrastBackground,
            var(--vscode-editor-background)
        );
    }

    .row-filter-button {
        width: 24px;
        height: 24px;
        display: flex;
        cursor: pointer;
        border-radius: 3px;
        position: relative;
        align-items: center;
        box-sizing: border-box;
        justify-content: center;
        grid-column: icon / gutter;
        border: 1px solid var(--vscode-positronDataExplorer-border);
        background-color: var(--vscode-positronDataExplorer-background);
    }

    .row-filter-button:hover:not(:disabled) {
        background-color: var(--vscode-positronActionBar-hoverBackground);
    }

    :global(.hc-black) .row-filter-button:hover:not(:disabled),
    :global(.hc-light) .row-filter-button:hover:not(:disabled) {
        border: 1px dashed var(--vscode-focusBorder) !important;
    }

    .row-filter-button:disabled {
        cursor: default;
        opacity: 0.5;
    }

    .row-filter-button:focus {
        outline: none;
    }

    .row-filter-button:focus-visible {
        border-radius: 3px;
        outline: 1px solid var(--vscode-focusBorder);
    }

    .row-filter-button .counter {
        top: -6px;
        right: -6px;
        width: 14px;
        height: 14px;
        display: flex;
        font-size: 10px;
        color: white;
        font-weight: 600;
        border-radius: 7px;
        position: absolute;
        align-items: center;
        justify-content: center;
        background-color: var(
            --vscode-positronDataGrid-sortIndexForeground,
            var(--vscode-badge-background)
        );
    }

    .filter-entries {
        row-gap: 8px;
        column-gap: 4px;
        display: flex;
        flex-wrap: wrap;
        flex-direction: row;
        grid-column: filters / end;
    }

    .add-row-filter-button {
        width: 24px;
        height: 24px;
        display: flex;
        cursor: pointer;
        border-radius: 3px;
        align-items: center;
        box-sizing: border-box;
        justify-content: center;
        border: 1px solid var(--vscode-positronDataExplorer-border);
        background-color: var(--vscode-positronDataExplorer-background);
    }

    .add-row-filter-button:hover:not(:disabled) {
        background-color: var(--vscode-positronActionBar-hoverBackground);
    }

    :global(.hc-black) .add-row-filter-button:hover:not(:disabled),
    :global(.hc-light) .add-row-filter-button:hover:not(:disabled) {
        border: 1px dashed var(--vscode-focusBorder) !important;
    }

    .add-row-filter-button:disabled {
        cursor: default;
        opacity: 0.5;
    }

    .add-row-filter-button:focus {
        outline: none;
    }

    .add-row-filter-button:focus-visible {
        border-radius: 3px;
        outline: 1px solid var(--vscode-focusBorder);
    }

    .filter-limit-dialog-message {
        line-height: 1.4;
        color: var(--vscode-descriptionForeground);
        white-space: normal;
    }
</style>
