/**
 * Match Positron's tab-suggest context without taking Tab away from indentation
 * or selected text. Monaco columns are one-based.
 */
export function isTabSuggestContext(
    lineContent: string,
    column: number,
    hasSelection: boolean,
): boolean {
    if (hasSelection) {
        return false;
    }

    return lineContent.substring(0, Math.max(0, column - 1)).trim().length > 0;
}
