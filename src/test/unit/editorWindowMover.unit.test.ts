import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    EditorWindowMover,
    type EditorWindowMoveHost,
    findActivePanel,
    type MovableWebviewPanel,
} from '../../editor/EditorWindowMover';

function createTabGroup(id: string): vscode.TabGroup {
    return {
        isActive: true,
        viewColumn: vscode.ViewColumn.One,
        activeTab: undefined,
        tabs: [],
        id,
    } as unknown as vscode.TabGroup;
}

class TestMoveHost implements EditorWindowMoveHost {
    private readonly _tabGroupsChanged = new vscode.EventEmitter<unknown>();
    private _activeGroup = createTabGroup('main');
    private _activePanel: TestPanel | undefined;
    private _destinationNumber = 0;

    readonly movedPanelIds: string[] = [];
    readonly onDidChangeTabGroups = this._tabGroupsChanged.event;

    getActiveTabGroup(): vscode.TabGroup {
        return this._activeGroup;
    }

    activate(panel: TestPanel): void {
        if (this._activePanel && this._activePanel !== panel) {
            this._activePanel.setActive(false);
        }
        this._activePanel = panel;
        this._activeGroup = panel.group;
        panel.setActive(true);
    }

    executeMoveCommand(): Thenable<unknown> {
        const panel = this._activePanel;
        if (!panel) {
            throw new Error('No active panel');
        }

        this.movedPanelIds.push(panel.id);
        const destination = createTabGroup(`destination-${++this._destinationNumber}`);
        panel.group = destination;
        this._activeGroup = destination;
        this._tabGroupsChanged.fire({});
        return Promise.resolve();
    }
}

class TestPanel implements MovableWebviewPanel {
    private readonly _viewStateChanged = new vscode.EventEmitter<unknown>();
    private readonly _disposed = new vscode.EventEmitter<void>();
    private _active = false;

    readonly onDidChangeViewState = this._viewStateChanged.event;
    readonly onDidDispose = this._disposed.event;
    group = createTabGroup('main');

    constructor(
        readonly id: string,
        private readonly _host: TestMoveHost,
        private readonly _activateOnReveal = true,
    ) { }

    get active(): boolean {
        return this._active;
    }

    reveal(_viewColumn?: vscode.ViewColumn, _preserveFocus?: boolean): void {
        if (this._activateOnReveal) {
            this._host.activate(this);
        }
    }

    setActive(active: boolean): void {
        this._active = active;
        this._viewStateChanged.fire({});
    }

    activate(): void {
        this._host.activate(this);
    }

    dispose(): void {
        this._active = false;
        this._disposed.fire();
    }
}

suite('[Unit] Editor window mover', () => {
    test('serializes moves so each command targets the requested panel', async () => {
        const host = new TestMoveHost();
        const mover = new EditorWindowMover(host, 100);
        const firstPanel = new TestPanel('first', host);
        const secondPanel = new TestPanel('second', host);

        const [firstGroup, secondGroup] = await Promise.all([
            mover.move(firstPanel),
            mover.move(secondPanel),
        ]);

        assert.deepStrictEqual(host.movedPanelIds, ['first', 'second']);
        assert.notStrictEqual(firstGroup, secondGroup);
    });

    test('coalesces concurrent move requests for the same panel', async () => {
        const host = new TestMoveHost();
        const mover = new EditorWindowMover(host, 100);
        const panel = new TestPanel('plot', host);

        const firstMove = mover.move(panel);
        const duplicateMove = mover.move(panel);

        assert.strictEqual(duplicateMove, firstMove);
        await firstMove;
        assert.deepStrictEqual(host.movedPanelIds, ['plot']);
    });

    test('waits for the requested panel to become active before moving', async () => {
        const host = new TestMoveHost();
        const mover = new EditorWindowMover(host, 100);
        const panel = new TestPanel('delayed', host, false);

        const move = mover.move(panel);
        await Promise.resolve();
        assert.deepStrictEqual(host.movedPanelIds, []);

        panel.activate();
        await move;
        assert.deepStrictEqual(host.movedPanelIds, ['delayed']);
    });

    test('continues queued moves after a target panel is disposed', async () => {
        const host = new TestMoveHost();
        const mover = new EditorWindowMover(host, 100);
        const disposedPanel = new TestPanel('disposed', host, false);
        const nextPanel = new TestPanel('next', host);

        const failedMove = mover.move(disposedPanel);
        const nextMove = mover.move(nextPanel);
        await Promise.resolve();
        disposedPanel.dispose();

        await assert.rejects(failedMove, /disposed before the move completed/);
        await nextMove;
        assert.deepStrictEqual(host.movedPanelIds, ['next']);
    });

    test('selects only an active panel and never falls back to a visible peer', () => {
        const inactive = { id: 'inactive', active: false };
        const active = { id: 'active', active: true };

        assert.strictEqual(findActivePanel([inactive]), undefined);
        assert.strictEqual(findActivePanel([inactive, active]), active);
    });
});
