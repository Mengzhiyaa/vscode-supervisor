/** Credential-free projection of supervisor state for the management surface. */
export interface SupervisorConfiguration {
    idleShutdownHours?: number;
    resourceSampleIntervalMs?: number;
    resourceIncludeChildren?: boolean;
    logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
}

export interface SupervisorInstanceSummary {
    id: string;
    workspaceName: string;
    current: boolean;
    pid: number;
    transport: string;
    reachable: boolean;
    version?: string;
    uptimeSeconds?: number;
    sessionCount?: number;
    busy?: boolean;
    error?: string;
}

export interface SupervisorSessionSummary {
    id: string;
    name: string;
    language: string;
    mode: string;
    status: string;
    connected: boolean;
    pid?: number;
    workingDirectory: string;
    started: string;
    cpuPercent?: number;
    memoryBytes?: number;
    username?: string;
    notebookUri?: string;
    idleSeconds?: number;
    busySeconds?: number;
    threadCount?: number;
    sampledAt?: number;
    managedByThisWindow: boolean;
    clientState?: string;
    canReconnect: boolean;
    canFocus: boolean;
    reconnectUnavailableReason?: string;
}

/** Local connection state, separate from kcserver's connected-to-any-client flag. */
export interface SupervisorSessionConnectionInfo {
    clientState: string;
    connected: boolean;
    reconnecting: boolean;
    canReconnect: boolean;
    canFocus: boolean;
}

export interface SupervisorInstanceDetail extends SupervisorInstanceSummary {
    serverId?: string;
    binaryPath: string;
    endpoint: string;
    logPath: string;
    canOpenWorkspace: boolean;
    started?: string;
    idleSeconds?: number;
    busySeconds?: number;
    configuration?: SupervisorConfiguration;
    configurationError?: string;
    sessions: SupervisorSessionSummary[];
    sessionsError?: string;
    sessionCounts?: { total: number; connected: number; disconnected: number; managed: number };
    mcp?: {
        active: boolean;
        port: number;
        requestCount: number;
        workspaces: Array<{
            id: string;
            name: string;
            connected: boolean;
            clients: Array<{
                id: number;
                name?: string;
                version?: string;
                pid?: number;
                connectedAt: string;
            }>;
        }>;
    };
}

export interface SupervisorManagerState {
    revision: number;
    expectedVersion: string;
    remoteName?: string;
    trusted: boolean;
    mcpEnabled: boolean;
    instances: SupervisorInstanceSummary[];
    selectedId?: string;
    detail?: SupervisorInstanceDetail;
}

export type SupervisorManagerAction =
    'showLogs' | 'openWorkspace' | 'restart' | 'shutdown' | 'openSettings';

export interface SupervisorManagerActionRequest {
    instanceId: string;
    action: SupervisorManagerAction;
}

export interface SupervisorConfigurationRequest {
    instanceId: string;
    configuration: SupervisorConfiguration;
}

export type SupervisorSessionAction = 'reconnect' | 'focus';

export interface SupervisorSessionActionRequest {
    instanceId: string;
    sessionId: string;
    action: SupervisorSessionAction;
}

// Like packageDetail, this editor uses a hand-written internal RPC domain.
export const SupervisorManagerRpc = {
    getState: 'supervisorManager/getState',
    action: 'supervisorManager/action',
    configure: 'supervisorManager/configure',
    sessionAction: 'supervisorManager/sessionAction',
    state: 'supervisorManager/state',
} as const;

export const SUPERVISOR_MANAGER_REQUEST_CANCELLED = -32800;
