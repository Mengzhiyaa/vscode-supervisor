import * as vscode from 'vscode';
import type { SerializedConsoleState } from '../../shared/consoleState';
import { ExecutionHistoryFileStore } from './executionHistoryFileStore';

const SessionHistoryKeyPrefix = 'vscode-supervisor.inputHistory.session.';
const LanguageHistoryKeyPrefix = 'vscode-supervisor.inputHistory.language.';
const ExecutionHistoryKeyPrefix = 'vscode-supervisor.executionHistory.v1.';
const DefaultHistorySize = 1000;
const MaxExecutionIndexEntries = 200;
const MaxExecutionIndexTextChars = 64 * 1024;
const ExecutionTruncatedMarker = '…(earlier output omitted from execution index)\n';

export interface InputHistoryEntry {
    readonly when: number;
    readonly input: string;
    readonly debug?: string;
}

export enum ExecutionEntryType {
    Startup = 'startup',
    Execution = 'execution',
}

export interface ExecutionHistoryError {
    readonly name: string;
    readonly message: string;
    readonly traceback: string[];
}

export interface ExecutionHistoryEntry {
    readonly id: string;
    readonly when: number;
    prompt: string;
    input: string;
    outputType: ExecutionEntryType;
    output: string | { banner: string; version: string };
    error?: ExecutionHistoryError;
    durationMs: number;
}

/**
 * Canonical extension-host history store. It mirrors Positron's separation
 * between per-session navigation history and per-language searchable history.
 */
export class ExecutionHistoryService implements vscode.Disposable {
    private readonly _sessionEntries = new Map<string, InputHistoryEntry[]>();
    private readonly _languageEntries = new Map<string, InputHistoryEntry[]>();
    private readonly _executionEntries = new Map<string, ExecutionHistoryEntry[]>();
    private readonly _knownEmptySessions = new Set<string>();
    private readonly _dirtyExecutionSessions = new Set<string>();
    private readonly _pendingWrites = new Map<
        string,
        InputHistoryEntry[] | ExecutionHistoryEntry[] | undefined
    >();
    private _writeDrainPromise: Promise<void> | undefined;
    private _disposed = false;
    private readonly _fileStore: ExecutionHistoryFileStore;

    constructor(
        private readonly _storage: vscode.Memento,
        private readonly _outputChannel: vscode.LogOutputChannel,
        storageUri?: vscode.Uri,
    ) {
        this._fileStore = new ExecutionHistoryFileStore(storageUri, _outputChannel);
    }

    async initialize(): Promise<void> {
        await this._fileStore.initialize();
        if (!this._fileStore.enabled) {
            return;
        }

        const legacyKeys = this._storage.keys().filter(key =>
            key.startsWith(SessionHistoryKeyPrefix) ||
            key.startsWith(LanguageHistoryKeyPrefix) ||
            key.startsWith(ExecutionHistoryKeyPrefix),
        );
        for (const key of legacyKeys) {
            const stored = this._storage.get<unknown>(key);
            if (key.startsWith(SessionHistoryKeyPrefix)) {
                const sessionId = key.slice(SessionHistoryKeyPrefix.length);
                if (this._fileStore.getSessionInput(sessionId) === undefined) {
                    await this._fileStore.writeSessionInput(
                        sessionId,
                        this._parseInputEntries(stored, key),
                    );
                }
            } else if (key.startsWith(LanguageHistoryKeyPrefix)) {
                const languageId = key.slice(LanguageHistoryKeyPrefix.length);
                if (this._fileStore.getLanguageInput(languageId) === undefined) {
                    await this._fileStore.writeLanguageInput(
                        languageId,
                        this._parseInputEntries(stored, key),
                    );
                }
            } else {
                const sessionId = key.slice(ExecutionHistoryKeyPrefix.length);
                if (this._fileStore.getExecution(sessionId) === undefined) {
                    await this._fileStore.writeExecution(
                        sessionId,
                        this._parseExecutionEntries(stored),
                    );
                }
            }
        }

        await Promise.all(legacyKeys.map(key => this._storage.update(key, undefined)));
    }

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

    getExecutionEntries(sessionId: string): ExecutionHistoryEntry[] {
        return this._loadExecutionEntries(sessionId).map(entry => ({ ...entry }));
    }

    restoreLegacyExecutionEntries(
        sessionId: string,
        state: SerializedConsoleState,
    ): ExecutionHistoryEntry[] {
        if (this._hasStoredExecutionEntries(sessionId)) {
            return this.getExecutionEntries(sessionId);
        }
        const entries: ExecutionHistoryEntry[] = [];
        for (const item of state.items) {
            if (item.type === 'startup') {
                entries.push({
                    id: item.id,
                    when: item.when,
                    prompt: '',
                    input: '',
                    outputType: ExecutionEntryType.Startup,
                    output: { banner: item.banner, version: item.version },
                    durationMs: 0,
                });
                continue;
            }
            if (item.type !== 'activity') {
                continue;
            }
            const input = item.items.find(entry => entry.type === 'input');
            const error = item.items.find(entry => entry.type === 'error');
            const output = item.items.map(entry => {
                if (entry.type === 'stream') {
                    return entry.text;
                }
                if (entry.type === 'output' || entry.type === 'outputPlot') {
                    return entry.data['text/plain'] ?? '';
                }
                return '';
            }).join('');
            entries.push({
                id: item.parentId,
                when: input?.when ?? item.items[0]?.when ?? Date.now(),
                prompt: input?.inputPrompt ?? '',
                input: input?.code ?? '',
                outputType: ExecutionEntryType.Execution,
                output,
                error: error && error.type === 'error'
                    ? {
                        name: error.name,
                        message: error.message,
                        traceback: error.traceback,
                    }
                    : undefined,
                durationMs: 0,
            });
        }
        this._executionEntries.set(sessionId, entries);
        this._persist(this._executionKey(sessionId), entries);
        return this.getExecutionEntries(sessionId);
    }

    recordExecutionInput(
        sessionId: string,
        executionId: string,
        prompt: string,
        input: string,
        when: number = Date.now(),
    ): void {
        const entry = this._getOrCreateExecution(sessionId, executionId, when);
        entry.prompt = prompt;
        entry.input = input;
        this._dirtyExecutionSessions.add(sessionId);
    }

    recordExecutionOutput(
        sessionId: string,
        executionId: string,
        output: string,
        when: number = Date.now(),
        replace = false,
    ): void {
        if (!output) {
            return;
        }
        const entry = this._getOrCreateExecution(sessionId, executionId, when);
        const current = typeof entry.output === 'string' ? entry.output : '';
        const combined = replace ? output : current + output;
        entry.output = combined.length > MaxExecutionIndexTextChars
            ? ExecutionTruncatedMarker + combined.slice(-MaxExecutionIndexTextChars)
            : combined;
        this._dirtyExecutionSessions.add(sessionId);
    }

    clearExecutionOutput(sessionId: string, executionId: string): void {
        const entry = this._loadExecutionEntries(sessionId)
            .find(candidate => candidate.id === executionId);
        if (!entry) {
            return;
        }
        entry.output = '';
        this._persistExecutionEntriesNow(sessionId);
    }

    recordExecutionError(
        sessionId: string,
        executionId: string,
        error: ExecutionHistoryError,
        when: number = Date.now(),
    ): void {
        const entry = this._getOrCreateExecution(sessionId, executionId, when);
        entry.error = error;
        this._persistExecutionEntriesNow(sessionId);
    }

    completeExecution(sessionId: string, executionId: string): void {
        const entry = this._loadExecutionEntries(sessionId)
            .find(candidate => candidate.id === executionId);
        if (!entry) {
            return;
        }
        entry.durationMs = Math.max(0, Date.now() - entry.when);
        this._persistExecutionEntriesNow(sessionId);
    }

    recordStartup(sessionId: string, id: string, banner: string, version: string): void {
        const entries = this._loadExecutionEntries(sessionId);
        const existing = entries.find(entry => entry.id === id);
        if (existing) {
            existing.output = { banner, version };
        } else {
            entries.push({
                id,
                when: Date.now(),
                prompt: '',
                input: '',
                outputType: ExecutionEntryType.Startup,
                output: { banner, version },
                durationMs: 0,
            });
        }
        this._persistExecutionEntriesNow(sessionId);
    }

    clearExecutionEntries(sessionId: string): void {
        this._dirtyExecutionSessions.delete(sessionId);
        this._executionEntries.set(sessionId, []);
        this._persist(this._executionKey(sessionId), []);
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
        const hasStoredEntries = this._hasStoredSessionEntries(sessionId);
        const cached = this._sessionEntries.get(sessionId);
        if (
            hasStoredEntries ||
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
        this._dirtyExecutionSessions.delete(sessionId);
        this._sessionEntries.delete(sessionId);
        this._knownEmptySessions.delete(sessionId);
        this._persist(this._sessionKey(sessionId), undefined);
        this._executionEntries.delete(sessionId);
        this._persist(this._executionKey(sessionId), undefined);
    }

    async flush(): Promise<void> {
        for (const sessionId of [...this._dirtyExecutionSessions]) {
            this._persistExecutionEntriesNow(sessionId);
        }
        while (this._writeDrainPromise) {
            await this._writeDrainPromise;
        }
    }

    dispose(): void {
        this._disposed = true;
    }

    private _loadSessionEntries(sessionId: string): InputHistoryEntry[] {
        const cached = this._sessionEntries.get(sessionId);
        if (cached) {
            return cached;
        }
        const key = this._sessionKey(sessionId);
        const stored = this._fileStore.enabled
            ? this._fileStore.getSessionInput(sessionId)
            : this._storage.get<unknown>(key, []);
        const entries = this._parseInputEntries(stored ?? [], key);
        this._sessionEntries.set(sessionId, entries);
        if (entries.length === 0 && this._hasStoredSessionEntries(sessionId)) {
            this._knownEmptySessions.add(sessionId);
        }
        return entries;
    }

    private _loadLanguageEntries(languageId: string): InputHistoryEntry[] {
        const cached = this._languageEntries.get(languageId);
        if (cached) {
            return cached;
        }
        const key = this._languageKey(languageId);
        const stored = this._fileStore.enabled
            ? this._fileStore.getLanguageInput(languageId)
            : this._storage.get<unknown>(key, []);
        const entries = this._parseInputEntries(stored ?? [], key);
        this._languageEntries.set(languageId, entries);
        return entries;
    }

    private _loadExecutionEntries(sessionId: string): ExecutionHistoryEntry[] {
        const cached = this._executionEntries.get(sessionId);
        if (cached) {
            return cached;
        }
        const stored = this._fileStore.enabled
            ? this._fileStore.getExecution(sessionId)
            : this._storage.get<unknown>(this._executionKey(sessionId), []);
        const entries = this._parseExecutionEntries(stored ?? []);
        this._executionEntries.set(sessionId, entries);
        return entries;
    }

    private _getOrCreateExecution(
        sessionId: string,
        executionId: string,
        when: number,
    ): ExecutionHistoryEntry {
        const entries = this._loadExecutionEntries(sessionId);
        let entry = entries.find(candidate => candidate.id === executionId);
        if (!entry) {
            entry = {
                id: executionId,
                when,
                prompt: '',
                input: '',
                outputType: ExecutionEntryType.Execution,
                output: '',
                durationMs: 0,
            };
            entries.push(entry);
        }
        return entry;
    }

    private _persistExecutionEntriesNow(sessionId: string): void {
        this._dirtyExecutionSessions.delete(sessionId);
        const entries = this._loadExecutionEntries(sessionId);
        if (entries.length > MaxExecutionIndexEntries) {
            entries.splice(0, entries.length - MaxExecutionIndexEntries);
        }
        const snapshot = entries.map(entry => ({
            ...entry,
            input: entry.input.slice(0, MaxExecutionIndexTextChars),
            output: typeof entry.output === 'string'
                ? entry.output.slice(-MaxExecutionIndexTextChars)
                : { ...entry.output },
            error: entry.error
                ? {
                    ...entry.error,
                    message: entry.error.message.slice(0, MaxExecutionIndexTextChars),
                    traceback: entry.error.traceback
                        .slice(-100)
                        .map(line => line.slice(0, 4096)),
                }
                : undefined,
        }));
        this._persist(
            this._executionKey(sessionId),
            snapshot,
        );
    }

    private _parseInputEntries(stored: unknown, key: string): InputHistoryEntry[] {
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

    private _parseExecutionEntries(stored: unknown): ExecutionHistoryEntry[] {
        return Array.isArray(stored)
            ? stored.filter((entry): entry is ExecutionHistoryEntry => (
                typeof entry === 'object' &&
                entry !== null &&
                typeof (entry as ExecutionHistoryEntry).id === 'string' &&
                typeof (entry as ExecutionHistoryEntry).when === 'number' &&
                typeof (entry as ExecutionHistoryEntry).input === 'string'
            ))
            : [];
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

    private _persist(
        key: string,
        value: InputHistoryEntry[] | ExecutionHistoryEntry[] | undefined,
    ): void {
        this._pendingWrites.set(key, value);
        void this._drainWrites();
    }

    private _drainWrites(): Promise<void> {
        if (this._writeDrainPromise) {
            return this._writeDrainPromise;
        }

        const drain = this._drainPendingWrites().finally(() => {
            if (this._writeDrainPromise === drain) {
                this._writeDrainPromise = undefined;
            }
        });
        this._writeDrainPromise = drain;
        return drain;
    }

    private async _drainPendingWrites(): Promise<void> {
        while (this._pendingWrites.size > 0) {
            const writes = [...this._pendingWrites.entries()];
            this._pendingWrites.clear();
            for (const [key, value] of writes) {
                try {
                    await this._write(key, value);
                } catch (error) {
                    this._outputChannel.warn(
                        `[ExecutionHistoryService] Failed to persist ${key}: ${error}`,
                    );
                }
            }
        }
    }

    private async _write(
        key: string,
        value: InputHistoryEntry[] | ExecutionHistoryEntry[] | undefined,
    ): Promise<void> {
        if (!this._fileStore.enabled) {
            if (this._storedValueEquals(key, value)) {
                return;
            }
            await this._storage.update(key, value);
            return;
        }

        if (key.startsWith(SessionHistoryKeyPrefix)) {
            const sessionId = key.slice(SessionHistoryKeyPrefix.length);
            if (value === undefined) {
                await this._fileStore.deleteSessionInput(sessionId);
            } else {
                await this._fileStore.writeSessionInput(sessionId, value);
            }
            return;
        }
        if (key.startsWith(LanguageHistoryKeyPrefix)) {
            const languageId = key.slice(LanguageHistoryKeyPrefix.length);
            if (value !== undefined) {
                await this._fileStore.writeLanguageInput(languageId, value);
            }
            return;
        }
        if (key.startsWith(ExecutionHistoryKeyPrefix)) {
            const sessionId = key.slice(ExecutionHistoryKeyPrefix.length);
            if (value === undefined) {
                await this._fileStore.deleteExecution(sessionId);
            } else {
                await this._fileStore.writeExecution(sessionId, value);
            }
        }
    }

    private _hasStoredSessionEntries(sessionId: string): boolean {
        return this._fileStore.enabled
            ? this._fileStore.getSessionInput(sessionId) !== undefined
            : this._storage.get(this._sessionKey(sessionId)) !== undefined;
    }

    private _hasStoredExecutionEntries(sessionId: string): boolean {
        return this._fileStore.enabled
            ? this._fileStore.getExecution(sessionId) !== undefined
            : this._storage.get(this._executionKey(sessionId)) !== undefined;
    }

    private _storedValueEquals(
        key: string,
        value: InputHistoryEntry[] | ExecutionHistoryEntry[] | undefined,
    ): boolean {
        const current = this._storage.get<unknown>(key);
        if (current === undefined || value === undefined) {
            return current === value;
        }
        return JSON.stringify(current) === JSON.stringify(value);
    }

    private _sessionKey(sessionId: string): string {
        return `${SessionHistoryKeyPrefix}${sessionId}`;
    }

    private _languageKey(languageId: string): string {
        return `${LanguageHistoryKeyPrefix}${languageId}`;
    }

    private _executionKey(sessionId: string): string {
        return `${ExecutionHistoryKeyPrefix}${sessionId}`;
    }
}
