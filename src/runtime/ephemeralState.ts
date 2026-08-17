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

class ReloadPersistentMemento implements EphemeralMemento {
    constructor(private readonly _workspaceState: vscode.Memento) {}

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        const storageKey = `${RELOAD_STATE_KEY_PREFIX}${key}`;
        return this._workspaceState.get<T>(storageKey, defaultValue as T);
    }

    async update(key: string, value: unknown): Promise<void> {
        await this._workspaceState.update(`${RELOAD_STATE_KEY_PREFIX}${key}`, value);
    }

    keys(): readonly string[] {
        return this._workspaceState.keys()
            .filter((key) => key.startsWith(RELOAD_STATE_KEY_PREFIX))
            .map((key) => key.slice(RELOAD_STATE_KEY_PREFIX.length));
    }
}

/**
 * Creates workspace-scoped state that survives replacement of the extension
 * host during a window reload. The namespace keeps reload-only state separate
 * from genuinely machine-persistent supervisor state.
 */
export function createReloadPersistentState(
    workspaceState: vscode.Memento,
): EphemeralMemento {
    return new ReloadPersistentMemento(workspaceState);
}
