/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *  Ported to vscode-ark by the vscode-ark team.
 *--------------------------------------------------------------------------------------------*/

/**
 * ThrottledEmitter class.
 * A simple event emitter that throttles event firing to prevent performance issues
 * when events occur at a high frequency.
 *
 * The throttle threshold specifies how many events can be fired during the throttle interval
 * before throttling will occur. As long as fewer than throttle threshold events are occurring
 * every throttle interval ms, events will be fired in real time. When the throttle threshold is
 * exceeded during the throttle interval in ms, events will be fired at the throttle interval
 * thereafter until event delivery slows down.
 */
export class ThrottledEmitter<T> {
    //#region Private Properties

    /**
     * Gets or sets the throttle threshold.
     */
    private readonly _throttleThreshold: number;

    /**
     * Gets or sets the throttle interval.
     */
    private readonly _throttleInterval: number;

    /**
     * Gets or sets the throttle event timeout.
     */
    private _throttleEventTimeout?: ReturnType<typeof setTimeout>;

    /**
     * Gets or sets the throttle history.
     */
    private _throttleHistory: number[] = [];

    /**
     * Gets or sets the last event.
     */
    private _lastEvent?: T;

    /**
     * Event listeners.
     */
    private _listeners: Set<(event: T) => void> = new Set();

    /**
     * Disposed state.
     */
    private _disposed = false;

    //#endregion Private Properties

    //#region Constructor & Dispose

    /**
     * Constructor.
     * @param throttleThreshold The throttle threshold.
     * @param throttleInterval The throttle interval in MS.
     */
    constructor(throttleThreshold: number, throttleInterval: number) {
        this._throttleThreshold = throttleThreshold;
        this._throttleInterval = throttleInterval;
    }

    /**
     * Dispose.
     */
    dispose() {
        // Clear the throttle event timeout.
        if (this._throttleEventTimeout) {
            clearTimeout(this._throttleEventTimeout);
            this._throttleEventTimeout = undefined;
        }

        // Clear listeners.
        this._listeners.clear();
        this._disposed = true;
    }

    //#endregion Constructor & Dispose

    //#region Public Properties

    /**
     * Gets the event as a subscribable function.
     */
    get event(): (listener: (event: T) => void) => { dispose: () => void } {
        return (listener: (event: T) => void) => {
            this._listeners.add(listener);
            return {
                dispose: () => {
                    this._listeners.delete(listener);
                }
            };
        };
    }

    //#endregion Public Properties

    //#region Public Methods

    /**
     * Fires the event.
     */
    public fire(event: T) {
        if (this._disposed) {
            return;
        }

        // Update the throttle history.
        const now = Date.now();
        const cutoff = now - this._throttleInterval;
        this._throttleHistory = this._throttleHistory.filter(time => time >= cutoff);
        this._throttleHistory.push(now);

        // If the event is being throttled, set the last event and return.
        if (this._throttleEventTimeout) {
            this._lastEvent = event;
            return;
        }

        // If the event can be fired immediately, fire it.
        if (this._throttleHistory.length < this._throttleThreshold) {
            this._fireToListeners(event);
            return;
        }

        // Set the last event and schedule the throttle event timeout.
        this._lastEvent = event;
        this._throttleEventTimeout = setTimeout(() => {
            this._throttleEventTimeout = undefined;
            if (this._lastEvent !== undefined) {
                this._fireToListeners(this._lastEvent);
            }
        }, this._throttleInterval);
    }

    //#endregion Public Methods

    //#region Private Methods

    /**
     * Fires the event to all listeners.
     */
    private _fireToListeners(event: T) {
        for (const listener of this._listeners) {
            try {
                listener(event);
            } catch (e) {
                console.error('Error in ThrottledEmitter listener:', e);
            }
        }
    }

    //#endregion Private Methods
}
