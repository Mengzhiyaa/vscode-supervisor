import * as assert from 'assert';
import { SupervisorApplication } from '../../application';

function makeApplication(failures = new Set<string>()) {
    const calls: string[] = [];
    const warnings: string[] = [];
    const step = (name: string) => {
        calls.push(name);
        if (failures.has(name)) {
            throw new Error(name);
        }
    };
    const output = { debug: () => undefined, warn: (message: string) => warnings.push(message),
        dispose: () => step('log') };
    const sessionManager = { detachForExtensionHostShutdown: async () => step('detach'),
        dispose: () => step('session-dispose') };
    const application = Object.assign(Object.create(SupervisorApplication.prototype), {
        _outputChannel: output,
        _consoleService: { flushPersistedState: async () => step('console') },
        _runtimeStartupService: { prepareForExtensionHostShutdown: async () => step('sessions') },
        _sessionManager: sessionManager,
        _surfaceLifecycle: { whenPersisted: async () => step('surfaces') },
        _languageCapabilityRegistry: { dispose: () => step('registry') },
        _disposables: [output, sessionManager, { dispose: () => step('first-resource') },
            { dispose: () => step('last-resource') }],
    }) as SupervisorApplication;
    return { application, calls, warnings };
}

suite('[Unit] application shutdown', () => {
    const expected = ['console', 'sessions', 'detach', 'surfaces', 'registry',
        'first-resource', 'last-resource', 'log'];

    test('coalesces shutdown and releases logging last', async () => {
        const { application, calls } = makeApplication();
        const first = application.shutdown();
        const second = application.shutdown();
        assert.strictEqual(first, second);
        await Promise.all([first, second]);
        await application.shutdown();
        assert.deepStrictEqual(calls, expected);
    });

    for (const stage of ['console', 'sessions', 'detach', 'surfaces', 'registry', 'first-resource']) {
        test(`continues cleanup after ${stage} fails`, async () => {
            const { application, calls, warnings } = makeApplication(new Set([stage]));
            await assert.rejects(application.shutdown(), (error: unknown) => {
                assert.ok(error instanceof AggregateError);
                assert.strictEqual(error.errors.length, 1);
                assert.strictEqual(error.errors[0].message, stage);
                return true;
            });
            assert.deepStrictEqual(calls, expected);
            assert.strictEqual(warnings.length, 1);
        });
    }

    test('reports all failures after attempting every cleanup step', async () => {
        const { application, calls } = makeApplication(new Set(['console', 'registry', 'first-resource']));
        await assert.rejects(application.shutdown(), (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.deepStrictEqual(error.errors.map(failure => failure.message),
                ['console', 'registry', 'first-resource']);
            return true;
        });
        assert.deepStrictEqual(calls, expected);
    });
});
