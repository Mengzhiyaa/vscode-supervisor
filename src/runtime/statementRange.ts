import * as vscode from 'vscode';
import {
    type ILanguageStatementRangeProvider,
    LanguageLspState,
} from '../api';
import type { RuntimeSession } from './session';

type StatementRangeSession = Pick<
    RuntimeSession,
    'lsp' | 'activateLsp' | 'waitLsp'
>;

/**
 * Resolves the session-owned statement range provider after its LSP has had a
 * chance to activate. Positron obtains this from the language feature registry;
 * Supervisor must explicitly bridge the equivalent session lifecycle.
 */
export async function resolveStatementRangeProvider(
    session: StatementRangeSession,
    outputChannel: vscode.LogOutputChannel,
): Promise<ILanguageStatementRangeProvider | undefined> {
    let lsp = session.lsp;
    if (lsp.statementRangeProvider) {
        return lsp.statementRangeProvider;
    }

    try {
        if (
            lsp.state === LanguageLspState.Uninitialized ||
            lsp.state === LanguageLspState.Stopped
        ) {
            await session.activateLsp();
        }

        if (session.lsp.state === LanguageLspState.Starting) {
            lsp = (await session.waitLsp()) ?? session.lsp;
        } else {
            lsp = session.lsp;
        }
    } catch (error) {
        outputChannel.warn(
            `[LspBridge] Failed waiting for statement range provider: ${error}`,
        );
        return undefined;
    }

    return lsp.statementRangeProvider;
}
