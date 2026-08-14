import type * as ConsoleProtocol from '../rpc/webview/console';

export const MAX_CONSOLE_RESOURCE_USAGE_HISTORY = 600;

export interface ConsoleResourceUsageSnapshot {
    sessionId: string;
    replace: boolean;
    samples: ConsoleProtocol.RuntimeResourceUsage[];
}

export interface ConsoleResourceUsagePublication {
    generation: number;
    sessions: ConsoleResourceUsageSnapshot[];
}

export type ConsoleResourceUsagePublisher = (
    publication: ConsoleResourceUsagePublication,
) => Promise<void> | void;

/**
 * Keeps resource usage history outside the webview and publishes at most one
 * unacknowledged batch at a time. Hidden surfaces accumulate a bounded history
 * and receive one replacement snapshot when they become active again.
 */
export class ConsoleResourceUsageCoordinator {
    private readonly _history = new Map<string, ConsoleProtocol.RuntimeResourceUsage[]>();
    private readonly _pendingSamples = new Map<string, ConsoleProtocol.RuntimeResourceUsage[]>();
    private _active = false;
    private _needsFullSnapshot = true;
    private _generation = 0;
    private _inFlightGeneration: number | undefined;
    private _drainScheduled = false;
    private _sending = false;
    private _disposed = false;

    constructor(private readonly _publish: ConsoleResourceUsagePublisher) {}

    record(sessionId: string, usage: ConsoleProtocol.RuntimeResourceUsage): void {
        if (this._disposed) {
            return;
        }

        this._appendBounded(this._history, sessionId, usage);
        if (this._active && !this._needsFullSnapshot) {
            this._appendBounded(this._pendingSamples, sessionId, usage);
        }
        this._scheduleDrain();
    }

    removeSession(sessionId: string): void {
        this._history.delete(sessionId);
        this._pendingSamples.delete(sessionId);
    }

    setActive(active: boolean): void {
        if (this._disposed || this._active === active) {
            return;
        }

        this._active = active;
        this._invalidatePublication();
        if (active) {
            this._scheduleDrain();
        }
    }

    resetPublication(): void {
        if (this._disposed) {
            return;
        }
        this._active = false;
        this._invalidatePublication();
    }

    acknowledge(generation: number): void {
        if (this._disposed || generation !== this._inFlightGeneration) {
            return;
        }
        this._inFlightGeneration = undefined;
        this._scheduleDrain();
    }

    dispose(): void {
        this._disposed = true;
        this._active = false;
        this._history.clear();
        this._pendingSamples.clear();
        this._inFlightGeneration = undefined;
        this._generation++;
    }

    private _appendBounded(
        target: Map<string, ConsoleProtocol.RuntimeResourceUsage[]>,
        sessionId: string,
        usage: ConsoleProtocol.RuntimeResourceUsage,
    ): void {
        let samples = target.get(sessionId);
        if (!samples) {
            samples = [];
            target.set(sessionId, samples);
        }
        samples.push(usage);
        if (samples.length > MAX_CONSOLE_RESOURCE_USAGE_HISTORY) {
            samples.splice(0, samples.length - MAX_CONSOLE_RESOURCE_USAGE_HISTORY);
        }
    }

    private _invalidatePublication(): void {
        this._generation++;
        this._inFlightGeneration = undefined;
        this._needsFullSnapshot = true;
        this._pendingSamples.clear();
    }

    private _scheduleDrain(): void {
        if (
            this._disposed ||
            !this._active ||
            this._drainScheduled ||
            this._inFlightGeneration !== undefined
        ) {
            return;
        }

        this._drainScheduled = true;
        queueMicrotask(() => {
            this._drainScheduled = false;
            void this._drain();
        });
    }

    private async _drain(): Promise<void> {
        if (
            this._disposed ||
            !this._active ||
            this._sending ||
            this._inFlightGeneration !== undefined
        ) {
            return;
        }

        const replace = this._needsFullSnapshot;
        const source = replace ? this._history : this._pendingSamples;
        const sessions = Array.from(source, ([sessionId, samples]) => ({
            sessionId,
            replace,
            samples: [...samples],
        })).filter(snapshot => snapshot.samples.length > 0);
        if (sessions.length === 0) {
            return;
        }

        if (replace) {
            this._needsFullSnapshot = false;
        } else {
            this._pendingSamples.clear();
        }

        const generation = ++this._generation;
        this._inFlightGeneration = generation;
        this._sending = true;
        try {
            await this._publish({ generation, sessions });
        } catch {
            if (this._inFlightGeneration === generation) {
                this._inFlightGeneration = undefined;
                this._needsFullSnapshot = true;
                this._pendingSamples.clear();
            }
        } finally {
            this._sending = false;
            this._scheduleDrain();
        }
    }
}
