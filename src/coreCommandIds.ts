export const CoreCommandIds = {
    newSession: 'supervisor.newSession',
    duplicateSession: 'supervisor.duplicateSession',
    quickLaunchSession: 'supervisor.quickLaunchSession',
    interruptExecution: 'supervisor.interruptExecution',
    clearOutput: 'supervisor.clearOutput',
    showSupervisorLog: 'supervisor.showSupervisorLog',
    refreshRuntimeSessions: 'supervisor.runtimeSessions.refresh',
    openPlotsGallery: 'supervisor.openPlotsGallery',
    openPlotInEditor: 'supervisor.openPlotInEditor',
    closeAuxiliaryPlotsPanel: 'supervisor.closeAuxiliaryPlotsPanel',
    packagesRefresh: 'supervisor.packages.refresh',
    packagesUpdateAll: 'supervisor.packages.updateAll',
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
    consoleFind: 'supervisor.console.find',
    consoleFindNext: 'supervisor.console.findNext',
    consoleFindPrevious: 'supervisor.console.findPrevious',
    consoleFindClose: 'supervisor.console.findClose',
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
    dataExplorerOpenAsSpreadsheet: 'supervisor.dataExplorer.openAsSpreadsheet',
    dataExplorerToggleFileOptions: 'supervisor.dataExplorer.toggleFileOptions',
    dataExplorerMoveToNewWindow: 'supervisor.dataExplorer.moveToNewWindow',
    dataExplorerShowColumnContextMenu: 'supervisor.dataExplorer.showColumnContextMenu',
    dataExplorerShowRowContextMenu: 'supervisor.dataExplorer.showRowContextMenu',
    dataExplorerShowCellContextMenu: 'supervisor.dataExplorer.showCellContextMenu',
    dataExplorerOpenFile: 'supervisor.dataExplorer.openFile',
    dataExplorerOpenInline: 'supervisor.dataExplorer.openInline',
    dataExplorerViewDataFrameAtCursor: 'supervisor.dataExplorer.viewDataFrameAtCursor',
    dataExplorerViewDataFrameByVariable: 'supervisor.dataExplorer.viewDataFrameByVariable',
    connectionsRefresh: 'supervisor.connections.refresh',
    connectionsNew: 'supervisor.connections.new',
    connectionsDisconnect: 'supervisor.connections.disconnect',
    connectionsPreview: 'supervisor.connections.preview',
    viewerFind: 'supervisor.viewer.find',
    viewerFocusContent: 'supervisor.viewer.focusContent',
    helpFind: 'supervisor.help.find',
    helpFocusContent: 'supervisor.help.focusContent',
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
    packages: 'supervisor.packages',
    viewer: 'supervisor.viewer',
    help: 'supervisor.help',
    runtimeSessions: 'supervisor.runtimeSessions',
    connections: 'supervisor.connections',
} as const;

export const ViewCommands = {
    consoleFocus: 'supervisor.console.focus',
    viewerCollapse: 'supervisor.viewer.collapse',
    helpFocus: 'supervisor.help.focus',
} as const;

export const ViewContainerIds = {
    consolePanel: 'supervisor-console-panel',
    session: 'supervisor-session',
    packages: 'supervisor-packages',
    connections: 'supervisor-connections',
    help: 'supervisor-help',
    viewer: 'supervisor-viewer',
    runtimes: 'supervisor-runtimes',
} as const;

export const WorkbenchViewContainerCommands = {
    consolePanel: `workbench.view.extension.${ViewContainerIds.consolePanel}`,
    session: `workbench.view.extension.${ViewContainerIds.session}`,
    packages: `workbench.view.extension.${ViewContainerIds.packages}`,
    connections: `workbench.view.extension.${ViewContainerIds.connections}`,
    help: `workbench.view.extension.${ViewContainerIds.help}`,
    viewer: `workbench.view.extension.${ViewContainerIds.viewer}`,
    runtimes: `workbench.view.extension.${ViewContainerIds.runtimes}`,
} as const;

export const ContextKeys = {
    consoleSessionsExist: 'supervisor.consoleSessionsExist',
    consoleFocused: 'supervisor.consoleFocused',
    consoleFindVisible: 'supervisor.consoleFindVisible',
    consoleFindInputFocused: 'supervisor.consoleFindInputFocused',
    shouldTabComplete: 'supervisor.shouldTabComplete',
    isDevelopment: 'supervisor.isDevelopment',
    dataExplorerEditorActive: 'supervisor.dataExplorerEditorActive',
    dataExplorerLayout: 'supervisor.dataExplorerLayout',
    dataExplorerIsColumnSorting: 'supervisor.dataExplorerIsColumnSorting',
    dataExplorerIsConvertToCodeEnabled: 'supervisor.dataExplorerIsConvertToCodeEnabled',
    dataExplorerCodeSyntaxesAvailable: 'supervisor.dataExplorerCodeSyntaxesAvailable',
    dataExplorerIsRowFiltering: 'supervisor.dataExplorerIsRowFiltering',
    dataExplorerIsPlaintext: 'supervisor.dataExplorerIsPlaintext',
    dataExplorerIsXlsx: 'supervisor.dataExplorerIsXlsx',
    dataExplorerSummaryCollapsed: 'supervisor.dataExplorerSummaryCollapsed',
    dataExplorerFocused: 'supervisor.dataExplorerFocused',
    dataExplorerInNewWindow: 'supervisor.dataExplorerInNewWindow',
    packagesHasActiveSession: 'supervisor.packages.hasActiveSession',
    packagesIsBusy: 'supervisor.packages.isBusy',
    packagesSelectedPackage: 'supervisor.packages.selectedPackage',
    packagesItemSize: 'supervisor.packages.itemSize',
} as const;

export const CoreConfigurationSections = {
    supervisor: 'supervisor',
} as const;

export const CoreConfigurationKeys = {
    interpretersStartupBehavior: 'supervisor.interpreters.startupBehavior',
    consoleFontSize: 'supervisor.console.fontSize',
    consoleFontFamily: 'supervisor.console.fontFamily',
    consoleLineHeight: 'supervisor.console.lineHeight',
    consoleFontLigatures: 'supervisor.console.fontLigatures',
    consoleFontVariations: 'supervisor.console.fontVariations',
    consoleFontWeight: 'supervisor.console.fontWeight',
    consoleLetterSpacing: 'supervisor.console.letterSpacing',
    consoleScrollbackSize: 'supervisor.console.scrollbackSize',
    consoleShowResourceMonitor: 'supervisor.console.showResourceMonitor',
    consolePromptWhenIncomplete: 'supervisor.console.promptWhenIncomplete',
    consoleEnableTrace: 'supervisor.console.enableTrace',
} as const;
