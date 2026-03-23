import * as vscode from 'vscode';

/**
 * Throttles event delivery once the event rate exceeds a configured threshold.
 * Mirrors the Positron console emitter behavior for runtime item changes.
 */
export class ThrottledEmitter<T> implements vscode.Disposable {
    private readonly _emitter = new vscode.EventEmitter<T>();
    private _throttleEventTimeout?: ReturnType<typeof setTimeout>;
    private _throttleHistory: number[] = [];
    private _lastEvent?: T;

    readonly event = this._emitter.event;

    constructor(
        private readonly _throttleThreshold: number,
        private readonly _throttleInterval: number,
        private readonly _merge?: (pending: T | undefined, next: T) => T,
    ) { }

    fire(event: T): void {
        const now = Date.now();
        const cutoff = now - this._throttleInterval;
        this._throttleHistory = this._throttleHistory.filter((time) => time >= cutoff);
        this._throttleHistory.push(now);

        if (this._throttleEventTimeout) {
            this._lastEvent = this._merge
                ? this._merge(this._lastEvent, event)
                : event;
            return;
        }

        if (this._throttleHistory.length < this._throttleThreshold) {
            this._emitter.fire(event);
            return;
        }

        this._lastEvent = this._merge
            ? this._merge(undefined, event)
            : event;
        this._throttleEventTimeout = setTimeout(() => {
            this._throttleEventTimeout = undefined;
            if (this._lastEvent !== undefined) {
                this._emitter.fire(this._lastEvent);
            }
        }, this._throttleInterval);
    }

    dispose(): void {
        if (this._throttleEventTimeout) {
            clearTimeout(this._throttleEventTimeout);
            this._throttleEventTimeout = undefined;
        }

        this._emitter.dispose();
    }
}
