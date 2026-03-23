/**
 * index.ts
 * 
 * Re-exports for history module.
 */

export type { IInputHistoryEntry } from './types';
export type { HistoryMatch } from './historyMatchStrategy';
export { HistoryMatchStrategy, EmptyHistoryMatchStrategy } from './historyMatchStrategy';
export { HistoryPrefixMatchStrategy } from './historyPrefixMatchStrategy';
export { HistoryInfixMatchStrategy } from './historyInfixMatchStrategy';
