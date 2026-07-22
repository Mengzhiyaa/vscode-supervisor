import assert from 'node:assert/strict';
import test from 'node:test';
import {
    canExecuteTargetPlatform,
    normalizePlatform,
} from './install-binaries.mjs';

test('normalizes workflow and Node platform aliases', () => {
    assert.equal(normalizePlatform('macos-aarch64'), 'darwin-arm64');
    assert.equal(normalizePlatform('win32-amd64'), 'windows-x64');
    assert.equal(normalizePlatform('linux-x86_64'), 'linux-x64');
});

test('runs the version probe only for executable host targets', () => {
    assert.equal(canExecuteTargetPlatform('linux-x64', 'linux-x64'), true);
    assert.equal(canExecuteTargetPlatform('linux-arm64', 'linux-x64'), false);
    assert.equal(canExecuteTargetPlatform('windows-x64', 'linux-x64'), false);
    assert.equal(canExecuteTargetPlatform('darwin-universal', 'darwin-arm64'), true);
    assert.equal(canExecuteTargetPlatform('darwin-universal', 'darwin-x64'), true);
});
