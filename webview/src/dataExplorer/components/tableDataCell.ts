/*---------------------------------------------------------------------------------------------
 *  Table Data Cell Utilities - Port from Positron's tableDataCell
 *--------------------------------------------------------------------------------------------*/

/**
 * Renders leading/trailing whitespace using dot symbols while preserving core text.
 */
export function renderLeadingTrailingWhitespace(
    text: string | undefined,
): Array<string | { kind: 'whitespace'; text: string }> {
    const parts: Array<string | { kind: 'whitespace'; text: string }> = [];

    const value = text ?? '';
    if (value === '') {
        parts.push({ kind: 'whitespace', text: '<empty>' });
        return parts;
    }

    const emptySpaceSymbol = '\u00B7';

    if (value.trim() === '') {
        parts.push({ kind: 'whitespace', text: emptySpaceSymbol.repeat(value.length) });
        return parts;
    }

    const leadingMatch = value.match(/^\s+/);
    if (leadingMatch) {
        parts.push({
            kind: 'whitespace',
            text: emptySpaceSymbol.repeat(leadingMatch[0].length),
        });
    }

    parts.push(value.trim());

    const trailingMatch = value.match(/\s+$/);
    if (trailingMatch) {
        parts.push({
            kind: 'whitespace',
            text: emptySpaceSymbol.repeat(trailingMatch[0].length),
        });
    }

    return parts;
}

