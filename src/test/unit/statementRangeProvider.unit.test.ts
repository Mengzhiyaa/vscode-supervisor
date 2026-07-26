import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    type ILanguageStatementRangeProvider,
    LanguageLspState,
} from '../../api';
import { resolveStatementRangeProvider } from '../../runtime/statementRange';

function makeNoopLogChannel(warnings: string[]): vscode.LogOutputChannel {
    const noop = () => undefined;
    const event: vscode.Event<vscode.LogLevel> = () => ({ dispose: noop });

    return {
        name: 'statement-range-provider-unit-test',
        logLevel: vscode.LogLevel.Trace,
        onDidChangeLogLevel: event,
        trace: noop,
        debug: noop,
        info: noop,
        warn: (message: string) => warnings.push(message),
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

suite('[Unit] statement range provider lifecycle', () => {
    test('waits for a starting session LSP before resolving the provider', async () => {
        const provider = {
            provideStatementRange: () => undefined,
        } satisfies ILanguageStatementRangeProvider;
        const startingLsp: any = {
            state: LanguageLspState.Starting,
            statementRangeProvider: undefined,
        };
        const runningLsp: any = {
            state: LanguageLspState.Running,
            statementRangeProvider: provider,
        };
        let currentLsp = startingLsp;
        let waitCalls = 0;

        const resolved = await resolveStatementRangeProvider({
            get lsp() {
                return currentLsp;
            },
            activateLsp: async () => undefined,
            waitLsp: async () => {
                waitCalls += 1;
                currentLsp = runningLsp;
                return runningLsp;
            },
        } as any, makeNoopLogChannel([]));

        assert.strictEqual(waitCalls, 1);
        assert.strictEqual(resolved, provider);
    });

    test('activates an uninitialized session LSP before resolving the provider', async () => {
        const provider = {
            provideStatementRange: () => undefined,
        } satisfies ILanguageStatementRangeProvider;
        const lsp: any = {
            state: LanguageLspState.Uninitialized,
            statementRangeProvider: undefined,
        };
        let activateCalls = 0;

        const resolved = await resolveStatementRangeProvider({
            lsp,
            activateLsp: async () => {
                activateCalls += 1;
                lsp.state = LanguageLspState.Running;
                lsp.statementRangeProvider = provider;
            },
            waitLsp: async () => lsp,
        } as any, makeNoopLogChannel([]));

        assert.strictEqual(activateCalls, 1);
        assert.strictEqual(resolved, provider);
    });
});
