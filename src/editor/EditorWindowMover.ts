import * as vscode from 'vscode';

const MoveEditorToNewWindowCommand = 'workbench.action.moveEditorToNewWindow';
const DefaultStateTransitionTimeoutMs = 5000;

export interface MovableWebviewPanel {
    readonly active: boolean;
    readonly onDidChangeViewState: vscode.Event<unknown>;
    readonly onDidDispose: vscode.Event<void>;
    reveal(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void;
}

export interface EditorWindowMoveHost {
    getActiveTabGroup(): vscode.TabGroup;
    readonly onDidChangeTabGroups: vscode.Event<unknown>;
    executeMoveCommand(): Thenable<unknown>;
}

const defaultHost: EditorWindowMoveHost = {
    getActiveTabGroup: () => vscode.window.tabGroups.activeTabGroup,
    onDidChangeTabGroups: vscode.window.tabGroups.onDidChangeTabGroups,
    executeMoveCommand: () => vscode.commands.executeCommand(MoveEditorToNewWindowCommand),
};

/**
 * Serializes editor-to-window moves and binds each move to an explicitly activated panel.
 *
 * VS Code's moveEditorToNewWindow command operates on the active editor when no internal
 * editor context is supplied. WebviewPanel does not expose that context, so the safest
 * public-API sequence is to activate the exact panel, observe that activation, and prevent
 * another plot/gallery move from changing the active editor until the command completes.
 */
export class EditorWindowMover {
    private _moveQueue: Promise<void> = Promise.resolve();
    private readonly _pendingMoves = new WeakMap<MovableWebviewPanel, Promise<vscode.TabGroup>>();

    constructor(
        private readonly _host: EditorWindowMoveHost = defaultHost,
        private readonly _stateTransitionTimeoutMs = DefaultStateTransitionTimeoutMs,
    ) { }

    move(panel: MovableWebviewPanel): Promise<vscode.TabGroup> {
        const pendingMove = this._pendingMoves.get(panel);
        if (pendingMove) {
            return pendingMove;
        }

        const move = this._moveQueue.then(() => this._moveActivePanel(panel));
        this._pendingMoves.set(panel, move);
        this._moveQueue = move.then(
            () => undefined,
            () => undefined,
        );

        void move.finally(() => {
            if (this._pendingMoves.get(panel) === move) {
                this._pendingMoves.delete(panel);
            }
        }).catch(() => undefined);

        return move;
    }

    private async _moveActivePanel(panel: MovableWebviewPanel): Promise<vscode.TabGroup> {
        // Omitting viewColumn keeps an existing panel in its current group instead of
        // resolving ViewColumn.Active against a possibly unrelated auxiliary window.
        panel.reveal(undefined, false);
        await this._waitFor(
            () => panel.active,
            [panel.onDidChangeViewState],
            panel.onDidDispose,
            'Timed out waiting for the target webview panel to become active.',
        );

        const sourceGroup = this._host.getActiveTabGroup();
        await this._host.executeMoveCommand();

        await this._waitFor(
            () => panel.active && this._host.getActiveTabGroup() !== sourceGroup,
            [panel.onDidChangeViewState, this._host.onDidChangeTabGroups],
            panel.onDidDispose,
            'Timed out waiting for the target webview panel to move to a new window.',
        );

        return this._host.getActiveTabGroup();
    }

    private _waitFor(
        predicate: () => boolean,
        events: readonly vscode.Event<unknown>[],
        onDidDispose: vscode.Event<void>,
        timeoutMessage: string,
    ): Promise<void> {
        if (predicate()) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve, reject) => {
            const disposables: vscode.Disposable[] = [];
            let timeout: ReturnType<typeof setTimeout> | undefined;
            let settled = false;

            const finish = (error?: Error) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = undefined;
                }
                for (const disposable of disposables) {
                    disposable.dispose();
                }
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            };

            const check = () => {
                if (predicate()) {
                    finish();
                }
            };

            for (const event of events) {
                disposables.push(event(check));
            }
            disposables.push(onDidDispose(() => {
                finish(new Error('The target webview panel was disposed before the move completed.'));
            }));

            timeout = setTimeout(() => {
                finish(new Error(timeoutMessage));
            }, this._stateTransitionTimeoutMs);

            // Close the small race between the initial predicate check and listener setup.
            check();
        });
    }
}

export function findActivePanel<T extends { readonly active: boolean }>(panels: Iterable<T>): T | undefined {
    for (const panel of panels) {
        if (panel.active) {
            return panel;
        }
    }
    return undefined;
}
