import * as assert from 'assert';
import {
    LanguageRuntimeSessionLocation,
    LanguageRuntimeStartupBehavior,
    LanguageRuntimeSessionMode,
} from '../../api';
import { KallichoreTransport } from '../../supervisor/KallichoreApiInstance';
import { KallichoreSession } from '../../supervisor/KallichoreSession';
import { ActiveSession, DefaultApi, InterruptMode, SessionMode, Status, VarActionType } from '../../supervisor/kcclient/api';
import { JupyterKernelSpec } from '../../supervisor/positron-supervisor';

suite('[Unit] restored session environment', () => {
    function createRuntimeMetadata() {
        return {
            runtimePath: '/usr/bin/R',
            runtimeId: '00000000-0000-0000-0000-000000000000',
            runtimeName: 'R 4.5',
            runtimeShortName: '4.5',
            runtimeVersion: '0.1',
            runtimeSource: 'Test',
            languageName: 'R',
            languageId: 'r',
            languageVersion: '4.5.0',
            startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
            sessionLocation: LanguageRuntimeSessionLocation.Workspace,
            extraRuntimeData: {},
        };
    }

    function createSessionMetadata() {
        return {
            sessionId: 'r-test-0001',
            sessionName: 'R 4.5',
            sessionMode: LanguageRuntimeSessionMode.Console,
            createdTimestamp: Date.now(),
            startReason: 'test',
        };
    }

    function activeSession(initialEnv?: Record<string, string>): ActiveSession {
        return {
            session_id: 'r-test-0001',
            argv: ['ark', '--connection_file', '{connection_file}'],
            username: 'test',
            display_name: 'R 4.5',
            language: 'r',
            interrupt_mode: InterruptMode.Message,
            initial_env: initialEnv,
            connected: true,
            started: new Date().toISOString(),
            session_mode: SessionMode.Console,
            working_directory: '/home/test',
            input_prompt: '>',
            continuation_prompt: '+',
            execution_queue: { length: 0, pending: [] },
            status: Status.Idle,
            kernel_info: { language_info: { version: '4.5.0' } },
            idle_seconds: 0,
            busy_seconds: 0,
        };
    }

    function newSession(isNew: boolean): KallichoreSession {
        return new KallichoreSession(
            createSessionMetadata(),
            createRuntimeMetadata(),
            { sessionName: 'R 4.5', inputPrompt: '>', continuationPrompt: '+' },
            { newSession: async () => undefined } as unknown as DefaultApi,
            KallichoreTransport.TCP,
            async () => undefined,
            isNew,
        );
    }

    test('restart of a restored session replays the launch environment', async () => {
        const session = newSession(false);
        session.restore(activeSession({
            R_HOME: '/opt/R/4.5/lib/R',
            R_LIBS: '/opt/R/library',
        }));
        try {
            const actions = await session.buildEnvVarActions(true);
            const replayed = actions.filter(action => action.name === 'R_HOME' || action.name === 'R_LIBS');
            assert.deepStrictEqual(replayed, [
                { action: VarActionType.Replace, name: 'R_HOME', value: '/opt/R/4.5/lib/R' },
                { action: VarActionType.Replace, name: 'R_LIBS', value: '/opt/R/library' },
            ]);
        } finally {
            session.dispose();
        }
    });

    test('the original kernel spec takes precedence over the recorded launch environment', async () => {
        const session = newSession(true);
        const kernelSpec: JupyterKernelSpec = {
            argv: ['ark', '--connection_file', '{connection_file}'],
            display_name: 'R 4.5',
            language: 'r',
            kernel_protocol_version: '5.5',
            env: { R_HOME: '/spec/R' },
        };
        await session.create(kernelSpec);
        session.restore(activeSession({ R_HOME: '/reconnect/R' }));
        try {
            const actions = await session.buildEnvVarActions(true);
            const rHome = actions.filter(action => action.name === 'R_HOME');
            assert.deepStrictEqual(rHome, [
                { action: VarActionType.Replace, name: 'R_HOME', value: '/spec/R' },
            ]);
        } finally {
            session.dispose();
        }
    });
});
