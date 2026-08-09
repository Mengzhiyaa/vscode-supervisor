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
        assert.strictEqual(typeof api.registerLanguageSupport, 'function');
        assert.strictEqual(typeof api.startRuntime, 'function');
        assert.ok(api.runtimeSessionService, 'Expected the runtime session service');
        assert.ok(api.runtimeStartupService, 'Expected the runtime startup service');
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

        const countBeforeRegistration = api.runtimeStartupService.discoveredRuntimeCount;
        await api.registerLanguageRuntime(provider);

        await pollForSuccess(() => {
            assert.ok(discoveryCalls > 0, 'Expected registration to trigger runtime discovery');
            assert.strictEqual(
                api.runtimeStartupService.discoveredRuntimeCount,
                countBeforeRegistration + 1,
                'Expected the fake runtime installation to be discovered',
            );
        });

        const callsAfterRegistration = discoveryCalls;
        await api.registerLanguageRuntime(provider);
        assert.strictEqual(discoveryCalls, callsAfterRegistration, 'Expected duplicate registration to be idempotent');
    });
});
