/**
 * types.ts
 * 
 * Common types for console history.
 * Mirrors: positron/.../services/positronHistory/common/executionHistoryService.ts
 */

/**
 * Input history entry interface (Positron pattern).
 */
export interface IInputHistoryEntry {
    /** The input text */
    input: string;
    /** When the input was executed */
    when: Date;
    /** Optional debug mode indicator */
    debug?: 'active' | 'inactive';
}
