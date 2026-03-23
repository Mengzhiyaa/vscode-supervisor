/**
 * historyMatchStrategy.ts
 * 
 * History match strategy interfaces and base classes.
 * Mirrors: positron/.../common/historyMatchStrategy.ts
 */

/**
 * A history match, which is a string with a start and end index that indicates
 * where the match should be highlighted.
 */
export interface HistoryMatch {
    input: string;
    highlightStart: number;
    highlightEnd: number;
}

/**
 * A history match strategy is a class that can find matches in the history
 * given an input string to match against.
 */
export abstract class HistoryMatchStrategy {
    abstract getMatches(input: string): HistoryMatch[];
}

/**
 * Default/placeholder history match strategy that never matches anything.
 */
export class EmptyHistoryMatchStrategy extends HistoryMatchStrategy {
    override getMatches(_input: string): HistoryMatch[] {
        return [];
    }
}
