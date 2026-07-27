import * as vscode from 'vscode';

const SessionHistoryKeyPrefix = 'vscode-supervisor.inputHistory.session.';
const LanguageHistoryKeyPrefix = 'vscode-supervisor.inputHistory.language.';
const DefaultHistorySize = 1000;

export interface InputHistoryEntry {
    readonly when: number;
    readonly input: string;
    readonly debug?: string;
}

/**
 * Canonical extension-host history store. It mirrors Positron's separation
 * between per-session navigation history and per-language searchable history.
 */
export class ExecutionHistoryService implements vscode.Disposable {
    private readonly _sessionEntries = new Map<string, InputHistoryEntry[]>();
    private readonly _languageEntries = new Map<string, InputHistoryEntry[]>();
    private readonly _knownEmptySessions = new Set<string>();
    private _writeQueue: Promise<void> = Promise.resolve();
    private _disposed = false;

    constructor(
        private readonly _storage: vscode.Memento,
        private readonly _outputChannel: vscode.LogOutputChannel,
    ) { }

    getSessionInputEntries(sessionId: string): InputHistoryEntry[] {
        return [...this._loadSessionEntries(sessionId)];
    }

    getInputEntries(languageId: string): InputHistoryEntry[] {
        return [...this._loadLanguageEntries(languageId)];
    }

    recordInput(
        sessionId: string,
        languageId: string,
        input: string,
        when: number = Date.now(),
        debug?: string,
    ): void {
        if (this._disposed || !input.trim()) {
            return;
        }

        const entry: InputHistoryEntry = { when, input, debug };
        const sessionEntries = this._append(this._loadSessionEntries(sessionId), entry);
        const languageEntries = this._append(this._loadLanguageEntries(languageId), entry);
        this._sessionEntries.set(sessionId, sessionEntries);
        this._languageEntries.set(languageId, languageEntries);
        this._knownEmptySessions.delete(sessionId);
        this._persist(this._sessionKey(sessionId), sessionEntries);
        this._persist(this._languageKey(languageId), languageEntries);
    }

    /**
     * Imports the history embedded in an old ConsoleState record once. An
     * explicitly cleared empty record is a tombstone and cannot be resurrected.
     */
    restoreLegacySessionEntries(
        sessionId: string,
        languageId: string,
        legacyInputs: readonly string[],
    ): InputHistoryEntry[] {
        const stored = this._storage.get<InputHistoryEntry[] | undefined>(
            this._sessionKey(sessionId),
        );
        const cached = this._sessionEntries.get(sessionId);
        if (
            stored !== undefined ||
            this._knownEmptySessions.has(sessionId) ||
            (cached !== undefined && cached.length > 0)
        ) {
            return this.getSessionInputEntries(sessionId);
        }

        const entries = legacyInputs
            .filter(input => typeof input === 'string' && input.trim().length > 0)
            .slice(-this._maxHistorySize())
            .map((input, index) => ({ when: index, input }));
        this._sessionEntries.set(sessionId, entries);
        if (entries.length === 0) {
            this._knownEmptySessions.add(sessionId);
        }
        this._persist(this._sessionKey(sessionId), entries);

        const languageEntries = [
            ...this._loadLanguageEntries(languageId),
            ...entries,
        ].slice(-this._maxHistorySize());
        this._languageEntries.set(languageId, languageEntries);
        this._persist(this._languageKey(languageId), languageEntries);
        return [...entries];
    }

    clearSessionInputEntries(sessionId: string): void {
        this._sessionEntries.set(sessionId, []);
        this._knownEmptySessions.add(sessionId);
        this._persist(this._sessionKey(sessionId), []);
    }

    clearInputEntries(languageId: string): void {
        this._languageEntries.set(languageId, []);
        this._persist(this._languageKey(languageId), []);
    }

    deleteSessionHistory(sessionId: string): void {
        this._sessionEntries.delete(sessionId);
        this._knownEmptySessions.delete(sessionId);
        this._persist(this._sessionKey(sessionId), undefined);
    }

    async flush(): Promise<void> {
        await this._writeQueue;
    }

    dispose(): void {
        this._disposed = true;
    }

    private _loadSessionEntries(sessionId: string): InputHistoryEntry[] {
        const cached = this._sessionEntries.get(sessionId);
        if (cached) {
            return cached;
        }
        const entries = this._read(this._sessionKey(sessionId));
        this._sessionEntries.set(sessionId, entries);
        if (entries.length === 0 && this._storage.get(this._sessionKey(sessionId)) !== undefined) {
            this._knownEmptySessions.add(sessionId);
        }
        return entries;
    }

    private _loadLanguageEntries(languageId: string): InputHistoryEntry[] {
        const cached = this._languageEntries.get(languageId);
        if (cached) {
            return cached;
        }
        const entries = this._read(this._languageKey(languageId));
        this._languageEntries.set(languageId, entries);
        return entries;
    }

    private _read(key: string): InputHistoryEntry[] {
        const stored = this._storage.get<unknown>(key, []);
        if (!Array.isArray(stored)) {
            this._outputChannel.warn(`[ExecutionHistoryService] Ignoring invalid history at ${key}`);
            return [];
        }
        return stored
            .filter((entry): entry is InputHistoryEntry => (
                typeof entry === 'object' &&
                entry !== null &&
                typeof (entry as InputHistoryEntry).input === 'string' &&
                typeof (entry as InputHistoryEntry).when === 'number'
            ))
            .slice(-this._maxHistorySize());
    }

    private _append(
        entries: readonly InputHistoryEntry[],
        entry: InputHistoryEntry,
    ): InputHistoryEntry[] {
        const max = this._maxHistorySize();
        if (max === 0) {
            return [];
        }
        const base = entries.length > 0 && entries[entries.length - 1].input === entry.input
            ? entries.slice(0, -1)
            : [...entries];
        return [...base, entry].slice(-max);
    }

    private _maxHistorySize(): number {
        const configured = vscode.workspace
            .getConfiguration('supervisor.console')
            .get<number>('inputHistorySize', DefaultHistorySize);
        return Number.isFinite(configured)
            ? Math.max(0, Math.floor(configured))
            : DefaultHistorySize;
    }

    private _persist(key: string, value: InputHistoryEntry[] | undefined): void {
        this._writeQueue = this._writeQueue
            .then(() => this._storage.update(key, value))
            .catch(error => {
                this._outputChannel.warn(
                    `[ExecutionHistoryService] Failed to persist ${key}: ${error}`,
                );
            });
    }

    private _sessionKey(sessionId: string): string {
        return `${SessionHistoryKeyPrefix}${sessionId}`;
    }

    private _languageKey(languageId: string): string {
        return `${LanguageHistoryKeyPrefix}${languageId}`;
    }
}
