import * as vscode from 'vscode';

export interface ConsoleSyncChunk {
    sessionId: string;
    chunkId: string;
    priority: number;
    bytes: number;
    send: () => void;
}

/**
 * Application-level scheduler for Console bulk traffic. Control messages are
 * sent by the provider directly; this coordinator only admits a bounded
 * number of state chunks and waits for an explicit Webview ACK before sending
 * more. This keeps a large transcript from monopolising the RPC channel.
 */
export class ConsoleSyncCoordinator implements vscode.Disposable {
    private readonly _pending: ConsoleSyncChunk[] = [];
    private readonly _inFlight = new Map<string, ConsoleSyncChunk>();
    private readonly _inFlightBySession = new Map<string, number>();
    private readonly _ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private _disposed = false;

    constructor(
        private readonly _maxInFlight = 2,
        private readonly _maxPerSession = 1,
        private readonly _ackTimeoutMs = 10_000,
        private readonly _onAckTimeout: (chunk: ConsoleSyncChunk) => void = () => undefined,
    ) {}

    enqueue(chunk: ConsoleSyncChunk): void {
        if (this._disposed) {
            return;
        }
        this._pending.push(chunk);
        this._pending.sort((left, right) => left.priority - right.priority);
        this._pump();
    }

    acknowledge(chunkId: string): void {
        const chunk = this._inFlight.get(chunkId);
        if (!chunk) {
            return;
        }
        this._inFlight.delete(chunkId);
        const timer = this._ackTimers.get(chunkId);
        if (timer) {
            clearTimeout(timer);
            this._ackTimers.delete(chunkId);
        }
        const sessionCount = this._inFlightBySession.get(chunk.sessionId) ?? 1;
        if (sessionCount <= 1) {
            this._inFlightBySession.delete(chunk.sessionId);
        } else {
            this._inFlightBySession.set(chunk.sessionId, sessionCount - 1);
        }
        this._pump();
    }

    cancelSession(sessionId: string): void {
        for (let index = this._pending.length - 1; index >= 0; index--) {
            if (this._pending[index].sessionId === sessionId) {
                this._pending.splice(index, 1);
            }
        }
    }

    dispose(): void {
        this._disposed = true;
        this._pending.length = 0;
        this._inFlight.clear();
        this._inFlightBySession.clear();
        for (const timer of this._ackTimers.values()) {
            clearTimeout(timer);
        }
        this._ackTimers.clear();
    }

    private _pump(): void {
        if (this._disposed) {
            return;
        }
        while (this._inFlight.size < this._maxInFlight) {
            const index = this._pending.findIndex(chunk =>
                (this._inFlightBySession.get(chunk.sessionId) ?? 0) < this._maxPerSession,
            );
            if (index < 0) {
                return;
            }
            const [chunk] = this._pending.splice(index, 1);
            this._inFlight.set(chunk.chunkId, chunk);
            this._inFlightBySession.set(
                chunk.sessionId,
                (this._inFlightBySession.get(chunk.sessionId) ?? 0) + 1,
            );
            this._ackTimers.set(chunk.chunkId, setTimeout(() => {
                const timedOut = this._inFlight.get(chunk.chunkId);
                if (!timedOut) {
                    return;
                }
                this._inFlight.delete(chunk.chunkId);
                this._ackTimers.delete(chunk.chunkId);
                const count = this._inFlightBySession.get(chunk.sessionId) ?? 1;
                if (count <= 1) {
                    this._inFlightBySession.delete(chunk.sessionId);
                } else {
                    this._inFlightBySession.set(chunk.sessionId, count - 1);
                }
                this._onAckTimeout(chunk);
                this._pump();
            }, this._ackTimeoutMs));
            chunk.send();
        }
    }
}
