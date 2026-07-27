import * as assert from 'assert';
import {
    ExtensionHostMemoryInfoProvider,
    MemoryInfoProviderKind,
    parsePsProcessSnapshot,
    sumProcessTreeMemory,
} from '../../services/memory/memoryInfoProvider';

suite('[Unit] memory info provider', () => {
    test('identifies local and remote extension-host measurements', () => {
        const local = new ExtensionHostMemoryInfoProvider(undefined);
        const remote = new ExtensionHostMemoryInfoProvider('ssh-remote');

        assert.deepStrictEqual(local.source, {
            providerKind: MemoryInfoProviderKind.Local,
            machineId: 'local-extension-host',
        });
        assert.deepStrictEqual(remote.source, {
            providerKind: MemoryInfoProviderKind.Remote,
            machineId: 'remote:ssh-remote',
            remoteName: 'ssh-remote',
        });
    });

    test('collects process-tree memory with a process API fallback', async () => {
        const info = await new ExtensionHostMemoryInfoProvider(undefined).getProcessMemoryInfo();
        assert.ok(info.totalSystemMemory > 0);
        assert.ok(info.freeSystemMemory >= 0);
        assert.ok(info.extensionHostOverheadBytes > 0);
        assert.ok(info.collectionMethod === 'process-tree' || info.collectionMethod === 'process-api');
    });

    test('parses RSS and excludes complete kernel subtrees from supervisor totals', () => {
        const snapshot = parsePsProcessSnapshot([
            '  10  1  100 supervisor',
            '  11 10   25 kernel',
            '  12 11   10 kernel-child',
            '  13 10    5 helper',
        ].join('\n'));

        assert.deepStrictEqual(snapshot.map(process => process.residentBytes), [
            100 * 1024,
            25 * 1024,
            10 * 1024,
            5 * 1024,
        ]);
        assert.strictEqual(
            sumProcessTreeMemory(snapshot, 10, [11]),
            105 * 1024,
        );
    });
});
