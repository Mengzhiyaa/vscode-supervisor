import * as assert from 'assert';
import * as vscode from 'vscode';
import type {
    ILanguageCapabilityKey,
    ILanguageOptionalCapabilityDescriptor,
} from '../../api';
import { LanguageCapabilityRegistry } from '../../languageRegistry/languageCapabilityRegistry';

function createRegistry(
    installSnapshot?: ConstructorParameters<typeof LanguageCapabilityRegistry>[0]['installSnapshot'],
): LanguageCapabilityRegistry {
    return new LanguageCapabilityRegistry({
        services: {} as any,
        validateOwner: () => true,
        installSnapshot,
    });
}

const sessionManager = {} as any;

function coreBuilder(registry: LanguageCapabilityRegistry, revision: number, provider = { languageId: 'r' } as any) {
    return registry.forExtension('publisher.r-extension').begin({
        languageId: 'r',
        registrationId: 'core',
        revision,
    }).setRuntimeProvider(provider).setSessionManager(sessionManager);
}

function capabilityKey(capabilityId: string): ILanguageCapabilityKey {
    return {
        ownerExtensionId: 'publisher.r-extension',
        languageId: 'r',
        registrationId: 'core',
        capabilityId,
    };
}

suite('[Unit] language capability registry', () => {
    test('deduplicates identical commits and releases on the final lease', () => {
        let installs = 0;
        let disposals = 0;
        const registry = createRegistry(() => {
            installs += 1;
            return new vscode.Disposable(() => { disposals += 1; });
        });
        const provider = { languageId: 'r' } as any;

        const first = coreBuilder(registry, 1, provider).commit();
        const second = coreBuilder(registry, 1, provider).commit();

        assert.strictEqual(first.generation, second.generation);
        assert.strictEqual(installs, 1);
        first.dispose();
        assert.ok(registry.getSnapshot('r'));
        assert.strictEqual(disposals, 0);
        second.dispose();
        assert.strictEqual(registry.getSnapshot('r'), undefined);
        assert.strictEqual(disposals, 1);
        registry.dispose();
    });

    test('rejects changed objects at the same revision', () => {
        const registry = createRegistry();
        const first = coreBuilder(registry, 1).commit();
        assert.throws(
            () => coreBuilder(registry, 1, { languageId: 'r' } as any).commit(),
            /increase revision/i,
        );
        first.dispose();
        registry.dispose();
    });

    test('supersedes older generations without letting an old handle delete the replacement', () => {
        const registry = createRegistry();
        const first = coreBuilder(registry, 1).commit();
        const second = coreBuilder(registry, 2).commit();

        assert.notStrictEqual(first.generation, second.generation);
        assert.strictEqual(registry.getSnapshot('r')?.generation, second.generation);
        first.dispose();
        assert.strictEqual(registry.getSnapshot('r')?.generation, second.generation);
        second.dispose();
        registry.dispose();
    });

    test('isolates optional activation failure and supports explicit retry', async () => {
        const registry = createRegistry();
        let attempts = 0;
        const descriptor: ILanguageOptionalCapabilityDescriptor = {
            id: 'commands.help',
            revision: 1,
            kind: 'commands',
            activate: () => {
                attempts += 1;
                if (attempts === 1) {
                    throw new Error('injected failure');
                }
                return new vscode.Disposable(() => undefined);
            },
        };
        const handle = coreBuilder(registry, 1).addOptionalCapability(descriptor).commit();

        const failed = await handle.whenCapabilityReady('commands.help');
        assert.strictEqual(failed.phase, 'failed');
        assert.strictEqual(
            registry.getCapabilityState(capabilityKey('core.runtimeProvider'))?.phase,
            'ready',
        );

        handle.retry('commands.help');
        const ready = await handle.whenCapabilityReady('commands.help');
        assert.strictEqual(ready.phase, 'ready');
        assert.strictEqual(attempts, 2);
        handle.dispose();
        registry.dispose();
    });

    test('keeps operation state independent from capability readiness', () => {
        const registry = createRegistry();
        const handle = coreBuilder(registry, 1).commit();
        const key = {
            ownerExtensionId: 'publisher.r-extension',
            languageId: 'r',
            operation: 'discovery' as const,
            entityId: 'initial',
            generation: handle.generation,
        };
        registry.setOperationState({
            key,
            phase: 'degraded',
            attempt: 1,
            changedAt: 0,
            error: { kind: 'transient-io', message: 'injected' },
        });

        assert.strictEqual(registry.getOperationState(key)?.phase, 'degraded');
        assert.strictEqual(
            registry.getCapabilityState(capabilityKey('core.runtimeProvider'))?.phase,
            'ready',
        );
        handle.dispose();
        registry.dispose();
    });
});
