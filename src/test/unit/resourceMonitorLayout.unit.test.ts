import * as assert from 'assert';
import { computeResourceMonitorLayout } from '../../shared/resourceMonitorLayout';

suite('[Unit] console resource monitor layout', () => {
    test('degrades from graph and memory to memory only, then empty', () => {
        assert.deepStrictEqual(computeResourceMonitorLayout(91), {
            showGraph: false,
            graphWidth: 0,
            showMemory: false,
        });
        assert.deepStrictEqual(computeResourceMonitorLayout(92), {
            showGraph: false,
            graphWidth: 0,
            showMemory: true,
        });
        assert.deepStrictEqual(computeResourceMonitorLayout(147), {
            showGraph: false,
            graphWidth: 0,
            showMemory: true,
        });
        assert.deepStrictEqual(computeResourceMonitorLayout(148), {
            showGraph: true,
            graphWidth: 50,
            showMemory: true,
        });
    });

    test('grows the graph through 150px and clamps it above the maximum', () => {
        assert.strictEqual(computeResourceMonitorLayout(149).graphWidth, 51);
        assert.strictEqual(computeResourceMonitorLayout(247).graphWidth, 149);
        assert.strictEqual(computeResourceMonitorLayout(248).graphWidth, 150);
        assert.strictEqual(computeResourceMonitorLayout(400).graphWidth, 150);
    });
});
