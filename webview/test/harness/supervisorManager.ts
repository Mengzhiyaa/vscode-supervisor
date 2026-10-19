import type { SupervisorInstanceDetail, SupervisorManagerState } from '../../../src/shared/supervisorManager';
import { createRequire } from 'node:module';
import type { MockWebviewBackend } from './mockWebviewBackend';
// The Host package is CommonJS; use Playwright's require transform across the
// package boundary rather than loading its TypeScript as a native ES module.
const { SupervisorManagerRpc } = createRequire(import.meta.url)('../../../src/shared/supervisorManager.ts') as
    typeof import('../../../src/shared/supervisorManager');

/** Mock Host for exercising the management editor without a live kcserver. */
export function registerSupervisorManagerMock(backend: MockWebviewBackend): void {
    let revision = 0;
    const instances: SupervisorInstanceDetail[] = [{
        id: 'supervisor-current', workspaceName: 'Analysis workspace', current: true,
        pid: 4200, transport: 'socket', reachable: true, version: '0.1.71',
        uptimeSeconds: 7200, sessionCount: 2, busy: false, serverId: 'server-current',
        binaryPath: '/opt/supervisor/kcserver', endpoint: '/tmp/supervisor.sock',
        logPath: '/tmp/supervisor.log', canOpenWorkspace: true,
        started: '2026-01-01T08:00:00Z', idleSeconds: 120, busySeconds: 0,
        configuration: { idleShutdownHours: 2, resourceSampleIntervalMs: 1000,
            resourceIncludeChildren: true, logLevel: 'warn' },
        sessionCounts: { total: 2, connected: 1, disconnected: 1, managed: 2 },
        sessions: [{ id: 'session-python', name: 'Python', language: 'python', mode: 'console',
            status: 'idle', connected: true, pid: 4201, workingDirectory: '/workspace/analysis',
            started: '2026-01-01T08:05:00Z', cpuPercent: 0.5, memoryBytes: 128 * 1024 * 1024,
            username: 'example', managedByThisWindow: true, clientState: 'idle',
            canReconnect: true, canFocus: true, idleSeconds: 120, busySeconds: 0,
            threadCount: 4, sampledAt: Date.parse('2026-01-01T10:00:00Z') },
        { id: 'session-offline', name: 'Python offline', language: 'python', mode: 'console',
            status: 'idle', connected: false, pid: 4203, workingDirectory: '/workspace/analysis',
            started: '2026-01-01T08:10:00Z', managedByThisWindow: true, clientState: 'offline',
            canReconnect: true, canFocus: true }],
        mcp: { active: true, port: 8182, requestCount: 12,
            workspaces: [{ id: 'analysis', name: 'Analysis workspace', connected: true,
                clients: [{ id: 1, name: 'Example agent', version: '1.0', pid: 4202,
                    connectedAt: '2026-01-01T09:00:00Z' }] }] },
    }, {
        id: 'supervisor-unavailable', workspaceName: 'Previous workspace', current: false,
        pid: 4100, transport: 'socket', reachable: false,
        binaryPath: '/opt/supervisor/kcserver', endpoint: '/tmp/previous.sock',
        logPath: '/tmp/previous.log', canOpenWorkspace: true, sessions: [],
        error: 'Unable to reach this recorded supervisor, or its identity has changed.',
    }];
    let selectedId = instances[0].id;
    const state = (): SupervisorManagerState => ({
        revision: ++revision, expectedVersion: '0.1.71', trusted: true, mcpEnabled: true,
        instances: instances.map(({ id, workspaceName, current, pid, transport, reachable,
            version, uptimeSeconds, sessionCount, busy, error }) => ({
            id, workspaceName, current, pid, transport, reachable, version, uptimeSeconds, sessionCount, busy, error,
        })),
        selectedId,
        detail: instances.find(instance => instance.id === selectedId),
    });
    backend.onRequest(SupervisorManagerRpc.getState, request => {
        const requestedId = (request.params as { selectedId?: string } | undefined)?.selectedId;
        if (requestedId && instances.some(instance => instance.id === requestedId)) { selectedId = requestedId; }
        return state();
    });
    backend.onRequest(SupervisorManagerRpc.action, request => {
        const { instanceId, action } = request.params as { instanceId: string; action: string };
        const index = instances.findIndex(instance => instance.id === instanceId);
        if (index !== -1 && action === 'shutdown') {
            instances.splice(index, 1);
            selectedId = instances[0]?.id ?? '';
        } else if (index !== -1 && action === 'restart') {
            instances[index] = { ...instances[index], sessions: [], sessionCount: 0, uptimeSeconds: 0,
                sessionCounts: { total: 0, connected: 0, disconnected: 0, managed: 0 } };
        }
        return state();
    });
    backend.onRequest(SupervisorManagerRpc.configure, request => {
        const { instanceId, configuration } = request.params as {
            instanceId: string; configuration: SupervisorInstanceDetail['configuration'];
        };
        const instance = instances.find(item => item.id === instanceId);
        if (instance) { instance.configuration = { ...instance.configuration, ...configuration }; }
        return state();
    });
    backend.onRequest(SupervisorManagerRpc.sessionAction, request => {
        const { instanceId, sessionId, action } = request.params as {
            instanceId: string; sessionId: string; action: string;
        };
        const instance = instances.find(item => item.id === instanceId);
        const session = instance?.sessions.find(item => item.id === sessionId);
        if (!instance || !session) { throw new Error('Session not found'); }
        if (action === 'reconnect') {
            session.connected = true;
            session.clientState = session.status;
            const connected = instance.sessions.filter(item => item.connected).length;
            instance.sessionCounts = { total: instance.sessions.length, connected,
                disconnected: instance.sessions.length - connected,
                managed: instance.sessions.filter(item => item.managedByThisWindow).length };
        }
        return state();
    });
}
