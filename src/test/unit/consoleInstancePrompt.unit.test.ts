import * as assert from 'assert';
import * as vscode from 'vscode';
import { LanguageRuntimeSessionMode } from '../../api';
import { RuntimeState } from '../../internal/runtimeTypes';
import { PositronConsoleInstance, SessionAttachMode } from '../../services/console';
import type { SerializedConsoleState } from '../../services/console/consoleInstance';

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'console-instance-prompt-unit-test',
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

function createRuntimeSession(overrides?: {
    inputPrompt?: string;
    continuationPrompt?: string;
}): any {
    return {
        sessionId: 'session-1',
        state: RuntimeState.Ready,
        workingDirectory: '/tmp/session-1',
        dynState: {
            sessionName: 'Session 1',
            inputPrompt: overrides?.inputPrompt ?? '',
            continuationPrompt: overrides?.continuationPrompt ?? '',
            busy: false,
            currentWorkingDirectory: '/tmp/session-1',
        },
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

suite('[Unit] console instance prompt normalization', () => {
    test('falls back to default prompts when restored state contains empty prompt strings', () => {
        const instance = createConsoleInstance();
        const state: SerializedConsoleState = {
            version: 2,
            items: [],
            inputHistory: [],
            trace: false,
            wordWrap: true,
            inputPrompt: '',
            continuationPrompt: '',
            workingDirectory: '/tmp/restored',
        };

        instance.restoreState(state);

        assert.strictEqual(instance.inputPrompt, '>');
        assert.strictEqual(instance.continuationPrompt, '+');
    });

    test('ignores empty prompt state updates from the runtime', () => {
        const instance = createConsoleInstance();

        instance.handlePromptStateChange({
            input_prompt: 'R>',
            continuation_prompt: '  +',
        });

        assert.strictEqual(instance.inputPrompt, 'R>');
        assert.strictEqual(instance.continuationPrompt, '  +');

        instance.handlePromptStateChange({
            input_prompt: '',
            continuation_prompt: '',
        });

        assert.strictEqual(instance.inputPrompt, 'R>');
        assert.strictEqual(instance.continuationPrompt, '  +');
    });

    test('ignores empty prompts when attaching a runtime session', () => {
        const instance = createConsoleInstance();

        instance.handlePromptStateChange({
            input_prompt: 'R>',
            continuation_prompt: '+',
        });

        instance.attachRuntimeSession(
            createRuntimeSession({
                inputPrompt: '',
                continuationPrompt: '',
            }),
            SessionAttachMode.Starting,
        );

        assert.strictEqual(instance.inputPrompt, 'R>');
        assert.strictEqual(instance.continuationPrompt, '+');
    });
});
