/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *  Ported to vscode-ark by the vscode-ark team.
 *--------------------------------------------------------------------------------------------*/

import type { ANSIOutputLine } from '$lib/ansi/ansiOutput';

/**
 * Formats output lines for the clipboard.
 * @param outputLines The output lines to format.
 * @param commentPrefix The comment prefix to use.
 * @returns The formatted output lines.
 */
export function formatOutputLinesForClipboard(
    outputLines: readonly ANSIOutputLine[],
    commentPrefix: string
): string[] {
    return outputLines.map(outputLine => {
        // Extract the text from the output runs
        const text = outputLine.outputRuns.map(run => run.text).join('');
        return commentPrefix + text;
    });
}
