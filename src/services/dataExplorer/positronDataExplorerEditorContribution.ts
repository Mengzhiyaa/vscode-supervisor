import * as vscode from 'vscode';
import { CoreCommandIds } from '../../coreCommandIds';
import type { RuntimeSessionService } from '../../runtime/runtimeSession';
import type { IPositronVariablesService } from '../variables/interfaces/variablesService';
import {
    findDataExplorerIdentifierRanges,
    resolveDataFrameAtPosition,
    type ViewDataFrameByVariableArgs,
} from './positronDataExplorerResolveDataFrame';

const DataExplorerLanguages: vscode.DocumentSelector = ['python', 'r', 'quarto'];

export class PositronDataExplorerEditorContribution implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[];

    constructor(
        private readonly _variablesService: IPositronVariablesService,
        private readonly _runtimeSessionService?: RuntimeSessionService,
    ) {
        this._disposables = [
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerViewDataFrameAtCursor, () =>
                this._viewDataFrameAtCursor()),
            vscode.commands.registerCommand(
                CoreCommandIds.dataExplorerViewDataFrameByVariable,
                (args: ViewDataFrameByVariableArgs) =>
                    this._viewDataFrameByVariable(args),
            ),
            vscode.languages.registerCodeActionsProvider(
                DataExplorerLanguages,
                new PositronDataExplorerCodeActionProvider(
                    _variablesService,
                    _runtimeSessionService,
                ),
                { providedCodeActionKinds: [vscode.CodeActionKind.Refactor] },
            ),
            vscode.languages.registerDocumentLinkProvider(
                DataExplorerLanguages,
                new PositronDataExplorerClickToViewProvider(
                    _variablesService,
                    _runtimeSessionService,
                ),
            ),
        ];
    }

    dispose(): void { this._disposables.forEach(disposable => disposable.dispose()); }

    private async _viewDataFrameAtCursor(): Promise<string | undefined> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return undefined; }
        const resolved = resolveDataFrameAtPosition(
            editor.document,
            editor.selection.active,
            this._variablesService,
            this._runtimeSessionService,
        );
        return resolved?.instance.view(resolved.variable.path);
    }

    private _viewDataFrameByVariable(
        args: ViewDataFrameByVariableArgs,
    ): Promise<string | undefined> | undefined {
        const instance = this._variablesService.getVariablesInstance(args.sessionId) ??
            this._variablesService.positronVariablesInstances.find(
                candidate => candidate.session.sessionId === args.sessionId,
            );
        const variable = instance?.variableItems.find(item =>
            item.hasViewer && item.id === args.variableId);
        return variable && instance ? instance.view(variable.path) : undefined;
    }
}

export class PositronDataExplorerCodeActionProvider implements vscode.CodeActionProvider {
    constructor(
        private readonly _variablesService: IPositronVariablesService,
        private readonly _runtimeSessionService?: RuntimeSessionService,
    ) {}

    provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
        const resolved = resolveDataFrameAtPosition(
            document,
            range.start,
            this._variablesService,
            this._runtimeSessionService,
        );
        if (!resolved) { return []; }
        const action = new vscode.CodeAction(
            vscode.l10n.t("Open '{0}' in Data Explorer", resolved.variable.displayName),
            vscode.CodeActionKind.Refactor,
        );
        action.command = {
            command: CoreCommandIds.dataExplorerViewDataFrameByVariable,
            title: action.title,
            arguments: [{
                sessionId: resolved.sessionId,
                variableId: resolved.variable.id,
            } satisfies ViewDataFrameByVariableArgs],
        };
        return [action];
    }
}

export class PositronDataExplorerClickToViewProvider implements vscode.DocumentLinkProvider {
    constructor(
        private readonly _variablesService: IPositronVariablesService,
        private readonly _runtimeSessionService?: RuntimeSessionService,
    ) {}

    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
        if (!vscode.workspace.getConfiguration('dataExplorer').get('enableClickToView', true)) { return []; }
        if (document.getText().length > 1_000_000) { return []; }
        const links: vscode.DocumentLink[] = [];
        for (const range of findDataExplorerIdentifierRanges(document)) {
            const resolved = resolveDataFrameAtPosition(
                document,
                range.start,
                this._variablesService,
                this._runtimeSessionService,
            );
            if (!resolved || !range.isEqual(resolved.range)) {
                continue;
            }
            const args: ViewDataFrameByVariableArgs = {
                sessionId: resolved.sessionId,
                variableId: resolved.variable.id,
            };
            const link = new vscode.DocumentLink(
                range,
                vscode.Uri.parse(
                    `command:${CoreCommandIds.dataExplorerViewDataFrameByVariable}?` +
                    encodeURIComponent(JSON.stringify([args])),
                ),
            );
            link.tooltip = vscode.l10n.t(
                "Open '{0}' in Data Explorer",
                resolved.variable.displayName,
            );
            links.push(link);
        }
        return links;
    }
}
