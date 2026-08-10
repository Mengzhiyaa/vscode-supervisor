import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    LanguageRuntimeSessionLocation,
    LanguageRuntimeStartupBehavior,
} from '../api';
import type {
    ILanguageRuntimeProvider,
    ISupervisorFrameworkApi,
    LanguageRuntimeMetadata,
} from '../api';
import { pollForSuccess } from './kit';

const SUPERVISOR_EXTENSION_ID = 'mengzhiya.vscode-supervisor';

suite('[Integration] Supervisor extension API', () => {
    let api: ISupervisorFrameworkApi;

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension<ISupervisorFrameworkApi>(SUPERVISOR_EXTENSION_ID);
        assert.ok(extension, `Expected ${SUPERVISOR_EXTENSION_ID} to be registered`);
        api = await extension.activate();
    });

    test('activates with the current framework API', () => {
        assert.strictEqual(typeof api.version, 'string');
        assert.ok(api.version.length > 0, 'Expected the Supervisor API to expose a version');
        assert.strictEqual(api.apiVersion, 2);
        assert.strictEqual(api.protocolVersion.major, 2);
        assert.ok(api.capabilities.includes('languageCapabilityRegistry'));
        assert.strictEqual(typeof api.languages.forExtension, 'function');
        assert.ok(api.services.runtimeSessionService);
        assert.strictEqual(typeof api.startRuntime, 'function');
        assert.strictEqual('registerLanguageSupport' in api, false);
        assert.strictEqual('registerLanguageRuntime' in api, false);
        assert.strictEqual('registerLspFactory' in api, false);
        assert.strictEqual('registerNotebookController' in api, false);
        assert.strictEqual('runtimeSessionService' in api, false);
        assert.strictEqual('runtimeStartupService' in api, false);
    });

    test('discovers a runtime registered through the public language API', async () => {
        const languageId = `supervisor-integration-${Date.now().toString(16)}`;
        const installation = { path: `/supervisor-test/${languageId}` };
        let discoveryCalls = 0;

        const provider: ILanguageRuntimeProvider<typeof installation> = {
            languageId,
            languageName: 'Supervisor Integration Test',
            async *discoverInstallations() {
                discoveryCalls += 1;
                yield installation;
            },
            async resolveInitialInstallation() {
                return installation;
            },
            async promptForInstallation() {
                return installation;
            },
            formatRuntimeName: () => 'Supervisor Integration Runtime',
            getRuntimePath: (value) => value.path,
            getRuntimeSource: () => 'integration-test',
            createRuntimeMetadata: (): LanguageRuntimeMetadata => ({
                runtimeId: `${languageId}-runtime`,
                runtimeName: 'Supervisor Integration Runtime',
                runtimeShortName: 'Integration Runtime',
                runtimePath: installation.path,
                runtimeVersion: '1.0.0',
                runtimeSource: 'integration-test',
                languageId,
                languageName: 'Supervisor Integration Test',
                languageVersion: '1.0.0',
                startupBehavior: LanguageRuntimeStartupBehavior.Explicit,
                sessionLocation: LanguageRuntimeSessionLocation.Workspace,
            }),
            async createKernelSpec() {
                return {
                    argv: ['unused-in-integration-test'],
                    display_name: 'Supervisor Integration Runtime',
                    language: languageId,
                    kernel_protocol_version: '5.5',
                };
            },
        };

        const sessionManager = {} as any;
        const beginRegistration = () => api.languages
            .forExtension(SUPERVISOR_EXTENSION_ID)
            .begin({ languageId, registrationId: 'integration-test', revision: 1 })
            .setRuntimeProvider(provider)
            .setSessionManager(sessionManager);
        const first = beginRegistration().commit();

        await pollForSuccess(() => {
            assert.ok(discoveryCalls > 0, 'Expected registration to trigger runtime discovery');
        });

        const callsAfterRegistration = discoveryCalls;
        const second = beginRegistration().commit();
        assert.strictEqual(second.generation, first.generation);
        assert.strictEqual(discoveryCalls, callsAfterRegistration, 'Expected duplicate registration to be idempotent');
        first.dispose();
        second.dispose();
    });
});
