import * as assert from 'assert';
import * as vscode from 'vscode';
import { LanguageRuntimeSessionMode } from '../../api';
import {
    PositronVariablesSorting,
    RuntimeClientState,
} from '../../services/variables/interfaces/variablesService';
import {
    compareVariableItemsByName,
    compareVariableItemsByRecent,
    compareVariableItemsBySize,
    PositronVariablesInstance,
} from '../../services/variables/variablesInstance';
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
    test('uses stable Positron name, size, and recent sort semantics', () => {
        const items = [
            { displayName: 'x10', size: 5, updatedTime: 100 },
            { displayName: 'x2', size: 10, updatedTime: 200 },
            { displayName: 'x2', size: 1, updatedTime: 100 },
        ];

        assert.deepStrictEqual(
            [...items].sort(compareVariableItemsByName).map(item => `${item.displayName}:${item.size}`),
            ['x2:1', 'x2:10', 'x10:5'],
        );
        assert.deepStrictEqual(
            [...items].sort(compareVariableItemsBySize).map(item => `${item.displayName}:${item.size}`),
            ['x2:10', 'x10:5', 'x2:1'],
        );
        assert.deepStrictEqual(
            [...items].sort(compareVariableItemsByRecent).map(item => `${item.updatedTime}:${item.displayName}`),
            ['200:x2', '100:x2', '100:x10'],
        );
    });

    test('uses Positron decimal size-group boundaries and ordering', () => {
        const instance = Object.create(
            PositronVariablesInstance.prototype,
        ) as PositronVariablesInstance;
        Object.assign(instance as any, {
            _collapsedGroupIds: new Set<string>(),
            _sorting: PositronVariablesSorting.Name,
        });
        const items = [
            { id: 'small', displayName: 'small', size: 999 },
            { id: 'medium', displayName: 'medium', size: 1_000 },
            { id: 'large', displayName: 'large', size: 10_000 },
            { id: 'very-large', displayName: 'very-large', size: 1_000_000 },
        ];

        const groups = (instance as any).groupBySize(items);

        assert.deepStrictEqual(groups.map((group: any) => group.title), [
            'Small',
            'Medium',
            'Large',
            'Very Large',
        ]);
        assert.deepStrictEqual(
            groups.map((group: any) => group.variableItems[0].id),
            ['small', 'medium', 'large', 'very-large'],
        );
    });

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
