import * as vscode from 'vscode';

/**
 * The subset of VS Code's memento contract used by reconnect/session storage.
 *
 * VS Code extensions do not have access to Positron's application-scoped
 * EphemeralStateService. This process-global memento is the closest safe
 * equivalent available to a standalone extension: values survive extension
 * deactivate/reactivate cycles in the same extension host, but are never
 * written to disk and disappear with the extension-host process.
 */
export type EphemeralMemento = Pick<vscode.Memento, 'get' | 'update' | 'keys'>;

const EPHEMERAL_STATE_SYMBOL = Symbol.for(
    'vscode-supervisor.extensionHostEphemeralState.v1',
);

type GlobalWithEphemeralState = typeof globalThis & {
    [EPHEMERAL_STATE_SYMBOL]?: Map<string, unknown>;
};

function getProcessStore(): Map<string, unknown> {
    const processGlobal = globalThis as GlobalWithEphemeralState;
    if (!processGlobal[EPHEMERAL_STATE_SYMBOL]) {
        processGlobal[EPHEMERAL_STATE_SYMBOL] = new Map<string, unknown>();
    }
    return processGlobal[EPHEMERAL_STATE_SYMBOL];
}

class ExtensionHostEphemeralMemento implements EphemeralMemento {
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        const store = getProcessStore();
        return (store.has(key) ? store.get(key) : defaultValue) as T | undefined;
    }

    async update(key: string, value: unknown): Promise<void> {
        const store = getProcessStore();
        if (value === undefined) {
            store.delete(key);
        } else {
            store.set(key, value);
        }
    }

    keys(): readonly string[] {
        return Array.from(getProcessStore().keys());
    }
}

/** In-memory, extension-host-lifetime state shared by supervisor services. */
export const extensionHostEphemeralState: EphemeralMemento =
    new ExtensionHostEphemeralMemento();
