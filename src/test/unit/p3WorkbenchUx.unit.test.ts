import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    addHtmlBaseUri,
    decodeImageDataUri,
    imageExtension,
} from '../../editor/PlotEditorProvider';
import {
    ExecutionEntryType,
    ExecutionHistoryService,
} from '../../services/console/executionHistoryService';
import {
    injectViewerBridge,
    VIEWER_BRIDGE_PATH,
} from '../../services/preview/htmlProxyUtils';

function createLog(): vscode.LogOutputChannel {
    const noop = () => undefined;
    return {
        name: 'p3-workbench-ux-test',
        logLevel: vscode.LogLevel.Trace,
        onDidChangeLogLevel: () => ({ dispose: noop }),
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

class MemoryMemento implements vscode.Memento {
    private readonly values = new Map<string, unknown>();
    keys(): readonly string[] {
        return [...this.values.keys()];
    }
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        return this.values.has(key) ? this.values.get(key) as T : defaultValue;
    }
    async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this.values.delete(key);
        } else {
            this.values.set(key, value);
        }
    }
    setKeysForSync(): void { }
}

suite('[Unit] P3 Workbench and UX equivalence', () => {
    test('centralizes session and language input history with adjacent deduplication', async () => {
        const storage = new MemoryMemento();
        const history = new ExecutionHistoryService(storage, createLog());
        history.recordInput('session-a', 'r', 'x <- 1', 1);
        history.recordInput('session-a', 'r', 'x <- 1', 2);
        history.recordInput('session-b', 'r', 'y <- 2', 3);
        await history.flush();

        assert.deepStrictEqual(
            history.getSessionInputEntries('session-a').map(entry => entry.input),
            ['x <- 1'],
        );
        assert.deepStrictEqual(
            history.getInputEntries('r').map(entry => entry.input),
            ['x <- 1', 'y <- 2'],
        );

        history.clearSessionInputEntries('session-a');
        await history.flush();
        assert.deepStrictEqual(
            history.restoreLegacySessionEntries('session-a', 'r', ['stale']),
            [],
            'an explicit clear must prevent stale console-state resurrection',
        );
        history.dispose();
    });

    test('imports legacy session history after an initial empty read', async () => {
        const history = new ExecutionHistoryService(new MemoryMemento(), createLog());
        assert.deepStrictEqual(history.getSessionInputEntries('legacy-session'), []);
        const restored = history.restoreLegacySessionEntries(
            'legacy-session',
            'python',
            ['print(1)', 'print(2)'],
        );
        assert.deepStrictEqual(restored.map(entry => entry.input), ['print(1)', 'print(2)']);
        history.dispose();
    });

    test('persists and reloads semantic execution history independently of console UI state', async () => {
        const storage = new MemoryMemento();
        const history = new ExecutionHistoryService(storage, createLog());
        const when = Date.now() - 10;

        history.recordExecutionOutput('semantic-session', 'execution-1', 'early ', when);
        history.recordExecutionInput('semantic-session', 'execution-1', '> ', 'print(42)', when);
        history.recordExecutionOutput('semantic-session', 'execution-1', '42', when);
        history.recordExecutionError('semantic-session', 'execution-1', {
            name: 'Warning',
            message: 'example',
            traceback: ['trace'],
        });
        history.completeExecution('semantic-session', 'execution-1');
        history.recordStartup('semantic-session', 'startup-semantic-session', 'Python', '3.12');
        await history.flush();
        history.dispose();

        const restored = new ExecutionHistoryService(storage, createLog());
        const entries = restored.getExecutionEntries('semantic-session');
        assert.strictEqual(entries.length, 2);
        assert.deepStrictEqual(entries[0], {
            id: 'execution-1',
            when,
            prompt: '> ',
            input: 'print(42)',
            outputType: ExecutionEntryType.Execution,
            output: 'early 42',
            error: {
                name: 'Warning',
                message: 'example',
                traceback: ['trace'],
            },
            durationMs: entries[0].durationMs,
        });
        assert.ok(entries[0].durationMs >= 0);
        assert.strictEqual(entries[1].outputType, ExecutionEntryType.Startup);
        assert.deepStrictEqual(entries[1].output, { banner: 'Python', version: '3.12' });

        restored.clearExecutionEntries('semantic-session');
        await restored.flush();
        assert.deepStrictEqual(restored.getExecutionEntries('semantic-session'), []);
        restored.dispose();
    });

    test('injects the Viewer bridge once and under the proxy base path', () => {
        const first = injectViewerBridge('<html><body>plot</body></html>', '/proxy/123');
        const second = injectViewerBridge(first, '/proxy/123');
        assert.match(first, new RegExp(`/proxy/123${VIEWER_BRIDGE_PATH.replace('.', '\\.')}`));
        assert.strictEqual(second, first);
        assert.strictEqual((first.match(/data-supervisor-viewer-bridge/g) ?? []).length, 1);
    });

    test('decodes image exports and adds a stable base URI to HTML exports', () => {
        const decoded = decodeImageDataUri('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
        assert.strictEqual(decoded.mimeType, 'image/svg+xml');
        assert.strictEqual(Buffer.from(decoded.bytes).toString('utf8'), '<svg></svg>');
        assert.strictEqual(imageExtension(decoded.mimeType), 'svg');

        const html = addHtmlBaseUri(
            '<html><head><title>Plot</title></head><body></body></html>',
            'http://127.0.0.1:1234/widget/',
        );
        assert.match(html, /<head><base href="http:\/\/127\.0\.0\.1:1234\/widget\/">/);
        assert.strictEqual(addHtmlBaseUri(html, 'https://other.invalid/'), html);
    });
});
