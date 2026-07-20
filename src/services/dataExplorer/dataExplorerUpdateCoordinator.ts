export const enum DataExplorerUpdateKind {
    Data = 'data',
    Schema = 'schema',
}

export type DataExplorerUpdateExecutor = (
    kind: DataExplorerUpdateKind,
    isCurrent: () => boolean,
) => Promise<void>;

/** Coalesces backend updates and suspends refreshes for hidden surfaces. */
export class DataExplorerUpdateCoordinator {
    private _pendingUpdate: DataExplorerUpdateKind | undefined;
    private _generation = 0;
    private _running = false;
    private _runningUpdate: DataExplorerUpdateKind | undefined;
    private _disposed = false;

    constructor(
        private _visible: boolean,
        private readonly _executeUpdate: DataExplorerUpdateExecutor,
    ) {}

    setVisible(visible: boolean): void {
        if (this._visible === visible || this._disposed) {
            return;
        }
        this._visible = visible;
        this._generation++;
        if (!visible && this._runningUpdate) {
            if (this._runningUpdate === DataExplorerUpdateKind.Schema || !this._pendingUpdate) {
                this._pendingUpdate = this._runningUpdate;
            }
        }
        if (visible) {
            void this._drain();
        }
    }

    schemaUpdated(): void {
        this._queue(DataExplorerUpdateKind.Schema);
    }

    dataUpdated(): void {
        this._queue(DataExplorerUpdateKind.Data);
    }

    dispose(): void {
        this._disposed = true;
        this._visible = false;
        this._pendingUpdate = undefined;
        this._generation++;
    }

    private _queue(kind: DataExplorerUpdateKind): void {
        if (this._disposed) {
            return;
        }
        if (kind === DataExplorerUpdateKind.Schema || !this._pendingUpdate) {
            this._pendingUpdate = kind;
        }
        this._generation++;
        if (this._visible) {
            void this._drain();
        }
    }

    private async _drain(): Promise<void> {
        if (this._running || !this._visible || this._disposed) {
            return;
        }
        this._running = true;
        try {
            while (this._visible && !this._disposed && this._pendingUpdate) {
                const update = this._pendingUpdate;
                const generation = this._generation;
                this._pendingUpdate = undefined;
                this._runningUpdate = update;
                await this._executeUpdate(
                    update,
                    () => !this._disposed && this._visible && generation === this._generation,
                );
                this._runningUpdate = undefined;
            }
        } finally {
            this._running = false;
            this._runningUpdate = undefined;
            if (this._visible && !this._disposed && this._pendingUpdate) {
                void this._drain();
            }
        }
    }
}
