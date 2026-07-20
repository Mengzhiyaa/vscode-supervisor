import * as os from 'os';
import * as vscode from 'vscode';

export const enum MemoryInfoProviderKind {
    Local = 'local',
    Remote = 'remote',
}

export interface MemoryUsageSource {
    providerKind: MemoryInfoProviderKind;
    machineId: string;
    remoteName?: string;
}

export interface SupervisorProcessMemoryInfo {
    totalSystemMemory: number;
    freeSystemMemory: number;
    extensionHostOverheadBytes: number;
    supervisorOverheadBytes?: number;
    source: MemoryUsageSource;
}

/**
 * Supplies memory figures for the machine on which runtime processes execute.
 *
 * Keeping collection behind this interface is important for remote extension
 * hosts: callers must not silently mix local UI-process figures with remote
 * kernel figures.
 */
export interface ISupervisorMemoryInfoProvider {
    readonly source: MemoryUsageSource;
    getProcessMemoryInfo(): Promise<SupervisorProcessMemoryInfo>;
}

export class ExtensionHostMemoryInfoProvider implements ISupervisorMemoryInfoProvider {
    readonly source: MemoryUsageSource;

    constructor(remoteName = vscode.env.remoteName) {
        this.source = remoteName
            ? {
                providerKind: MemoryInfoProviderKind.Remote,
                machineId: `remote:${remoteName}`,
                remoteName,
            }
            : {
                providerKind: MemoryInfoProviderKind.Local,
                machineId: 'local-extension-host',
            };
    }

    async getProcessMemoryInfo(): Promise<SupervisorProcessMemoryInfo> {
        return {
            totalSystemMemory: os.totalmem(),
            freeSystemMemory: os.freemem(),
            extensionHostOverheadBytes: process.memoryUsage().rss,
            // The standalone extension cannot measure the VS Code platform
            // process truthfully. Leave it absent instead of reporting a fake 0.
            supervisorOverheadBytes: undefined,
            source: this.source,
        };
    }
}
