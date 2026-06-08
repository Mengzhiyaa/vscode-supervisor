export type LowMemoryUnit = "percent" | "megabytes";

export interface LowMemoryStatus {
    unit: LowMemoryUnit;
    threshold: number;
    remaining: number;
}

export interface MemorySessionUsage {
    sessionId: string;
    sessionName: string;
    languageId: string;
    memoryBytes: number;
    processId?: number;
}

export interface MemoryUsageSnapshot {
    timestamp: number;
    totalSystemMemory: number;
    freeSystemMemory: number;
    kernelSessions: MemorySessionUsage[];
    kernelTotalBytes: number;
    positronOverheadBytes: number;
    extensionHostOverheadBytes: number;
    otherProcessesBytes: number;
    lowMemory?: LowMemoryStatus;
}

export interface MemoryUsageState {
    enabled: boolean;
    snapshot?: MemoryUsageSnapshot;
}
