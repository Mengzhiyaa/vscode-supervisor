import * as vscode from 'vscode';

/**
 * Global runtime client registry.
 *
 * Mirrors Positron's extHost-level registered client ID tracking so comm_data
 * can be marked as handled even when no local RuntimeClientInstance wrapper
 * exists on the frontend.
 */
const _registeredRuntimeClientIds = new Set<string>();

/**
 * Registers a runtime client instance ID as handled by extension-land code.
 */
export function registerRuntimeClientInstance(clientId: string): vscode.Disposable {
    _registeredRuntimeClientIds.add(clientId);
    return new vscode.Disposable(() => {
        _registeredRuntimeClientIds.delete(clientId);
    });
}

/**
 * Returns whether a runtime client instance ID is globally registered.
 */
export function isRuntimeClientInstanceRegistered(clientId: string): boolean {
    return _registeredRuntimeClientIds.has(clientId);
}

