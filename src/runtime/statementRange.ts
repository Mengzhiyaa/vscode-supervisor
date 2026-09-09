import * as vscode from 'vscode';
import {
    type ILanguageStatementRangeProvider,
    LanguageLspState,
} from '../api';
import type { RuntimeSession } from './session';

type StatementRangeSession = Pick<
    RuntimeSession,
    'lsp' | 'waitLsp'
>;

/**
 * Resolves the provider owned by the session's active language client.
 * Language contributions control activation and console ownership.
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
