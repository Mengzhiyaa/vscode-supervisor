import * as assert from 'assert';
import * as vscode from 'vscode';
import { KallichoreSession } from '../../supervisor/KallichoreSession';
import { LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior } from '../../api';
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
            startupBehavior: LanguageRuntimeStartupBehavior.Explicit,
        },
        makeNoopLogChannel(),
    );
}

function createRuntimeSession(
    executeCalls: unknown[][],
    state: RuntimeState = RuntimeState.Ready,
): any {
    // Use the supervisor's real Unprocessed protocol; only the final kernel
    // dispatch is stubbed. A void execute stub cannot report incomplete code,
    // completeness failures, or cancellation to the Console.
    const kernel = Object.create(KallichoreSession.prototype) as any;
    const pendingExecutions = new Map<string, unknown[]>();
    Object.assign(kernel, {
        metadata: { sessionId: 'session-1' },
        _pendingUnprocessedExecutions: new Map(),
        _runtimeState: state,
        _api: { interruptSession: async () => undefined },
        onStateChange: () => undefined,
        execute: (_code: string, id: string) => {
            const args = pendingExecutions.get(id);
            assert.ok(args, `Missing execution ${id}`);
            executeCalls.push(args);
        },
        isCodeFragmentComplete: (code: string) => runtimeSession.isCodeFragmentComplete(code),
    });
    const runtimeSession = {
        sessionId: 'session-1',
        state,
        lsp: {},
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
            const [code, id, mode, errorBehavior] = args as [string, string, RuntimeCodeExecutionMode, RuntimeErrorBehavior];
            if (mode === RuntimeCodeExecutionMode.Unprocessed) {
                pendingExecutions.set(id, args);
                return Promise.resolve(KallichoreSession.prototype.execute.call(kernel, code, id, mode, errorBehavior))
                    .finally(() => pendingExecutions.delete(id));
            }
            executeCalls.push(args);
        },
        interrupt: () => kernel.interrupt(),
        onDidChangeRuntimeState: createEventStub(),
        onDidReceiveRuntimeMessage: createEventStub(),
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
    return runtimeSession;
}

suite('[Unit] console execution alignment', () => {
    test('editor execution merges the current draft snapshot instead of a stale pending fragment', async () => {
        const calls: unknown[][] = [];
        const instance = createConsoleInstance();
        instance.attachRuntimeSession(createRuntimeSession(calls), SessionAttachMode.Connected);
        const edits: any[] = [];
        instance.onDidRequestInputEdit(edit => edits.push(edit));
        try {
            await instance.enqueueCode(')', { source: 'editor' });
            instance.updateInputDraft({ clientId: 'model-1', version: 1, code: ')' });
            instance.setInputDraftReader(async () => ({ clientId: 'model-1', version: 2, code: 'x <-' }));
            await instance.enqueueCode('1', { source: 'editor', metadata: { completenessVerified: true } });
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0][0], 'x <-\n1');
            assert.deepStrictEqual(edits.at(-1), {
                code: undefined, expectedDraft: { clientId: 'model-1', version: 2, code: 'x <-' },
            });
        } finally {
            instance.dispose();
        }
    });

    test('cancelling boundary detection publishes completion without starting a fallback kernel check', async () => {
        const calls: unknown[][] = [];
        const instance = createConsoleInstance();
        const session = createRuntimeSession(calls);
        let checks = 0;
        session.isCodeFragmentComplete = async () => { checks += 1; return RuntimeCodeFragmentStatus.Complete; };
        instance.attachRuntimeSession(session, SessionAttachMode.Connected);
        const states: boolean[] = [];
        instance.onDidChangeCodeSubmissionInProgress(value => states.push(value));
        let started!: () => void;
        const waiting = new Promise<void>(resolve => { started = resolve; });
        (instance as any)._getInputBoundaryFragments = () => { started(); return new Promise(() => undefined); };
        try {
            const submission = instance.enqueueCode('1', { source: 'editor' });
            await waiting;
            instance.cancelCodeSubmission();
            await submission;
            assert.strictEqual(checks, 0);
            assert.strictEqual(calls.length, 0);
            assert.deepStrictEqual(states, [true, false]);
            assert.strictEqual(instance.submissionStateVersion, 2);
        } finally {
            instance.dispose();
        }
    });

    test('a silent completeness check does not acquire or cancel interactive submission state', async () => {
        const calls: unknown[][] = [];
        const instance = createConsoleInstance();
        const session = createRuntimeSession(calls);
        let finish!: (status: RuntimeCodeFragmentStatus) => void;
        let started!: () => void;
        const waiting = new Promise<void>(resolve => { started = resolve; });
        session.isCodeFragmentComplete = () => {
            started();
            return new Promise<RuntimeCodeFragmentStatus>(resolve => { finish = resolve; });
        };
        instance.attachRuntimeSession(session, SessionAttachMode.Connected);
        const states: boolean[] = [];
        instance.onDidChangeCodeSubmissionInProgress(value => states.push(value));
        try {
            const background = instance.enqueueCode('1', { source: 'extension' }, false, RuntimeCodeExecutionMode.Silent);
            await waiting;
            assert.strictEqual(instance.codeSubmissionInProgress, false);
            instance.cancelCodeSubmission();
            finish(RuntimeCodeFragmentStatus.Complete);
            await background;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0][2], RuntimeCodeExecutionMode.Silent);
            assert.deepStrictEqual(states, []);
        } finally {
            instance.dispose();
        }
    });

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

        // Clear the Host mirror without erasing browser type-ahead.
        assert.deepStrictEqual(pendingCodeChanges, [')']);
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
        let markCompletenessRequested!: () => void;
        const completenessRequested = new Promise<void>(resolve => { markCompletenessRequested = resolve; });
        runtimeSession.isCodeFragmentComplete = () =>
            new Promise<RuntimeCodeFragmentStatus>((resolve) => {
                resolveCompleteness = resolve;
                markCompletenessRequested();
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

        await completenessRequested;
        resolveCompleteness(RuntimeCodeFragmentStatus.Complete);
        assert.strictEqual(await submission, 'executed');
        assert.strictEqual(executeCalls.length, 1);
        assert.strictEqual(executeCalls[0][0], '1 + 1');
        assert.strictEqual(executeCalls[0][2], RuntimeCodeExecutionMode.Unprocessed);
        assert.strictEqual(instance.codeSubmissionInProgress, true);
        instance.markExecutionCompleted(String(executeCalls[0][1]));
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
        instance.markExecutionCompleted(String(executeCalls[0][1]));

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

    test('stopping a local completeness check preserves queued code without interrupting the kernel', async () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls);
        let checking!: () => void;
        const checkStarted = new Promise<void>(resolve => { checking = resolve; });
        runtimeSession.lsp.inputBoundaryProvider = {
            provideInputBoundaries: () => { checking(); return new Promise(() => undefined); },
        };
        let interrupts = 0;
        runtimeSession.interrupt = async () => { interrupts++; };
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);
        try {
            const submission = instance.submitCode('slow()', { source: 'console' });
            await checkStarted;
            await instance.enqueueCode('queued()', { source: 'editor' }, true,
                RuntimeCodeExecutionMode.Interactive, RuntimeErrorBehavior.Continue, 'queued');
            runtimeSession.state = RuntimeState.Busy;
            instance.interrupt();
            assert.strictEqual(await submission, 'cancelled');
            assert.strictEqual(interrupts, 0);
            assert.ok(instance.runtimeItems.some(item => item instanceof RuntimeItemPendingInput && item.code === 'queued()'));
            runtimeSession.state = RuntimeState.Idle;
            await (instance as any).processPendingInput();
            assert.strictEqual(executeCalls[0]?.[0], 'queued()');
        } finally { instance.dispose(); }
    });

    test('interrupting a busy Console reports the execution IDs removed from its queue', async () => {
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession([], RuntimeState.Busy);
        const cancelled: string[] = [];
        runtimeSession.cancelExecutions = (ids: string[]) => cancelled.push(...ids);
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);
        try {
            await instance.enqueueCode('%run -- scratch.py', { source: 'editor' }, true,
                RuntimeCodeExecutionMode.Interactive, RuntimeErrorBehavior.Continue, 'scratch');
            instance.interrupt();
            assert.deepStrictEqual(cancelled, ['scratch']);
            assert.ok(!instance.runtimeItems.some(item => item instanceof RuntimeItemPendingInput));
        } finally { instance.dispose(); }
    });

    test('host-owned submission cancellation wins a slow completeness race', async () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls);
        let markCompletenessRequested!: () => void;
        const completenessRequested = new Promise<void>(resolve => { markCompletenessRequested = resolve; });
        runtimeSession.isCodeFragmentComplete = () => {
            markCompletenessRequested();
            return new Promise(() => undefined);
        };
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);

        const submission = instance.submitCode('slow()', { source: 'console' });
        await completenessRequested;
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

    test('host-owned submission waits for supervisor validation beyond the host completeness timeout', async () => {
        const executeCalls: unknown[][] = [];
        const instance = createConsoleInstance();
        const runtimeSession = createRuntimeSession(executeCalls);
        let resolveCompleteness!: (status: RuntimeCodeFragmentStatus) => void;
        let markCompletenessRequested!: () => void;
        const completenessRequested = new Promise<void>(resolve => { markCompletenessRequested = resolve; });
        runtimeSession.isCodeFragmentComplete = () => new Promise<RuntimeCodeFragmentStatus>(resolve => {
            resolveCompleteness = resolve;
            markCompletenessRequested();
        });
        instance.attachRuntimeSession(runtimeSession, SessionAttachMode.Connected);
        (instance as any)._codeCompletenessTimeoutMs = 10;

        const submission = instance.submitCode('1 + 1', { source: 'console' });
        let completed = false;
        void submission.then(() => { completed = true; });
        await completenessRequested;
        await new Promise<void>(resolve => setTimeout(resolve, 20));
        assert.strictEqual(completed, false);
        assert.deepStrictEqual(executeCalls, []);
        assert.strictEqual(instance.codeSubmissionInProgress, true);

        resolveCompleteness(RuntimeCodeFragmentStatus.Complete);
        assert.strictEqual(await submission, 'executed');
        assert.strictEqual(executeCalls.length, 1);
        assert.strictEqual(executeCalls[0][0], '1 + 1');
        assert.strictEqual(executeCalls[0][2], RuntimeCodeExecutionMode.Unprocessed);
        instance.markExecutionCompleted(String(executeCalls[0][1]));
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
