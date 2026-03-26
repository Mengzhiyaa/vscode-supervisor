import * as vscode from "vscode";
import { PositronConsoleInstance, SerializedConsoleState } from "./consoleInstance";
import { SessionAttachMode } from "./interfaces/consoleService";

const ConsoleStateKeyPrefix = "vscode-supervisor.console.state.";
const MaxPersistedStateBytes = 64 * 1024;
const MaxPersistedInputHistoryEntries = 500;

export class ConsoleStateStore implements vscode.Disposable {
    private readonly _subscriptions = new Map<string, vscode.Disposable[]>();
    private readonly _instances = new Map<string, PositronConsoleInstance>();
    private readonly _dirtySessions = new Set<string>();

    constructor(
        private readonly _storage: vscode.Memento,
        private readonly _logChannel: vscode.LogOutputChannel
    ) { }

    restore(instance: PositronConsoleInstance, attachMode: SessionAttachMode): void {
        if (attachMode === SessionAttachMode.Starting || attachMode === SessionAttachMode.Restarting) {
            this.delete(instance.sessionId);
            return;
        }

        const state = this._storage.get<SerializedConsoleState>(this._key(instance.sessionId));
        if (!state) {
            return;
        }

        try {
            instance.restoreState(state);
        } catch (error) {
            this._logChannel.warn(`[ConsoleStateStore] Failed to restore state for ${instance.sessionId}: ${error}`);
        }
    }

    bind(instance: PositronConsoleInstance): void {
        const sessionId = instance.sessionId;
        if (this._subscriptions.has(sessionId)) {
            return;
        }

        this._instances.set(sessionId, instance);

        // All state changes are kept in memory only. Memento persistence
        // happens once on dispose/flush — no intermediate writes.
        const markDirty = () => {
            this._dirtySessions.add(sessionId);
        };

        const disposables: vscode.Disposable[] = [
            instance.onDidChangeRuntimeItems(markDirty),
            instance.onDidChangePendingInput(markDirty),
            instance.onDidChangeTrace(markDirty),
            instance.onDidChangeWordWrap(markDirty),
            instance.onDidClearInputHistory(markDirty),
            instance.onDidClearConsole(markDirty),
            instance.onDidChangeInputState(markDirty),
            instance.onDidChangeState(markDirty),
            instance.onDidChangePrompt(markDirty),
            instance.onDidChangeWorkingDirectory(markDirty),
        ];

        this._subscriptions.set(sessionId, disposables);
    }

    delete(sessionId: string): void {
        const disposables = this._subscriptions.get(sessionId);
        if (disposables) {
            disposables.forEach(d => d.dispose());
            this._subscriptions.delete(sessionId);
        }

        this._instances.delete(sessionId);
        this._dirtySessions.delete(sessionId);
        void this._storage.update(this._key(sessionId), undefined);
    }

    /**
     * Flush all dirty session states to Memento. Called once on dispose.
     */
    async flush(): Promise<void> {
        const writePromises: Promise<void>[] = [];

        for (const instance of this._instances.values()) {
            if (!this._dirtySessions.has(instance.sessionId)) {
                continue;
            }

            try {
                const serializedState = instance.serializeState();
                const state = this._prepareStateForStorage(serializedState);
                const p = Promise.resolve(
                    this._storage.update(this._key(instance.sessionId), state)
                )
                    .then(() => {
                        this._dirtySessions.delete(instance.sessionId);
                    })
                    .catch((error) => {
                        this._logChannel.warn(
                            `[ConsoleStateStore] Failed to persist state for ${instance.sessionId}: ${error}`
                        );
                    });

                writePromises.push(p);
            } catch (error) {
                this._logChannel.warn(`[ConsoleStateStore] Failed to persist state for ${instance.sessionId}: ${error}`);
            }
        }

        if (writePromises.length > 0) {
            await Promise.allSettled(writePromises);
        }
    }

    dispose(): void {
        void this.flush();

        for (const disposables of this._subscriptions.values()) {
            disposables.forEach(d => d.dispose());
        }
        this._subscriptions.clear();
        this._instances.clear();
    }

    private _prepareStateForStorage(state: SerializedConsoleState): SerializedConsoleState {
        let prepared: SerializedConsoleState = {
            ...state,
            // `serializeState()` stores oldest -> newest. Keep the most recent tail.
            inputHistory: state.inputHistory.slice(-MaxPersistedInputHistoryEntries)
        };

        // Guardrail: if the payload is too large, drop heavy runtime items
        // to avoid large writes.
        const sizeBytes = this._estimateStateBytes(prepared);
        if (sizeBytes > MaxPersistedStateBytes && prepared.items.length > 0) {
            prepared = {
                ...prepared,
                items: []
            };
        }

        return prepared;
    }

    private _estimateStateBytes(state: SerializedConsoleState): number {
        try {
            return Buffer.byteLength(JSON.stringify(state), "utf8");
        } catch {
            return Number.MAX_SAFE_INTEGER;
        }
    }

    private _key(sessionId: string): string {
        return `${ConsoleStateKeyPrefix}${sessionId}`;
    }
}
