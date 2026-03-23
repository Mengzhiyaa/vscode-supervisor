export const CoreCommandIds = {
    newSession: 'supervisor.newSession',
    duplicateSession: 'supervisor.duplicateSession',
    quickLaunchSession: 'supervisor.quickLaunchSession',
    interruptExecution: 'supervisor.interruptExecution',
    clearOutput: 'supervisor.clearOutput',
    showSupervisorLog: 'supervisor.showSupervisorLog',
    openPlotsGallery: 'supervisor.openPlotsGallery',
    openPlotInEditor: 'supervisor.openPlotInEditor',
    closeAuxiliaryPlotsPanel: 'supervisor.closeAuxiliaryPlotsPanel',
    consoleExecuteCode: 'supervisor.console.executeCode',
    consoleExecuteCodeWithoutAdvancing: 'supervisor.console.executeCodeWithoutAdvancing',
    consoleClearConsole: 'supervisor.console.clearConsole',
    consoleFocusConsole: 'supervisor.console.focusConsole',
    consoleClearInputHistory: 'supervisor.console.clearInputHistory',
    consoleExecuteCodeBeforeCursor: 'supervisor.console.executeCodeBeforeCursor',
    consoleExecuteCodeAfterCursor: 'supervisor.console.executeCodeAfterCursor',
    consoleNavigateInputHistoryUp: 'supervisor.console.navigateInputHistoryUp',
    consoleNavigateInputHistoryDown: 'supervisor.console.navigateInputHistoryDown',
    consoleNavigateInputHistoryUpPrefixMatch: 'supervisor.console.navigateInputHistoryUpPrefixMatch',
    dataExplorerCopy: 'supervisor.dataExplorer.copy',
    dataExplorerCopyTableData: 'supervisor.dataExplorer.copyTableData',
    dataExplorerCollapseSummary: 'supervisor.dataExplorer.collapseSummary',
    dataExplorerExpandSummary: 'supervisor.dataExplorer.expandSummary',
    dataExplorerSummaryOnLeft: 'supervisor.dataExplorer.summaryOnLeft',
    dataExplorerSummaryOnRight: 'supervisor.dataExplorer.summaryOnRight',
    dataExplorerSummaryOnLeftActive: 'supervisor.dataExplorer.summaryOnLeftActive',
    dataExplorerSummaryOnRightActive: 'supervisor.dataExplorer.summaryOnRightActive',
    dataExplorerClearColumnSorting: 'supervisor.dataExplorer.clearColumnSorting',
    dataExplorerConvertToCode: 'supervisor.dataExplorer.convertToCode',
    dataExplorerOpenAsPlaintext: 'supervisor.dataExplorer.openAsPlaintext',
    dataExplorerToggleFileOptions: 'supervisor.dataExplorer.toggleFileOptions',
    dataExplorerMoveToNewWindow: 'supervisor.dataExplorer.moveToNewWindow',
    dataExplorerShowColumnContextMenu: 'supervisor.dataExplorer.showColumnContextMenu',
    dataExplorerShowRowContextMenu: 'supervisor.dataExplorer.showRowContextMenu',
    dataExplorerShowCellContextMenu: 'supervisor.dataExplorer.showCellContextMenu',
    dataExplorerOpenFile: 'supervisor.dataExplorer.openFile',
    supervisorReconnectSession: 'positron.supervisor.reconnectSession',
    supervisorRestartSupervisor: 'positron.supervisor.restartSupervisor',
} as const;

export const TestCommandIds = {
    getRuntimeSnapshot: '_supervisor.test.getRuntimeSnapshot',
    emitRuntimeEvent: '_supervisor.test.emitRuntimeEvent',
    simulateCommOpen: '_supervisor.test.simulateCommOpen',
    simulateCommData: '_supervisor.test.simulateCommData',
    clearConsoleAsUser: '_supervisor.test.clearConsoleAsUser',
    setWorkingDirectory: '_supervisor.test.setWorkingDirectory',
    openConsoleCodeInEditor: '_supervisor.test.openConsoleCodeInEditor',
} as const;

export const InternalCommandIds = {
    lspGetStatementRange: 'supervisor.lsp.getStatementRange',
} as const;

export const MenuIds = {
    consoleSession: 'supervisor.console.sessionMenu',
} as const;

export const ViewIds = {
    console: 'supervisor.console',
    variables: 'supervisor.variables',
    plots: 'supervisor.plots',
    viewer: 'supervisor.viewer',
    help: 'supervisor.help',
} as const;

export const ViewCommands = {
    consoleFocus: 'supervisor.console.focus',
    viewerCollapse: 'supervisor.viewer.collapse',
    helpFocus: 'supervisor.help.focus',
} as const;

export const ViewContainerIds = {
    consolePanel: 'supervisor-console-panel',
    sessionSidebar: 'supervisor-sidebar-session',
    explorationSidebar: 'supervisor-sidebar-exploration',
} as const;

export const WorkbenchViewContainerCommands = {
    consolePanel: `workbench.view.extension.${ViewContainerIds.consolePanel}`,
    sessionSidebar: `workbench.view.extension.${ViewContainerIds.sessionSidebar}`,
    explorationSidebar: `workbench.view.extension.${ViewContainerIds.explorationSidebar}`,
} as const;

export const ContextKeys = {
    consoleSessionsExist: 'supervisor.consoleSessionsExist',
    shouldTabComplete: 'supervisor.shouldTabComplete',
    isDevelopment: 'supervisor.isDevelopment',
    dataExplorerEditorActive: 'supervisor.dataExplorerEditorActive',
    dataExplorerLayout: 'supervisor.dataExplorerLayout',
    dataExplorerIsColumnSorting: 'supervisor.dataExplorerIsColumnSorting',
    dataExplorerIsConvertToCodeEnabled: 'supervisor.dataExplorerIsConvertToCodeEnabled',
    dataExplorerCodeSyntaxesAvailable: 'supervisor.dataExplorerCodeSyntaxesAvailable',
    dataExplorerIsRowFiltering: 'supervisor.dataExplorerIsRowFiltering',
    dataExplorerIsPlaintext: 'supervisor.dataExplorerIsPlaintext',
    dataExplorerFileHasHeaderRow: 'supervisor.dataExplorerFileHasHeaderRow',
    dataExplorerSummaryCollapsed: 'supervisor.dataExplorerSummaryCollapsed',
    dataExplorerFocused: 'supervisor.dataExplorerFocused',
    dataExplorerInNewWindow: 'supervisor.dataExplorerInNewWindow',
} as const;

export const CoreConfigurationSections = {
    supervisor: 'supervisor',
} as const;

export const CoreConfigurationKeys = {
    interpretersStartupBehavior: 'supervisor.interpreters.startupBehavior',
    consoleFontSize: 'supervisor.console.fontSize',
    consoleFontFamily: 'supervisor.console.fontFamily',
    consoleLineHeight: 'supervisor.console.lineHeight',
    consoleScrollbackSize: 'supervisor.console.scrollbackSize',
    consoleShowResourceMonitor: 'supervisor.console.showResourceMonitor',
    consoleEnableTrace: 'supervisor.console.enableTrace',
} as const;
