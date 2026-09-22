import * as vscode from 'vscode';
import type { SerializedConsoleState } from '../../shared/consoleState';

const SessionHistoryKeyPrefix = 'vscode-supervisor.inputHistory.session.';
const LanguageHistoryKeyPrefix = 'vscode-supervisor.inputHistory.language.';
const ExecutionHistoryKeyPrefix = 'vscode-supervisor.executionHistory.v1.';
const DefaultHistorySize = 1000;
const ExecutionHistorySaveDelayMs = 10_000;

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

export interface ExecutionHistoryOutput {
    readonly outputId?: string;
    text: string;
}

export interface ExecutionHistoryEntry {
    readonly id: string;
    readonly when: number;
    prompt: string;
    input: string;
    outputType: ExecutionEntryType;
    output: string | { banner: string; version: string };
    /** Optional in legacy records. Keeps display identity across reconnects. */
    outputs?: ExecutionHistoryOutput[];
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
    private readonly _initializedExecutionSessions = new Set<string>();
    private readonly _dirtyExecutionSessions = new Set<string>();
    private _executionSaveTimer: ReturnType<typeof setTimeout> | undefined;
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

    getExecutionEntries(sessionId: string): ExecutionHistoryEntry[] {
        return this._loadExecutionEntries(sessionId).map(entry => {
            const copy: ExecutionHistoryEntry = {
                ...entry,
                output: typeof entry.output === 'string' ? entry.output : { ...entry.output },
            };
            // Omit absent optional fields, including those introduced by loading
            // a legacy record. An own property set to undefined is not equivalent.
            if (entry.outputs?.some(output => output.outputId !== undefined)) {
                copy.outputs = entry.outputs.map(output => ({ ...output }));
            } else {
                delete copy.outputs;
            }
            if (entry.error) {
                copy.error = { ...entry.error, traceback: [...entry.error.traceback] };
            } else {
                delete copy.error;
            }
            return copy;
        });
    }

    restoreLegacyExecutionEntries(
        sessionId: string,
        state: SerializedConsoleState,
    ): ExecutionHistoryEntry[] {
        if (this._initializedExecutionSessions.has(sessionId) ||
            this._storage.get(this._executionKey(sessionId)) !== undefined) {
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
            const outputs = item.items.flatMap<ExecutionHistoryOutput>(entry => {
                if (entry.type === 'stream') {
                    return [{ text: entry.text }];
                }
                if (entry.type === 'output' || entry.type === 'outputPlot') {
                    const text = entry.data['text/plain'];
                    return [{ outputId: entry.outputId, text: typeof text === 'string' ? text : '' }];
                }
                if (entry.type === 'outputHtml') {
                    return [{ outputId: entry.outputId, text: entry.resource ?? '' }];
                }
                return [];
            });
            entries.push({
                id: item.parentId,
                when: input?.when ?? item.items[0]?.when ?? Date.now(),
                prompt: input?.inputPrompt ?? '',
                input: input?.code ?? '',
                outputType: ExecutionEntryType.Execution,
                output: outputs.map(output => output.text).join(''),
                outputs,
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
        this._persistExecutionEntries(sessionId);
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
        this._persistExecutionEntries(sessionId);
    }

    recordExecutionOutput(
        sessionId: string,
        executionId: string,
        output: string,
        when: number = Date.now(),
        replace = false,
        outputId?: string,
    ): void {
        if (this._disposed || (!output && !outputId && !replace)) {
            return;
        }
        const entry = this._getOrCreateExecution(sessionId, executionId, when);
        const current = typeof entry.output === 'string' ? entry.output : '';
        if (!outputId && !entry.outputs) {
            entry.output = replace ? output : current + output;
        } else {
            const outputs = this._getOutputParts(entry);
            if (replace) {
                entry.outputs = [{ outputId, text: output }];
            } else if (!outputId && outputs.length > 0 && !outputs[outputs.length - 1].outputId) {
                outputs[outputs.length - 1].text += output;
            } else {
                outputs.push({ outputId, text: output });
            }
            entry.output = replace ? output : outputs.map(part => part.text).join('');
        }
        this._persistExecutionEntries(sessionId);
    }

    /** Updates every occurrence of a display ID, independent of the update's parent ID. */
    updateExecutionOutput(sessionId: string, outputId: string, text: string): boolean {
        if (this._disposed) { return false; }
        let changed = false;
        for (const entry of this._loadExecutionEntries(sessionId)) {
            if (entry.outputType !== ExecutionEntryType.Execution) { continue; }
            const outputs = this._getOutputParts(entry);
            let entryChanged = false;
            for (const output of outputs) {
                if (output.outputId === outputId) {
                    output.text = text;
                    entryChanged = true;
                }
            }
            if (entryChanged) {
                entry.output = outputs.map(output => output.text).join('');
                changed = true;
            }
        }
        if (changed) { this._persistExecutionEntries(sessionId); }
        return changed;
    }

    private _getOutputParts(entry: ExecutionHistoryEntry): ExecutionHistoryOutput[] {
        return entry.outputs ??= typeof entry.output === 'string' && entry.output
            ? [{ text: entry.output }]
            : [];
    }

    clearExecutionOutput(sessionId: string, executionId: string): void {
        const entry = this._loadExecutionEntries(sessionId)
            .find(candidate => candidate.id === executionId);
        if (!entry) {
            return;
        }
        entry.output = '';
        entry.outputs = [];
        entry.error = undefined;
        this._persistExecutionEntries(sessionId);
    }

    recordExecutionError(
        sessionId: string,
        executionId: string,
        error: ExecutionHistoryError,
        when: number = Date.now(),
    ): void {
        const entry = this._getOrCreateExecution(sessionId, executionId, when);
        entry.error = error;
        this._persistExecutionEntries(sessionId);
    }

    completeExecution(sessionId: string, executionId: string): void {
        const entry = this._loadExecutionEntries(sessionId)
            .find(candidate => candidate.id === executionId);
        if (!entry) {
            return;
        }
        entry.durationMs = Math.max(0, Date.now() - entry.when);
        this._persistExecutionEntries(sessionId);
        void this.flush();
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
        this._persistExecutionEntries(sessionId);
    }

    clearExecutionEntries(sessionId: string): void {
        this._executionEntries.set(sessionId, []);
        this._initializedExecutionSessions.add(sessionId);
        this._dirtyExecutionSessions.delete(sessionId);
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
        this._executionEntries.delete(sessionId);
        this._initializedExecutionSessions.add(sessionId);
        this._dirtyExecutionSessions.delete(sessionId);
        this._persist(this._executionKey(sessionId), undefined);
    }

    async flush(): Promise<void> {
        this._flushExecutionEntries();
        await this._writeQueue;
    }

    dispose(): void {
        if (this._disposed) { return; }
        this._flushExecutionEntries();
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

    private _loadExecutionEntries(sessionId: string): ExecutionHistoryEntry[] {
        const cached = this._executionEntries.get(sessionId);
        if (cached) {
            return cached;
        }
        const key = this._executionKey(sessionId);
        const stored = this._storage.get<unknown>(key);
        if (stored !== undefined) { this._initializedExecutionSessions.add(sessionId); }
        const entries = Array.isArray(stored)
            ? stored.filter((entry): entry is ExecutionHistoryEntry => (
                typeof entry === 'object' &&
                entry !== null &&
                typeof (entry as ExecutionHistoryEntry).id === 'string' &&
                typeof (entry as ExecutionHistoryEntry).when === 'number' &&
                typeof (entry as ExecutionHistoryEntry).input === 'string'
            )).map(entry => ({
                ...entry,
                outputs: Array.isArray(entry.outputs)
                    ? entry.outputs.filter(output => output && typeof output.text === 'string' &&
                        (output.outputId === undefined || typeof output.outputId === 'string'))
                        .map(output => ({ ...output }))
                    : undefined,
            }))
            : [];
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

    private _persistExecutionEntries(sessionId: string): void {
        if (this._disposed) { return; }
        this._initializedExecutionSessions.add(sessionId);
        this._dirtyExecutionSessions.add(sessionId);
        if (this._executionSaveTimer === undefined) {
            // Keep a bounded save interval even while output streams continuously.
            this._executionSaveTimer = setTimeout(() => this._flushExecutionEntries(), ExecutionHistorySaveDelayMs);
        }
    }

    private _flushExecutionEntries(): void {
        if (this._executionSaveTimer !== undefined) {
            clearTimeout(this._executionSaveTimer);
            this._executionSaveTimer = undefined;
        }
        for (const sessionId of this._dirtyExecutionSessions) {
            const entries = this._executionEntries.get(sessionId);
            if (entries) { this._persist(this._executionKey(sessionId), entries); }
        }
        this._dirtyExecutionSessions.clear();
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

    private _persist(
        key: string,
        value: InputHistoryEntry[] | ExecutionHistoryEntry[] | undefined,
    ): void {
        if (this._disposed) { return; }
        // Snapshot at enqueue time: later updates or clears must not mutate an
        // in-flight save. Stream output reaches here only once per batch.
        const snapshot = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
        this._writeQueue = this._writeQueue
            .then(() => this._storage.update(key, snapshot))
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

    private _executionKey(sessionId: string): string {
        return `${ExecutionHistoryKeyPrefix}${sessionId}`;
    }
}
