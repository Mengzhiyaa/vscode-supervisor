import * as vscode from 'vscode';
import type {
    PositronDataExplorerLayout,
    PositronDataExplorerUiState,
} from './interfaces/positronDataExplorerInstance';

export const USE_DATA_EXPLORER_SUMMARY_COLLAPSED_KEY = 'dataExplorer.summaryCollapsed';
export const USE_DATA_EXPLORER_SUMMARY_LAYOUT_KEY = 'dataExplorer.summaryLayout';
export const DATA_EXPLORER_ENABLE_PREVIEW_KEY = 'dataExplorer.enablePreview';

type DataExplorerConfiguration = Pick<vscode.WorkspaceConfiguration, 'get'>;

export function DataExplorerSummaryCollapseEnabled(
    configuration: DataExplorerConfiguration = vscode.workspace.getConfiguration(),
): boolean {
    return configuration.get<boolean>(
        USE_DATA_EXPLORER_SUMMARY_COLLAPSED_KEY,
        false,
    );
}

export function DefaultDataExplorerSummaryLayout(
    configuration: DataExplorerConfiguration = vscode.workspace.getConfiguration(),
): PositronDataExplorerLayout {
    return configuration.get<string>(
        USE_DATA_EXPLORER_SUMMARY_LAYOUT_KEY,
        'left',
    ) === 'right'
        ? 'SummaryOnRight'
        : 'SummaryOnLeft';
}

export function DataExplorerPreviewEnabled(
    configuration: DataExplorerConfiguration = vscode.workspace.getConfiguration(),
): boolean {
    return configuration.get<boolean>(
        DATA_EXPLORER_ENABLE_PREVIEW_KEY,
        false,
    );
}

export function createDefaultDataExplorerUiState(
    configuration: DataExplorerConfiguration = vscode.workspace.getConfiguration(),
): PositronDataExplorerUiState {
    return {
        layout: DefaultDataExplorerSummaryLayout(configuration),
        summaryCollapsed: DataExplorerSummaryCollapseEnabled(configuration),
        summaryWidth: 350,
    };
}
