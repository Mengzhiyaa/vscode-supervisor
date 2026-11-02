import * as vscode from 'vscode';
import { CoreCommandIds } from '../../coreCommandIds';
import type { RuntimeSessionService } from '../../runtime/runtimeSession';
import type {
    IPositronVariablesInstance,
    IPositronVariablesService,
} from '../variables/interfaces/variablesService';
import type { IPositronDataExplorerService } from './positronDataExplorerService';
import { viewVariableItem } from './positronDataExplorerViewVariableItem';
import {
    findDataExplorerIdentifierRanges,
    resolveDataFrameAtPosition,
    type ViewDataFrameAtCursorArgs,
    type ViewDataFrameByVariableArgs,
} from './positronDataExplorerResolveDataFrame';

const DataExplorerLanguages: vscode.DocumentSelector = ['python', 'r', 'quarto'];

export class PositronDataExplorerEditorContribution implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[];
    private readonly _variableListeners = new Map<IPositronVariablesInstance, vscode.Disposable>();
    private _clickToViewRegistration: vscode.Disposable | undefined;
    private _refreshQueued = false;
    private _disposed = false;

    constructor(
        private readonly _variablesService: IPositronVariablesService,
        private readonly _runtimeSessionService: RuntimeSessionService | undefined,
        private readonly _dataExplorerService: IPositronDataExplorerService,
    ) {
        this._disposables = [
            vscode.commands.registerCommand(
                CoreCommandIds.dataExplorerViewDataFrameAtCursor,
                (args?: ViewDataFrameAtCursorArgs) => this._viewDataFrameAtCursor(args),
            ),
            vscode.commands.registerCommand(
                CoreCommandIds.dataExplorerViewDataFrameByVariable,
                (args: ViewDataFrameByVariableArgs) => this._viewDataFrameByVariable(args),
            ),
            vscode.languages.registerCodeActionsProvider(
                DataExplorerLanguages,
                new PositronDataExplorerCodeActionProvider(
                    _variablesService,
                    _runtimeSessionService,
                ),
                { providedCodeActionKinds: [vscode.CodeActionKind.Refactor] },
            ),
            _variablesService.onDidStartPositronVariablesInstance((instance) => {
                this._watchVariables(instance);
                this._refreshClickToViewProvider();
            }),
            _variablesService.onDidStopPositronVariablesInstance((instance) => {
                this._variableListeners.get(instance)?.dispose();
                this._variableListeners.delete(instance);
                this._refreshClickToViewProvider();
            }),
            _variablesService.onDidChangeActivePositronVariablesInstance(() =>
                this._refreshClickToViewProvider(),
            ),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('dataExplorer.enableClickToView')) {
                    this._refreshClickToViewProvider();
                }
            }),
        ];
        if (_runtimeSessionService) {
            this._disposables.push(
                _runtimeSessionService.onDidChangeForegroundSession(() =>
                    this._refreshClickToViewProvider(),
                ),
            );
        }
        for (const instance of _variablesService.positronVariablesInstances) {
            this._watchVariables(instance);
        }
        this._refreshClickToViewProvider();
    }

    dispose(): void {
        this._disposed = true;
        this._clickToViewRegistration?.dispose();
        this._variableListeners.forEach((listener) => listener.dispose());
        this._variableListeners.clear();
        this._disposables.forEach((disposable) => disposable.dispose());
    }

    private _watchVariables(instance: IPositronVariablesInstance): void {
        this._variableListeners.get(instance)?.dispose();
        this._variableListeners.set(
            instance,
            instance.onDidChangeEntries(() => this._refreshClickToViewProvider()),
        );
    }

    private _refreshClickToViewProvider(): void {
        if (this._disposed || this._refreshQueued) {
            return;
        }
        this._refreshQueued = true;
        queueMicrotask(() => {
            this._refreshQueued = false;
            if (this._disposed) {
                return;
            }
            // VS Code exposes no DocumentLink invalidation event. Re-register
            // the provider so unchanged documents see the new runtime variables.
            this._clickToViewRegistration?.dispose();
            this._clickToViewRegistration = vscode.languages.registerDocumentLinkProvider(
                DataExplorerLanguages,
                new PositronDataExplorerClickToViewProvider(
                    this._variablesService,
                    this._runtimeSessionService,
                ),
            );
        });
    }

    private async _viewDataFrameAtCursor(
        args?: ViewDataFrameAtCursorArgs,
    ): Promise<string | undefined> {
        const editor = vscode.window.activeTextEditor;
        const document = args
            ? vscode.workspace.textDocuments.find(
                  (candidate) => candidate.uri.toString() === args.documentUri,
              )
            : editor?.document;
        if (!document || (args && document.version !== args.documentVersion)) {
            return undefined;
        }
        if (
            args &&
            !vscode.workspace.getConfiguration('dataExplorer').get('enableClickToView', true)
        ) {
            return undefined;
        }
        const position = args
            ? new vscode.Position(args.position.line, args.position.character)
            : editor!.selection.active;
        const resolved = await resolveDataFrameAtPosition(
            document,
            position,
            this._variablesService,
            this._runtimeSessionService,
            undefined,
            { wait: !args },
        );
        if (!resolved && !args) {
            void vscode.window.showInformationMessage(
                vscode.l10n.t('No viewable data frame was found at the cursor.'),
            );
        }
        return (
            resolved &&
            viewVariableItem(
                resolved.sessionId,
                resolved.variable,
                resolved.instance,
                this._dataExplorerService,
            )
        );
    }

    private _viewDataFrameByVariable(
        args?: ViewDataFrameByVariableArgs,
    ): Promise<string | undefined> | undefined {
        if (!args?.sessionId || !args.variableId) {
            return undefined;
        }
        const instance =
            this._variablesService.getVariablesInstance(args.sessionId) ??
            this._variablesService.positronVariablesInstances.find(
                (candidate) => candidate.session.sessionId === args.sessionId,
            );
        const variable = instance?.variableItems.find(
            (item) => item.hasViewer && item.id === args.variableId,
        );
        return variable && instance
            ? viewVariableItem(args.sessionId, variable, instance, this._dataExplorerService)
            : undefined;
    }
}

export class PositronDataExplorerCodeActionProvider implements vscode.CodeActionProvider {
    constructor(
        private readonly _variablesService: IPositronVariablesService,
        private readonly _runtimeSessionService?: RuntimeSessionService,
    ) {}

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context?: vscode.CodeActionContext,
    ): vscode.CodeAction[] {
        if (context?.only && !context.only.intersects(vscode.CodeActionKind.Refactor)) {
            return [];
        }
        const resolved = resolveDataFrameAtPosition(
            document,
            range.start,
            this._variablesService,
            this._runtimeSessionService,
        );
        if (!resolved) {
            return [];
        }
        const action = new vscode.CodeAction(
            vscode.l10n.t("Open '{0}' in Data Explorer", resolved.variable.displayName),
            vscode.CodeActionKind.Refactor,
        );
        action.command = {
            command: CoreCommandIds.dataExplorerViewDataFrameByVariable,
            title: action.title,
            arguments: [
                {
                    sessionId: resolved.sessionId,
                    variableId: resolved.variable.id,
                } satisfies ViewDataFrameByVariableArgs,
            ],
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
        if (!vscode.workspace.getConfiguration('dataExplorer').get('enableClickToView', true)) {
            return [];
        }
        if (document.getText().length > 1_000_000) {
            return [];
        }
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
            const args: ViewDataFrameAtCursorArgs = {
                documentUri: document.uri.toString(),
                documentVersion: document.version,
                position: { line: range.start.line, character: range.start.character },
            };
            const link = new vscode.DocumentLink(
                range,
                vscode.Uri.parse(
                    `command:${CoreCommandIds.dataExplorerViewDataFrameAtCursor}?` +
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
