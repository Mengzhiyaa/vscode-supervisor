import * as vscode from "vscode";
import { createHash } from 'crypto';
import { PositronConsoleInstance, SerializedConsoleState } from "./consoleInstance";
import { SessionAttachMode } from "./interfaces/consoleService";
import type { SerializedRuntimeItem, SerializedActivityItem } from "../../shared/consoleState";
import { ConsoleRecoveryFileStore } from "./consoleRecoveryFileStore";

const ConsoleStateKeyPrefix = "vscode-supervisor.console.state.";
const ActiveConsoleSessionKey = "vscode-supervisor.console.activeSession.v1";

/** Self-imposed budget. Memento has no hard VS Code limit; 256 KB covers most
 *  interactive sessions comfortably. */
const MaxPersistedStateBytes = 256 * 1024;
/** File checkpoints retain substantially more history while remaining bounded. */
const MaxFileCheckpointBytes = 20 * 1024 * 1024;

const MaxPersistedInputHistoryEntries = 500;
/** Byte budget for the inputHistory array alone. Long commands can make 500
 *  entries surprisingly large. */
const MaxPersistedInputHistoryBytes = 64 * 1024;

/** Strings inside individual runtime/activity items are truncated to this many
 *  characters before the per-item budget pass. */
const MaxStringFieldChars = 4096;

/** Periodic checkpoint fallback for ordinary output. Execution boundaries and
 * destructive operations are flushed immediately below. */
const AutoFlushIntervalMs = 5_000;

export class ConsoleStateStore implements vscode.Disposable {
    private readonly _subscriptions = new Map<string, vscode.Disposable[]>();
    private readonly _instances = new Map<string, PositronConsoleInstance>();

    // -- Version-based dirty tracking --
    // Every markDirty() call increments the per-session dirty counter.
    // flush() records a snapshot version at the start; on successful write it
    // only marks the session as flushed when no new changes have arrived in
    // the meantime (dirtyVersion === snapshotVersion). If new changes
    // arrived, a re-flush is scheduled automatically.
    private readonly _dirtyVersion = new Map<string, number>();
    private readonly _flushedVersion = new Map<string, number>();
    /** Hashes the last content successfully written to the canonical store. */
    private readonly _lastPersistedHash = new Map<string, string>();

    /**
     * All callers share the same drain promise. In particular, shutdown must
     * not return merely because a timer-started flush is already running.
     */
    private _flushPromise: Promise<void> | undefined;
    /** Serialises state writes, clears and deletes to prevent resurrection. */
    private _storageWriteQueue: Promise<void> = Promise.resolve();

    private _autoFlushTimer: ReturnType<typeof setInterval> | undefined;

    constructor(
        private readonly _storage: vscode.Memento,
        private readonly _logChannel: vscode.LogOutputChannel,
        storageUri?: vscode.Uri,
    ) {
        this._fileStore = new ConsoleRecoveryFileStore(storageUri, _logChannel);
        this._autoFlushTimer = setInterval(() => {
            if (this._hasDirtySessions()) {
                void this.flush();
            }
        }, AutoFlushIntervalMs);
    }

    private readonly _fileStore: ConsoleRecoveryFileStore;

    async initialize(): Promise<void> {
        await this._fileStore.initialize();
        if (!this._fileStore.enabled) {
            return;
        }

        const legacyKeys = this._storage.keys()
            .filter(key => key.startsWith(ConsoleStateKeyPrefix));
        const migratedLegacyKeys: string[] = [];
        for (const key of legacyKeys) {
            const sessionId = key.slice(ConsoleStateKeyPrefix.length);
            const legacyState = this._storage.get<unknown>(key);
            if (this._fileStore.get(sessionId)) {
                migratedLegacyKeys.push(key);
            } else if (this._isSerializedConsoleState(legacyState)) {
                await this._fileStore.write(
                    sessionId,
                    this._prepareStateForStorage(legacyState, MaxFileCheckpointBytes),
                );
                migratedLegacyKeys.push(key);
            }
        }

        const hasLegacyActiveSession = this._storage.keys().includes(ActiveConsoleSessionKey);
        if (hasLegacyActiveSession && this._fileStore.getActiveSessionId() === undefined) {
            await this._fileStore.setActiveSessionId(
                this._storage.get<string>(ActiveConsoleSessionKey),
            );
        }

        // All successfully migrated Console data is now canonical in the
        // Extension Host file store. Batch removal so Memento can coalesce it.
        await Promise.all([
            ...migratedLegacyKeys.map(key => this._storage.update(key, undefined)),
            ...(hasLegacyActiveSession
                ? [this._storage.update(ActiveConsoleSessionKey, undefined)]
                : []),
        ]);
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    restore(
        instance: PositronConsoleInstance,
        attachMode: SessionAttachMode,
    ): SerializedConsoleState | undefined {
        if (attachMode === SessionAttachMode.Starting || attachMode === SessionAttachMode.Restarting) {
            void this.delete(instance.sessionId);
            return undefined;
        }

        const state = this._fileStore.get(instance.sessionId) ??
            this._storage.get<SerializedConsoleState>(this._key(instance.sessionId));
        if (!state) {
            return undefined;
        }

        try {
            instance.restoreState(state);
            if (state.version === 3) {
                const restoredState = this._prepareStateForStorage(
                    state,
                    this._fileStore.enabled ? MaxFileCheckpointBytes : MaxPersistedStateBytes,
                );
                this._lastPersistedHash.set(
                    instance.sessionId,
                    this._hashState(restoredState),
                );
            }
            return state;
        } catch (error) {
            this._logChannel.warn(`[ConsoleStateStore] Failed to restore state for ${instance.sessionId}: ${error}`);
        }
        return undefined;
    }

    bind(instance: PositronConsoleInstance): void {
        const sessionId = instance.sessionId;
        if (this._subscriptions.has(sessionId)) {
            return;
        }

        this._instances.set(sessionId, instance);

        const markDirty = () => {
            this._dirtyVersion.set(
                sessionId,
                (this._dirtyVersion.get(sessionId) ?? 0) + 1
            );
        };

        const flushDirty = () => {
            void this.flush().catch(error => {
                this._logChannel.warn(
                    `[ConsoleStateStore] Immediate flush failed for ${sessionId}: ${error}`,
                );
            });
        };

        const markDirtyAndFlush = () => {
            markDirty();
            flushDirty();
        };

        const disposables: vscode.Disposable[] = [
            instance.onDidChangePersistableState(markDirty),
            instance.onDidClearConsole(markDirtyAndFlush),
            // Execution/input-state boundaries flush already-dirty recovery
            // content but are not themselves part of serializeState().
            instance.onDidChangeInputState(flushDirty),
            instance.onDidChangeState(flushDirty),
        ];

        this._subscriptions.set(sessionId, disposables);
        // Ensures legacy v1/v2 snapshots are rewritten in the canonical v3
        // envelope even if the restored console receives no runtime events.
        this._dirtyVersion.set(sessionId, (this._dirtyVersion.get(sessionId) ?? 0) + 1);
    }

    getActiveSessionId(): string | undefined {
        return this._fileStore.getActiveSessionId() ??
            this._storage.get<string>(ActiveConsoleSessionKey);
    }

    setActiveSessionId(sessionId: string | undefined): Promise<void> {
        return this._enqueueStorageWrite(
            async () => {
                if (this._fileStore.enabled) {
                    await this._fileStore.setActiveSessionId(sessionId);
                } else if (this._storage.get<string>(ActiveConsoleSessionKey) !== sessionId) {
                    await this._storage.update(ActiveConsoleSessionKey, sessionId);
                }
            },
        );
    }

    delete(sessionId: string): Promise<void> {
        const disposables = this._subscriptions.get(sessionId);
        if (disposables) {
            disposables.forEach(d => d.dispose());
            this._subscriptions.delete(sessionId);
        }

        this._instances.delete(sessionId);
        this._dirtyVersion.delete(sessionId);
        this._flushedVersion.delete(sessionId);
        this._lastPersistedHash.delete(sessionId);
        return this._enqueueStorageWrite(
            async () => {
                if (this._fileStore.enabled) {
                    await this._fileStore.delete(sessionId);
                } else {
                    await this._storage.update(this._key(sessionId), undefined);
                }
            },
        );
    }

    /**
     * Applies the same bounded representation used for persistence before a
     * state crosses the Webview/Remote boundary.
     */
    prepareForTransport(state: SerializedConsoleState): SerializedConsoleState {
        return this._prepareStateForStorage(state);
    }

    /**
     * Flush all dirty session states to the canonical persistence store.
     *
     * Safe to call concurrently: if a flush is already in progress, the call
     * is coalesced and a re-flush is scheduled after the current one finishes
     * so that no in-flight changes are lost.
     */
    async flush(): Promise<void> {
        if (!this._flushPromise) {
            this._flushPromise = this._drainUntilStable()
                .finally(() => {
                    this._flushPromise = undefined;
                });
        }
        return this._flushPromise;
    }

    /**
     * Best-effort dispose. The primary flush happens in the normal shutdown
     * path via application.shutdown() → await flushPersistedState() which
     * runs *before* dispose(). The flush here is a fire-and-forget fallback
     * for the (rare) case where VS Code disposes the extension without
     * going through deactivate().
     */
    dispose(): void {
        if (this._autoFlushTimer) {
            clearInterval(this._autoFlushTimer);
            this._autoFlushTimer = undefined;
        }
        // Best-effort: not awaited, may not complete before process exit.
        void this.flush();

        for (const disposables of this._subscriptions.values()) {
            disposables.forEach(d => d.dispose());
        }
        this._subscriptions.clear();
        this._instances.clear();
        this._dirtyVersion.clear();
        this._flushedVersion.clear();
        this._lastPersistedHash.clear();
    }

    // -----------------------------------------------------------------------
    // Private: flush implementation
    // -----------------------------------------------------------------------

    private async _drainUntilStable(): Promise<void> {
        let iterations = 0;
        do {
            await this._doFlush();
            // Includes delete/clear writes that may not have a dirty instance.
            await this._storageWriteQueue;
            iterations += 1;
            if (iterations >= 3 && this._hasDirtySessions()) {
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                iterations = 0;
            }
        } while (this._hasDirtySessions());
    }

    private async _doFlush(): Promise<void> {
        const writePromises: Promise<void>[] = [];

        for (const instance of this._instances.values()) {
            const sid = instance.sessionId;
            const dirty = this._dirtyVersion.get(sid) ?? 0;
            const flushed = this._flushedVersion.get(sid) ?? 0;

            if (dirty <= flushed) {
                continue;
            }

            const snapshotVersion = dirty;

            try {
                const serializedState = instance.serializeState();
                const state = this._prepareStateForStorage(serializedState);
                const fileState = this._prepareStateForStorage(
                    { ...serializedState, inputHistory: [] },
                    MaxFileCheckpointBytes,
                );
                // Session input history has its own canonical file store. It
                // remains on the in-memory state sent to the Webview, but is
                // not duplicated in the Console recovery checkpoint.
                const sizeBytes = this._estimateStateBytes(state);
                const persistedState = this._fileStore.enabled ? fileState : state;
                const contentHash = this._hashState(persistedState);

                if (this._lastPersistedHash.get(sid) === contentHash) {
                    if ((this._dirtyVersion.get(sid) ?? 0) === snapshotVersion) {
                        this._flushedVersion.set(sid, snapshotVersion);
                    }
                    this._logChannel.debug(
                        `[ConsoleStateStore] Skipped unchanged state for ${sid}`,
                    );
                    continue;
                }

                const p = this._enqueueStorageWrite(
                    async () => {
                        if (this._fileStore.enabled) {
                            await this._fileStore.write(sid, fileState, contentHash);
                        } else {
                            await this._storage.update(this._key(sid), state);
                        }
                    },
                )
                    .then(() => {
                        this._lastPersistedHash.set(sid, contentHash);
                        // Only mark flushed if no new changes arrived since
                        // the snapshot was taken.
                        if ((this._dirtyVersion.get(sid) ?? 0) === snapshotVersion) {
                            this._flushedVersion.set(sid, snapshotVersion);
                        }
                        this._logChannel.debug(
                            `[ConsoleStateStore] Flushed ${sid}: ${sizeBytes} bytes, ` +
                            `${state.items.length} items, ${state.inputHistory.length} history`
                        );
                    })
                    .catch((error) => {
                        this._logChannel.warn(
                            `[ConsoleStateStore] Failed to persist state for ${sid}: ${error}`
                        );
                        throw error;
                    });

                writePromises.push(p);
            } catch (error) {
                this._logChannel.warn(
                    `[ConsoleStateStore] Failed to serialize state for ${sid}: ${error}`
                );
                throw error;
            }
        }

        if (writePromises.length > 0) {
            await Promise.all(writePromises);
        }
    }

    private _enqueueStorageWrite(operation: () => Thenable<void>): Promise<void> {
        const queued = this._storageWriteQueue.then(
            () => Promise.resolve(operation()),
            () => Promise.resolve(operation()),
        );
        // Keep the internal queue usable after a failed operation while still
        // returning the original rejection to the caller that owns the write.
        this._storageWriteQueue = queued.catch(() => undefined);
        return queued;
    }

    // -----------------------------------------------------------------------
    // Private: state preparation / truncation
    // -----------------------------------------------------------------------

    /**
     * Prepare serialized state so it fits within the Memento byte budget.
     *
     * Strategy (progressive, most → least aggressive):
     *   1. Trim inputHistory by count and bytes.
     *   2. Truncate long *string values* inside each runtime item (but never
     *      trim structural arrays like `SerializedRuntimeActivity.items`).
     *   3. Remove the oldest top-level runtime items one by one.
     *   4. If still over budget (extremely large inputHistory), trim history
     *      entries from the oldest end.
     */
    private _prepareStateForStorage(
        state: SerializedConsoleState,
        maxBytes: number = MaxPersistedStateBytes,
    ): SerializedConsoleState {
        let prepared: SerializedConsoleState = {
            ...state,
            inputHistory: this._trimInputHistory(state.inputHistory),
        };
        let truncatedBefore = prepared.truncatedBefore === true;

        let sizeBytes = this._estimateStateBytes(prepared);
        if (sizeBytes <= maxBytes) {
            return prepared;
        }

        // Phase 1: truncate long string values inside each item.
        prepared = {
            ...prepared,
            items: prepared.items.map(item => this._truncateItemStrings(item)),
        };

        sizeBytes = this._estimateStateBytes(prepared);
        if (sizeBytes <= maxBytes) {
            return prepared;
        }

        // Phase 2: remove oldest top-level items until within budget.
        // Pre-compute per-item sizes (in UTF-8 bytes, matching
        // _estimateStateBytes) to avoid O(n²) re-serialisation.
        const itemSizes = prepared.items.map(item => {
            try { return Buffer.byteLength(JSON.stringify(item), 'utf8'); } catch { return 0; }
        });
        let runningSize = sizeBytes;
        let removeCount = 0;

        while (removeCount < prepared.items.length && runningSize > maxBytes) {
            runningSize -= itemSizes[removeCount];
            removeCount++;
        }

        if (removeCount > 0) {
            truncatedBefore = true;
            prepared = {
                ...prepared,
                items: prepared.items.slice(removeCount),
                truncatedBefore,
            };
        }

        // Precise re-check: the per-item byte estimates above don't account
        // for JSON structural overhead (array commas, brackets) so the
        // running total may drift slightly.  Do one exact measurement and,
        // if still over budget, continue removing oldest items one by one.
        sizeBytes = this._estimateStateBytes(prepared);
        if (sizeBytes <= maxBytes) {
            return prepared;
        }

        while (prepared.items.length > 0 && sizeBytes > maxBytes) {
            truncatedBefore = true;
            prepared = { ...prepared, items: prepared.items.slice(1) };
            sizeBytes = this._estimateStateBytes(prepared);
        }

        if (truncatedBefore && prepared.truncatedBefore !== true) {
            prepared = { ...prepared, truncatedBefore: true };
        }

        // Phase 3: last resort — trim inputHistory from oldest.
        while (prepared.inputHistory.length > 0 && sizeBytes > maxBytes) {
            prepared = { ...prepared, inputHistory: prepared.inputHistory.slice(1) };
            sizeBytes = this._estimateStateBytes(prepared);
        }

        return prepared;
    }

    /**
     * Truncate long string values inside a single runtime item.
     *
     * This deliberately does NOT trim structural arrays such as
     * `SerializedRuntimeActivity.items` — those contain the child
     * input/output/error entries that define the semantic structure of the
     * activity.  Trimming them would break the restore logic which expects
     * the original input entry to be present.
     *
     * Instead, we only shorten leaf string fields (stream text, error
     * tracebacks, html, output data values, input code, trace text,
     * startup banner, etc.).  If the item is still too large after
     * truncation, the caller (Phase 2) will drop the whole item.
     */
    private _truncateItemStrings(item: SerializedRuntimeItem): SerializedRuntimeItem {
        // Quick check: if the serialised item is small, skip the work.
        try {
            if (JSON.stringify(item).length <= MaxStringFieldChars * 2) {
                return item;
            }
        } catch {
            return item;
        }

        if (item.type === 'activity' && Array.isArray(item.items)) {
            // Truncate strings inside each activity child, but keep the
            // array structure intact.
            return {
                ...item,
                items: item.items.map(child =>
                    this._truncateActivityItemStrings(child)
                ),
            };
        }

        // For non-activity top-level items, truncate any string fields.
        return this._shallowTruncateStrings(item as unknown as Record<string, unknown>) as unknown as SerializedRuntimeItem;
    }

    /**
     * Truncate string fields inside a single activity item (stream, error,
     * output, input, etc.).  Does not touch id/type/parentId.
     */
    private _truncateActivityItemStrings(
        item: SerializedActivityItem
    ): SerializedActivityItem {
        switch (item.type) {
            case 'stream':
                if (typeof item.text === 'string' && item.text.length > MaxStringFieldChars) {
                    return { ...item, text: item.text.slice(-MaxStringFieldChars) + '\n…(truncated)' };
                }
                return item;

            case 'error':
                return {
                    ...item,
                    message: this._truncStr(item.message),
                    name: this._truncStr(item.name),
                    traceback: item.traceback.length > 20
                        ? item.traceback.slice(-20).map(l => this._truncStr(l))
                        : item.traceback.map(l => this._truncStr(l)),
                };

            case 'outputHtml':
                if (typeof item.html === 'string' && item.html.length > MaxStringFieldChars) {
                    return { ...item, html: item.html.slice(0, MaxStringFieldChars) };
                }
                return item;

            case 'output':
            case 'outputPlot':
                // data is Record<string, string|undefined> — truncate each value.
                if (item.data && typeof item.data === 'object') {
                    const truncatedData: Record<string, string | undefined> = {};
                    for (const [mime, value] of Object.entries(item.data)) {
                        truncatedData[mime] = typeof value === 'string'
                            ? this._truncStr(value)
                            : value;
                    }
                    return { ...item, data: truncatedData };
                }
                return item;

            case 'input':
                if (typeof item.code === 'string' && item.code.length > MaxStringFieldChars) {
                    return { ...item, code: item.code.slice(0, MaxStringFieldChars) + '\n…(truncated)' };
                }
                return item;

            case 'prompt':
                return item;

            default:
                return item;
        }
    }

    /**
     * Shallow-truncate all string properties on a plain object.
     * Used for non-activity runtime items (trace, startup, pendingInput, etc.).
     */
    private _shallowTruncateStrings<T extends Record<string, unknown>>(obj: T): T {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string' && value.length > MaxStringFieldChars) {
                result[key] = value.slice(0, MaxStringFieldChars) + '…(truncated)';
            } else {
                result[key] = value;
            }
        }
        return result as T;
    }

    private _truncStr(s: string): string {
        if (s.length > MaxStringFieldChars) {
            return s.slice(0, MaxStringFieldChars) + '…(truncated)';
        }
        return s;
    }

    // -----------------------------------------------------------------------
    // Private: inputHistory trimming
    // -----------------------------------------------------------------------

    /**
     * Trim inputHistory by entry count first, then by total byte budget.
     * Removes oldest entries so that the most recent commands survive.
     */
    private _trimInputHistory(history: string[]): string[] {
        // Trim by count (keep newest).
        const trimmed = history.slice(-MaxPersistedInputHistoryEntries);

        // Trim by bytes (rough UTF-16 estimate: 2 bytes per char).
        // Use an index instead of repeatedly slicing to avoid O(n) array
        // copies per removed entry.
        let totalBytes = 0;
        for (const entry of trimmed) {
            totalBytes += entry.length * 2;
        }

        let startIndex = 0;
        while (startIndex < trimmed.length && totalBytes > MaxPersistedInputHistoryBytes) {
            totalBytes -= trimmed[startIndex].length * 2;
            startIndex++;
        }

        return startIndex > 0 ? trimmed.slice(startIndex) : trimmed;
    }

    // -----------------------------------------------------------------------
    // Private: helpers
    // -----------------------------------------------------------------------

    private _hasDirtySessions(): boolean {
        for (const [sid, dirty] of this._dirtyVersion) {
            if (dirty > (this._flushedVersion.get(sid) ?? 0)) {
                return true;
            }
        }
        return false;
    }

    private _estimateStateBytes(state: SerializedConsoleState): number {
        try {
            return Buffer.byteLength(JSON.stringify(state), "utf8");
        } catch {
            return Number.MAX_SAFE_INTEGER;
        }
    }

    private _hashState(state: SerializedConsoleState): string {
        return createHash('sha256')
            .update(JSON.stringify(state), 'utf8')
            .digest('hex');
    }

    private _isSerializedConsoleState(value: unknown): value is SerializedConsoleState {
        if (!value || typeof value !== 'object') {
            return false;
        }
        const state = value as Partial<SerializedConsoleState>;
        return (state.version === 1 || state.version === 2 || state.version === 3) &&
            Array.isArray(state.items) &&
            Array.isArray(state.inputHistory) &&
            typeof state.trace === 'boolean' &&
            typeof state.wordWrap === 'boolean';
    }

    private _key(sessionId: string): string {
        return `${ConsoleStateKeyPrefix}${sessionId}`;
    }
}
