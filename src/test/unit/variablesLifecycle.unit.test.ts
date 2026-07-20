import * as assert from 'assert';
import * as vscode from 'vscode';
import { LanguageRuntimeSessionMode } from '../../api';
import { RuntimeClientState } from '../../services/variables/interfaces/variablesService';
import { PositronVariablesInstance } from '../../services/variables/variablesInstance';
import { PositronVariablesService } from '../../services/variables/variablesService';

function eventStub<T>(): vscode.Event<T> {
    return () => ({ dispose: () => undefined });
}

function logStub(): vscode.LogOutputChannel {
    const noop = () => undefined;
    return {
        name: 'variables-lifecycle-test',
        logLevel: vscode.LogLevel.Trace,
        onDidChangeLogLevel: eventStub(),
        trace: noop,
        debug: noop,
        info: noop,
        warn: noop,
        error: noop,
        append: noop,
        appendLine: noop,
        replace: noop,
        clear: noop,
        show: noop,
        hide: noop,
        dispose: noop,
    };
}

suite('[Unit] variables lifecycle', () => {
    test('rebinds the model through a full detach and attach sequence', () => {
        const oldSession = { sessionId: 'session-1' } as any;
        const newSession = { sessionId: 'session-1' } as any;
        const instance = Object.create(PositronVariablesInstance.prototype) as PositronVariablesInstance;
        const calls: string[] = [];
        Object.assign(instance as any, {
            _session: oldSession,
            _outputChannel: logStub(),
            detachFromSession: () => calls.push('detach-client'),
            _disposeRuntimeDisposables: () => calls.push('detach-runtime'),
            attachToSession: () => calls.push('attach-runtime'),
        });

        instance.setRuntimeSession(newSession);

        assert.strictEqual(instance.session, newSession);
        assert.deepStrictEqual(calls, ['detach-client', 'detach-runtime', 'attach-runtime']);
    });

    test('ignores background sessions and rebinds closed foreground models', () => {
        const service = new PositronVariablesService({} as any, logStub());
        (service as any)._viewVisible = true;
        const background = {
            sessionId: 'background-1',
            sessionMetadata: { sessionMode: LanguageRuntimeSessionMode.Background },
        } as any;
        (service as any).createOrAssignPositronVariablesInstance(background, false);
        assert.strictEqual(service.getVariablesInstance(background.sessionId), undefined);

        const oldSession = {
            sessionId: 'console-1',
            sessionMetadata: { sessionMode: LanguageRuntimeSessionMode.Console },
        } as any;
        const restartedSession = { ...oldSession };
        const rebound: any[] = [];
        const instance = {
            session: oldSession,
            state: RuntimeClientState.Closed,
            setRuntimeSession: (session: any) => rebound.push(session),
            requestRefresh: () => undefined,
            dispose: () => undefined,
        };
        (service as any)._variablesInstancesBySessionId.set(oldSession.sessionId, instance);

        (service as any).createOrAssignPositronVariablesInstance(restartedSession, false);
        assert.deepStrictEqual(rebound, [restartedSession]);
        service.dispose();
    });
});
