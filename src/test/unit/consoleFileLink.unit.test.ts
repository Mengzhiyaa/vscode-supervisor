import * as assert from 'assert';
import { resolveConsoleFileUri } from '../../webview/consoleFileLink';

suite('[Unit] console file links', () => {
    test('resolves relative paths against the runtime working directory', () => {
        const uri = resolveConsoleFileUri('RPE/SI/plot_drug.R', '/workspace/project');
        assert.strictEqual(uri.fsPath, '/workspace/project/RPE/SI/plot_drug.R');
    });

    test('preserves absolute paths', () => {
        const uri = resolveConsoleFileUri('/tmp/plot_drug.R', '/workspace/project');
        assert.strictEqual(uri.fsPath, '/tmp/plot_drug.R');
    });

    test('rejects relative paths when the runtime working directory is unavailable', () => {
        assert.throws(
            () => resolveConsoleFileUri('plot_drug.R', undefined),
            /working directory is unavailable/,
        );
    });
});
