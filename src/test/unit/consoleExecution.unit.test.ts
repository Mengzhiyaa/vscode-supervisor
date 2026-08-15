import * as assert from 'assert';
import * as vscode from 'vscode';
import { LanguageRuntimeSessionMode } from '../../api';
import {
    RuntimeCodeFragmentStatus,
    LanguageRuntimeMessageType,
    RuntimeOnlineState,
    RuntimeState,
} from '../../internal/runtimeTypes';
import {
    PositronConsoleInstance,
    PositronConsoleState,
    SessionAttachMode,
} from '../../services/console';
import {
    RuntimeCodeExecutionMode,
    RuntimeErrorBehavior,
} from '../../services/console/interfaces/consoleService';
import {
    RuntimeItemActivity,
    RuntimeItemPendingInput,
} from '../../services/console/classes/runtimeItem';

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
            { requestId: 'request-direct' },
        );

        assert.deepStrictEqual(pendingCodeChanges, [')', undefined]);
        assert.deepStrictEqual(executeCalls, [[
            ')',
            'console-execution',
            RuntimeCodeExecutionMode.Interactive,
            RuntimeErrorBehavior.Continue,
            { source: 'console' },
            { requestId: 'request-direct' },
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

    test('completeness-verified editor code bypasses the runtime completeness check', async () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls);
        let completenessChecks = 0;
        runtimeSession.isCodeFragmentComplete = async () => {
            completenessChecks += 1;
            return RuntimeCodeFragmentStatus.Incomplete;
        };
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);

        await instance.enqueueCode(
            'for i in range(3):\n    print(i)',
            {
                source: 'editor',
                metadata: { completenessVerified: true },
            },
        );

        assert.strictEqual(completenessChecks, 0);
        assert.strictEqual(executeCalls.length, 1);
        assert.strictEqual(executeCalls[0][0], 'for i in range(3):\n    print(i)');
        instance.dispose();
    });

    test('completeness-verified pending code bypasses the check when the runtime becomes ready', async () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls, RuntimeState.Busy);
        let completenessChecks = 0;
        runtimeSession.isCodeFragmentComplete = async () => {
            completenessChecks += 1;
            return RuntimeCodeFragmentStatus.Incomplete;
        };
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);

        await instance.enqueueCode(
            'for i in range(3):\n    print(i)',
            {
                source: 'editor',
                metadata: { completenessVerified: true },
            },
        );

        runtimeSession.state = RuntimeState.Ready;
        await (instance as any).processPendingInput();

        assert.strictEqual(completenessChecks, 0);
        assert.strictEqual(executeCalls.length, 1);
        instance.dispose();
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

    test('preserves execution metadata while code is pending', async () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls, RuntimeState.Busy);
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);
        const executionMetadata = { cellId: 'cell-1', documentVersion: 7 };

        await instance.enqueueCode(
            '1 + 1',
            { source: 'editor' },
            false,
            RuntimeCodeExecutionMode.Interactive,
            RuntimeErrorBehavior.Continue,
            'queued-execution',
            executionMetadata,
        );
        assert.deepStrictEqual(executeCalls, []);

        runtimeSession.state = RuntimeState.Ready;
        await (instance as any).processPendingInput();

        assert.strictEqual(executeCalls[0][5], executionMetadata);
        instance.dispose();
    });

    test('host-owned submission shows a transcript placeholder and executes exactly once', async () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls);
        let resolveCompleteness!: (status: RuntimeCodeFragmentStatus) => void;
        runtimeSession.isCodeFragmentComplete = () =>
            new Promise<RuntimeCodeFragmentStatus>((resolve) => {
                resolveCompleteness = resolve;
            });
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);

        const submission = instance.submitCode('1 + 1', { source: 'console' });
        const placeholder = instance.runtimeItems.find(
            (item): item is RuntimeItemPendingInput => item instanceof RuntimeItemPendingInput,
        );
        assert.ok(placeholder);
        const placeholderIndex = instance.runtimeItems.indexOf(placeholder);
        assert.strictEqual(placeholder.submitting, true);
        assert.strictEqual(instance.codeSubmissionInProgress, true);

        resolveCompleteness(RuntimeCodeFragmentStatus.Complete);
        assert.strictEqual(await submission, 'executed');
        assert.strictEqual(executeCalls.length, 1);
        assert.strictEqual(executeCalls[0][0], '1 + 1');
        assert.strictEqual(instance.codeSubmissionInProgress, false);
        assert.ok(!instance.runtimeItems.includes(placeholder));
        assert.ok(instance.runtimeItems[placeholderIndex] instanceof RuntimeItemActivity);
        instance.dispose();
    });

    test('console submission clears stale invalid pending code before later editor executions', async () => {
        const executeCalls: unknown[][] = [];
        const pendingCodeChanges: Array<string | undefined> = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls);
        runtimeSession.isCodeFragmentComplete = async (code: string) =>
            code.includes('tmp.obs.prediction.score.18')
                ? RuntimeCodeFragmentStatus.Invalid
                : RuntimeCodeFragmentStatus.Complete;
        instance.onDidSetPendingCode(code => pendingCodeChanges.push(code));
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);

        const fragments = [
            'tmp.obs.prediction.score.18',
            "sc.pl.umap(tmp, color='prediction.score.18', )",
            "sc.pl.umap(tmp, color='prediction.score.18', )",
            "new = pd.DataFrame({'A': [1, 2, 3], 'B': [4, 5, 6]})",
        ];

        // Editor-driven executions are merged into the invalid pending fragment
        // until the user submits the accumulated console contents.
        for (const fragment of fragments) {
            await instance.enqueueCode(
                fragment,
                { source: 'editor' },
                false,
                RuntimeCodeExecutionMode.Interactive,
                RuntimeErrorBehavior.Continue,
            );
        }
        const accumulatedCode = fragments.join('\n');
        assert.deepStrictEqual(pendingCodeChanges, [
            fragments[0],
            fragments.slice(0, 2).join('\n'),
            fragments.slice(0, 3).join('\n'),
            accumulatedCode,
        ]);
        assert.deepStrictEqual(executeCalls, []);

        assert.strictEqual(
            await instance.submitCode(accumulatedCode, { source: 'console' }),
            'executed',
        );
        assert.strictEqual(executeCalls.length, 1);
        assert.strictEqual(executeCalls[0][0], accumulatedCode);

        // Clearing the host mirror must be silent: the webview already cleared
        // its model, and a notification here could erase type-ahead. The next
        // editor execution must run alone instead of inheriting accumulatedCode.
        assert.strictEqual(pendingCodeChanges.at(-1), accumulatedCode);
        await instance.enqueueCode(
            'a = [1, 2, 3]',
            { source: 'editor' },
            false,
            RuntimeCodeExecutionMode.Interactive,
            RuntimeErrorBehavior.Continue,
        );
        assert.strictEqual(executeCalls.length, 2);
        assert.strictEqual(executeCalls[1][0], 'a = [1, 2, 3]');
        assert.ok(!String(executeCalls[1][0]).includes(accumulatedCode));
        assert.strictEqual(pendingCodeChanges.length, fragments.length);
        instance.dispose();
    });

    test('host-owned submission leaves incomplete code unexecuted', async () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls);
        runtimeSession.isCodeFragmentComplete = async () => RuntimeCodeFragmentStatus.Incomplete;
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);

        assert.strictEqual(
            await instance.submitCode('function(', { source: 'console' }),
            'incomplete',
        );
        assert.deepStrictEqual(executeCalls, []);
        assert.strictEqual(instance.codeSubmissionInProgress, false);
        instance.dispose();
    });

    test('host-owned submission cancellation wins a slow completeness race', async () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls);
        runtimeSession.isCodeFragmentComplete = () => new Promise(() => undefined);
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);

        const submission = instance.submitCode('slow()', { source: 'console' });
        instance.cancelCodeSubmission();
        assert.strictEqual(await submission, 'cancelled');
        assert.deepStrictEqual(executeCalls, []);
        assert.strictEqual(instance.codeSubmissionInProgress, false);
        assert.ok(!instance.runtimeItems.some(
            item => item instanceof RuntimeItemPendingInput && item.submitting,
        ));
        instance.dispose();
    });

    test('host-owned submission reports completeness failures and restores idle state', async () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls);
        runtimeSession.isCodeFragmentComplete = async () => {
            throw new Error('completeness unavailable');
        };
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);

        assert.strictEqual(
            await instance.submitCode('1 + 1', { source: 'console' }),
            'failed',
        );
        assert.deepStrictEqual(executeCalls, []);
        assert.strictEqual(instance.codeSubmissionInProgress, false);
        instance.dispose();
    });

    test('host-owned submission executes when completeness check times out', async () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls);
        runtimeSession.isCodeFragmentComplete = () => new Promise(() => undefined);
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);
        (instance as any)._codeCompletenessTimeoutMs = 10;

        assert.strictEqual(
            await instance.submitCode('1 + 1', { source: 'console' }),
            'executed',
        );
        assert.strictEqual(executeCalls.length, 1);
        assert.strictEqual(executeCalls[0][0], '1 + 1');
        assert.strictEqual(instance.codeSubmissionInProgress, false);
        instance.dispose();
    });

    test('background runtime busy state does not disable console input', () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls);
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);

        assert.strictEqual(instance.state, PositronConsoleState.Ready);

        // Kernel-wide Busy can be caused by Variables, Plots, LSP, or another
        // comm client and carries no parent ID that ties it to Console input.
        (instance as any).handleRuntimeStateChange(RuntimeState.Busy);

        assert.strictEqual(instance.state, PositronConsoleState.Ready);
        instance.dispose();
    });

    test('correlated console execution still drives busy and ready state', () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls);
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);

        instance.handleState({
            id: 'state-busy',
            event_clock: 1,
            parent_id: 'fragment-console-1',
            when: new Date().toISOString(),
            type: LanguageRuntimeMessageType.State,
            state: RuntimeOnlineState.Busy,
        });
        assert.strictEqual(instance.state, PositronConsoleState.Busy);

        instance.handleState({
            id: 'state-idle',
            event_clock: 2,
            parent_id: 'fragment-console-1',
            when: new Date().toISOString(),
            type: LanguageRuntimeMessageType.State,
            state: RuntimeOnlineState.Idle,
        });
        assert.strictEqual(instance.state, PositronConsoleState.Ready);
        instance.dispose();
    });

    test('reconnecting busy runtime returns console input to ready on idle', () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls, RuntimeState.Busy);
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Reconnecting);

        assert.strictEqual(instance.state, PositronConsoleState.Busy);

        (instance as any).handleRuntimeStateChange(RuntimeState.Idle);
        assert.strictEqual(instance.state, PositronConsoleState.Ready);
        instance.dispose();
    });

    test('unrelated global idle does not complete a correlated console execution', () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls);
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);

        instance.handleState({
            id: 'state-busy',
            event_clock: 1,
            parent_id: 'fragment-console-1',
            when: new Date().toISOString(),
            type: LanguageRuntimeMessageType.State,
            state: RuntimeOnlineState.Busy,
        });
        (instance as any).handleRuntimeStateChange(RuntimeState.Idle);

        assert.strictEqual(instance.state, PositronConsoleState.Busy);
        instance.dispose();
    });
});
