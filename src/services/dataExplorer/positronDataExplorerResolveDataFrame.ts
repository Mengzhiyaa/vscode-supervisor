import * as vscode from 'vscode';
import type {
    IPositronVariablesInstance,
    IPositronVariablesService,
    VariablesTreeItem,
} from '../variables/interfaces/variablesService';

export interface ResolvedDataFrame {
    readonly instance: IPositronVariablesInstance;
    readonly variable: VariablesTreeItem;
    readonly range: vscode.Range;
}

/** Resolve against the cached Variables model without starting a runtime or opening a surface. */
export function resolveDataFrameAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    variablesService: IPositronVariablesService,
): ResolvedDataFrame | undefined {
    const range = document.getWordRangeAtPosition(position);
    if (!range) {
        return undefined;
    }
    const name = document.getText(range);
    const instance = variablesService.activePositronVariablesInstance;
    if (!instance || !isDocumentLanguageCompatible(document.languageId, instance.session.runtimeMetadata.languageId)) {
        return undefined;
    }
    const variable = instance.variableItems.find(item =>
        item.hasViewer && (item.displayName === name || item.path.at(-1) === name));
    return variable ? { instance, variable, range } : undefined;
}

export function isDocumentLanguageCompatible(documentLanguageId: string, runtimeLanguageId: string): boolean {
    if (documentLanguageId === 'quarto') {
        return runtimeLanguageId === 'python' || runtimeLanguageId === 'r';
    }
    return documentLanguageId.toLowerCase() === runtimeLanguageId.toLowerCase();
}
