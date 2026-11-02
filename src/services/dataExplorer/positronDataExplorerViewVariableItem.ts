import * as vscode from 'vscode';
import type {
    IPositronVariablesInstance,
    VariablesTreeItem,
} from '../variables/interfaces/variablesService';
import type { IPositronDataExplorerService } from './positronDataExplorerService';

/** Shared viewer opening flow for editor commands, code actions, and click-to-view. */
export async function viewVariableItem(
    sessionId: string,
    item: VariablesTreeItem,
    variablesInstance: IPositronVariablesInstance,
    dataExplorerService: IPositronDataExplorerService,
): Promise<string | undefined> {
    const instance = dataExplorerService.getInstanceForVar(item.id);
    if (instance?.sessionId === sessionId) {
        instance.requestFocus();
        return instance.identifier;
    }
    if (item.path.length > 0) {
        const pathInstance = dataExplorerService.getInstanceForVariablePath(sessionId, item.path);
        if (pathInstance) {
            pathInstance.requestFocus();
            return pathInstance.identifier;
        }
    }

    let viewerId: string | undefined;
    try {
        viewerId = await variablesInstance.view(item.path);
    } catch {
        void vscode.window.showErrorMessage(
            vscode.l10n.t(
                'An error occurred while opening the viewer. Try restarting your session.',
            ),
        );
        return undefined;
    }
    if (viewerId) {
        dataExplorerService.setInstanceForVar(viewerId, item.id);
        if (item.path.length > 0) {
            dataExplorerService.setInstanceForVariablePath(viewerId, sessionId, item.path);
        }
    }
    return viewerId;
}
