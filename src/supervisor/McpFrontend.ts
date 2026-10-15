/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *  Adapted from Positron's MCP workspace lifecycle for standalone VS Code.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DefaultApi, McpClient } from './kcclient/api';
import { KallichoreServerState } from './ServerState';
import { McpFrontendChannel } from './McpFrontendChannel';
import { MCP_DEFINITION_PROVIDER_ID, McpServerDefinitions } from './McpServerDefinitions';
import { MCP_TOKEN_ENV_VAR, MCP_URL_ENV_VAR, McpConnection,
    mcpDescriptorPath, removeConnectionFiles, writeConnectionFiles } from './mcpConnection';

const STATE_KEY = 'supervisor.mcp.workspace';
interface WorkspaceIdentity { workspaceId?: string; port?: number; }
interface ServerConnection { api: DefaultApi; state: KallichoreServerState; }

/** Owns one workspace registration; server connection state remains with the adapter. */
export class McpFrontend implements vscode.Disposable {
    private _server?: ServerConnection;
    private _connection?: McpConnection;
    private _channel?: McpFrontendChannel;
    private _pending = Promise.resolve();
    private _retry?: ReturnType<typeof setTimeout>;
    private _generation = 0;
    private _disposed = false;
    private _disabledFilesCleaned = false;
    private _revoked = false;
    private readonly _changed = new vscode.EventEmitter<void>();
    public readonly onDidChangeConnection = this._changed.event;
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _sessionIds: () => string[],
        private readonly _log: (message: string) => void,
    ) {
        const provider = new McpServerDefinitions(this);
        this._disposables.push(provider, this._status,
            vscode.lm.registerMcpServerDefinitionProvider(MCP_DEFINITION_PROVIDER_ID, provider),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('kernelSupervisor.mcp.enabled')) {
                    if (!this.enabled) { this.unpublish(); }
                    void this.sync();
                }
            }),
            vscode.workspace.onDidGrantWorkspaceTrust(() => { void this.sync(); }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => { void this.sync(); }),
            vscode.window.onDidChangeWindowState(state => {
                if (state.focused) { void this.sync(); }
            }),
        );
        // Environment collections survive a reload, including one with MCP off.
        this.clearEnvironment();
        void this.sync();
    }

    public get connection(): McpConnection | undefined { return this._connection; }
    private get enabled(): boolean {
        return vscode.workspace.isTrusted &&
            vscode.workspace.getConfiguration('kernelSupervisor').get<boolean>('mcp.enabled', false);
    }

    public attach(api: DefaultApi, state: KallichoreServerState): Promise<void> {
        this.detach();
        this._server = { api, state };
        return this.sync();
    }

    /** Stop reconnecting to an exited server, retaining identity for its replacement. */
    public detach(): void {
        this._generation++;
        this._server = undefined;
        this._revoked = false;
        this.unpublish();
        if (this._retry) { clearTimeout(this._retry); this._retry = undefined; }
    }

    public notifySessionsChanged(): void { this._channel?.sessionsChanged(); }

    /** Serialize registration, revocation, and file writes across settings/server changes. */
    public sync(): Promise<void> {
        this._pending = this._pending.then(() => this.syncNow()).catch(() => {
            // HTTP errors can carry Authorization headers: never serialize them.
            this._log('Could not synchronize the MCP workspace; will retry.');
            if (!this._disposed && this._server && !this._retry) {
                this._retry = setTimeout(() => {
                    this._retry = undefined;
                    void this.sync();
                }, 10000);
            }
        });
        return this._pending;
    }

    private async syncNow(): Promise<void> {
        const server = this._server;
        const generation = this._generation;
        if (this._disposed) { return; }
        const saved = this._context.workspaceState.get<WorkspaceIdentity>(STATE_KEY, {});
        if (!this.enabled) {
            this.unpublish();
            if (saved.workspaceId && !this._disabledFilesCleaned) {
                await removeConnectionFiles(this._context.globalStorageUri, { workspaceId: saved.workspaceId });
                await this._context.secrets.delete(this.secretKey(saved.workspaceId));
                this._disabledFilesCleaned = true;
            }
            if (saved.workspaceId && server && !this._revoked) {
                try {
                    await server.api.deregisterMcpWorkspace(saved.workspaceId, { timeout: 5000 });
                } catch (error) {
                    if ((error as { response?: { status: number } }).response?.status !== 404) { throw error; }
                }
                if (this.current(server, generation)) { this._revoked = true; }
            }
            return;
        }
        this._disabledFilesCleaned = false;
        this._revoked = false;
        if (!server) { return; }

        if (!this._connection) {
            const token = saved.workspaceId
                ? await this._context.secrets.get(this.secretKey(saved.workspaceId)) : undefined;
            if (!this.current(server, generation)) { return; }
            const { data } = await server.api.registerMcpWorkspace({
                display_name: vscode.workspace.name ?? vscode.l10n.t('Empty Workspace'),
                workspace_id: saved.workspaceId, preferred_port: saved.port, token,
            }, { timeout: 5000 });
            if (!this.current(server, generation)) { return; }
            // Remember the issued ID before revocation, so a failed DELETE can
            // be retried even if this was the workspace's first registration.
            await this._context.workspaceState.update(STATE_KEY, { workspaceId: data.workspace_id, port: data.port });
            if (!this.current(server, generation)) { return; }
            // A setting can change while the registration request is in flight.
            if (!this.enabled) {
                await server.api.deregisterMcpWorkspace(data.workspace_id, { timeout: 5000 });
                return;
            }
            await this._context.secrets.store(this.secretKey(data.workspace_id), data.token);
            if (!this.current(server, generation) || !this.enabled) { return; }
            this._connection = {
                workspaceId: data.workspace_id, port: data.port, token: data.token, url: data.url,
                displayName: vscode.workspace.name ?? vscode.l10n.t('Empty Workspace'), folders: [],
            };
        }

        const connection = this._connection;
        connection.folders = (vscode.workspace.workspaceFolders ?? [])
            .filter(folder => folder.uri.scheme === 'file' || folder.uri.scheme === 'vscode-remote')
            .map(folder => folder.uri.fsPath);
        await writeConnectionFiles(this._context.globalStorageUri, connection);
        if (!this.current(server, generation) || !this.enabled) { return; }
        this._context.environmentVariableCollection.replace(MCP_URL_ENV_VAR, connection.url);
        this._context.environmentVariableCollection.replace(MCP_TOKEN_ENV_VAR, connection.token);
        if (!this._channel) {
            this._channel = new McpFrontendChannel(this.channelUri(server.state, connection.workspaceId),
                { Authorization: `Bearer ${server.state.bearer_token}` },
                this._sessionIds, clients => this.setClients(clients), this._log);
            this._log(`Registered MCP workspace ${connection.workspaceId}; descriptor: ` +
                mcpDescriptorPath(this._context.globalStorageUri, connection.workspaceId));
            this._changed.fire();
        }
    }

    private current(server: ServerConnection, generation: number): boolean {
        return !this._disposed && this._server === server && this._generation === generation;
    }

    private secretKey(workspaceId: string): string { return `${STATE_KEY}.${workspaceId}.token`; }

    private channelUri(state: KallichoreServerState, workspaceId: string): string {
        const route = `/mcp/workspaces/${encodeURIComponent(workspaceId)}/channel`;
        if (state.socket_path) { return `ws+unix://${state.socket_path}:${route}`; }
        if (state.named_pipe) { return `ws+npipe://${state.named_pipe}:${route}`; }
        if (!state.base_path) { throw new Error('Missing MCP frontend base path'); }
        return `${state.base_path.replace(/^http/, 'ws').replace(/\/$/, '')}${route}`;
    }

    private setClients(clients: McpClient[]): void {
        if (!clients.length || !this.enabled || this._disposed) { this._status.hide(); return; }
        this._status.text = `$(hubot) ${clients.length}`;
        this._status.tooltip = vscode.l10n.t('{0} agents connected to this workspace', clients.length);
        this._status.show();
    }

    private clearEnvironment(): void {
        this._context.environmentVariableCollection.delete(MCP_URL_ENV_VAR);
        this._context.environmentVariableCollection.delete(MCP_TOKEN_ENV_VAR);
    }

    private unpublish(): void {
        const wasPublished = !!this._connection;
        this._channel?.dispose();
        this._channel = undefined;
        this._connection = undefined;
        this.clearEnvironment();
        if (wasPublished) { this._changed.fire(); }
    }

    public dispose(): void {
        if (this._disposed) { return; }
        this._disposed = true;
        // A detached supervisor may still be serving agents. Window teardown
        // closes only the frontend channel; disabling the setting revokes it.
        this.detach();
        this._disposables.forEach(disposable => disposable.dispose());
        this._changed.dispose();
    }
}
