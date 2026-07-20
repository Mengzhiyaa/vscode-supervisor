import * as assert from 'assert';
import {
    ExtensionHostMemoryInfoProvider,
    MemoryInfoProviderKind,
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

    test('does not manufacture an unavailable platform memory value', async () => {
        const info = await new ExtensionHostMemoryInfoProvider(undefined).getProcessMemoryInfo();
        assert.ok(info.totalSystemMemory > 0);
        assert.ok(info.freeSystemMemory >= 0);
        assert.ok(info.extensionHostOverheadBytes > 0);
        assert.strictEqual(info.supervisorOverheadBytes, undefined);
    });
});
