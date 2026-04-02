import * as assert from 'assert';
import { shouldKeepDataExplorerInline } from '../../services/dataExplorer/dataExplorerRouting';

suite('[Unit] data explorer routing', () => {
    test('keeps inline explorers inline for notebook sessions', () => {
        assert.strictEqual(shouldKeepDataExplorerInline('notebook', true), true);
    });

    test('promotes inline explorers to full editors for console sessions', () => {
        assert.strictEqual(shouldKeepDataExplorerInline('console', true), false);
    });

    test('leaves non-inline explorers as full editors', () => {
        assert.strictEqual(shouldKeepDataExplorerInline('console', false), false);
    });
});
