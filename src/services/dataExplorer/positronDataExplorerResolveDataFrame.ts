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

export interface ViewDataFrameAtCursorArgs {
    readonly documentUri: string;
    readonly documentVersion: number;
    readonly position: { readonly line: number; readonly character: number };
}

const QUARTO_FENCE_START = /^\s*(`{3,}|~{3,})(.*)$/;
const QUARTO_FENCE_END = /^\s*(`{3,}|~{3,})\s*$/;
const VARIABLES_LIST_READY_TIMEOUT_MS = 2_000;

function* getDataExplorerCodeLines(document: vscode.TextDocument) {
    let fence: { marker: string; length: number; languageId?: string } | undefined;
    const documentLanguageId = document.languageId.toLowerCase();
    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
        const line = document.lineAt(lineIndex).text;
        let languageId: string | undefined = documentLanguageId;
        if (documentLanguageId === 'quarto') {
            languageId = undefined;
            if (!fence) {
                const start = QUARTO_FENCE_START.exec(line);
                if (start) {
                    fence = {
                        marker: start[1][0],
                        length: start[1].length,
                        languageId: /^\s*\{?\s*(python|r)(?:[\s,}]|$)/i
                            .exec(start[2])?.[1]
                            ?.toLowerCase(),
                    };
                }
            } else {
                const end = QUARTO_FENCE_END.exec(line);
                if (end && end[1][0] === fence.marker && end[1].length >= fence.length) {
                    fence = undefined;
                } else {
                    languageId = fence.languageId;
                }
            }
        }
        yield { lineIndex, line, languageId };
    }
}

function getDataExplorerWordPattern(languageId: string): RegExp {
    return languageId === 'r'
        ? /(?:[_\p{ID_Start}]|\.(?!\p{N}))[_\p{ID_Continue}.]*/gu
        : /[_\p{ID_Start}][_\p{ID_Continue}]*/gu;
}

export interface IDataFrameResolutionOptions {
    readonly wait: boolean;
}

/** Interactive commands wait for the first variable list; background providers do not. */
async function waitForVariables(instance: IPositronVariablesInstance): Promise<void> {
    if (instance.variableItems.length > 0) {
        return;
    }
    await new Promise<void>((resolve) => {
        let listener: vscode.Disposable | undefined;
        const finish = () => {
            clearTimeout(timeout);
            listener?.dispose();
            resolve();
        };
        const timeout = setTimeout(finish, VARIABLES_LIST_READY_TIMEOUT_MS);
        listener = instance.onDidChangeEntries(finish);
        if (instance.variableItems.length > 0) {
            finish();
        }
    });
}

/** Returns the embedded R/Python language at a Quarto position. */
export function getDataExplorerLanguageIdAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): string | undefined {
    if (document.languageId.toLowerCase() !== 'quarto') {
        return document.languageId.toLowerCase();
    }
    for (const { lineIndex, languageId } of getDataExplorerCodeLines(document)) {
        if (lineIndex === position.line) {
            return languageId;
        }
    }
    return undefined;
}

export function isDocumentLanguageCompatible(
    documentLanguageId: string,
    runtimeLanguageId: string,
): boolean {
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
    document?: vscode.TextDocument,
): IPositronVariablesInstance | undefined {
    if (!requestedSessionId && document?.uri.scheme === 'vscode-notebook-cell') {
        const notebook = vscode.workspace.notebookDocuments.find((candidate) =>
            candidate
                .getCells()
                .some((cell) => cell.document.uri.toString() === document.uri.toString()),
        );
        const session =
            notebook && runtimeSessionService?.getNotebookSessionForNotebookUri(notebook.uri);
        // A notebook must never fall back to a console with the same language.
        return session ? variablesService.getVariablesInstance(session.sessionId) : undefined;
    }
    const sessionId =
        requestedSessionId ??
        runtimeSessionService?.getConsoleSessionForLanguage(languageId)?.sessionId ??
        runtimeSessionService?.activeSessions.find(
            (session) =>
                session.runtimeMetadata.languageId.toLowerCase() === languageId &&
                session.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console,
        )?.sessionId;
    if (sessionId) {
        return (
            variablesService.getVariablesInstance?.(sessionId) ??
            variablesService.positronVariablesInstances.find(
                (instance) => instance.session.sessionId === sessionId,
            )
        );
    }
    if (runtimeSessionService) {
        return undefined;
    }
    const activeInstance = variablesService.activePositronVariablesInstance;
    if (
        activeInstance?.session.runtimeMetadata.languageId.toLowerCase() === languageId &&
        activeInstance.session.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console
    ) {
        return activeInstance;
    }
    const compatibleInstances =
        variablesService.positronVariablesInstances?.filter(
            (instance) =>
                instance.session.runtimeMetadata.languageId.toLowerCase() === languageId &&
                instance.session.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Console,
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
): ResolvedDataFrame | undefined;
export function resolveDataFrameAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    variablesService: IPositronVariablesService,
    runtimeSessionService: RuntimeSessionService | undefined,
    requestedSessionId: string | undefined,
    options: IDataFrameResolutionOptions,
): Promise<ResolvedDataFrame | undefined>;
export function resolveDataFrameAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    variablesService: IPositronVariablesService,
    runtimeSessionService?: RuntimeSessionService,
    requestedSessionId?: string,
    options?: IDataFrameResolutionOptions,
): ResolvedDataFrame | undefined | Promise<ResolvedDataFrame | undefined> {
    if (options) {
        return (async () => {
            const languageId = getDataExplorerLanguageIdAtPosition(document, position);
            if (languageId !== 'python' && languageId !== 'r') {
                return undefined;
            }
            const instance = resolveVariablesInstance(
                languageId,
                variablesService,
                runtimeSessionService,
                requestedSessionId,
                document,
            );
            if (instance && options.wait) {
                await waitForVariables(instance);
            }
            return resolveDataFrameAtPosition(
                document,
                position,
                variablesService,
                runtimeSessionService,
                requestedSessionId,
            );
        })();
    }
    return resolveCachedDataFrameAtPosition(
        document,
        position,
        variablesService,
        runtimeSessionService,
        requestedSessionId,
    );
}

function resolveCachedDataFrameAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    variablesService: IPositronVariablesService,
    runtimeSessionService?: RuntimeSessionService,
    requestedSessionId?: string,
): ResolvedDataFrame | undefined {
    const languageId = getDataExplorerLanguageIdAtPosition(document, position);
    if (languageId !== 'python' && languageId !== 'r') {
        return undefined;
    }
    const range = document.getWordRangeAtPosition(position, getDataExplorerWordPattern(languageId));
    if (!range) {
        return undefined;
    }
    const name = document.getText(range);
    const instance = resolveVariablesInstance(
        languageId,
        variablesService,
        runtimeSessionService,
        requestedSessionId,
        document,
    );
    if (!instance) {
        return undefined;
    }
    const variable = instance.variableItems.find(
        (item) => item.hasViewer && item.displayName === name,
    );
    return variable
        ? {
              instance,
              variable,
              range,
              sessionId: instance.session.sessionId,
              languageId,
          }
        : undefined;
}

/**
 * Enumerates identifier ranges in executable R/Python code only. This is the
 * public VS Code DocumentLink adaptation of Positron's position-based private
 * click-to-view provider.
 */
export function findDataExplorerIdentifierRanges(document: vscode.TextDocument): vscode.Range[] {
    const ranges: vscode.Range[] = [];
    let multilineQuote: "'''" | '"""' | undefined;
    for (const { lineIndex, line, languageId } of getDataExplorerCodeLines(document)) {
        if (languageId !== 'python' && languageId !== 'r') {
            multilineQuote = undefined;
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
            if (
                languageId === 'python' &&
                (line.startsWith("'''", character) || line.startsWith('"""', character))
            ) {
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
        for (const match of code.matchAll(getDataExplorerWordPattern(languageId))) {
            const start = new vscode.Position(lineIndex, match.index ?? 0);
            ranges.push(new vscode.Range(start, start.translate(0, match[0].length)));
        }
    }
    return ranges;
}
