/*---------------------------------------------------------------------------------------------
 *  Console Actions
 *  1:1 replication of Positron's console actions for editor integration
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CoreCommandIds, InternalCommandIds } from '../../coreCommandIds';
import { PositronConsoleService } from './consoleService';
import { IConsoleCodeAttribution } from './interfaces/consoleService';

/**
 * Trims newlines from the start and end of a string (Positron pattern).
 */
const trimNewlines = (str: string): string => str.replace(/^\n+|\n+$/g, '');

/**
 * Statement range information (Positron pattern).
 * Mirrors IStatementRange from Positron's language features.
 */
interface StatementRange {
    range: vscode.Range;
    code?: string;
}

interface StatementRangeRejection {
    kind: 'rejection';
    rejectionKind: 'syntax';
    line?: number;
}

type StatementRangeCommandResult =
    | {
          kind: 'success';
          range: {
              start: { line: number; character: number };
              end: { line: number; character: number };
          };
          code?: string;
      }
    | StatementRangeRejection
    | {
          range: {
              start: { line: number; character: number };
              end: { line: number; character: number };
          };
          code?: string;
      };

function isStatementRangeRejection(
    result: StatementRange | StatementRangeRejection,
): result is StatementRangeRejection {
    return (result as StatementRangeRejection).kind === 'rejection';
}

async function notifyStatementRangeSyntaxRejection(
    editor: vscode.TextEditor,
    line: number | undefined,
): Promise<void> {
    const jumpToLineAction = 'Jump to line';
    const message =
        line === undefined
            ? "Can't execute code due to a syntax error."
            : `Can't execute code due to a syntax error near line ${line + 1}.`;

    const selection = line === undefined
        ? await vscode.window.showInformationMessage(message)
        : await vscode.window.showInformationMessage(message, jumpToLineAction);

    if (selection === jumpToLineAction && line !== undefined) {
        const position = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenterIfOutsideViewport,
        );
    }
}

/**
 * Registers console-related commands for editor integration.
 * @returns Array of disposables for command registrations
 */
export function registerConsoleActions(
    consoleService: PositronConsoleService,
    outputChannel: vscode.LogOutputChannel
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Execute Code (Ctrl+Enter) - executes current line or selection with cursor advancement
    disposables.push(
        vscode.commands.registerCommand(CoreCommandIds.consoleExecuteCode, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            await executeCodeWithAdvancement(editor, consoleService, outputChannel, true);
        })
    );

    // Execute Code Without Advancing (Alt+Enter)
    disposables.push(
        vscode.commands.registerCommand(CoreCommandIds.consoleExecuteCodeWithoutAdvancing, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            await executeCodeWithAdvancement(editor, consoleService, outputChannel, false);
        })
    );

    // Clear Console (Ctrl+L)
    disposables.push(
        vscode.commands.registerCommand(CoreCommandIds.consoleClearConsole, () => {
            const activeInstance = consoleService.activePositronConsoleInstance;
            if (activeInstance) {
                outputChannel.info('[ConsoleActions] Clearing console');
                activeInstance.clearConsole();
            }
        })
    );

    // Focus Console
    disposables.push(
        vscode.commands.registerCommand(CoreCommandIds.consoleFocusConsole, async () => {
            outputChannel.info('[ConsoleActions] Focusing console input');
            await consoleService.focusConsole();
        })
    );

    // Clear Input History
    disposables.push(
        vscode.commands.registerCommand(CoreCommandIds.consoleClearInputHistory, () => {
            const activeInstance = consoleService.activePositronConsoleInstance;
            if (activeInstance) {
                outputChannel.info('[ConsoleActions] Clearing input history');
                activeInstance.clearInputHistory();
                vscode.window.showInformationMessage('Console input history cleared');
            }
        })
    );

    // Execute Code Before Cursor (Ctrl+Alt+Home)
    disposables.push(
        vscode.commands.registerCommand(CoreCommandIds.consoleExecuteCodeBeforeCursor, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const document = editor.document;
            const position = editor.selection.active;

            // Get all text from start of document to end of current line (Positron pattern)
            const range = new vscode.Range(
                new vscode.Position(0, 0),
                new vscode.Position(position.line, document.lineAt(position.line).text.length)
            );
            const code = document.getText(range);

            if (!code.trim()) {
                vscode.window.showInformationMessage('No code found before cursor position.');
                return;
            }

            const attribution: IConsoleCodeAttribution = {
                source: 'editor',
                fileUri: editor.document.uri,
                lineNumber: 1
            };

            outputChannel.info(`[ConsoleActions] Executing code before cursor`);

            await consoleService.executeCode(
                document.languageId,
                undefined,
                code,
                attribution,
                false
            );
        })
    );

    // Execute Code After Cursor (Ctrl+Alt+End)
    disposables.push(
        vscode.commands.registerCommand(CoreCommandIds.consoleExecuteCodeAfterCursor, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const document = editor.document;
            const position = editor.selection.active;

            // Get all text from start of current line to end of document (Positron pattern)
            const range = new vscode.Range(
                new vscode.Position(position.line, 0),
                new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length)
            );
            const code = document.getText(range);

            if (!code.trim()) {
                vscode.window.showInformationMessage('No code found after cursor position.');
                return;
            }

            const attribution: IConsoleCodeAttribution = {
                source: 'editor',
                fileUri: editor.document.uri,
                lineNumber: position.line + 1
            };

            outputChannel.info(`[ConsoleActions] Executing code after cursor`);

            await consoleService.executeCode(
                document.languageId,
                undefined,
                code,
                attribution,
                false
            );
        })
    );

    // Navigate Input History Up (1:1 Positron)
    disposables.push(
        vscode.commands.registerCommand(CoreCommandIds.consoleNavigateInputHistoryUp, () => {
            const activeInstance = consoleService.activePositronConsoleInstance;
            if (activeInstance) {
                outputChannel.info('[ConsoleActions] Navigate input history up');
                const result = activeInstance.navigateInputHistoryUp('', false);
                if (result !== undefined) {
                    outputChannel.debug(`[ConsoleActions] History result: ${result.substring(0, 50)}...`);
                }
            } else {
                vscode.window.showInformationMessage('Cannot navigate input history. A console is not active.');
            }
        })
    );

    // Navigate Input History Down (1:1 Positron)
    disposables.push(
        vscode.commands.registerCommand(CoreCommandIds.consoleNavigateInputHistoryDown, () => {
            const activeInstance = consoleService.activePositronConsoleInstance;
            if (activeInstance) {
                outputChannel.info('[ConsoleActions] Navigate input history down');
                const result = activeInstance.navigateInputHistoryDown('', false);
                if (result !== undefined) {
                    outputChannel.debug(`[ConsoleActions] History result: ${result.substring(0, 50)}...`);
                }
            } else {
                vscode.window.showInformationMessage('Cannot navigate input history. A console is not active.');
            }
        })
    );

    // Navigate Input History Up with Prefix Match (1:1 Positron)
    disposables.push(
        vscode.commands.registerCommand(CoreCommandIds.consoleNavigateInputHistoryUpPrefixMatch, () => {
            const activeInstance = consoleService.activePositronConsoleInstance;
            if (activeInstance) {
                outputChannel.info('[ConsoleActions] Navigate input history up (prefix match)');
                const result = activeInstance.navigateInputHistoryUp('', true);
                if (result !== undefined) {
                    outputChannel.debug(`[ConsoleActions] History result: ${result.substring(0, 50)}...`);
                }
            } else {
                vscode.window.showInformationMessage('Cannot navigate input history. A console is not active.');
            }
        })
    );

    return disposables;
}

/**
 * Executes code with optional cursor advancement (1:1 Positron pattern).
 * This is the core execution logic that handles:
 * 1. Selection-based execution
 * 2. Statement range detection (via LSP)
 * 3. Line-based fallback
 * 4. Cursor advancement to next statement/line
 */
async function executeCodeWithAdvancement(
    editor: vscode.TextEditor,
    consoleService: PositronConsoleService,
    outputChannel: vscode.LogOutputChannel,
    advance: boolean
): Promise<void> {
    const document = editor.document;
    const selection = editor.selection;
    const position = selection.active;

    let code: string | undefined;

    // If we have a selection and it isn't empty, use its contents (Positron pattern)
    if (!selection.isEmpty) {
        code = document.getText(selection);

        // HACK: Python multiline indented code fix (Positron pattern)
        if (document.languageId === 'python') {
            const lines = code.split('\n');
            if (lines.length > 1 && /^[ \t]/.test(lines[lines.length - 1])) {
                code += '\n';
            }
        }

        if (advance) {
            await advanceSelection(editor, selection);
        }
    }

    // If no selection, try to get statement range from LSP (Positron pattern)
    if (code === undefined) {
        const statementRange = await getStatementRangeAtPosition(document, position, outputChannel);

        if (statementRange) {
            if (isStatementRangeRejection(statementRange)) {
                await notifyStatementRangeSyntaxRejection(editor, statementRange.line);
                return;
            }

            code = statementRange.code ?? document.getText(statementRange.range);

            if (advance) {
                await advanceStatement(editor, statementRange, outputChannel);
            }
        }
    }

    // If still no code, fall back to current line (Positron pattern)
    if (code === undefined) {
        let lineNumber = position.line;

        // Find the first non-empty line at or after cursor position
        for (let number = lineNumber; number < document.lineCount; ++number) {
            const lineText = trimNewlines(document.lineAt(number).text);
            if (lineText.length > 0) {
                code = lineText;
                lineNumber = number;
                break;
            }
        }

        if (advance && code !== undefined) {
            await advanceLine(editor, position, lineNumber);
        }

        // If we're at the end and still no code, handle empty document end (Positron pattern)
        if (code === undefined && lineNumber >= document.lineCount - 1) {
            await amendNewlineToEnd(editor);

            const newPosition = new vscode.Position(lineNumber, 0);
            editor.selection = new vscode.Selection(newPosition, newPosition);
            editor.revealRange(
                new vscode.Range(newPosition, newPosition),
                vscode.TextEditorRevealType.InCenterIfOutsideViewport,
            );
        }

        // If still no code, execute empty string (Positron pattern)
        if (code === undefined) {
            code = '';
        }
    }

    // Execute the code
    if (code !== undefined) {
        const attribution: IConsoleCodeAttribution = {
            source: 'editor',
            fileUri: document.uri,
            lineNumber: position.line + 1
        };

        outputChannel.info(`[ConsoleActions] Executing code: ${code.substring(0, 50)}...`);

        await consoleService.executeCode(
            document.languageId,
            undefined,
            code,
            attribution,
            false // Don't focus console to keep cursor in editor (Positron pattern)
        );
    }
}

async function advanceSelection(
    editor: vscode.TextEditor,
    selection: vscode.Selection,
): Promise<void> {
    const document = editor.document;
    const lastSelectedLine =
        selection.end.character === 0 && selection.end.line > selection.start.line
            ? selection.end.line - 1
            : selection.end.line;

    let nextLine = lastSelectedLine + 1;
    if (nextLine >= document.lineCount) {
        await amendNewlineToEnd(editor);
        nextLine = editor.document.lineCount - 1;
    }

    const newPosition = new vscode.Position(nextLine, 0);
    editor.selection = new vscode.Selection(newPosition, newPosition);
    editor.revealRange(
        new vscode.Range(newPosition, newPosition),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
}

/**
 * Gets the statement range at the given position using LSP (Positron pattern).
 * This attempts to use the language server's statement range capability.
 */
async function getStatementRangeAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    outputChannel: vscode.LogOutputChannel
): Promise<StatementRange | StatementRangeRejection | undefined> {
    try {
        // Try to get statement range from language server via custom LSP request
        // This mirrors Positron's statementRangeProvider.provideStatementRange
        const result = await vscode.commands.executeCommand<StatementRangeCommandResult | undefined>(
            InternalCommandIds.lspGetStatementRange,
            document.uri.toString(),
            { line: position.line, character: position.character }
        );

        if (!result) {
            return undefined;
        }

        if ('kind' in result && result.kind === 'rejection') {
            return result;
        }

        if (result.range) {
            return {
                range: new vscode.Range(
                    new vscode.Position(result.range.start.line, result.range.start.character),
                    new vscode.Position(result.range.end.line, result.range.end.character)
                ),
                code: result.code
            };
        }
    } catch (err) {
        // Statement range provider not available or threw error
        outputChannel.debug(`[ConsoleActions] Failed to get statement range: ${err}`);
    }

    return undefined;
}

/**
 * Advances the cursor to the next statement (Positron pattern).
 * Uses the statement range provider to find the next statement boundary.
 */
async function advanceStatement(
    editor: vscode.TextEditor,
    executedRange: StatementRange,
    outputChannel: vscode.LogOutputChannel
): Promise<void> {
    const document = editor.document;

    // Calculate the next position by creating a position on the line
    // following the statement (Positron pattern)
    let newLineNumber = executedRange.range.end.line + 1;
    let newColumn = 0;

    if (newLineNumber > document.lineCount - 1) {
        // If the new position is past the end of the document,
        // add a newline unless it already ends with an empty line (Positron pattern)
        const lastLine = document.lineAt(document.lineCount - 1);
        if (lastLine.text.trim().length > 0) {
            await amendNewlineToEnd(editor);
        }
        // Use editor.document to get the updated line count after edit
        newLineNumber = editor.document.lineCount - 1;
        newColumn = 0;
    } else {
        // Try to find the next statement to position cursor at its start (Positron pattern)
        const nextStatementRange = await getStatementRangeAtPosition(
            document,
            new vscode.Position(newLineNumber, 0),
            outputChannel
        );

        if (nextStatementRange) {
            if (isStatementRangeRejection(nextStatementRange)) {
                outputChannel.warn(
                    nextStatementRange.line === undefined
                        ? "Can't compute advancement due to a syntax error."
                        : `Can't compute advancement due to a syntax error on line ${nextStatementRange.line + 1}.`,
                );
            } else {
                const nextStatement = nextStatementRange.range;
                // Maintain invariant: always step further down, never up (Positron pattern)
                if (nextStatement.start.line > executedRange.range.end.line) {
                    newLineNumber = nextStatement.start.line;
                    newColumn = nextStatement.start.character;
                } else if (nextStatement.end.line > executedRange.range.end.line) {
                    // Exiting nested scope case (Positron pattern)
                    newLineNumber = nextStatement.end.line;
                    newColumn = nextStatement.end.character;
                }
            }
        }
    }

    // Move cursor (Positron pattern)
    const newPosition = new vscode.Position(newLineNumber, newColumn);
    editor.selection = new vscode.Selection(newPosition, newPosition);
    editor.revealRange(new vscode.Range(newPosition, newPosition), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/**
 * Advances the cursor to the next non-empty line (Positron pattern).
 * Fallback when no statement range provider is available.
 */
async function advanceLine(
    editor: vscode.TextEditor,
    position: vscode.Position,
    lineNumber: number,
): Promise<void> {
    const document = editor.document;
    let onlyEmptyLines = true;

    // Find the next non-empty line (Positron pattern)
    for (let number = lineNumber + 1; number < document.lineCount; ++number) {
        if (trimNewlines(document.lineAt(number).text).length !== 0) {
            onlyEmptyLines = false;
            lineNumber = number;
            break;
        }
    }

    if (onlyEmptyLines) {
        // At minimum, move 1 line past executed code (Positron pattern)
        lineNumber += 1;

        if (lineNumber >= document.lineCount) {
            // Past end of document, add newline and move to it (Positron pattern)
            await amendNewlineToEnd(editor);
        }
    }

    // Move cursor (Positron pattern)
    const newPosition = position.with(lineNumber, 0);
    editor.selection = new vscode.Selection(newPosition, newPosition);
    editor.revealRange(new vscode.Range(newPosition, newPosition), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/**
 * Appends a newline to the end of the document (Positron pattern).
 * Used when cursor is at the end and we need to create space for continued editing.
 * @returns true if the edit was successful, false otherwise
 */
async function amendNewlineToEnd(editor: vscode.TextEditor): Promise<boolean> {
    const document = editor.document;
    const lastLine = document.lineAt(document.lineCount - 1);

    const success = await editor.edit(editBuilder => {
        editBuilder.insert(lastLine.range.end, '\n');
    });

    return success;
}
