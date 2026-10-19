import { createHash } from 'crypto';
import * as vscode from 'vscode';
import type {
    SupervisorConfiguration,
    SupervisorInstanceDetail,
    SupervisorInstanceSummary,
    SupervisorManagerActionRequest,
    SupervisorManagerState,
    SupervisorSessionActionRequest,
    SupervisorSessionConnectionInfo,
} from '../shared/supervisorManager';
import { KallichoreApiInstance, KallichoreTransport } from './KallichoreApiInstance';
import { KallichoreInstances, type StoredKallichoreInstance } from './KallichoreInstances';
import type { ActiveSession, DefaultApi, ServerConfiguration, ServerStatus } from './kcclient/api';
import type { KallichoreServerState } from './ServerState';

interface CurrentSupervisor {
    getState(): KallichoreServerState | undefined;
    restart(): Promise<void>;
    shutdown(): Promise<void>;
    getSessionConnection(sessionId: string): SupervisorSessionConnectionInfo | undefined;
    reconnectSession(sessionId: string): Promise<void>;
    focusSession(sessionId: string): Promise<void>;
}

interface Inspection {
    record: StoredKallichoreInstance;
    summary: SupervisorInstanceSummary;
    api: DefaultApi;
    status?: ServerStatus;
}

/** Only these deliberately authored messages may cross the Webview RPC boundary. */
export class SupervisorManagementError extends Error {}

/** Keeps authenticated clients and lifecycle operations entirely in the extension host. */
export class SupervisorManagerService {
    private _revision = 0;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _current: CurrentSupervisor,
    ) {}

    private id(state: KallichoreServerState): string {
        return createHash('sha256')
            .update(
                JSON.stringify([
                    state.server_id,
                    state.server_pid,
                    state.socket_path,
                    state.named_pipe,
                    state.base_path,
                ]),
            )
            .digest('hex');
    }

    private async records(
        pruneExited = false,
        signal?: AbortSignal,
    ): Promise<StoredKallichoreInstance[]> {
        const records = pruneExited
            ? await KallichoreInstances.getRunningSupervisors(signal)
            : await KallichoreInstances.getRecordedSupervisors();
        const current = this._current.getState();
        if (
            current &&
            (!pruneExited ||
                KallichoreInstances.isSupervisorAlive(current.server_pid, current.socket_path))
        ) {
            const index = records.findIndex(
                (record) => record.state.server_pid === current.server_pid,
            );
            const record = {
                workspaceName: vscode.workspace.name,
                state: current,
                lastSeen: Date.now(),
            };
            if (index === -1) {
                records.push(record);
            } else {
                records[index] = { ...records[index], ...record };
            }
        }
        return records;
    }

    private createApi(state: KallichoreServerState): DefaultApi {
        const instance = new KallichoreApiInstance(state.transport ?? KallichoreTransport.TCP);
        instance.loadState(state);
        return instance.api;
    }

    private isCurrent(state: KallichoreServerState): boolean {
        const current = this._current.getState();
        return !!current && this.id(current) === this.id(state);
    }

    private verifyIdentity(state: KallichoreServerState, status: ServerStatus): void {
        if (
            state.server_pid !== status.process_id ||
            (state.server_id && status.server_id !== state.server_id)
        ) {
            throw new SupervisorManagementError(
                vscode.l10n.t('The supervisor instance changed. Refresh before trying again.'),
            );
        }
    }

    private async inspect(
        record: StoredKallichoreInstance,
        signal?: AbortSignal,
    ): Promise<Inspection> {
        const state = record.state;
        const api = this.createApi(state);
        const summary: SupervisorInstanceSummary = {
            id: this.id(state),
            workspaceName: record.workspaceName ?? vscode.l10n.t('Empty Workspace'),
            current: this.isCurrent(state),
            pid: state.server_pid,
            transport: state.transport ?? KallichoreTransport.TCP,
            reachable: false,
        };
        try {
            const { data: status } = await api.serverStatus({ timeout: 3000, signal });
            this.verifyIdentity(state, status);
            Object.assign(summary, {
                reachable: true,
                version: status.version,
                uptimeSeconds: status.uptime_seconds,
                sessionCount: status.sessions,
                busy: status.busy,
            });
            return { record, summary, api, status };
        } catch {
            // Never serialize HTTP errors: they can contain tokens, headers and response bodies.
            summary.error = vscode.l10n.t(
                'Unable to reach this recorded supervisor, or its identity has changed.',
            );
            return { record, summary, api };
        }
    }

    async getState(selectedId?: string, signal?: AbortSignal): Promise<SupervisorManagerState> {
        // Bound concurrent probes; a stale instance must not block every other instance.
        if (signal?.aborted) {
            throw new vscode.CancellationError();
        }
        const records = await this.records(true, signal);
        const inspections: Inspection[] = [];
        for (let index = 0; index < records.length; index += 4) {
            if (signal?.aborted) {
                throw new vscode.CancellationError();
            }
            inspections.push(
                ...(await Promise.all(
                    records.slice(index, index + 4).map((record) => this.inspect(record, signal)),
                )),
            );
        }
        if (signal?.aborted) {
            throw new vscode.CancellationError();
        }
        const selected =
            inspections.find((item) => item.summary.id === selectedId) ??
            inspections.find((item) => item.summary.current) ??
            inspections[0];
        const detail = selected ? await this.detail(selected, signal) : undefined;
        if (selected && detail?.sessionCounts) {
            selected.summary.sessionCount = detail.sessionCounts.total;
        }
        if (signal?.aborted) {
            throw new vscode.CancellationError();
        }
        return {
            revision: ++this._revision,
            expectedVersion:
                this._context.extension.packageJSON.positron.binaryDependencies.kallichore,
            remoteName: vscode.env.remoteName,
            trusted: vscode.workspace.isTrusted,
            mcpEnabled: vscode.workspace
                .getConfiguration('kernelSupervisor')
                .get<boolean>('mcp.enabled', false),
            instances: inspections.map((item) => item.summary),
            selectedId: selected?.summary.id,
            detail,
        };
    }

    private async detail(
        inspection: Inspection,
        signal?: AbortSignal,
    ): Promise<SupervisorInstanceDetail> {
        const { record, summary, status, api } = inspection;
        const state = record.state;
        const detail: SupervisorInstanceDetail = {
            ...summary,
            serverId: status?.server_id,
            binaryPath: state.server_path,
            // Avoid passing base URLs with credentials or query strings to the browser.
            endpoint:
                state.socket_path ??
                state.named_pipe ??
                (state.port ? `127.0.0.1:${state.port}` : ''),
            logPath: state.log_path,
            canOpenWorkspace: !!this.workspaceUri(record),
            started: status?.started,
            idleSeconds: status?.idle_seconds,
            busySeconds: status?.busy_seconds,
            sessions: [],
        };
        if (!status) {
            return detail;
        }
        if (status.mcp) {
            detail.mcp = {
                active: status.mcp.active,
                port: status.mcp.port,
                requestCount: status.mcp.request_count,
                workspaces: status.mcp.workspaces.map((workspace) => ({
                    id: workspace.id,
                    name: workspace.display_name,
                    connected: workspace.connected,
                    clients: workspace.clients.map((client) => ({
                        id: client.id,
                        name: client.name,
                        version: client.version,
                        pid: client.pid,
                        connectedAt: client.connected_at,
                    })),
                })),
            };
        }
        const [configuration, sessions] = await Promise.allSettled([
            api.getServerConfiguration({ timeout: 3000, signal }),
            api.listSessions({ timeout: 3000, signal }),
        ]);
        if (configuration.status === 'fulfilled') {
            const data = configuration.value.data;
            detail.configuration = {
                idleShutdownHours: data.idle_shutdown_hours,
                resourceSampleIntervalMs: data.resource_sample_interval_ms,
                resourceIncludeChildren: data.resource_include_children,
                logLevel: data.log_level,
            };
        } else {
            detail.configurationError = vscode.l10n.t(
                'Unable to retrieve the running configuration.',
            );
        }
        if (sessions.status === 'fulfilled') {
            detail.sessions = sessions.value.data.sessions.map((session) => {
                const connection = summary.current
                    ? this._current.getSessionConnection(session.session_id)
                    : undefined;
                let unavailableReason: string | undefined;
                if (session.status === 'exited' || connection?.clientState === 'exited') {
                    unavailableReason = vscode.l10n.t(
                        'This session has ended or was transferred to another client.',
                    );
                } else if (!summary.current) {
                    unavailableReason = vscode.l10n.t(
                        'Open the owning workspace to reconnect this session.',
                    );
                } else if (!connection) {
                    unavailableReason = vscode.l10n.t(
                        'This session is not registered in this window. Restore it from its owning workspace.',
                    );
                } else if (connection.reconnecting) {
                    unavailableReason = vscode.l10n.t('This session is already reconnecting.');
                } else if (!connection.canReconnect) {
                    unavailableReason = vscode.l10n.t(
                        'This session cannot be reconnected in its current state.',
                    );
                } else if (session.connected && !connection.connected) {
                    unavailableReason = vscode.l10n.t(
                        'Another client is connected to this session.',
                    );
                }
                return {
                    id: session.session_id,
                    name: session.display_name,
                    language: session.language,
                    mode: session.session_mode,
                    status: session.status,
                    connected: session.connected,
                    pid: session.process_id,
                    workingDirectory: session.working_directory,
                    started: session.started,
                    cpuPercent: session.resource_usage?.cpu_percent,
                    memoryBytes: session.resource_usage?.memory_bytes,
                    username: session.username,
                    notebookUri: session.notebook_uri,
                    idleSeconds: session.idle_seconds,
                    busySeconds: session.busy_seconds,
                    threadCount: session.resource_usage?.thread_count,
                    sampledAt: session.resource_usage?.timestamp,
                    managedByThisWindow: !!connection,
                    clientState: connection?.clientState,
                    canReconnect: !unavailableReason,
                    canFocus: connection?.canFocus ?? false,
                    reconnectUnavailableReason: unavailableReason,
                };
            });
            const connected = detail.sessions.filter((session) => session.connected).length;
            detail.sessionCounts = {
                total: detail.sessions.length,
                connected,
                disconnected: detail.sessions.length - connected,
                managed: detail.sessions.filter((session) => session.managedByThisWindow).length,
            };
            detail.sessionCount = detail.sessionCounts.total;
        } else {
            detail.sessionsError = vscode.l10n.t('Unable to retrieve supervisor sessions.');
        }
        return detail;
    }

    private requireTrust(): void {
        if (!vscode.workspace.isTrusted) {
            throw new SupervisorManagementError(
                vscode.l10n.t('Trust this workspace before managing kernel supervisors.'),
            );
        }
    }

    private async find(instanceId: string): Promise<StoredKallichoreInstance> {
        const record = (await this.records()).find((item) => this.id(item.state) === instanceId);
        if (!record) {
            throw new SupervisorManagementError(
                vscode.l10n.t('The supervisor instance changed. Refresh before trying again.'),
            );
        }
        return record;
    }

    private async verifiedApi(record: StoredKallichoreInstance): Promise<DefaultApi> {
        const api = this.createApi(record.state);
        try {
            this.verifyIdentity(record.state, (await api.serverStatus({ timeout: 3000 })).data);
        } catch {
            throw new SupervisorManagementError(
                vscode.l10n.t(
                    'Unable to reach this recorded supervisor, or its identity has changed.',
                ),
            );
        }
        return api;
    }

    async runAction(request: SupervisorManagerActionRequest): Promise<void> {
        if (request.action === 'openSettings') {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                `@ext:${this._context.extension.id} kernelSupervisor`,
            );
            return;
        }
        const record = await this.find(request.instanceId);
        if (request.action === 'showLogs') {
            if (!record.state.log_path) {
                throw new SupervisorManagementError(
                    vscode.l10n.t('No log file path is available for this supervisor.'),
                );
            }
            await vscode.window.showTextDocument(
                await vscode.workspace.openTextDocument(vscode.Uri.file(record.state.log_path)),
            );
            return;
        }
        if (request.action === 'openWorkspace') {
            const uri = this.workspaceUri(record);
            if (!uri) {
                throw new SupervisorManagementError(
                    vscode.l10n.t('Workspace location is unavailable.'),
                );
            }
            await vscode.commands.executeCommand('vscode.openFolder', uri, {
                forceNewWindow: true,
            });
            return;
        }
        this.requireTrust();
        if (request.action !== 'shutdown' && request.action !== 'restart') {
            throw new SupervisorManagementError('Unknown supervisor action');
        }
        if (request.action === 'restart' && !this.isCurrent(record.state)) {
            throw new SupervisorManagementError(
                vscode.l10n.t(
                    'Only the supervisor connected to this window can be restarted here.',
                ),
            );
        }
        const api = await this.verifiedApi(record);
        const label =
            request.action === 'restart' ? vscode.l10n.t('Restart') : vscode.l10n.t('Shut Down');
        const confirmed = await vscode.window.showWarningMessage(
            vscode.l10n.t(
                'This will end all sessions in the supervisor for {0}, including sessions used by other windows.',
                record.workspaceName ?? vscode.l10n.t('Empty Workspace'),
            ),
            { modal: true },
            label,
        );
        if (confirmed !== label) {
            return;
        }
        // A confirmation dialog can stay open across server changes and trust changes.
        this.requireTrust();
        await this.verifiedApi(record);
        if (this.isCurrent(record.state)) {
            try {
                if (request.action === 'restart') {
                    await this._current.restart();
                } else {
                    await this._current.shutdown();
                }
            } catch {
                throw new SupervisorManagementError(
                    request.action === 'restart'
                        ? vscode.l10n.t(
                              'Failed to restart the supervisor. Refresh and check the Supervisor log.',
                          )
                        : vscode.l10n.t(
                              'Failed to shut down the supervisor. Refresh to check its status.',
                          ),
                );
            }
        } else {
            if (request.action === 'restart') {
                throw new SupervisorManagementError(
                    vscode.l10n.t('The supervisor instance changed. Refresh before trying again.'),
                );
            }
            try {
                await api.shutdownServer({ timeout: 5000 });
            } catch {
                throw new SupervisorManagementError(
                    vscode.l10n.t(
                        'Failed to shut down the supervisor. Refresh to check its status.',
                    ),
                );
            }
            await KallichoreInstances.removeByPid(record.state.server_pid);
        }
    }

    async configure(instanceId: string, configuration: SupervisorConfiguration): Promise<void> {
        this.requireTrust();
        const record = await this.find(instanceId);
        const config: ServerConfiguration = {};
        const { idleShutdownHours, resourceSampleIntervalMs, resourceIncludeChildren, logLevel } =
            configuration;
        if (idleShutdownHours !== undefined) {
            if (
                !Number.isFinite(idleShutdownHours) ||
                (idleShutdownHours !== -1 && idleShutdownHours < 0) ||
                idleShutdownHours > 8760
            ) {
                throw new SupervisorManagementError(
                    vscode.l10n.t(
                        'Enter an idle timeout between 0 and 8760 hours, or -1 to disable it.',
                    ),
                );
            }
            config.idle_shutdown_hours = idleShutdownHours;
        }
        if (resourceSampleIntervalMs !== undefined) {
            if (
                !Number.isInteger(resourceSampleIntervalMs) ||
                resourceSampleIntervalMs < 0 ||
                resourceSampleIntervalMs > 60000
            ) {
                throw new SupervisorManagementError(
                    vscode.l10n.t('Enter a sampling interval between 0 and 60000 milliseconds.'),
                );
            }
            config.resource_sample_interval_ms = resourceSampleIntervalMs;
        }
        if (resourceIncludeChildren !== undefined) {
            if (typeof resourceIncludeChildren !== 'boolean') {
                throw new SupervisorManagementError('Invalid resource sampling option');
            }
            config.resource_include_children = resourceIncludeChildren;
        }
        if (logLevel !== undefined) {
            if (!['trace', 'debug', 'info', 'warn', 'error'].includes(logLevel)) {
                throw new SupervisorManagementError('Invalid log level');
            }
            config.log_level = logLevel;
        }
        if (!Object.keys(config).length) {
            throw new SupervisorManagementError('No configuration fields supplied');
        }
        const api = await this.verifiedApi(record);
        this.requireTrust();
        try {
            await api.setServerConfiguration(config, { timeout: 5000 });
        } catch {
            throw new SupervisorManagementError(
                vscode.l10n.t(
                    'Failed to apply the running configuration. Refresh to check the effective values.',
                ),
            );
        }
    }

    async runSessionAction(request: SupervisorSessionActionRequest): Promise<void> {
        this.requireTrust();
        const record = await this.find(request.instanceId);
        if (!this.isCurrent(record.state)) {
            throw new SupervisorManagementError(
                vscode.l10n.t('Open the owning workspace to reconnect this session.'),
            );
        }
        const api = await this.verifiedApi(record);
        let session: ActiveSession;
        try {
            session = (await api.getSession(request.sessionId, { timeout: 3000 })).data;
        } catch {
            throw new SupervisorManagementError(
                vscode.l10n.t('The session is no longer available. Refresh the session list.'),
            );
        }
        this.requireTrust();
        if (!this.isCurrent(record.state) || session.session_id !== request.sessionId) {
            throw new SupervisorManagementError(
                vscode.l10n.t('The supervisor instance changed. Refresh before trying again.'),
            );
        }
        const connection = this._current.getSessionConnection(request.sessionId);
        if (!connection) {
            throw new SupervisorManagementError(
                vscode.l10n.t(
                    'This session is not registered in this window. Restore it from its owning workspace.',
                ),
            );
        }
        if (request.action === 'focus') {
            if (!connection.canFocus) {
                throw new SupervisorManagementError(
                    vscode.l10n.t(
                        'Only console sessions managed by this window can be opened here.',
                    ),
                );
            }
            await this._current.focusSession(request.sessionId);
            return;
        }
        if (request.action !== 'reconnect') {
            throw new SupervisorManagementError('Invalid session action');
        }
        if (!connection.canReconnect || connection.reconnecting || session.status === 'exited') {
            throw new SupervisorManagementError(
                vscode.l10n.t(
                    'This session cannot be reconnected right now. Refresh the session list.',
                ),
            );
        }
        if (session.connected && !connection.connected) {
            throw new SupervisorManagementError(
                vscode.l10n.t('Another client is connected to this session.'),
            );
        }
        try {
            await this._current.reconnectSession(request.sessionId);
        } catch {
            throw new SupervisorManagementError(
                vscode.l10n.t(
                    'Failed to reconnect the session. Refresh and check the Supervisor log.',
                ),
            );
        }
    }

    private workspaceUri(record: StoredKallichoreInstance): vscode.Uri | undefined {
        const value = record.workspaceUri;
        if (!value) {
            return undefined;
        }
        try {
            const uri = vscode.Uri.parse(value, true);
            return uri.scheme === 'file' || uri.scheme === 'vscode-remote' ? uri : undefined;
        } catch {
            return undefined;
        }
    }
}
