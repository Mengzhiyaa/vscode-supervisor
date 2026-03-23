/**
 * historyPrefixMatchStrategy.ts
 * 
 * A history match strategy that matches the input at the beginning of the string.
 * Mirrors: positron/.../common/historyPrefixMatchStrategy.ts
 * 
 * This mimics RStudio's Cmd+Up history search mode.
 */

import type { IInputHistoryEntry } from './types';
import { type HistoryMatch, HistoryMatchStrategy } from './historyMatchStrategy';

/**
 * A history match strategy that matches the input at the beginning of the
 * string. It mimics RStudio's Cmd+Up history search mode.
 */
export class HistoryPrefixMatchStrategy extends HistoryMatchStrategy {
    constructor(protected readonly _entries: Array<IInputHistoryEntry>) {
        super();
    }

    /**
     * Matches the input at the beginning of the string.
     *
     * @param input The input to match
     * @returns The array of matches
     */
    override getMatches(input: string): HistoryMatch[] {
        const matches: HistoryMatch[] = [];
        let previousInput = '';

        for (const entry of this._entries) {
            // Duplicate suppression: Ignore this entry if it's the same as the
            // previous one or the same as the previous match
            if (entry.input === previousInput ||
                entry.input === matches[matches.length - 1]?.input) {
                continue;
            }

            // If the input starts with the entry's input, highlight it and match it
            if (entry.input.startsWith(input)) {
                const match: HistoryMatch = {
                    input: entry.input,
                    highlightStart: 0,
                    highlightEnd: input.length
                };
                matches.push(match);
            }
            previousInput = entry.input;
        }
        return matches;
    }
}
