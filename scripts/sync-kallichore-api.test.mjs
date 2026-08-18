import assert from 'node:assert/strict';
import test from 'node:test';
import { assertKallichoreVersionsCanSync } from './sync-kallichore-api.mjs';

test('allows the Positron API source to advance independently', () => {
    assert.doesNotThrow(() => {
        assertKallichoreVersionsCanSync({
            sourceVersion: '0.1.67',
            standaloneVersion: '0.1.67',
            positronVersion: '0.1.68',
        });
    });
});

test('requires the standalone binary version to match the Kallichore source', () => {
    assert.throws(
        () => assertKallichoreVersionsCanSync({
            sourceVersion: '0.1.68',
            standaloneVersion: '0.1.67',
            positronVersion: '0.1.68',
        }),
        /source=0\.1\.68, vscode-supervisor=0\.1\.67/,
    );
});
