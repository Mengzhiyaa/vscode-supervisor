import { createHash } from 'crypto';
import * as vscode from 'vscode';

/**
 * The subset of VS Code's memento contract used by reconnect/session storage.
 *
 * VS Code extensions do not have access to Positron's application-scoped
 * EphemeralStateService. In Positron that service lives outside the renderer
 * and extension host, so its values survive a window reload. A standalone
 * extension must use workspaceState to provide the same reload boundary.
 */
export type EphemeralMemento = Pick<vscode.Memento, 'get' | 'update' | 'keys'>;

const RELOAD_STATE_KEY_PREFIX = 'vscode-supervisor.reloadState.v1.';
const RELOAD_STATE_ENVELOPE_VERSION = 1;

interface ReloadScopedValue<T> {
    version: typeof RELOAD_STATE_ENVELOPE_VERSION;
    ownerEpoch: string;
    value: T;
}

function isReloadScopedValue(value: unknown): value is ReloadScopedValue<unknown> {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<ReloadScopedValue<unknown>>;
    return candidate.version === RELOAD_STATE_ENVELOPE_VERSION &&
        typeof candidate.ownerEpoch === 'string' &&
        Object.prototype.hasOwnProperty.call(candidate, 'value');
}

/**
 * Creates an identifier for the lifetime of the VS Code application process.
 *
 * VSCODE_PID and VSCODE_IPC_HOOK are inherited by replacement extension hosts,
 * so their hash remains stable across a window reload and changes when the
 * application is launched again. The parent PID is a best-effort fallback for
 * hosts that do not expose VS Code's private environment variables.
 */
export function createApplicationOwnerEpoch(
    environment: NodeJS.ProcessEnv = process.env,
    parentPid = process.ppid,
): string {
    const vscodePid = environment.VSCODE_PID?.trim() || '';
    const ipcHook = environment.VSCODE_IPC_HOOK?.trim() || '';
    const applicationIdentity = vscodePid || ipcHook
        ? `${vscodePid}\0${ipcHook}`
        : `parent:${parentPid}`;
    return createHash('sha256')
        .update(`v1\0${applicationIdentity}`)
        .digest('hex');
}

class ReloadPersistentMemento implements EphemeralMemento {
    constructor(
        private readonly _workspaceState: vscode.Memento,
        private readonly _ownerEpoch: string,
    ) {}

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        const storageKey = `${RELOAD_STATE_KEY_PREFIX}${key}`;
        const stored = this._workspaceState.get<unknown>(storageKey);
        if (
            !isReloadScopedValue(stored) ||
            stored.ownerEpoch !== this._ownerEpoch
        ) {
            if (stored !== undefined) {
                this._removeStaleValue(storageKey);
            }
            return defaultValue;
        }
        return stored.value as T;
    }

    async update(key: string, value: unknown): Promise<void> {
        const storageKey = `${RELOAD_STATE_KEY_PREFIX}${key}`;
        if (value === undefined) {
            await this._workspaceState.update(storageKey, undefined);
            return;
        }

        const stored: ReloadScopedValue<unknown> = {
            version: RELOAD_STATE_ENVELOPE_VERSION,
            ownerEpoch: this._ownerEpoch,
            value,
        };
        await this._workspaceState.update(storageKey, stored);
    }

    keys(): readonly string[] {
        const keys: string[] = [];
        for (const storageKey of this._workspaceState.keys()) {
            if (!storageKey.startsWith(RELOAD_STATE_KEY_PREFIX)) {
                continue;
            }

            const stored = this._workspaceState.get<unknown>(storageKey);
            if (
                isReloadScopedValue(stored) &&
                stored.ownerEpoch === this._ownerEpoch
            ) {
                keys.push(storageKey.slice(RELOAD_STATE_KEY_PREFIX.length));
            } else if (stored !== undefined) {
                this._removeStaleValue(storageKey);
            }
        }
        return keys;
    }

    /** Removes stale bytes without racing a current-epoch replacement value. */
    private _removeStaleValue(storageKey: string): void {
        queueMicrotask(() => {
            const current = this._workspaceState.get<unknown>(storageKey);
            if (
                current === undefined ||
                (isReloadScopedValue(current) &&
                    current.ownerEpoch === this._ownerEpoch)
            ) {
                return;
            }
            void this._workspaceState.update(storageKey, undefined).then(
                undefined,
                () => undefined,
            );
        });
    }
}

/**
 * Creates workspace-scoped state that survives replacement of the extension
 * host during a window reload. The namespace keeps reload-only state separate
 * from genuinely machine-persistent supervisor state.
 */
export function createReloadPersistentState(
    workspaceState: vscode.Memento,
    ownerEpoch = createApplicationOwnerEpoch(),
): EphemeralMemento {
    return new ReloadPersistentMemento(workspaceState, ownerEpoch);
}
