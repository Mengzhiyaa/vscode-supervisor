import * as assert from 'assert';
import { PositronConsoleState } from '../../services/console';
import { SessionSnapshotBuilder } from '../../webview/sessionSnapshotBuilder';
import { RuntimeState } from '../../positronTypes';

function createSession(sessionId: string, state: RuntimeState, name: string) {
    return {
        sessionId,
        state,
        dynState: { sessionName: name },
        sessionMetadata: {
            sessionId,
            sessionName: `${name}-metadata`,
            sessionMode: 'console',
        },
        runtimeMetadata: {
            runtimeName: 'R',
            runtimePath: `/runtime/${sessionId}`,
            languageVersion: '4.4.0',
            runtimeSource: 'system',
            base64EncodedIconSvg: 'icon',
        },
    };
}

function createConsoleInstance(
    sessionId: string,
    state: PositronConsoleState,
    options?: { promptActive?: boolean; runtimeAttached?: boolean; sessionName?: string },
) {
    return {
        sessionId,
        state,
        sessionName: options?.sessionName ?? `console-${sessionId}`,
        promptActive: options?.promptActive ?? false,
        runtimeAttached: options?.runtimeAttached ?? false,
        runtimeMetadata: {
            runtimeName: 'R',
            runtimePath: `/console/${sessionId}`,
            languageVersion: '4.4.1',
            runtimeSource: 'configured',
            base64EncodedIconSvg: 'console-icon',
        },
    };
}

suite('[Unit] session snapshot builder', () => {
    test('buildBaseSessions uses session-manager runtime truth only', () => {
        const restarting = createSession('session-2', RuntimeState.Restarting, 'runtime-session');
        const idle = createSession('session-3', RuntimeState.Idle, 'idle-session');

        const builder = new SessionSnapshotBuilder(
            {
                sessions: [restarting, idle],
                getSession: (sessionId: string) => {
                    if (sessionId === 'session-2') {
                        return restarting;
                    }
                    if (sessionId === 'session-3') {
                        return idle;
                    }
                    return undefined;
                },
            } as any,
        );

        const sessions = builder.buildBaseSessions();
        assert.deepStrictEqual(
            sessions.map(session => ({
                id: session.id,
                state: session.state,
                promptActive: session.promptActive,
                runtimeAttached: session.runtimeAttached,
            })),
            [
                {
                    id: 'session-2',
                    state: 'restarting',
                    promptActive: false,
                    runtimeAttached: false,
                },
                {
                    id: 'session-3',
                    state: 'ready',
                    promptActive: false,
                    runtimeAttached: false,
                },
            ],
        );

        assert.strictEqual(
            builder.resolveActiveSessionId(sessions, ['missing', undefined]),
            'session-2',
        );
    });

    test('buildSessionsWithConsoleOverlay applies console projection without replacing base identity', () => {
        const session = createSession('session-1', RuntimeState.Starting, 'renamed-session');
        const instance = createConsoleInstance('session-1', PositronConsoleState.Ready, {
            promptActive: true,
            runtimeAttached: true,
            sessionName: 'stale-console-name',
        });

        const builder = new SessionSnapshotBuilder(
            {
                sessions: [session],
                getSession: (sessionId: string) => sessionId === 'session-1' ? session : undefined,
            } as any,
            {
                positronConsoleInstances: [instance],
                getConsoleInstance: (sessionId: string) => sessionId === 'session-1' ? instance : undefined,
            } as any,
        );

        const sessions = builder.buildSessionsWithConsoleOverlay();
        assert.deepStrictEqual(sessions, [{
            id: 'session-1',
            name: 'renamed-session',
            runtimeName: 'R',
            state: 'ready',
            runtimePath: '/console/session-1',
            runtimeVersion: '4.4.1',
            runtimeSource: 'configured',
            base64EncodedIconSvg: 'console-icon',
            promptActive: true,
            runtimeAttached: true,
        }]);

        assert.strictEqual(
            builder.resolveActiveSessionId(sessions, ['missing', 'session-1']),
            'session-1',
        );
    });
});
