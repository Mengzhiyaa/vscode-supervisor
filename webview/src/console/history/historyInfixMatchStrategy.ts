/**
 * historyInfixMatchStrategy.ts
 * 
 * A history match strategy that matches the input anywhere in the string.
 * Mirrors: positron/.../common/historyInfixMatchStrategy.ts
 * 
 * This mimics the behavior of Bash's reverse-history-search mode (Ctrl+R).
 */

import type { IInputHistoryEntry } from './types';
import { type HistoryMatch, HistoryMatchStrategy } from './historyMatchStrategy';

/**
 * A history match strategy that matches the input anywhere in the string.
 * It mimics the behavior of Bash's reverse-history-search mode (Ctrl+R).
 */
export class HistoryInfixMatchStrategy extends HistoryMatchStrategy {
    constructor(protected readonly _entries: Array<IInputHistoryEntry>) {
        super();
    }

    /**
     * Match the input anywhere in the string.
     *
     * @param input The input to match
     * @returns An array of matches
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

            if (input.length > 0) {
                // If there is a string to match, find the first occurrence of
                // the input in the entry's input string and highlight it.
                const matchIdx = entry.input.indexOf(input);
                if (matchIdx >= 0) {
                    const match: HistoryMatch = {
                        input: entry.input,
                        highlightStart: matchIdx,
                        highlightEnd: matchIdx + input.length
                    };
                    matches.push(match);
                }
            } else {
                // When not passed a string to match, just return the entire
                // history as a match.
                const match: HistoryMatch = {
                    input: entry.input,
                    highlightStart: 0,
                    highlightEnd: 0
                };
                matches.push(match);
            }
            previousInput = entry.input;
        }
        return matches;
    }
}
