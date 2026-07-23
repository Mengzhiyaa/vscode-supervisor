import * as assert from 'assert';
import type { BinaryDefinition } from '../../api';
import {
    getExpectedBinaryVersion,
    isBinaryVersionCompatible,
} from '../../binaryManager';

function makeDefinition(
    overrides: Partial<BinaryDefinition> = {},
): BinaryDefinition {
    return {
        repo: 'example/example',
        binaryName: 'example',
        archivePattern: (version, platform) =>
            `example-${version}-${platform}.zip`,
        installDir: 'resources/example',
        ...overrides,
    };
}

suite('[Unit] BinaryManager version contracts', () => {
    test('uses the release tag when the binary reports the same version', () => {
        const definition = makeDefinition();

        assert.strictEqual(
            getExpectedBinaryVersion(definition, '0.1.67'),
            '0.1.67',
        );
        assert.strictEqual(
            isBinaryVersionCompatible(definition, '0.1.67', '0.1.67'),
            true,
        );
    });

    test('compares against an explicit reported version instead of the release tag', () => {
        const definition = makeDefinition({
            reportedVersion: '0.1.252+14.6618e9a',
        });

        assert.strictEqual(
            getExpectedBinaryVersion(
                definition,
                'ark-0.1.252-14-6618e9a',
            ),
            '0.1.252+14.6618e9a',
        );
        assert.strictEqual(
            isBinaryVersionCompatible(
                definition,
                '0.1.252+14.6618e9a',
                'ark-0.1.252-14-6618e9a',
            ),
            true,
        );
        assert.strictEqual(
            isBinaryVersionCompatible(
                definition,
                'ark-0.1.252-14-6618e9a',
                'ark-0.1.252-14-6618e9a',
            ),
            false,
        );
    });
});
