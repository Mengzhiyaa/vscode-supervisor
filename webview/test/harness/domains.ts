import { MockWebviewBackend } from './mockWebviewBackend';
import {
    ConsoleMethods,
    type ConsoleSettings,
    DataExplorerMethods,
    type DataExplorerBackendState,
    type DataExplorerSchemaColumn,
    HelpMethods,
    PlotsMethods,
    PlotEditorMethods,
    SessionMethods,
    type SessionInfo,
    VariablesMethods,
    type VariableEntry,
    type VariablesInstanceInfo,
    ViewerMethods,
} from './protocol';
import { TEST_BASE_URL } from './page';

export const SMALL_PNG_DATA_URI =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sotW1cAAAAASUVORK5CYII=';

export function createSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
    return {
        id: overrides.id ?? 'session-1',
        name: overrides.name ?? 'Primary',
        runtimeName: overrides.runtimeName ?? 'R',
        languageId: overrides.languageId ?? 'r',
        state: overrides.state ?? 'ready',
        runtimePath: overrides.runtimePath,
        runtimeVersion: overrides.runtimeVersion,
        runtimeSource: overrides.runtimeSource,
        base64EncodedIconSvg: overrides.base64EncodedIconSvg,
        promptActive: overrides.promptActive ?? true,
        runtimeAttached: overrides.runtimeAttached ?? true,
    };
}

export function createVariablesInstance(
    sessionId: string,
    overrides: Partial<VariablesInstanceInfo> = {},
): VariablesInstanceInfo {
    return {
        sessionId,
        state: overrides.state ?? 'connected',
        status: overrides.status ?? 'idle',
        grouping: overrides.grouping ?? 'kind',
        sorting: overrides.sorting ?? 'name',
        filterText: overrides.filterText ?? '',
        highlightRecent: overrides.highlightRecent ?? true,
    };
}

export function createDataExplorerSchemaColumn(
    overrides: Partial<DataExplorerSchemaColumn> = {},
): DataExplorerSchemaColumn {
    return {
        column_name: overrides.column_name ?? 'col_1',
        column_label: overrides.column_label,
        column_index: overrides.column_index ?? 0,
        type_name: overrides.type_name ?? 'INTEGER',
        type_display: overrides.type_display ?? 'integer',
        description: overrides.description,
    };
}

export function createDataExplorerBackendState(
    overrides: Partial<DataExplorerBackendState> = {},
): DataExplorerBackendState {
    return {
        display_name: overrides.display_name ?? 'Fixture Table',
        table_shape: overrides.table_shape ?? {
            num_rows: 120,
            num_columns: 2,
        },
        table_unfiltered_shape: overrides.table_unfiltered_shape ?? {
            num_rows: 120,
            num_columns: 2,
        },
        has_row_labels: overrides.has_row_labels ?? false,
        column_filters: overrides.column_filters ?? [],
        row_filters: overrides.row_filters ?? [],
        sort_keys: overrides.sort_keys ?? [],
        supported_features: overrides.supported_features ?? {
            search_schema: {
                support_status: 'supported',
                supported_types: [],
            },
            set_column_filters: {
                support_status: 'supported',
                supported_types: [],
            },
            set_row_filters: {
                support_status: 'supported',
                supports_conditions: 'supported',
                supported_types: [],
            },
            get_column_profiles: {
                support_status: 'supported',
                supported_types: [],
            },
            set_sort_columns: {
                support_status: 'supported',
            },
            export_data_selection: {
                support_status: 'supported',
                supported_formats: ['csv', 'tsv', 'html'],
            },
            convert_to_code: {
                support_status: 'supported',
                code_syntaxes: [
                    { code_syntax_name: 'python' },
                    { code_syntax_name: 'r' },
                ],
            },
        },
        connected: overrides.connected ?? true,
        error_message: overrides.error_message,
        __ark_file_options: overrides.__ark_file_options,
        __ark_window_state: overrides.__ark_window_state,
    };
}

export interface PlotListItem {
    id: string;
    sessionId?: string;
    thumbnail?: string;
    initialData?: string;
    renderVersion?: number;
    kind?: 'static' | 'dynamic' | 'html';
    htmlUri?: string;
    name?: string;
    originUri?: string;
    code?: string;
    parentId?: string;
    languageId?: string;
}

export function createHelpFixtureUrl(): string {
    return `${TEST_BASE_URL}/test-pages/fixtures/help-frame.html`;
}

export function createPreviewFixtureUrl(): string {
    return `${TEST_BASE_URL}/test-pages/fixtures/simple-preview.html`;
}

export function registerConsoleDefaults(
    backend: MockWebviewBackend,
    options: {
        sessions?: SessionInfo[];
        activeSessionId?: string;
        settings?: ConsoleSettings;
        onRequestFullState?: (request: { sessionId: string; reason: string }) => Promise<void> | void;
    } = {},
): void {
    const sessions = options.sessions ?? [createSession()];
    let activeSessionId = options.activeSessionId ?? sessions[0]?.id;

    backend.onRequest(SessionMethods.list, () => ({
        sessions,
        activeSessionId,
    }));
    backend.onRequest(ConsoleMethods.getSettings, () => ({
        scrollbackSize: 1000,
        fontFamily: 'var(--vscode-editor-font-family)',
        fontSize: 13,
        lineHeight: 1.4,
        ...options.settings,
    }));
    backend.onRequest(SessionMethods.switch, async (request) => {
        activeSessionId = (request.params as { sessionId: string }).sessionId;
        await backend.notify(SessionMethods.info, {
            sessions,
            activeSessionId,
        });
        return undefined;
    });
    backend.onRequest(SessionMethods.create, () => ({ session: sessions[0] }));
    backend.onRequest(SessionMethods.stop, () => undefined);
    backend.onRequest(SessionMethods.restart, () => undefined);
    backend.onRequest(SessionMethods.rename, () => undefined);
    backend.onRequest(SessionMethods.listOutputChannels, () => ({
        channels: [],
    }));
    backend.onRequest(SessionMethods.showOutputChannel, () => undefined);
    backend.onRequest(ConsoleMethods.isComplete, () => ({ status: 'complete' }));
    backend.onRequest(ConsoleMethods.replyPrompt, () => undefined);
    backend.onRequest(ConsoleMethods.execute, (request) => ({
        executionId: (request.params as { executionId?: string }).executionId ?? 'exec-1',
    }));
    backend.onRequest(ConsoleMethods.interrupt, () => undefined);
    backend.onRequest(ConsoleMethods.clearConsole, () => undefined);
    backend.onRequest(ConsoleMethods.toggleWordWrap, () => undefined);
    backend.onRequest(ConsoleMethods.toggleTrace, () => undefined);
    backend.onRequest('console/openInEditor', () => undefined);
    backend.onRequest(ConsoleMethods.requestFullState, async (request) => {
        await options.onRequestFullState?.(
            request.params as { sessionId: string; reason: string },
        );
        return undefined;
    });
}

export function registerVariablesDefaults(
    backend: MockWebviewBackend,
    options: {
        entriesBySession?: Record<string, VariableEntry[]>;
    } = {},
): void {
    const entriesBySession = new Map<string, VariableEntry[]>(
        Object.entries(options.entriesBySession ?? {}),
    );

    backend.onRequest(VariablesMethods.listEntries, (request) => {
        const params = request.params as { sessionId?: string };
        return {
            entries: entriesBySession.get(params.sessionId ?? 'session-1') ?? [],
        };
    });
    backend.onRequest(VariablesMethods.refresh, () => undefined);
    backend.onRequest(VariablesMethods.setActiveSession, () => undefined);
    backend.onRequest(VariablesMethods.setGrouping, () => undefined);
    backend.onRequest(VariablesMethods.setSorting, () => undefined);
    backend.onRequest(VariablesMethods.setFilter, () => undefined);
    backend.onRequest(VariablesMethods.setHighlightRecent, () => undefined);
    backend.onRequest(VariablesMethods.expandGroup, () => undefined);
    backend.onRequest(VariablesMethods.collapseGroup, () => undefined);
    backend.onRequest(VariablesMethods.expandItem, () => undefined);
    backend.onRequest(VariablesMethods.collapseItem, () => undefined);
    backend.onRequest(VariablesMethods.formatForClipboard, () => 'clipboard');
    backend.onRequest(VariablesMethods.clear, () => undefined);
    backend.onRequest(VariablesMethods.view, () => undefined);
}

export function registerPlotsDefaults(
    backend: MockWebviewBackend,
    options: {
        plots?: PlotListItem[];
        selectedPlotId?: string;
    } = {},
): void {
    const plots = options.plots ?? [];
    let renderVersion = 1;

    backend.onRequest(PlotsMethods.getHistoryState, () => ({
        policy: 'auto',
        position: 'auto',
    }));
    backend.onRequest(PlotsMethods.getDarkFilterMode, () => ({
        mode: 'auto',
    }));
    backend.onRequest(PlotsMethods.getPreferredEditorTarget, () => ({
        target: 'activeGroup',
    }));
    backend.onRequest(PlotsMethods.list, () => ({
        plots,
        selectedPlotId: options.selectedPlotId ?? plots[plots.length - 1]?.id,
        totalCount: plots.length,
        nextCursor: plots.length,
        hasMore: false,
    }));
    backend.onRequest(PlotsMethods.render, () => ({
        data: SMALL_PNG_DATA_URI,
        mimeType: 'image/png',
        renderVersion: renderVersion++,
    }));
    backend.onRequest(PlotsMethods.claimHtmlPlot, () => ({ success: true }));
    backend.onRequest(PlotsMethods.releaseHtmlPlot, () => ({ success: true }));
    backend.onRequest(PlotsMethods.select, () => undefined);
    backend.onRequest(PlotsMethods.selectZoom, () => undefined);
    backend.onRequest(PlotsMethods.selectDarkFilterMode, () => undefined);
    backend.onRequest(PlotsMethods.selectSizingPolicy, () => undefined);
    backend.onRequest(PlotsMethods.setCustomSize, () => undefined);
    backend.onRequest(PlotsMethods.clear, () => undefined);
    backend.onRequest(PlotsMethods.delete, () => undefined);
    backend.onRequest(PlotsMethods.openInEditor, () => undefined);
    backend.onRequest(PlotsMethods.openInNewWindow, () => undefined);
    backend.onRequest(PlotsMethods.openGalleryInNewWindow, () => undefined);
    backend.onRequest(PlotsMethods.revealInConsole, () => undefined);
    backend.onRequest(PlotsMethods.runCodeAgain, () => undefined);
    backend.onRequest(PlotsMethods.activateConsoleSession, () => undefined);
    backend.onRequest(PlotsMethods.openOriginFile, () => undefined);
    backend.onRequest(PlotsMethods.openDarkFilterSettings, () => undefined);
    backend.onRequest(PlotsMethods.closeAuxPanel, () => undefined);
    backend.onRequest(PlotsMethods.save, () => undefined);
    backend.onRequest(PlotsMethods.copy, () => undefined);
}

export {
    ConsoleMethods,
    DataExplorerMethods,
    HelpMethods,
    PlotsMethods,
    PlotEditorMethods,
    SessionMethods,
    VariablesMethods,
    ViewerMethods,
};
