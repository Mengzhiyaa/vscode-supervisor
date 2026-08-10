import * as assert from 'assert';
import type { ILanguageSupportRegistration } from '../../api';
import { SupervisorApplication } from '../../application';

function makeApplicationHarness(): any {
    const errors: string[] = [];
    const application = Object.create(SupervisorApplication.prototype) as any;
    application._activatedLanguageContributionIds = new Set<string>();
    application._languageContributionActivationPromises = new Map<string, Promise<void>>();
    application._languageSupport = new Map<string, ILanguageSupportRegistration<any>>();
    application._pendingLspFactories = new Map();
    application._disposables = [];
    application._getLanguageContributionServices = () => ({});
    application._outputChannel = {
        error: (message: string) => errors.push(message),
    };
    return { application, errors };
}

function registration(
    languageId: string,
    registerContributions: () => Promise<void> | void,
): ILanguageSupportRegistration<any> {
    return {
        runtimeProvider: { languageId } as any,
        languageContribution: { registerContributions },
    };
}

suite('[Unit] language support registration', () => {
    test('deduplicates concurrent activation and retries after a failed attempt', async () => {
        const { application } = makeApplicationHarness();
        let attempts = 0;
        let releaseActivation!: () => void;
        const activationGate = new Promise<void>(resolve => { releaseActivation = resolve; });
        const languageRegistration = registration('r', async () => {
            attempts += 1;
            if (attempts === 1) {
                throw new Error('first activation failed');
            }
            await activationGate;
        });

        await assert.rejects(
            application._activateLanguageContribution(languageRegistration),
            /first activation failed/,
        );

        const firstRetry = application._activateLanguageContribution(languageRegistration);
        const concurrentRetry = application._activateLanguageContribution(languageRegistration);
        await Promise.resolve();
        assert.strictEqual(attempts, 2);

        releaseActivation();
        await Promise.all([firstRetry, concurrentRetry]);
        assert.strictEqual(application._activatedLanguageContributionIds.has('r'), true);
    });

    test('isolates one contribution failure from other registered languages', async () => {
        const { application, errors } = makeApplicationHarness();
        let pythonActivations = 0;
        application._languageSupport.set(
            'r',
            registration('r', async () => { throw new Error('R contribution failed'); }),
        );
        application._languageSupport.set(
            'python',
            registration('python', () => { pythonActivations += 1; }),
        );

        await application._activateRegisteredLanguageContributions();

        assert.strictEqual(pythonActivations, 1);
        assert.strictEqual(application._activatedLanguageContributionIds.has('python'), true);
        assert.strictEqual(application._activatedLanguageContributionIds.has('r'), false);
        assert.ok(errors.some((message: string) => message.includes('R contribution failed')));
    });

    test('retries an identical registration whose contribution did not activate', async () => {
        const { application } = makeApplicationHarness();
        const languageRegistration = registration('r', () => undefined);
        application._activated = true;
        application._languageSupport.set('r', languageRegistration);
        let initializeCalls = 0;
        application._initializeLanguageSupportAfterActivation = async () => { initializeCalls += 1; };
        application._startDeferredActivationTasks = () => undefined;

        await application.registerLanguageSupport(languageRegistration);

        assert.strictEqual(initializeCalls, 1);
    });
});
