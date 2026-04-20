import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConsoleStateStore } from '../../services/console/consoleStateStore';
import type { SerializedConsoleState } from '../../shared/consoleState';
import { ActivityItemInputState } from '../../shared/console';

function createMemento(initialEntries: Record<string, unknown> = {}): vscode.Memento {
    const store = new Map<string, unknown>(Object.entries(initialEntries));
    return {
        get: <T>(key: string, defaultValue?: T) => {
            return (store.has(key) ? store.get(key) : defaultValue) as T;
        },
        update: async (key: string, value: unknown) => {
            if (value === undefined) {
                store.delete(key);
            } else {
                store.set(key, value);
            }
        },
        keys: () => Array.from(store.keys()),
    };
}

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'console-state-store-test',
        logLevel: vscode.LogLevel.Trace,
        onDidChangeLogLevel: event,
        trace: noop,
        debug: noop,
        info: noop,
        warn: noop,
        error: noop,
        append: noop,
        appendLine: noop,
        replace: noop,
        clear: noop,
        show: noop,
        hide: noop,
        dispose: noop,
    };
}

/**
 * Build a minimal valid SerializedConsoleState.
 */
function makeState(overrides: Partial<SerializedConsoleState> = {}): SerializedConsoleState {
    return {
        version: 2,
        items: [],
        inputHistory: [],
        trace: false,
        wordWrap: true,
        ...overrides,
    };
}

/**
 * Create a stream activity item that contributes ~`sizeChars` to the payload.
 */
function makeStreamItem(sizeChars: number, parentId = 'exec-1'): any {
    return {
        type: 'activity',
        parentId,
        items: [
            {
                type: 'input',
                id: `input-${parentId}`,
                parentId,
                when: Date.now(),
                state: 'completed',
                inputPrompt: '>',
                continuationPrompt: '+',
                code: 'print("hello")',
            },
            {
                type: 'stream',
                id: `stream-${parentId}`,
                parentId,
                when: Date.now(),
                streamType: 'output',
                text: 'x'.repeat(sizeChars),
            },
        ],
    };
}

/**
 * Create an output activity item with a large data record.
 */
function makeOutputItem(sizeChars: number, parentId = 'exec-out-1'): any {
    return {
        type: 'activity',
        parentId,
        items: [
            {
                type: 'input',
                id: `input-${parentId}`,
                parentId,
                when: Date.now(),
                state: 'completed',
                inputPrompt: '>',
                continuationPrompt: '+',
                code: 'result',
            },
            {
                type: 'output',
                id: `output-${parentId}`,
                parentId,
                when: Date.now(),
                data: { 'text/plain': 'y'.repeat(sizeChars) },
            },
        ],
    };
}

/**
 * Create a trace runtime item with a large trace string.
 */
function makeTraceItem(sizeChars: number): any {
    return {
        type: 'trace',
        id: `trace-${Date.now()}`,
        when: Date.now(),
        trace: 'z'.repeat(sizeChars),
    };
}

suite('[Unit] ConsoleStateStore — progressive truncation', () => {

    test('small state passes through unchanged', () => {
        const memento = createMemento();
        const store = new ConsoleStateStore(memento, makeNoopLogChannel());

        const state = makeState({
            items: [makeStreamItem(100, 'small-1')],
            inputHistory: ['1 + 1', 'print(x)'],
        });

        // Access private method for testing
        const prepared = (store as any)._prepareStateForStorage(state);
        assert.strictEqual(prepared.items.length, 1);
        assert.strictEqual(prepared.inputHistory.length, 2);
        store.dispose();
    });

    test('progressive truncation keeps newest items when over budget', () => {
        const memento = createMemento();
        const store = new ConsoleStateStore(memento, makeNoopLogChannel());

        // Create state with many items totaling > 256KB.
        // Each item text is 4000 chars (below the 4096 truncation threshold),
        // so Phase 1 truncation won't help — forces Phase 2 (oldest removal).
        const items = [];
        for (let i = 0; i < 100; i++) {
            items.push(makeStreamItem(4000, `exec-${i}`)); // ~4KB each = ~400KB total
        }

        const state = makeState({ items });
        const prepared = (store as any)._prepareStateForStorage(state);

        // Should have fewer items than the original
        assert.ok(prepared.items.length > 0, 'should retain some items');
        assert.ok(prepared.items.length < 100, 'should have removed some items');

        // The retained items should be the newest (highest index)
        const lastOriginalParentId = items[items.length - 1].parentId;
        const lastPreparedParentId = prepared.items[prepared.items.length - 1].parentId;
        assert.strictEqual(lastPreparedParentId, lastOriginalParentId,
            'newest item should be preserved');

        // Total size should be within budget
        const sizeBytes = Buffer.byteLength(JSON.stringify(prepared), 'utf8');
        assert.ok(sizeBytes <= 256 * 1024, `size ${sizeBytes} should be <= 256KB`);

        store.dispose();
    });

    test('stream text fields are truncated before item removal', () => {
        const memento = createMemento();
        const store = new ConsoleStateStore(memento, makeNoopLogChannel());

        // Single item with 300KB stream text — should truncate the string, not remove the item
        const state = makeState({
            items: [makeStreamItem(300_000, 'big-stream')],
        });

        const prepared = (store as any)._prepareStateForStorage(state);
        assert.strictEqual(prepared.items.length, 1, 'item should be retained after truncation');

        const streamItem = prepared.items[0].items.find((i: any) => i.type === 'stream');
        assert.ok(streamItem, 'stream child should exist');
        assert.ok(streamItem.text.length <= 4096 + 20, // MaxStringFieldChars + suffix
            `stream text should be truncated, got ${streamItem.text.length}`);

        store.dispose();
    });

    test('output.data values are truncated (non-stream/error/html type)', () => {
        const memento = createMemento();
        const store = new ConsoleStateStore(memento, makeNoopLogChannel());

        // Single item with 300KB output data
        const state = makeState({
            items: [makeOutputItem(300_000, 'big-output')],
        });

        const prepared = (store as any)._prepareStateForStorage(state);
        assert.strictEqual(prepared.items.length, 1, 'item should be retained');

        const outputChild = prepared.items[0].items.find((i: any) => i.type === 'output');
        assert.ok(outputChild, 'output child should exist');
        assert.ok(outputChild.data['text/plain'].length <= 4096 + 20,
            `output data should be truncated, got ${outputChild.data['text/plain'].length}`);

        store.dispose();
    });

    test('trace item string is truncated by shallow truncation', () => {
        const memento = createMemento();
        const store = new ConsoleStateStore(memento, makeNoopLogChannel());

        const state = makeState({
            items: [makeTraceItem(300_000)],
        });

        const prepared = (store as any)._prepareStateForStorage(state);
        assert.strictEqual(prepared.items.length, 1, 'trace item should be retained');
        assert.ok(prepared.items[0].trace.length <= 4096 + 20,
            `trace string should be truncated, got ${prepared.items[0].trace.length}`);

        store.dispose();
    });

    test('activity.items array is NOT truncated (structural array preserved)', () => {
        const memento = createMemento();
        const store = new ConsoleStateStore(memento, makeNoopLogChannel());

        // Activity with 30 child items (input + many small streams)
        const children: any[] = [
            {
                type: 'input',
                id: 'input-many',
                parentId: 'exec-many',
                when: Date.now(),
                state: 'completed',
                inputPrompt: '>',
                continuationPrompt: '+',
                code: 'for(i in 1:30) print(i)',
            },
        ];
        for (let i = 0; i < 29; i++) {
            children.push({
                type: 'stream',
                id: `stream-many-${i}`,
                parentId: 'exec-many',
                when: Date.now(),
                streamType: 'output',
                text: `[1] ${i}\n`,
            });
        }

        const state = makeState({
            items: [{
                type: 'activity',
                parentId: 'exec-many',
                items: children,
            }],
        });

        const prepared = (store as any)._prepareStateForStorage(state);
        assert.strictEqual(prepared.items.length, 1, 'activity should be retained');
        assert.strictEqual(prepared.items[0].items.length, 30,
            'all 30 activity children should be preserved (structural array not truncated)');

        store.dispose();
    });

    test('inputHistory is trimmed by byte budget', () => {
        const memento = createMemento();
        const store = new ConsoleStateStore(memento, makeNoopLogChannel());

        // 300 entries × 1KB each = ~300KB of history
        const bigHistory: string[] = [];
        for (let i = 0; i < 300; i++) {
            bigHistory.push('cmd_' + 'a'.repeat(1000));
        }

        const state = makeState({ inputHistory: bigHistory });
        const prepared = (store as any)._prepareStateForStorage(state);

        // Should have fewer entries
        assert.ok(prepared.inputHistory.length > 0, 'should retain some history');
        assert.ok(prepared.inputHistory.length < 300, 'should have trimmed history');

        // The retained entries should be the newest
        assert.strictEqual(
            prepared.inputHistory[prepared.inputHistory.length - 1],
            bigHistory[bigHistory.length - 1],
            'newest history entry should be preserved'
        );

        store.dispose();
    });

    test('single oversized item that remains large after truncation gets removed', () => {
        const memento = createMemento();
        const store = new ConsoleStateStore(memento, makeNoopLogChannel());

        // Activity with 100 output mime types, each 4096 chars after truncation → ~400KB
        const mimeData: Record<string, string> = {};
        for (let i = 0; i < 100; i++) {
            mimeData[`application/x-custom-${i}`] = 'w'.repeat(50_000);
        }

        const state = makeState({
            items: [{
                type: 'activity',
                parentId: 'exec-huge',
                items: [{
                    type: 'input',
                    id: 'input-huge',
                    parentId: 'exec-huge',
                    when: Date.now(),
                    state: ActivityItemInputState.Completed,
                    inputPrompt: '>',
                    continuationPrompt: '+',
                    code: 'result',
                }, {
                    type: 'output',
                    id: 'output-huge',
                    parentId: 'exec-huge',
                    when: Date.now(),
                    data: mimeData,
                }],
            }],
            inputHistory: ['1 + 1'],
        });

        const prepared = (store as any)._prepareStateForStorage(state);

        // The single item is still too large even after per-field truncation → removed
        assert.strictEqual(prepared.items.length, 0, 'oversized item should be removed');

        // But inputHistory should survive
        assert.strictEqual(prepared.inputHistory.length, 1, 'inputHistory should survive');
        assert.strictEqual(prepared.inputHistory[0], '1 + 1');

        const sizeBytes = Buffer.byteLength(JSON.stringify(prepared), 'utf8');
        assert.ok(sizeBytes <= 256 * 1024, `final size ${sizeBytes} should be <= 256KB`);

        store.dispose();
    });
});

suite('[Unit] ConsoleStateStore — version-based flush', () => {

    test('delete() cleans up version tracking state', () => {
        const memento = createMemento();
        const store = new ConsoleStateStore(memento, makeNoopLogChannel());

        // Simulate: dirtyVersion and flushedVersion exist for a session
        (store as any)._dirtyVersion.set('session-1', 5);
        (store as any)._flushedVersion.set('session-1', 3);

        store.delete('session-1');

        assert.strictEqual((store as any)._dirtyVersion.has('session-1'), false,
            'dirtyVersion should be cleaned up');
        assert.strictEqual((store as any)._flushedVersion.has('session-1'), false,
            'flushedVersion should be cleaned up');
    });

    test('dispose() cleans up timer and version maps', () => {
        const memento = createMemento();
        const store = new ConsoleStateStore(memento, makeNoopLogChannel());

        (store as any)._dirtyVersion.set('s1', 1);
        (store as any)._flushedVersion.set('s1', 0);

        store.dispose();

        assert.strictEqual((store as any)._autoFlushTimer, undefined,
            'auto-flush timer should be cleared');
        assert.strictEqual((store as any)._dirtyVersion.size, 0,
            'dirtyVersion should be cleared');
        assert.strictEqual((store as any)._flushedVersion.size, 0,
            'flushedVersion should be cleared');
    });
});
