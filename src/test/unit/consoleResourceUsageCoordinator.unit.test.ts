import * as assert from 'assert';
import {
    ConsoleResourceUsageCoordinator,
    ConsoleResourceUsagePublication,
    MAX_CONSOLE_RESOURCE_USAGE_HISTORY,
} from '../../webview/consoleResourceUsageCoordinator';

async function nextTurn(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

suite('[Unit] console resource usage coordinator', () => {
    test('bounds hidden history and restores it with one snapshot', async () => {
        const publications: ConsoleResourceUsagePublication[] = [];
        const coordinator = new ConsoleResourceUsageCoordinator(publication => {
            publications.push(publication);
        });

        for (let index = 0; index < 1_000; index++) {
            coordinator.record('session-1', {
                cpu_percent: index,
                memory_bytes: index * 1024,
                timestamp: index,
            });
        }
        await nextTurn();
        assert.deepStrictEqual(publications, []);

        coordinator.setActive(true);
        await nextTurn();

        assert.strictEqual(publications.length, 1);
        const publication = publications[0] as ConsoleResourceUsagePublication | undefined;
        assert.ok(publication);
        assert.strictEqual(publication.sessions.length, 1);
        assert.strictEqual(publication.sessions[0].replace, true);
        assert.strictEqual(
            publication.sessions[0].samples.length,
            MAX_CONSOLE_RESOURCE_USAGE_HISTORY,
        );
        assert.strictEqual(publication.sessions[0].samples[0].timestamp, 400);
        assert.strictEqual(
            publication.sessions[0].samples[publication.sessions[0].samples.length - 1].timestamp,
            999,
        );
    });

    test('keeps one batch in flight and coalesces follow-up samples', async () => {
        const publications: ConsoleResourceUsagePublication[] = [];
        const coordinator = new ConsoleResourceUsageCoordinator(publication => {
            publications.push(publication);
        });

        coordinator.record('session-1', { cpu_percent: 1, memory_bytes: 1 });
        coordinator.setActive(true);
        await nextTurn();
        assert.strictEqual(publications.length, 1);

        coordinator.record('session-1', { cpu_percent: 2, memory_bytes: 2 });
        coordinator.record('session-1', { cpu_percent: 3, memory_bytes: 3 });
        coordinator.record('session-2', { cpu_percent: 4, memory_bytes: 4 });
        await nextTurn();
        assert.strictEqual(publications.length, 1);

        coordinator.acknowledge(publications[0].generation);
        await nextTurn();

        assert.strictEqual(publications.length, 2);
        assert.deepStrictEqual(
            publications[1].sessions.map(session => ({
                sessionId: session.sessionId,
                replace: session.replace,
                cpu: session.samples.map(sample => sample.cpu_percent),
            })),
            [
                { sessionId: 'session-1', replace: false, cpu: [2, 3] },
                { sessionId: 'session-2', replace: false, cpu: [4] },
            ],
        );
    });

    test('ignores stale acknowledgements after a hidden-to-visible transition', async () => {
        const publications: ConsoleResourceUsagePublication[] = [];
        const coordinator = new ConsoleResourceUsageCoordinator(publication => {
            publications.push(publication);
        });

        coordinator.record('session-1', { cpu_percent: 1, memory_bytes: 1 });
        coordinator.setActive(true);
        await nextTurn();
        const staleGeneration = publications[0].generation;

        coordinator.setActive(false);
        coordinator.record('session-1', { cpu_percent: 2, memory_bytes: 2 });
        coordinator.setActive(true);
        await nextTurn();
        assert.strictEqual(publications.length, 2);
        assert.strictEqual(publications[1].sessions[0].replace, true);

        coordinator.record('session-1', { cpu_percent: 3, memory_bytes: 3 });
        coordinator.acknowledge(staleGeneration);
        await nextTurn();
        assert.strictEqual(publications.length, 2);

        coordinator.acknowledge(publications[1].generation);
        await nextTurn();
        assert.strictEqual(publications.length, 3);
        assert.deepStrictEqual(
            publications[2].sessions[0].samples.map(sample => sample.cpu_percent),
            [3],
        );
    });
});
