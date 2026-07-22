import * as vscode from 'vscode';
import { CoreCommandIds } from '../../coreCommandIds';
import type { IPositronVariablesService } from '../variables/interfaces/variablesService';
import { isDocumentLanguageCompatible, resolveDataFrameAtPosition } from './positronDataExplorerResolveDataFrame';

const DataExplorerLanguages: vscode.DocumentSelector = ['python', 'r', 'quarto'];

export class PositronDataExplorerEditorContribution implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[];

    constructor(private readonly _variablesService: IPositronVariablesService) {
        this._disposables = [
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerViewDataFrameAtCursor, () =>
                this._viewDataFrameAtCursor()),
            vscode.commands.registerCommand(
                CoreCommandIds.dataExplorerViewDataFrameByVariable,
                (path: readonly string[]) => this._viewDataFrameByPath(path),
            ),
            vscode.languages.registerCodeActionsProvider(
                DataExplorerLanguages,
                new PositronDataExplorerCodeActionProvider(_variablesService),
                { providedCodeActionKinds: [vscode.CodeActionKind.Refactor] },
            ),
            vscode.languages.registerDocumentLinkProvider(
                DataExplorerLanguages,
                new PositronDataExplorerClickToViewProvider(_variablesService),
            ),
        ];
    }

    dispose(): void { this._disposables.forEach(disposable => disposable.dispose()); }

    private async _viewDataFrameAtCursor(): Promise<string | undefined> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return undefined; }
        const resolved = resolveDataFrameAtPosition(editor.document, editor.selection.active, this._variablesService);
        return resolved?.instance.view(resolved.variable.path);
    }

    private _viewDataFrameByPath(path: readonly string[]): Promise<string | undefined> | undefined {
        const instance = this._variablesService.activePositronVariablesInstance;
        const variable = instance?.variableItems.find(item =>
            item.hasViewer && item.path.join('\0') === path.join('\0'));
        return variable ? instance?.view(variable.path) : undefined;
    }
}

export class PositronDataExplorerCodeActionProvider implements vscode.CodeActionProvider {
    constructor(private readonly _variablesService: IPositronVariablesService) {}

    provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
        const resolved = resolveDataFrameAtPosition(document, range.start, this._variablesService);
        if (!resolved) { return []; }
        const action = new vscode.CodeAction(
            vscode.l10n.t("Open '{0}' in Data Explorer", resolved.variable.displayName),
            vscode.CodeActionKind.Refactor,
        );
        action.command = {
            command: CoreCommandIds.dataExplorerViewDataFrameByVariable,
            title: action.title,
            arguments: [resolved.variable.path],
        };
        return [action];
    }
}

export class PositronDataExplorerClickToViewProvider implements vscode.DocumentLinkProvider {
    constructor(private readonly _variablesService: IPositronVariablesService) {}

    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
        if (!vscode.workspace.getConfiguration('dataExplorer').get('enableClickToView', true)) { return []; }
        const instance = this._variablesService.activePositronVariablesInstance;
        if (!instance || !isDocumentLanguageCompatible(document.languageId, instance.session.runtimeMetadata.languageId)) {
            return [];
        }
        const text = document.getText();
        if (text.length > 1_000_000) { return []; }
        const links: vscode.DocumentLink[] = [];
        for (const variable of instance.variableItems.filter(item => item.hasViewer)) {
            const escapedName = variable.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (!escapedName) { continue; }
            const pattern = new RegExp(`\\b${escapedName}\\b`, 'g');
            for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
                const line = document.lineAt(lineIndex).text;
                for (const match of line.matchAll(pattern)) {
                    const start = new vscode.Position(lineIndex, match.index ?? 0);
                    const link = new vscode.DocumentLink(
                        new vscode.Range(start, start.translate(0, variable.displayName.length)),
                        vscode.Uri.parse(`command:${CoreCommandIds.dataExplorerViewDataFrameByVariable}?${encodeURIComponent(JSON.stringify([variable.path]))}`),
                    );
                    link.tooltip = vscode.l10n.t("Open '{0}' in Data Explorer", variable.displayName);
                    links.push(link);
                }
            }
        }
        return links;
    }
}
