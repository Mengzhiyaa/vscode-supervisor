import * as assert from 'assert';
import { reconcileConsoleInputEdit, type ConsoleInputDraft } from '../../shared/consoleInputState';

suite('[Unit] Console draft reconciliation', () => {
    const draft: ConsoleInputDraft = { clientId: 'model-1', version: 1, code: 'x <-' };

    test('clears only the consumed prefix and preserves later type-ahead', () => {
        assert.strictEqual(
            reconcileConsoleInputEdit(
                { ...draft, version: 2, code: 'x <-\ny <- 2' },
                {
                    expectedDraft: draft,
                },
            ),
            '\ny <- 2',
        );
    });

    test('does not replace a user-edited draft or a recreated model', () => {
        assert.strictEqual(
            reconcileConsoleInputEdit(
                { ...draft, version: 2, code: 'y <-' },
                {
                    code: 'x <-\n1',
                    expectedDraft: draft,
                },
            ),
            'y <-',
        );
        assert.strictEqual(
            reconcileConsoleInputEdit(
                { ...draft, clientId: 'model-2' },
                {
                    expectedDraft: draft,
                },
            ),
            'x <-',
        );
    });

    test('restores incomplete code ahead of new input without dropping that input', () => {
        assert.strictEqual(
            reconcileConsoleInputEdit(
                { ...draft, version: 2, code: 'new input' },
                {
                    code: 'incomplete code',
                    expectedDraft: { ...draft, code: '' },
                },
            ),
            'incomplete code\nnew input',
        );
    });

    test('legacy edits preserve a populated input model', () => {
        assert.strictEqual(reconcileConsoleInputEdit(draft, {}), 'x <-');
        assert.strictEqual(
            reconcileConsoleInputEdit({ ...draft, code: '' }, { code: 'restore' }),
            'restore',
        );
    });
});
