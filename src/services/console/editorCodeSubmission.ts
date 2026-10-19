import * as vscode from 'vscode';
import { CoreCommandIds } from '../../coreCommandIds';

type SubmissionDecision = 'cancel' | 'runAsIs';
type DecisionOutcome = { kind: 'cancel' } | { kind: 'runAsIs' };

type DetectionOutcome<T> =
    | { kind: 'result'; value: T }
    | { kind: 'error'; error: unknown }
    | DecisionOutcome;

/** Owns one provider request, including providers that ignore cancellation. */
export class StatementRangeDetection implements vscode.Disposable {
    private readonly _source = new vscode.CancellationTokenSource();
    private readonly _decision: Promise<DecisionOutcome>;
    private readonly _finished: Promise<void>;
    private readonly _listeners: vscode.Disposable[];
    private readonly _statusTimer: ReturnType<typeof setTimeout>;
    private readonly _progressTimer: ReturnType<typeof setTimeout>;
    private _resolveDecision!: (value: DecisionOutcome) => void;
    private _resolveFinished!: () => void;
    private _status: vscode.StatusBarItem | undefined;
    private _decided = false;
    private _disposed = false;

    readonly token = this._source.token;

    constructor(
        document: vscode.TextDocument,
        line: number,
        private readonly _onDispose: () => void,
    ) {
        this._decision = new Promise(resolve => { this._resolveDecision = resolve; });
        this._finished = new Promise(resolve => { this._resolveFinished = resolve; });
        this._listeners = [
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document === document && event.contentChanges.length > 0) {
                    this.decide('cancel');
                }
            }),
            vscode.workspace.onDidCloseTextDocument(closed => {
                if (closed === document) { this.decide('cancel'); }
            }),
        ];

        // Keep fast providers quiet. Slow requests expose both actions using
        // public VS Code APIs, without requiring a workbench editor widget.
        this._statusTimer = setTimeout(() => {
            if (this._disposed || this._decided) { return; }
            this._status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
            this._status.text = `$(sync~spin) ${vscode.l10n.t('Preparing code…')}  $(play) ${vscode.l10n.t('Run as Is')}`;
            this._status.tooltip = vscode.l10n.t('Run without waiting for statement detection.');
            this._status.command = CoreCommandIds.consoleRunCodeAsIs;
            this._status.show();
        }, 400);
        this._progressTimer = setTimeout(() => {
            if (this._disposed || this._decided) { return; }
            void vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Preparing code at line {0}', line + 1),
                cancellable: true,
            }, async (_progress, token) => {
                const listener = token.onCancellationRequested(() => this.decide('cancel'));
                try {
                    if (token.isCancellationRequested) { this.decide('cancel'); }
                    await this._finished;
                } finally {
                    listener.dispose();
                }
            });
        }, 1000);
    }

    async wait<T>(work: PromiseLike<T>): Promise<DetectionOutcome<T>> {
        const result = Promise.resolve(work).then<DetectionOutcome<T>, DetectionOutcome<T>>(
            value => ({ kind: 'result', value }),
            error => ({ kind: 'error', error }),
        );
        // Handle late provider rejections even after the user's decision wins.
        return Promise.race([result, this._decision]);
    }

    decide(kind: SubmissionDecision): void {
        if (this._disposed || this._decided) { return; }
        this._decided = true;
        this._resolveDecision({ kind });
        this._source.cancel();
    }

    dispose(): void {
        if (this._disposed) { return; }
        this.decide('cancel');
        this._disposed = true;
        clearTimeout(this._statusTimer);
        clearTimeout(this._progressTimer);
        this._status?.dispose();
        this._resolveFinished();
        this._listeners.forEach(listener => listener.dispose());
        this._source.dispose();
        this._onDispose();
    }
}

export class EditorCodeSubmissionService implements vscode.Disposable {
    private _current: StatementRangeDetection | undefined;

    begin(document: vscode.TextDocument, line: number): StatementRangeDetection {
        // A superseded detection must not submit stale code when it returns.
        this._current?.dispose();
        const detection = new StatementRangeDetection(document, line, () => {
            if (this._current === detection) {
                this._current = undefined;
                void vscode.commands.executeCommand('setContext', 'supervisor.editorCodeSubmissionPending', false);
            }
        });
        this._current = detection;
        void vscode.commands.executeCommand('setContext', 'supervisor.editorCodeSubmissionPending', true);
        return detection;
    }

    cancel(): void { this._current?.decide('cancel'); }
    runAsIs(): void { this._current?.decide('runAsIs'); }
    dispose(): void { this._current?.dispose(); }
}
