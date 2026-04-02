import * as assert from 'assert';
import {
    inferPositronOutputKind,
    RuntimeOutputKind,
} from '../../runtime/runtimeOutputKind';

suite('[Unit] runtime output kind data explorer diagnostics', () => {
    test('classifies Positron viewer mime as a viewer widget', () => {
        const kind = inferPositronOutputKind({
            data: {
                'application/vnd.positron.viewer+json': '{"url":"https://example.com"}',
            },
        });

        assert.strictEqual(kind, RuntimeOutputKind.ViewerWidget);
    });

    test('classifies Positron inline data explorer mime as a viewer widget', () => {
        const kind = inferPositronOutputKind({
            data: {
                'application/vnd.positron.dataExplorer+json': JSON.stringify({
                    version: 1,
                    comm_id: 'de-inline-1',
                    title: 'db preview',
                    source: 'View(db)',
                    shape: { rows: 3, columns: 2 },
                    variable_path: ['db'],
                }),
            },
        });

        assert.strictEqual(kind, RuntimeOutputKind.ViewerWidget);
    });
});
