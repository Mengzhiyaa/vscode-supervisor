import * as assert from 'assert';
import {
    DataExplorerUpdateCoordinator,
    DataExplorerUpdateKind,
} from '../../services/dataExplorer/dataExplorerUpdateCoordinator';

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>(currentResolve => {
        resolve = currentResolve;
    });
    return { promise, resolve };
}

async function nextTurn(): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
}

suite('[Unit] data explorer update coordinator', () => {
    test('does not fetch while hidden and coalesces schema over data', async () => {
        const updates: DataExplorerUpdateKind[] = [];
        const coordinator = new DataExplorerUpdateCoordinator(false, async kind => {
            updates.push(kind);
        });

        coordinator.dataUpdated();
        coordinator.schemaUpdated();
        coordinator.dataUpdated();
        await nextTurn();
        assert.deepStrictEqual(updates, []);

        coordinator.setVisible(true);
        await nextTurn();
        assert.deepStrictEqual(updates, [DataExplorerUpdateKind.Schema]);
    });

    test('invalidates an in-flight publication when hidden', async () => {
        const gate = deferred();
        let isCurrent: (() => boolean) | undefined;
        const coordinator = new DataExplorerUpdateCoordinator(true, async (_kind, current) => {
            isCurrent = current;
            await gate.promise;
        });

        coordinator.dataUpdated();
        await nextTurn();
        assert.strictEqual(isCurrent?.(), true);

        coordinator.setVisible(false);
        assert.strictEqual(isCurrent?.(), false);
        gate.resolve();
        await nextTurn();
        coordinator.setVisible(true);
        await nextTurn();
        assert.strictEqual(isCurrent?.(), true);
    });

    test('serializes updates and performs one follow-up refresh', async () => {
        const first = deferred();
        const updates: DataExplorerUpdateKind[] = [];
        const coordinator = new DataExplorerUpdateCoordinator(true, async kind => {
            updates.push(kind);
            if (updates.length === 1) {
                await first.promise;
            }
        });

        coordinator.dataUpdated();
        await nextTurn();
        coordinator.dataUpdated();
        coordinator.schemaUpdated();
        first.resolve();
        await nextTurn();
        await nextTurn();

        assert.deepStrictEqual(updates, [
            DataExplorerUpdateKind.Data,
            DataExplorerUpdateKind.Schema,
        ]);
    });
});
