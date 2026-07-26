import * as assert from 'assert';
import * as vscode from 'vscode';
import { LanguageRuntimeSessionMode } from '../../api';
import {
    RuntimeCodeFragmentStatus,
    RuntimeState,
} from '../../internal/runtimeTypes';
import {
    PositronConsoleInstance,
    SessionAttachMode,
} from '../../services/console';
import {
    RuntimeCodeExecutionMode,
    RuntimeErrorBehavior,
} from '../../services/console/interfaces/consoleService';

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'console-execution-unit-test',
        logLevel: vscode.LogLevel.Trace,
        onDidChangeLogLevel: event,
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

function createEventStub<T>(): vscode.Event<T> {
    return () => ({ dispose: () => undefined });
}

function createConsoleInstance(): PositronConsoleInstance {
    return new PositronConsoleInstance(
        {
            sessionId: 'session-1',
            sessionName: 'Session 1',
            sessionMode: LanguageRuntimeSessionMode.Console,
            createdTimestamp: Date.now(),
            startReason: 'unit-test',
        },
        {
            runtimeId: 'runtime-1',
            runtimeName: 'R',
            runtimePath: '/usr/bin/R',
            runtimeVersion: '4.4.0',
            runtimeShortName: 'R',
            runtimeSource: 'system',
            languageId: 'r',
            languageName: 'R',
            languageVersion: '4.4.0',
        },
        makeNoopLogChannel(),
    );
}

function createRuntimeSession(
    executeCalls: unknown[][],
    state: RuntimeState = RuntimeState.Ready,
): any {
    return {
        sessionId: 'session-1',
        state,
        workingDirectory: '/tmp/session-1',
        dynState: {
            sessionName: 'Session 1',
            inputPrompt: '>',
            continuationPrompt: '+',
            busy: state === RuntimeState.Busy,
            currentWorkingDirectory: '/tmp/session-1',
        },
        isCodeFragmentComplete: async (code: string) => {
            if (code.includes(')')) {
                return RuntimeCodeFragmentStatus.Invalid;
            }
            return RuntimeCodeFragmentStatus.Complete;
        },
        execute: (...args: unknown[]) => {
            executeCalls.push(args);
        },
        interrupt: () => undefined,
        onDidChangeRuntimeState: createEventStub(),
        onDidReceiveRuntimeMessageStream: createEventStub(),
        onDidReceiveRuntimeMessageInput: createEventStub(),
        onDidReceiveRuntimeMessageError: createEventStub(),
        onDidReceiveRuntimeMessageOutput: createEventStub(),
        onDidReceiveRuntimeMessageResult: createEventStub(),
        onDidReceiveRuntimeMessageState: createEventStub(),
        onDidReceiveRuntimeMessagePrompt: createEventStub(),
        onDidReceiveRuntimeMessageClearOutput: createEventStub(),
        onDidReceiveRuntimeMessageUpdateOutput: createEventStub(),
        onDidEndSession: createEventStub(),
        onDidEncounterStartupFailure: createEventStub(),
    };
}

suite('[Unit] console execution alignment', () => {
    test('direct console execution clears an invalid pending editor fragment', async () => {
        const executeCalls: unknown[][] = [];
        const pendingCodeChanges: Array<string | undefined> = [];
        const instance = createConsoleInstance();
        instance.onDidSetPendingCode(code => pendingCodeChanges.push(code));
        instance.attachRuntimeSession(
            createRuntimeSession(executeCalls),
            SessionAttachMode.Connected,
        );

        await instance.enqueueCode(
            ')',
            { source: 'editor' },
            false,
            RuntimeCodeExecutionMode.Interactive,
            RuntimeErrorBehavior.Continue,
            'editor-execution',
        );

        assert.deepStrictEqual(executeCalls, []);
        assert.deepStrictEqual(pendingCodeChanges, [')']);

        instance.executeCode(
            ')',
            { source: 'console' },
            RuntimeCodeExecutionMode.Interactive,
            RuntimeErrorBehavior.Continue,
            'console-execution',
        );

        assert.deepStrictEqual(pendingCodeChanges, [')', undefined]);
        assert.deepStrictEqual(executeCalls, [[
            ')',
            'console-execution',
            RuntimeCodeExecutionMode.Interactive,
            RuntimeErrorBehavior.Continue,
            { source: 'console' },
        ]]);
    });

    test('allowIncomplete enqueue retains Positron pending-fragment merge semantics', async () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        instance.attachRuntimeSession(
            createRuntimeSession(executeCalls),
            SessionAttachMode.Connected,
        );

        await instance.enqueueCode(')', { source: 'editor' });
        await instance.enqueueCode(
            '1 + 1',
            { source: 'editor' },
            true,
            RuntimeCodeExecutionMode.Interactive,
        );

        assert.strictEqual(executeCalls.length, 1);
        assert.strictEqual(executeCalls[0][0], ')\n1 + 1');
    });

    test('enqueue propagates completeness failures instead of creating pending code', async () => {
        const executeCalls: unknown[][] = [];
        const pendingCodeChanges: Array<string | undefined> = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls);
        runtimeSession.isCodeFragmentComplete = async () => {
            throw new Error('completeness unavailable');
        };
        instance.onDidSetPendingCode(code => pendingCodeChanges.push(code));
        instance.attachRuntimeSession(
            runtimeSession,
            SessionAttachMode.Connected,
        );

        await assert.rejects(
            instance.enqueueCode('1 + 1', { source: 'editor' }),
            /completeness unavailable/,
        );

        assert.deepStrictEqual(executeCalls, []);
        assert.deepStrictEqual(pendingCodeChanges, []);
    });
});
