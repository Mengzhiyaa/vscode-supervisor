import { execFile } from 'child_process';
import * as os from 'os';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { KallichoreInstances } from '../../supervisor/KallichoreInstances';

const execFileAsync = promisify(execFile);
const PROCESS_LIST_MAX_BUFFER = 8 * 1024 * 1024;

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
    collectionMethod: 'process-tree' | 'process-api';
    source: MemoryUsageSource;
}

export interface ProcessMemoryQuery {
    kernelProcessIds?: readonly number[];
}

export interface ProcessSnapshotEntry {
    pid: number;
    parentPid: number;
    residentBytes: number;
    command: string;
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
    getProcessMemoryInfo(query?: ProcessMemoryQuery): Promise<SupervisorProcessMemoryInfo>;
}

export class ExtensionHostMemoryInfoProvider implements ISupervisorMemoryInfoProvider {
    readonly source: MemoryUsageSource;

    constructor(
        remoteName = vscode.env.remoteName,
        private readonly _getSupervisorProcessId: () => number | undefined = () => {
            try {
                return KallichoreInstances.getCurrentWindowSupervisorPid();
            } catch {
                return undefined;
            }
        },
    ) {
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

    async getProcessMemoryInfo(query: ProcessMemoryQuery = {}): Promise<SupervisorProcessMemoryInfo> {
        try {
            const processes = await collectProcessSnapshot();
            const supervisorProcessId = this._getSupervisorProcessId();
            const kernelProcessIds = query.kernelProcessIds ?? [];
            const excludedFromExtensionHost = [
                ...kernelProcessIds,
                ...(supervisorProcessId ? [supervisorProcessId] : []),
            ];
            const extensionHostOverheadBytes = sumProcessTreeMemory(
                processes,
                process.pid,
                excludedFromExtensionHost,
            );
            const supervisorOverheadBytes = supervisorProcessId
                ? sumProcessTreeMemory(processes, supervisorProcessId, kernelProcessIds)
                : undefined;

            return {
                totalSystemMemory: os.totalmem(),
                freeSystemMemory: os.freemem(),
                extensionHostOverheadBytes: extensionHostOverheadBytes ||
                    process.memoryUsage().rss,
                supervisorOverheadBytes,
                collectionMethod: 'process-tree',
                source: this.source,
            };
        } catch {
            // Commands can be unavailable in minimal containers or restricted
            // remote hosts. Preserve a truthful process-API fallback.
        }
        return {
            totalSystemMemory: os.totalmem(),
            freeSystemMemory: os.freemem(),
            extensionHostOverheadBytes: process.memoryUsage().rss,
            supervisorOverheadBytes: undefined,
            collectionMethod: 'process-api',
            source: this.source,
        };
    }
}

export function parsePsProcessSnapshot(output: string): ProcessSnapshotEntry[] {
    const processes: ProcessSnapshotEntry[] = [];
    for (const line of output.split(/\r?\n/)) {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
        if (!match) {
            continue;
        }
        processes.push({
            pid: Number(match[1]),
            parentPid: Number(match[2]),
            residentBytes: Number(match[3]) * 1024,
            command: match[4],
        });
    }
    return processes;
}

export function sumProcessTreeMemory(
    processes: readonly ProcessSnapshotEntry[],
    rootPid: number,
    excludedRootPids: readonly number[] = [],
): number {
    const excluded = new Set(excludedRootPids);
    const children = new Map<number, ProcessSnapshotEntry[]>();
    const byPid = new Map<number, ProcessSnapshotEntry>();
    for (const processInfo of processes) {
        byPid.set(processInfo.pid, processInfo);
        const list = children.get(processInfo.parentPid) ?? [];
        list.push(processInfo);
        children.set(processInfo.parentPid, list);
    }

    let total = 0;
    const pending = [rootPid];
    const visited = new Set<number>();
    while (pending.length > 0) {
        const pid = pending.pop()!;
        if (visited.has(pid) || (pid !== rootPid && excluded.has(pid))) {
            continue;
        }
        visited.add(pid);
        const processInfo = byPid.get(pid);
        if (processInfo && !isMeasurementHelper(processInfo.command)) {
            total += Math.max(0, processInfo.residentBytes);
        }
        for (const child of children.get(pid) ?? []) {
            pending.push(child.pid);
        }
    }
    return total;
}

async function collectProcessSnapshot(): Promise<ProcessSnapshotEntry[]> {
    if (process.platform === 'win32') {
        const script = [
            'Get-CimInstance Win32_Process',
            '| Select-Object ProcessId,ParentProcessId,WorkingSetSize,Name',
            '| ConvertTo-Json -Compress',
        ].join(' ');
        const { stdout } = await execFileAsync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', script],
            { maxBuffer: PROCESS_LIST_MAX_BUFFER, encoding: 'utf8' },
        );
        const parsed = JSON.parse(stdout || '[]') as Record<string, unknown> | Record<string, unknown>[];
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        return rows.map(row => ({
            pid: Number(row.ProcessId),
            parentPid: Number(row.ParentProcessId),
            residentBytes: Number(row.WorkingSetSize),
            command: String(row.Name ?? ''),
        })).filter(row => Number.isFinite(row.pid) && Number.isFinite(row.residentBytes));
    }

    const { stdout } = await execFileAsync(
        'ps',
        ['-axo', 'pid=,ppid=,rss=,comm='],
        { maxBuffer: PROCESS_LIST_MAX_BUFFER, encoding: 'utf8' },
    );
    return parsePsProcessSnapshot(stdout);
}

function isMeasurementHelper(command: string): boolean {
    const basename = command.split(/[\\/]/).pop()?.toLowerCase();
    return basename === 'ps' || basename === 'powershell.exe' || basename === 'powershell';
}
