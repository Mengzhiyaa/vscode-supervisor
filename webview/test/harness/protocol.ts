export interface SessionInfo {
    id: string;
    name: string;
    runtimeName: string;
    languageId?: string;
    state:
        | 'uninitialized'
        | 'starting'
        | 'ready'
        | 'busy'
        | 'offline'
        | 'interrupting'
        | 'restarting'
        | 'exiting'
        | 'exited'
        | 'disconnected';
    runtimePath?: string;
    runtimeVersion?: string;
    runtimeSource?: string;
    base64EncodedIconSvg?: string;
    promptActive: boolean;
    runtimeAttached: boolean;
}

export interface ConsoleSettings {
    scrollbackSize: number;
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
}

export interface VariablesInstanceInfo {
    sessionId: string;
    state: 'uninitialized' | 'opening' | 'connected' | 'closing' | 'closed';
    status: 'idle' | 'busy' | 'disconnected';
    grouping: 'none' | 'kind' | 'size';
    sorting: 'name' | 'size' | 'recent';
    filterText: string;
    highlightRecent: boolean;
}

export interface VariableEntry {
    type: 'group' | 'item' | 'overflow';
    id?: string;
    title?: string;
    isExpanded?: boolean;
    indentLevel?: number;
    path?: string[];
    displayName?: string;
    displayValue?: string;
    displayType?: string;
    size?: number;
    kind?: string;
    hasChildren?: boolean;
    hasViewer?: boolean;
    isRecent?: boolean;
    overflowValues?: number;
}

export type DataExplorerLayout = 'SummaryOnLeft' | 'SummaryOnRight';

export interface DataExplorerSchemaColumn {
    column_name: string;
    column_label?: string;
    column_index: number;
    type_name: string;
    type_display:
        | 'boolean'
        | 'string'
        | 'date'
        | 'datetime'
        | 'time'
        | 'interval'
        | 'object'
        | 'array'
        | 'struct'
        | 'unknown'
        | 'floating'
        | 'integer'
        | 'decimal';
    description?: string;
}

export interface DataExplorerBackendState {
    display_name: string;
    table_shape: {
        num_rows: number;
        num_columns: number;
    };
    table_unfiltered_shape: {
        num_rows: number;
        num_columns: number;
    };
    has_row_labels: boolean;
    column_filters: unknown[];
    row_filters: unknown[];
    sort_keys: Array<{
        column_index: number;
        ascending: boolean;
    }>;
    supported_features: {
        search_schema: {
            support_status: 'unsupported' | 'supported';
            supported_types: unknown[];
        };
        set_column_filters: {
            support_status: 'unsupported' | 'supported';
            supported_types: unknown[];
        };
        set_row_filters: {
            support_status: 'unsupported' | 'supported';
            supports_conditions: 'unsupported' | 'supported';
            supported_types: unknown[];
        };
        get_column_profiles: {
            support_status: 'unsupported' | 'supported';
            supported_types: unknown[];
        };
        set_sort_columns: {
            support_status: 'unsupported' | 'supported';
        };
        export_data_selection: {
            support_status: 'unsupported' | 'supported';
            supported_formats: Array<'csv' | 'tsv' | 'html'>;
        };
        convert_to_code: {
            support_status: 'unsupported' | 'supported';
            code_syntaxes?: Array<{
                code_syntax_name: string;
            }>;
        };
    };
    connected?: boolean;
    error_message?: string;
    __ark_file_options?: {
        supportsFileOptions?: boolean;
        fileHasHeaderRow?: boolean;
    };
    __ark_window_state?: {
        inNewWindow?: boolean;
    };
}

export const SessionMethods = {
    list: 'session/list',
    create: 'session/create',
    stop: 'session/stop',
    restart: 'session/restart',
    switch: 'session/switch',
    rename: 'session/rename',
    listOutputChannels: 'session/listOutputChannels',
    showOutputChannel: 'session/showOutputChannel',
    info: 'session/info',
} as const;

export const ConsoleMethods = {
    isComplete: 'console/isComplete',
    execute: 'console/execute',
    interrupt: 'console/interrupt',
    clearConsole: 'console/clearConsole',
    toggleWordWrap: 'console/toggleWordWrap',
    toggleTrace: 'console/toggleTrace',
    replyPrompt: 'console/replyPrompt',
    getSettings: 'console/getSettings',
    requestFullState: 'console/requestFullState',
    revealExecution: 'console/revealExecution',
    clear: 'console/clear',
    restoreState: 'console/restoreState',
    runtimeChanges: 'console/runtimeChanges',
    sessionMetadataChanged: 'console/sessionMetadataChanged',
    focusInput: 'console/focusInput',
    pasteText: 'console/pasteText',
    selectAll: 'console/selectAll',
    historyNavigateUp: 'console/historyNavigateUp',
    historyNavigateDown: 'console/historyNavigateDown',
    historyClear: 'console/historyClear',
    setPendingCode: 'console/setPendingCode',
    pendingInputChanged: 'console/pendingInputChanged',
    historyAdd: 'console/historyAdd',
    settingsChanged: 'console/settingsChanged',
    resourceUsage: 'console/resourceUsage',
    themeChanged: 'console/themeChanged',
    languageSupportAssetsChanged: 'console/languageSupportAssetsChanged',
    runtimeStartupPhase: 'console/runtimeStartupPhase',
    setWidthInChars: 'console/setWidthInChars',
    openExternal: 'console/openExternal',
    ready: 'console/ready',
} as const;

export const VariablesMethods = {
    ready: 'variables/ready',
    instanceStarted: 'variables/instanceStarted',
    instanceStopped: 'variables/instanceStopped',
    activeInstanceChanged: 'variables/activeInstanceChanged',
    entriesChanged: 'variables/entriesChanged',
    listEntries: 'variables/listEntries',
    refresh: 'variables/refresh',
    setActiveSession: 'variables/setActiveSession',
    setGrouping: 'variables/setGrouping',
    setSorting: 'variables/setSorting',
    setFilter: 'variables/setFilter',
    setHighlightRecent: 'variables/setHighlightRecent',
    expandGroup: 'variables/expandGroup',
    collapseGroup: 'variables/collapseGroup',
    expandItem: 'variables/expandItem',
    collapseItem: 'variables/collapseItem',
    formatForClipboard: 'variables/formatForClipboard',
    clear: 'variables/clear',
    view: 'variables/view',
} as const;

export const PlotsMethods = {
    ready: 'plots/ready',
    list: 'plots/list',
    render: 'plots/render',
    claimHtmlPlot: 'plots/claimHtmlPlot',
    releaseHtmlPlot: 'plots/releaseHtmlPlot',
    layoutHtmlPlot: 'plots/layoutHtmlPlot',
    getHistoryState: 'plots/getHistoryState',
    getDarkFilterMode: 'plots/getDarkFilterMode',
    getPreferredEditorTarget: 'plots/getPreferredEditorTarget',
    select: 'plots/select',
    selectZoom: 'plots/selectZoom',
    selectDarkFilterMode: 'plots/selectDarkFilterMode',
    selectSizingPolicy: 'plots/selectSizingPolicy',
    setCustomSize: 'plots/setCustomSize',
    clear: 'plots/clear',
    delete: 'plots/delete',
    openInEditor: 'plots/openInEditor',
    openInNewWindow: 'plots/openInNewWindow',
    openGalleryInNewWindow: 'plots/openGalleryInNewWindow',
    revealInConsole: 'plots/revealInConsole',
    runCodeAgain: 'plots/runCodeAgain',
    activateConsoleSession: 'plots/activateConsoleSession',
    openOriginFile: 'plots/openOriginFile',
    openDarkFilterSettings: 'plots/openDarkFilterSettings',
    closeAuxPanel: 'plots/closeAuxPanel',
    save: 'plots/save',
    copy: 'plots/copy',
    added: 'plots/added',
    selectedChanged: 'plots/selectedChanged',
    sizingPolicyChanged: 'plots/sizingPolicyChanged',
    historyPolicyChanged: 'plots/historyPolicyChanged',
    historyPositionChanged: 'plots/historyPositionChanged',
    darkFilterModeChanged: 'plots/darkFilterModeChanged',
    plotStateChanged: 'plots/plotStateChanged',
    renderCompleted: 'plots/renderCompleted',
    updated: 'plots/updated',
    zoomChanged: 'plots/zoomChanged',
    viewportChanged: 'plots/viewportChanged',
    cleared: 'plots/cleared',
    removed: 'plots/removed',
} as const;

export const ViewerMethods = {
    navigate: 'viewer/navigate',
    navigateBack: 'viewer/navigateBack',
    navigateForward: 'viewer/navigateForward',
    reload: 'viewer/reload',
    clear: 'viewer/clear',
    openInBrowser: 'viewer/openInBrowser',
    openInEditor: 'viewer/openInEditor',
    openInNewWindow: 'viewer/openInNewWindow',
    interrupt: 'viewer/interrupt',
    show: 'viewer/show',
    updateNavState: 'viewer/updateNavState',
} as const;

export const HelpMethods = {
    state: 'help/state',
    styles: 'help/styles',
    navigate: 'help/navigate',
    navigateBackward: 'help/navigateBackward',
    navigateForward: 'help/navigateForward',
    openHistory: 'help/openHistory',
    showWelcome: 'help/showWelcome',
    find: 'help/find',
    scroll: 'help/scroll',
    complete: 'help/complete',
    executeCommand: 'help/executeCommand',
    copySelection: 'help/copySelection',
    themeChanged: 'help/themeChanged',
} as const;

export const DataExplorerMethods = {
    ready: 'dataExplorer/ready',
    initialize: 'dataExplorer/initialize',
    metadata: 'dataExplorer/metadata',
    schema: 'dataExplorer/schema',
    data: 'dataExplorer/data',
    backendState: 'dataExplorer/backendState',
    loading: 'dataExplorer/loading',
    error: 'dataExplorer/error',
    copy: 'dataExplorer/copy',
    copyTableData: 'dataExplorer/copyTableData',
    exportData: 'dataExplorer/exportData',
    moveToNewWindow: 'dataExplorer/moveToNewWindow',
    convertToCode: 'dataExplorer/convertToCode',
    openAsPlaintext: 'dataExplorer/openAsPlaintext',
    toggleFileOptions: 'dataExplorer/toggleFileOptions',
    runConvertToCode: 'dataExplorer/runConvertToCode',
    applyFileOptions: 'dataExplorer/applyFileOptions',
    requestConvertToCodePreview: 'dataExplorer/requestConvertToCodePreview',
    setLayout: 'dataExplorer/setLayout',
    setSummaryCollapsed: 'dataExplorer/setSummaryCollapsed',
    focusChanged: 'dataExplorer/focusChanged',
    requestData: 'dataExplorer/requestData',
    requestSchema: 'dataExplorer/requestSchema',
    searchSchema: 'dataExplorer/searchSchema',
    requestColumnProfiles: 'dataExplorer/requestColumnProfiles',
    refresh: 'dataExplorer/refresh',
    sort: 'dataExplorer/sort',
    clearSort: 'dataExplorer/clearSort',
    clearFilters: 'dataExplorer/clearFilters',
    addFilter: 'dataExplorer/addFilter',
    updateFilter: 'dataExplorer/updateFilter',
    removeFilter: 'dataExplorer/removeFilter',
    copyToClipboard: 'dataExplorer/copyToClipboard',
    layoutChanged: 'dataExplorer/layoutChanged',
    summaryCollapsedChanged: 'dataExplorer/summaryCollapsedChanged',
    summarySchema: 'dataExplorer/summarySchema',
    columnProfiles: 'dataExplorer/columnProfiles',
    convertToCodePreview: 'dataExplorer/convertToCodePreview',
    showColumnContextMenu: 'dataExplorer/showColumnContextMenu',
    showRowContextMenu: 'dataExplorer/showRowContextMenu',
    showCellContextMenu: 'dataExplorer/showCellContextMenu',
    close: 'dataExplorer/close',
} as const;

export const PlotEditorMethods = {
    ready: 'plotEditor/ready',
    render: 'plotEditor/render',
    save: 'plotEditor/save',
    copy: 'plotEditor/copy',
    close: 'plotEditor/close',
    setImage: 'plotEditor/setImage',
    renderResult: 'plotEditor/renderResult',
} as const;
