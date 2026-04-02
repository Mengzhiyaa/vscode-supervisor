/*---------------------------------------------------------------------------------------------
 *  Positron data explorer actions
 *--------------------------------------------------------------------------------------------*/

export enum PositronDataExplorerCommandId {
    Copy = 'supervisor.dataExplorer._copyInternal',
    CopyTableData = 'supervisor.dataExplorer._copyTableDataInternal',
    CollapseSummary = 'supervisor.dataExplorer._collapseSummaryInternal',
    ExpandSummary = 'supervisor.dataExplorer._expandSummaryInternal',
    SummaryOnLeft = 'supervisor.dataExplorer._summaryOnLeftInternal',
    SummaryOnRight = 'supervisor.dataExplorer._summaryOnRightInternal',
    ClearColumnSorting = 'supervisor.dataExplorer._clearColumnSortingInternal',
    ConvertToCode = 'supervisor.dataExplorer._convertToCodeInternal',
    OpenAsPlaintext = 'supervisor.dataExplorer._openAsPlaintextInternal',
    ToggleFileOptions = 'supervisor.dataExplorer._toggleFileOptionsInternal',
    MoveToNewWindow = 'supervisor.dataExplorer._moveToNewWindowInternal',
    ShowColumnContextMenu = 'supervisor.dataExplorer._showColumnContextMenuInternal',
    ShowRowContextMenu = 'supervisor.dataExplorer._showRowContextMenuInternal',
    ShowCellContextMenu = 'supervisor.dataExplorer._showCellContextMenuInternal',
}

export { PositronDataExplorerCommandId as DataExplorerCommandId };
