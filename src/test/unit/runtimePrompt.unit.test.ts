import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageRuntimeSessionMode,
    type IRuntimeSessionMetadata,
    type LanguageRuntimeMetadata,
} from '../../api';
import type { LanguageRuntimeInfo } from '../../internal/runtimeTypes';
import { RuntimeSession } from '../../runtime/session';
import { RuntimeSessionService } from '../../runtime/runtimeSession';

function createMemento(): vscode.Memento {
    const store = new Map<string, unknown>();
    return {
        get: <T>(key: string, defaultValue?: T) => {
            return (store.has(key) ? store.get(key) : defaultValue) as T;
        },
        update: async (key: string, value: unknown) => {
            if (value === undefined) {
                store.delete(key);
            } else {
                store.set(key, value);
            }
        },
        keys: () => Array.from(store.keys()),
    };
}

function makeContext(): vscode.ExtensionContext {
    const extensionPath = path.resolve(__dirname, '../../..');
    return {
        extensionPath,
        extensionUri: vscode.Uri.file(extensionPath),
        subscriptions: [],
        globalState: createMemento(),
        workspaceState: createMemento(),
        asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
    } as unknown as vscode.ExtensionContext;
}

function makeNoopLogChannel(): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'runtime-prompt-unit-test',
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

function makeRuntimeMetadata(): LanguageRuntimeMetadata {
    return {
        runtimeId: 'runtime-1',
        runtimeName: 'R 4.4.1',
        runtimePath: '/usr/bin/R',
        runtimeVersion: '0.0.1',
        runtimeShortName: '4.4.1',
        runtimeSource: 'system',
        languageId: 'r',
        languageName: 'R',
        languageVersion: '4.4.1',
    };
}

function makeSessionMetadata(): IRuntimeSessionMetadata {
    return {
        sessionId: 'session-1',
        sessionName: 'Session 1',
        sessionMode: LanguageRuntimeSessionMode.Console,
        createdTimestamp: Date.now(),
        startReason: 'unit-test',
    };
}

function makeRuntimeInfo(overrides?: Partial<LanguageRuntimeInfo>): LanguageRuntimeInfo {
    return {
        banner: 'R version 4.4.1',
        implementation_version: '4.4.1',
        language_version: '4.4.1',
        ...overrides,
    };
}

function createRuntimeSession(): RuntimeSession {
    return new RuntimeSession(
        'session-1',
        makeRuntimeMetadata(),
        makeSessionMetadata(),
        makeNoopLogChannel(),
        'Session 1',
    );
}

suite('[Unit] runtime prompt normalization', () => {
    test('prompt-state updates preserve existing prompts when the runtime sends empty strings', () => {
        const service = new RuntimeSessionService(makeContext(), makeNoopLogChannel());
        const session = {
            dynState: {
                inputPrompt: 'R>',
                continuationPrompt: '+',
            },
        } as any;

        const state = (service as any)._applyPromptState(session, {
            input_prompt: '',
            continuation_prompt: '',
        });

        assert.deepStrictEqual(state, {
            input_prompt: 'R>',
            continuation_prompt: '+',
        });
        assert.strictEqual(session.dynState.inputPrompt, 'R>');
        assert.strictEqual(session.dynState.continuationPrompt, '+');

        service.dispose();
    });

    test('prompt-state updates trim trailing whitespace before updating dynState', () => {
        const service = new RuntimeSessionService(makeContext(), makeNoopLogChannel());
        const session = {
            dynState: {
                inputPrompt: '>',
                continuationPrompt: '+',
            },
        } as any;

        const state = (service as any)._applyPromptState(session, {
            input_prompt: 'R>   ',
            continuation_prompt: '...   ',
        });

        assert.deepStrictEqual(state, {
            input_prompt: 'R>',
            continuation_prompt: '...',
        });
        assert.strictEqual(session.dynState.inputPrompt, 'R>');
        assert.strictEqual(session.dynState.continuationPrompt, '...');

        service.dispose();
    });

    test('startup preserves default prompts when runtime info contains empty strings', async () => {
        const session = createRuntimeSession();
        (session as any)._kernel = {
            start: async () => makeRuntimeInfo({
                input_prompt: '',
                continuation_prompt: '',
            }),
        };

        await session.start();

        assert.strictEqual(session.dynState.inputPrompt, '>');
        assert.strictEqual(session.dynState.continuationPrompt, '+');
        await session.dispose();
    });

    test('restart preserves existing prompts when runtime info contains empty strings', async () => {
        const session = createRuntimeSession();
        session.dynState.inputPrompt = 'R>';
        session.dynState.continuationPrompt = '...';

        (session as any)._kernel = {
            restart: async () => undefined,
            runtimeInfo: makeRuntimeInfo({
                input_prompt: '',
                continuation_prompt: '',
            }),
        };
        (session as any)._waitForLspStartupDuringRestart = async () => false;
        (session as any)._deactivateServices = async () => undefined;

        await session.restart();

        assert.strictEqual(session.dynState.inputPrompt, 'R>');
        assert.strictEqual(session.dynState.continuationPrompt, '...');
        await session.dispose();
    });
});
