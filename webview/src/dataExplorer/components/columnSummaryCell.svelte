<!--
  columnSummaryCell.svelte - Data grid cell wrapper for column summary rows
  Port from Positron's columnSummaryCell.tsx for 1:1 UI replication
-->
<script lang="ts">
    import { getDataExplorerContext } from "../positronDataExplorerContext";
    import type { SchemaColumn } from "../../dataGrid/types";
    import ColumnSummaryRow from "./columnSummaryRow.svelte";
    import type { TableSummaryDataGridInstance } from "../tableSummaryDataGridInstance";

    interface Props {
        columnIndex: number;
        columnSchema: SchemaColumn;
        instance: TableSummaryDataGridInstance;
    }

    let { columnIndex, columnSchema, instance }: Props = $props();

    const { stores, tableDataDataGridInstance } = getDataExplorerContext();
    const { columnProfiles, summaryExpandedColumns } = stores;

    let updateRevision = $state(0);

    $effect(() => {
        const disposable = instance.onDidUpdate(() => {
            updateRevision += 1;
        });

        return () => {
            disposable.dispose();
        };
    });

    const profile = $derived($columnProfiles.get(columnIndex));
    const expanded = $derived($summaryExpandedColumns.has(columnIndex));
    const nullPercent = $derived.by(() => {
        updateRevision;
        return instance.getColumnProfileNullPercent(columnIndex);
    });
    const summaryStatsSupported = $derived.by(() => {
        updateRevision;
        return instance.canToggleColumnExpansion(columnIndex);
    });

    const isCursor = $derived.by(() => {
        updateRevision;
        return instance.cursorRowIndex === columnIndex;
    });

    const isFocused = $derived.by(() => {
        updateRevision;
        return instance.focused;
    });

    function handleToggle(_expanded: boolean) {
        if (!summaryStatsSupported) {
            return;
        }
        instance.toggleExpandColumn(columnIndex);
    }

    function handleSelect() {
        instance.scrollToRow(columnIndex);
        instance.setCursorPosition(0, columnIndex);
    }

    function handleDoubleClick() {
        if (tableDataDataGridInstance) {
            tableDataDataGridInstance.selectColumn(columnIndex);
            void tableDataDataGridInstance.scrollToColumn(columnIndex);
        }
    }
</script>

<ColumnSummaryRow
    columnIndex={columnIndex}
    columnName={columnSchema.column_name}
    columnType={columnSchema.type_name}
    typeDisplay={columnSchema.type_display || columnSchema.type_name}
    columnLabel={columnSchema.description}
    hoverManager={instance.hoverManager}
    {profile}
    {nullPercent}
    {summaryStatsSupported}
    expanded={expanded}
    {isCursor}
    {isFocused}
    onToggle={handleToggle}
    onSelect={handleSelect}
    onDoubleClick={handleDoubleClick}
/>
