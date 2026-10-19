<script lang="ts">
    import { onMount } from 'svelte';
    import type { MessageConnection } from 'vscode-jsonrpc/browser';
    import { getErrorMessage } from '@shared/errors';
    import { SupervisorManagerRpc, SUPERVISOR_MANAGER_REQUEST_CANCELLED, type SupervisorConfiguration, type SupervisorManagerAction,
        type SupervisorManagerState, type SupervisorSessionAction, type SupervisorSessionSummary } from '@shared/supervisorManager';
    import { getRpcConnection } from '$lib/rpc/client';
    import { localize } from '$lib/localization';

    let connection: MessageConnection | undefined;
    let managerState = $state<SupervisorManagerState>();
    let pending = $state(false);
    let error = $state<string>();
    let notice = $state<string>();
    let reconnectingSessionId = $state<string>();
    let form = $state<SupervisorConfiguration>({});
    let baseline: SupervisorConfiguration = {};
    let dirty = $state(false);
    let alive = true;
    const detail = $derived(managerState?.detail);
    const canManage = $derived(!!managerState?.trusted && !!detail?.reachable && !pending);
    const versionMismatch = $derived(!!detail?.version && detail.version !== managerState?.expectedVersion);

    function isCancelled(cause: unknown): boolean {
        return typeof cause === 'object' && cause !== null &&
            (cause as { code?: number }).code === SUPERVISOR_MANAGER_REQUEST_CANCELLED;
    }

    function applyState(next: SupervisorManagerState, resetForm = false): void {
        if (!alive || (managerState && next.revision < managerState.revision)) return;
        if (resetForm || !dirty || managerState?.selectedId !== next.selectedId) {
            form = { ...next.detail?.configuration };
            baseline = { ...form };
            dirty = false;
        }
        managerState = next;
    }

    async function refresh(selectedId?: string): Promise<void> {
        if (!connection || pending) return;
        pending = true;
        error = undefined;
        notice = undefined;
        try {
            applyState(await connection.sendRequest(SupervisorManagerRpc.getState, { selectedId }) as SupervisorManagerState);
        } catch (cause) {
            if (alive && !isCancelled(cause)) error = getErrorMessage(cause);
        } finally {
            if (alive) pending = false;
        }
    }

    async function runAction(action: SupervisorManagerAction): Promise<void> {
        if (!connection || pending || (!detail && action !== 'openSettings')) return;
        const instanceId = detail?.id ?? '';
        pending = true;
        error = undefined;
        notice = undefined;
        try {
            applyState(await connection.sendRequest(SupervisorManagerRpc.action, { instanceId, action }) as SupervisorManagerState);
        } catch (cause) {
            if (alive && !isCancelled(cause)) error = getErrorMessage(cause);
        } finally {
            if (alive) pending = false;
        }
    }

    async function runSessionAction(session: SupervisorSessionSummary, action: SupervisorSessionAction): Promise<void> {
        if (!connection || !detail || !canManage ||
            (action === 'reconnect' ? !session.canReconnect : !session.canFocus)) return;
        const instanceId = detail.id;
        pending = true;
        reconnectingSessionId = action === 'reconnect' ? session.id : undefined;
        error = undefined;
        notice = undefined;
        try {
            applyState(await connection.sendRequest(SupervisorManagerRpc.sessionAction,
                { instanceId, sessionId: session.id, action }) as SupervisorManagerState);
            if (alive && action === 'reconnect') {
                notice = localize('supervisorManager.reconnected', 'Reconnected to {0}.', session.name);
            }
        } catch (cause) {
            if (alive && !isCancelled(cause)) error = getErrorMessage(cause);
        } finally {
            if (alive) {
                pending = false;
                reconnectingSessionId = undefined;
            }
        }
    }

    async function applyConfiguration(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (!connection || !detail || !canManage || !dirty) return;
        const keys: Array<keyof SupervisorConfiguration> = [
            'idleShutdownHours', 'resourceSampleIntervalMs', 'resourceIncludeChildren', 'logLevel',
        ];
        const changed = keys.filter(key => form[key] !== baseline[key]);
        if (!changed.length) { resetForm(); return; }
        if (changed.some(key => form[key] === undefined)) {
            error = localize('supervisorManager.requiredValues', 'Enter a value for each changed setting.');
            return;
        }
        // Send only edited fields so polling or another window cannot make us
        // overwrite unrelated configuration values from an older snapshot.
        const configuration = Object.fromEntries(changed.map(key => [key, form[key]])) as SupervisorConfiguration;
        pending = true;
        error = undefined;
        notice = undefined;
        const instanceId = detail.id;
        try {
            applyState(await connection.sendRequest(SupervisorManagerRpc.configure,
                { instanceId, configuration }) as SupervisorManagerState, true);
            if (alive) notice = localize('supervisorManager.applied', 'Running configuration applied.');
        } catch (cause) {
            if (alive && !isCancelled(cause)) error = getErrorMessage(cause);
        } finally {
            if (alive) pending = false;
        }
    }

    function resetForm(): void {
        form = { ...detail?.configuration };
        baseline = { ...form };
        dirty = false;
    }

    function duration(seconds: number | undefined): string {
        if (seconds === undefined) return '—';
        const minutes = Math.floor(Math.max(0, seconds) / 60);
        if (minutes < 60) return localize('supervisorManager.minutes', '{0} min', minutes);
        const hours = Math.floor(minutes / 60);
        return localize('supervisorManager.hoursMinutes', '{0} h {1} min', hours, minutes % 60);
    }

    function date(value: string | number | undefined): string {
        if (value === undefined || value === '') return '—';
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
    }

    function memory(bytes: number | undefined): string {
        return bytes === undefined ? '—' : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
    }

    onMount(() => {
        alive = true;
        connection = getRpcConnection();
        const subscription = connection.onNotification(SupervisorManagerRpc.state, (next: SupervisorManagerState) => applyState(next));
        void refresh();
        return () => {
            alive = false;
            subscription.dispose();
            connection = undefined;
        };
    });
</script>

<main aria-busy={pending}>
    <header class="page-header">
        <div>
            <div class="eyebrow">Supervisor / kcserver</div>
            <h1>{localize('supervisorManager.title', 'Kernel Supervisor Manager')}</h1>
            <p>{localize('supervisorManager.scope', 'Inspect running supervisors recorded by this extension on the extension host.')}</p>
            {#if managerState?.remoteName}<p>{localize('supervisorManager.remote', 'Remote host: {0}', managerState.remoteName)}</p>{/if}
        </div>
        <div class="actions">
            <button disabled={pending} onclick={() => runAction('openSettings')}><span class="codicon codicon-settings-gear" aria-hidden="true"></span>{localize('supervisorManager.settings', 'Saved Settings')}</button>
            <button class="primary" disabled={pending} onclick={() => refresh()}><span class:spin={pending} class="codicon codicon-refresh" aria-hidden="true"></span>{localize('supervisorManager.refresh', 'Refresh')}</button>
        </div>
    </header>

    {#if error}<div class="banner error" role="alert">{error}</div>{/if}
    {#if notice}<div class="banner" role="status">{notice}</div>{/if}
    {#if managerState && !managerState.trusted}<div class="banner">{localize('supervisorManager.trust', 'Trust this workspace before managing kernel supervisors.')}</div>{/if}

    <div class="layout">
        <aside aria-label={localize('supervisorManager.instances', 'Running instances')}>
            <div class="section-heading"><h2>{localize('supervisorManager.instances', 'Running instances')}</h2><span class="count">{managerState?.instances.length ?? '—'}</span></div>
            <p class="hint">{localize('supervisorManager.autoRefresh', 'Automatically refreshes while this page is visible.')}</p>
            {#if !managerState && pending}<p role="status">{localize('supervisorManager.loading', 'Checking kernel supervisors…')}</p>{/if}
            {#if managerState?.instances.length === 0}<p>{localize('supervisorManager.empty', 'No running kernel supervisors were found. Start an interpreter session, then refresh.')}</p>{/if}
            <div class="instance-list">
                {#each managerState?.instances ?? [] as instance (instance.id)}
                    <button class="instance" class:selected={managerState?.selectedId === instance.id}
                        aria-pressed={managerState?.selectedId === instance.id} disabled={pending}
                        onclick={() => refresh(instance.id)}>
                        <span class="instance-name"><span class="status-dot" class:online={instance.reachable} aria-hidden="true"></span>{instance.workspaceName}</span>
                        {#if instance.current}<span class="badge">{localize('supervisorManager.current', 'This window')}</span>{/if}
                        <span class="hint">PID {instance.pid} · {instance.version ?? instance.transport}</span>
                        <span class="hint">{instance.reachable
                            ? localize('supervisorManager.sessionCount', '{0} sessions', instance.sessionCount ?? 0)
                            : localize('supervisorManager.unavailable', 'Unavailable')}</span>
                    </button>
                {/each}
            </div>
        </aside>

        <div class="details">
            {#if detail}
                <section class="card overview">
                    <div class="section-heading">
                        <div><h2>{detail.workspaceName}</h2><p class="hint">{detail.current ? localize('supervisorManager.current', 'This window') : localize('supervisorManager.otherWindow', 'Recorded workspace instance')}</p></div>
                        <span class="badge" class:warning={!detail.reachable}>{!detail.reachable
                            ? localize('supervisorManager.unavailable', 'Unavailable')
                            : detail.busy ? localize('supervisorManager.busy', 'Busy') : localize('supervisorManager.idle', 'Idle')}</span>
                    </div>
                    <div class="actions">
                        <button disabled={pending || !detail.logPath} onclick={() => runAction('showLogs')}>{localize('supervisorManager.logs', 'Show Logs')}</button>
                        {#if detail.canOpenWorkspace}<button disabled={pending} onclick={() => runAction('openWorkspace')}>{localize('supervisorManager.workspace', 'Open Workspace')}</button>{/if}
                        {#if detail.current}<button disabled={!canManage} onclick={() => runAction('restart')}>{localize('supervisorManager.restart', 'Restart')}</button>{/if}
                        <button class="danger" disabled={!canManage} onclick={() => runAction('shutdown')}>{localize('supervisorManager.shutdown', 'Shut Down')}</button>
                    </div>
                    {#if detail.error}<div class="banner error">{detail.error}</div>{/if}
                    {#if versionMismatch}<div class="banner warning">{localize('supervisorManager.versionMismatch', 'Running version {0} differs from the expected version {1}.', detail.version ?? '', managerState?.expectedVersion ?? '')}</div>{/if}
                    <div class="stats">
                        <div><span>{localize('supervisorManager.version', 'Version')}</span><strong>{detail.version ?? '—'}</strong></div>
                        <div><span>{localize('supervisorManager.uptime', 'Uptime')}</span><strong>{duration(detail.uptimeSeconds)}</strong></div>
                        <div><span>{localize('supervisorManager.sessions', 'Sessions')}</span><strong>{detail.sessionCount ?? '—'}</strong></div>
                        <div><span>{detail.busy ? localize('supervisorManager.busyTime', 'Busy duration') : localize('supervisorManager.idleTime', 'Idle duration')}</span><strong>{duration(detail.busy ? detail.busySeconds : detail.idleSeconds)}</strong></div>
                    </div>
                    <dl>
                        <dt>PID</dt><dd>{detail.pid}</dd>
                        <dt>{localize('supervisorManager.started', 'Started')}</dt><dd>{date(detail.started)}</dd>
                        <dt>{localize('supervisorManager.binary', 'Executable')}</dt><dd>{detail.binaryPath || '—'}</dd>
                        <dt>{localize('supervisorManager.transport', 'Transport')}</dt><dd>{detail.transport}</dd>
                        <dt>{localize('supervisorManager.endpoint', 'Endpoint')}</dt><dd>{detail.endpoint || '—'}</dd>
                        <dt>{localize('supervisorManager.logFile', 'Log file')}</dt><dd>{detail.logPath || '—'}</dd>
                        <dt>{localize('supervisorManager.serverId', 'Server ID')}</dt><dd>{detail.serverId ?? '—'}</dd>
                    </dl>
                </section>

                <section class="card">
                    <div class="section-heading">
                        <h2>{localize('supervisorManager.sessions', 'Sessions')}</h2>
                        <span class="count">{detail.sessionCounts?.total ?? detail.sessionCount ?? '—'}</span>
                    </div>
                    {#if detail.sessionCounts}
                        <div class="session-counts">
                            <span>{localize('supervisorManager.connectedCount', '{0} connected', detail.sessionCounts.connected)}</span>
                            <span>{localize('supervisorManager.disconnectedCount', '{0} disconnected', detail.sessionCounts.disconnected)}</span>
                            <span>{localize('supervisorManager.managedCount', '{0} managed by this window', detail.sessionCounts.managed)}</span>
                        </div>
                    {/if}
                    <p class="hint">{localize('supervisorManager.sessionResources', 'CPU and memory below belong to kernel sessions, not the kcserver process.')}</p>
                    <p class="hint">{localize('supervisorManager.reconnectHint', 'Reconnect restores the client connection without restarting the kernel. Connected means connected to any client, not necessarily this window.')}</p>
                    {#if detail.sessionsError}<p class="error" role="status">{detail.sessionsError}</p>{/if}
                    {#if detail.reachable && !detail.sessionsError && !detail.sessions.length}<p class="hint">{localize('supervisorManager.noSessions', 'No running sessions.')}</p>{/if}
                    {#if detail.sessions.length}
                        <div class="table-scroll">
                            <table>
                                <caption class="sr-only">{localize('supervisorManager.sessions', 'Sessions')}</caption>
                                <thead><tr>
                                    <th scope="col">{localize('supervisorManager.session', 'Session')}</th>
                                    <th scope="col">{localize('supervisorManager.language', 'Language / mode')}</th>
                                    <th scope="col">{localize('supervisorManager.status', 'Status')}</th>
                                    <th scope="col">PID</th><th scope="col">CPU</th>
                                    <th scope="col">{localize('supervisorManager.memory', 'Memory')}</th>
                                    <th scope="col">{localize('supervisorManager.sessionActions', 'Actions')}</th>
                                </tr></thead>
                                <tbody>{#each detail.sessions as session (session.id)}
                                    <tr>
                                        <td>
                                            <strong>{session.name}</strong><span class="cell-detail">{session.id}</span>
                                            <span class="cell-detail">{session.workingDirectory}</span>
                                            <details class="session-detail">
                                                <summary>{localize('supervisorManager.sessionDetails', 'Session details')}</summary>
                                                <dl>
                                                    <dt>{localize('supervisorManager.started', 'Started')}</dt><dd>{date(session.started)}</dd>
                                                    <dt>{localize('supervisorManager.owner', 'Owner')}</dt><dd>{session.username || '—'}</dd>
                                                    <dt>{localize('supervisorManager.clientState', 'State in this window')}</dt><dd>{session.clientState ?? '—'}</dd>
                                                    <dt>{localize('supervisorManager.idleTime', 'Idle duration')}</dt><dd>{duration(session.idleSeconds)}</dd>
                                                    <dt>{localize('supervisorManager.busyTime', 'Busy duration')}</dt><dd>{duration(session.busySeconds)}</dd>
                                                    <dt>{localize('supervisorManager.threads', 'Threads')}</dt><dd>{session.threadCount ?? '—'}</dd>
                                                    <dt>{localize('supervisorManager.sampledAt', 'Resource sample time')}</dt><dd>{date(session.sampledAt)}</dd>
                                                    {#if session.notebookUri}<dt>{localize('supervisorManager.notebook', 'Notebook')}</dt><dd>{session.notebookUri}</dd>{/if}
                                                </dl>
                                            </details>
                                        </td>
                                        <td>{session.language}<span class="cell-detail">{session.mode}</span></td>
                                        <td>{session.status}<span class="cell-detail">{session.connected ? localize('supervisorManager.connected', 'Connected') : localize('supervisorManager.disconnected', 'Disconnected')}</span></td>
                                        <td>{session.pid ?? '—'}</td><td>{session.cpuPercent === undefined ? '—' : `${session.cpuPercent.toFixed(1)}%`}</td><td>{memory(session.memoryBytes)}</td>
                                        <td class="session-operations">
                                            <div class="actions">
                                                <button disabled={!canManage || !session.canReconnect} onclick={() => runSessionAction(session, 'reconnect')}>
                                                    {reconnectingSessionId === session.id ? localize('supervisorManager.reconnecting', 'Reconnecting…') : localize('supervisorManager.reconnect', 'Reconnect')}
                                                </button>
                                                {#if session.canFocus}<button disabled={!canManage} onclick={() => runSessionAction(session, 'focus')}>{localize('supervisorManager.openConsole', 'Open Console')}</button>{/if}
                                            </div>
                                            {#if session.reconnectUnavailableReason}<span class="cell-detail">{session.reconnectUnavailableReason}</span>{/if}
                                        </td>
                                    </tr>
                                {/each}</tbody>
                            </table>
                        </div>
                    {/if}
                </section>

                <section class="card">
                    <h2>{localize('supervisorManager.configuration', 'Running configuration')}</h2>
                    <p class="hint">{localize('supervisorManager.temporary', 'Changes apply to this running instance and all its sessions. Saved settings or a restart may override them. Use Saved Settings for persistent changes.')}</p>
                    {#if detail.configurationError}<p class="error" role="status">{detail.configurationError}</p>{/if}
                    {#if detail.configuration}
                        <form onsubmit={applyConfiguration}>
                            <fieldset disabled={!canManage}>
                                <div class="form-grid">
                                    <label>{localize('supervisorManager.idleHours', 'Idle shutdown (hours)')}
                                        <input type="number" min="-1" max="8760" step="any" bind:value={form.idleShutdownHours} oninput={() => dirty = true} />
                                        <span class="hint">{localize('supervisorManager.idleHint', '-1 disables idle shutdown; 0 uses the server grace period.')}</span>
                                    </label>
                                    <label>{localize('supervisorManager.sampleInterval', 'Resource sampling (milliseconds)')}
                                        <input type="number" min="0" max="60000" step="1" bind:value={form.resourceSampleIntervalMs} oninput={() => dirty = true} />
                                        <span class="hint">{localize('supervisorManager.sampleHint', '0 disables resource sampling.')}</span>
                                    </label>
                                    <label>{localize('supervisorManager.logLevel', 'Log level')}
                                        <select bind:value={form.logLevel} onchange={() => dirty = true}>
                                            <option value={undefined} disabled>—</option>
                                            {#each ['trace', 'debug', 'info', 'warn', 'error'] as level}<option value={level}>{level}</option>{/each}
                                        </select>
                                    </label>
                                    {#if form.resourceIncludeChildren !== undefined}
                                        <label class="checkbox"><input type="checkbox" bind:checked={form.resourceIncludeChildren} onchange={() => dirty = true} />{localize('supervisorManager.children', 'Include child processes in resource usage')}</label>
                                    {/if}
                                </div>
                                <div class="actions">
                                    <button class="primary" type="submit" disabled={!canManage || !dirty}>{localize('supervisorManager.apply', 'Apply to Running Instance')}</button>
                                    <button type="button" disabled={!dirty || pending} onclick={resetForm}>{localize('supervisorManager.reset', 'Reset')}</button>
                                    {#if dirty}<span class="hint">{localize('supervisorManager.unsaved', 'Unapplied changes')}</span>{/if}
                                </div>
                            </fieldset>
                        </form>
                    {/if}
                </section>

                <section class="card">
                    <div class="section-heading"><h2>MCP</h2><span class="badge">{!detail.mcp ? localize('supervisorManager.unavailable', 'Unavailable') : detail.mcp.active ? localize('supervisorManager.active', 'Active') : localize('supervisorManager.inactive', 'Inactive')}</span></div>
                    {#if detail.current}<p class="hint">{managerState?.mcpEnabled ? localize('supervisorManager.mcpEnabled', 'MCP is enabled in this workspace.') : localize('supervisorManager.mcpDisabled', 'MCP is disabled in this workspace. Enable it in Saved Settings.')}</p>{/if}
                    {#if detail.mcp}
                        <dl><dt>{localize('supervisorManager.mcpPort', 'Listener port')}</dt><dd>{detail.mcp.port || '—'}</dd>
                            <dt>{localize('supervisorManager.mcpRequests', 'Tool calls served')}</dt><dd>{detail.mcp.requestCount}</dd></dl>
                        {#each detail.mcp.workspaces as workspace (workspace.id)}
                            <article class="mcp-workspace">
                                <div class="section-heading"><h3>{workspace.name}</h3><span class="hint">{workspace.connected ? localize('supervisorManager.connected', 'Connected') : localize('supervisorManager.disconnected', 'Disconnected')}</span></div>
                                <p class="hint">{workspace.id}</p>
                                {#if !workspace.clients.length}<p class="hint">{localize('supervisorManager.noAgents', 'No connected agents.')}</p>{/if}
                                {#each workspace.clients as client (client.id)}
                                    <div class="agent"><span class="codicon codicon-hubot" aria-hidden="true"></span><strong>{client.name ?? localize('supervisorManager.agent', 'Agent')}</strong><span>{client.version ?? ''}</span><span class="hint">PID {client.pid ?? '—'} · {date(client.connectedAt)}</span></div>
                                {/each}
                            </article>
                        {/each}
                    {:else}<p class="hint">{localize('supervisorManager.mcpUnavailable', 'MCP status is not available from this instance.')}</p>{/if}
                </section>
            {:else if managerState}
                <div class="empty-state"><span class="codicon codicon-server-process" aria-hidden="true"></span><h2>{localize('supervisorManager.emptyTitle', 'No supervisor selected')}</h2><p>{localize('supervisorManager.empty', 'No running kernel supervisors were found. Start an interpreter session, then refresh.')}</p></div>
            {/if}
        </div>
    </div>
</main>
