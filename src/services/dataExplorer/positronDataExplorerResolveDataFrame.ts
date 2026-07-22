import * as vscode from 'vscode';
import { LanguageRuntimeSessionMode } from '../../api';
import type { RuntimeSessionService } from '../../runtime/runtimeSession';
import type {
    IPositronVariablesInstance,
    IPositronVariablesService,
    VariablesTreeItem,
} from '../variables/interfaces/variablesService';

export interface ResolvedDataFrame {
    readonly instance: IPositronVariablesInstance;
    readonly variable: VariablesTreeItem;
    readonly range: vscode.Range;
    readonly sessionId: string;
    readonly languageId: string;
}

export interface ViewDataFrameByVariableArgs {
    readonly sessionId: string;
    readonly variableId: string;
}

const QUARTO_FENCE_START = /^\s*```\s*\{?\s*(python|r)(?:[\s,}]|$)/i;
const QUARTO_FENCE_END = /^\s*```\s*$/;

/** Returns the embedded R/Python language at a Quarto position. */
export function getDataExplorerLanguageIdAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): string | undefined {
    if (document.languageId.toLowerCase() !== 'quarto') {
        return document.languageId.toLowerCase();
    }
    let embeddedLanguageId: string | undefined;
    for (let lineIndex = 0; lineIndex <= position.line; lineIndex++) {
        const line = document.lineAt(lineIndex).text;
        if (!embeddedLanguageId) {
            embeddedLanguageId = QUARTO_FENCE_START.exec(line)?.[1]?.toLowerCase();
        } else if (QUARTO_FENCE_END.test(line)) {
            embeddedLanguageId = undefined;
        }
    }
    return embeddedLanguageId;
}

export function isDocumentLanguageCompatible(documentLanguageId: string, runtimeLanguageId: string): boolean {
    if (documentLanguageId === 'quarto') {
        return runtimeLanguageId === 'python' || runtimeLanguageId === 'r';
    }
    return documentLanguageId.toLowerCase() === runtimeLanguageId.toLowerCase();
}

function resolveVariablesInstance(
    languageId: string,
    variablesService: IPositronVariablesService,
    runtimeSessionService?: RuntimeSessionService,
    requestedSessionId?: string,
): IPositronVariablesInstance | undefined {
    const sessionId = requestedSessionId ??
        runtimeSessionService?.getConsoleSessionForLanguage(languageId)?.sessionId ??
        runtimeSessionService?.activeSessions.find(session =>
            session.runtimeMetadata.languageId.toLowerCase() === languageId &&
            session.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console,
        )?.sessionId;
    if (sessionId) {
        return variablesService.getVariablesInstance?.(sessionId) ??
            variablesService.positronVariablesInstances.find(
                instance => instance.session.sessionId === sessionId,
            );
    }
    const activeInstance = variablesService.activePositronVariablesInstance;
    if (activeInstance?.session.runtimeMetadata.languageId.toLowerCase() === languageId) {
        return activeInstance;
    }
    const compatibleInstances = variablesService.positronVariablesInstances?.filter(
        instance => instance.session.runtimeMetadata.languageId.toLowerCase() === languageId,
    ) ?? [];
    return compatibleInstances.length === 1 ? compatibleInstances[0] : undefined;
}

/** Resolve against the cached Variables model without starting a runtime or opening a surface. */
export function resolveDataFrameAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    variablesService: IPositronVariablesService,
    runtimeSessionService?: RuntimeSessionService,
    requestedSessionId?: string,
): ResolvedDataFrame | undefined {
    const range = document.getWordRangeAtPosition(position);
    if (!range) {
        return undefined;
    }
    const languageId = getDataExplorerLanguageIdAtPosition(document, position);
    if (languageId !== 'python' && languageId !== 'r') {
        return undefined;
    }
    const name = document.getText(range);
    const instance = resolveVariablesInstance(
        languageId,
        variablesService,
        runtimeSessionService,
        requestedSessionId,
    );
    if (!instance) {
        return undefined;
    }
    const variable = instance.variableItems.find(item =>
        item.hasViewer && (item.displayName === name || item.path.at(-1) === name));
    return variable ? {
        instance,
        variable,
        range,
        sessionId: instance.session.sessionId,
        languageId,
    } : undefined;
}

/**
 * Enumerates identifier ranges in executable R/Python code only. This is the
 * public VS Code DocumentLink adaptation of Positron's position-based private
 * click-to-view provider.
 */
export function findDataExplorerIdentifierRanges(document: vscode.TextDocument): vscode.Range[] {
    const ranges: vscode.Range[] = [];
    let quartoLanguageId: string | undefined;
    let multilineQuote: "'''" | '"""' | undefined;
    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
        const line = document.lineAt(lineIndex).text;
        let languageId = document.languageId.toLowerCase();
        if (languageId === 'quarto') {
            if (!quartoLanguageId) {
                quartoLanguageId = QUARTO_FENCE_START.exec(line)?.[1]?.toLowerCase();
                continue;
            }
            if (QUARTO_FENCE_END.test(line)) {
                quartoLanguageId = undefined;
                continue;
            }
            languageId = quartoLanguageId;
        }
        if (languageId !== 'python' && languageId !== 'r') {
            continue;
        }
        let quote: "'" | '"' | undefined;
        let escaped = false;
        let code = '';
        for (let character = 0; character < line.length; character++) {
            const value = line[character];
            if (multilineQuote) {
                if (line.startsWith(multilineQuote, character)) {
                    code += '   ';
                    character += 2;
                    multilineQuote = undefined;
                } else {
                    code += ' ';
                }
                continue;
            }
            if (quote) {
                code += ' ';
                if (escaped) {
                    escaped = false;
                } else if (value === '\\') {
                    escaped = true;
                } else if (value === quote) {
                    quote = undefined;
                }
                continue;
            }
            if (value === '#') {
                code += ' '.repeat(line.length - character);
                break;
            }
            if (languageId === 'python' &&
                (line.startsWith("'''", character) || line.startsWith('"""', character))) {
                multilineQuote = line.slice(character, character + 3) as "'''" | '"""';
                code += '   ';
                character += 2;
                continue;
            }
            if (value === "'" || value === '"') {
                quote = value;
                code += ' ';
                continue;
            }
            code += value;
        }
        for (const match of code.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
            const start = new vscode.Position(lineIndex, match.index ?? 0);
            ranges.push(new vscode.Range(start, start.translate(0, match[0].length)));
        }
    }
    return ranges;
}
