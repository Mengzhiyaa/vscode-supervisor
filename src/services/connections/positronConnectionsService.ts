import * as vscode from 'vscode';
import { RuntimeClientState, RuntimeClientType } from '../../internal/runtimeTypes';
import type { RuntimeClientInstance } from '../../runtime/RuntimeClientInstance';
import type { RuntimeClientManager } from '../../runtime/runtimeClientManager';
import type { RuntimeSession } from '../../runtime/session';
import type { RuntimeSessionService } from '../../runtime/runtimeSession';
import {
    type ConnectionFieldSchema,
    type ConnectionMetadata,
    type ConnectionObjectSchema,
    ConnectionsBackendRequest,
    PositronConnectionsComm,
} from '../../runtime/comms/positronConnectionsComm';
import {
    createSurfaceModelId,
    SurfaceLifecycleService,
    SurfaceModelKind,
    SurfaceSourceKind,
} from '../surfaces/surfaceLifecycleService';

export interface ConnectionPathEntry extends ConnectionObjectSchema {
    readonly dtype?: string;
}

export interface PositronConnectionNode extends ConnectionPathEntry {
    readonly id: string;
    readonly path: readonly ConnectionPathEntry[];
    readonly containsData: boolean;
}

export class PositronConnectionInstance implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _children = new Map<string, readonly PositronConnectionNode[]>();
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    private _active = true;

    readonly onDidChange = this._onDidChange.event;

    constructor(
        readonly sessionId: string,
        readonly clientId: string,
        readonly metadata: ConnectionMetadata,
        private readonly _comm: PositronConnectionsComm,
        private readonly _client: RuntimeClientInstance,
    ) {
        this._disposables.push(
            this._onDidChange,
            this._comm.onDidUpdate(() => this.refresh()),
            this._comm.onDidClose(() => {
                this._active = false;
                this._children.clear();
                this._onDidChange.fire();
            }),
            this._client.onDidChangeClientState(state => {
                if (state === RuntimeClientState.Closed) {
                    this._active = false;
                    this._onDidChange.fire();
                }
            }),
        );
    }

    get id(): string {
        return `${this.sessionId}:${this.clientId}`;
    }

    get active(): boolean {
        return this._active;
    }

    get onDidFocus(): vscode.Event<Record<string, never>> {
        return this._comm.onDidFocus;
    }

    async getChildren(path: readonly ConnectionPathEntry[] = []): Promise<readonly PositronConnectionNode[]> {
        const key = JSON.stringify(path.map(entry => [entry.name, entry.kind]));
        const cached = this._children.get(key);
        if (cached) {
            return cached;
        }

        let children: readonly ConnectionPathEntry[];
        if (path.length > 0 && await this._comm.containsData(path)) {
            children = (await this._comm.listFields(path)).map((field: ConnectionFieldSchema) => ({
                name: field.name,
                kind: 'field',
                dtype: field.dtype,
                has_children: false,
            }));
        } else {
            children = await this._comm.listObjects(path);
        }

        const nodes = await Promise.all(children.map(async child => {
            const childPath = [...path, child];
            let containsData = false;
            if (child.kind !== 'field') {
                try {
                    containsData = await this._comm.containsData(childPath);
                } catch {
                    // A failed capability check must not hide the object tree.
                }
            }
            return {
                ...child,
                id: childPath.map(entry => `${entry.kind}:${entry.name}`).join('/'),
                path: childPath,
                containsData,
            };
        }));
        this._children.set(key, nodes);
        return nodes;
    }

    async preview(path: readonly ConnectionPathEntry[]): Promise<void> {
        await this._comm.previewObject(path);
    }

    refresh(): void {
        this._children.clear();
        this._onDidChange.fire();
    }

    disconnect(): void {
        this._client.dispose();
    }

    dispose(): void {
        this._comm.dispose();
        this._disposables.forEach(disposable => disposable.dispose());
    }
}

export class PositronConnectionsService implements vscode.Disposable {
    private readonly _instances = new Map<string, PositronConnectionInstance>();
    private readonly _sessionDisposables = new Map<string, vscode.Disposable[]>();
    private readonly _attachedManagers = new WeakSet<RuntimeClientManager>();
    private readonly _pendingClients = new Set<string>();
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _onDidChangeConnections = new vscode.EventEmitter<readonly PositronConnectionInstance[]>();
    private readonly _onDidFocusConnection = new vscode.EventEmitter<PositronConnectionInstance>();
    private _initialized = false;

    readonly onDidChangeConnections = this._onDidChangeConnections.event;
    readonly onDidFocusConnection = this._onDidFocusConnection.event;

    constructor(
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _lifecycle: SurfaceLifecycleService,
        private readonly _outputChannel: vscode.LogOutputChannel,
    ) {
        this._disposables.push(this._onDidChangeConnections, this._onDidFocusConnection);
    }

    get connections(): readonly PositronConnectionInstance[] {
        return [...this._instances.values()];
    }

    initialize(): void {
        if (this._initialized) {
            return;
        }
        this._initialized = true;
        this._sessionManager.sessions.forEach(session => this._attachSession(session));
        this._disposables.push(
            this._sessionManager.onDidCreateSession(session => this._attachSession(session)),
            this._sessionManager.onDidDeleteRuntimeSession(sessionId => this._detachSession(sessionId)),
        );
    }

    getConnection(id: string): PositronConnectionInstance | undefined {
        return this._instances.get(id);
    }

    private _attachSession(session: RuntimeSession): void {
        if (this._sessionDisposables.has(session.sessionId)) {
            return;
        }
        const disposables: vscode.Disposable[] = [];
        this._sessionDisposables.set(session.sessionId, disposables);
        const attachManager = (manager: RuntimeClientManager) => {
            if (this._attachedManagers.has(manager)) {
                return;
            }
            this._attachedManagers.add(manager);
            disposables.push(manager.registerClientHandler({
                clientType: RuntimeClientType.Connection,
                callback: (client, params) => {
                    void this._registerConnection(session, client, params as Record<string, unknown>);
                    return true;
                },
            }));
            for (const client of manager.clientInstances) {
                if (client.getClientType() === RuntimeClientType.Connection) {
                    void this._registerConnection(session, client, client.message.data);
                }
            }
        };
        if (session.clientManager) {
            attachManager(session.clientManager);
        }
        disposables.push(session.onDidCreateClientManager(attachManager));
    }

    private async _registerConnection(
        session: RuntimeSession,
        client: RuntimeClientInstance,
        params: Record<string, unknown>,
    ): Promise<void> {
        const id = `${session.sessionId}:${client.getClientId()}`;
        if (this._instances.has(id) || this._pendingClients.has(id)) {
            return;
        }
        this._pendingClients.add(id);
        const comm = new PositronConnectionsComm(client, {
            [ConnectionsBackendRequest.ListObjects]: { timeout: undefined },
            [ConnectionsBackendRequest.PreviewObject]: { timeout: undefined },
        });
        try {
            const metadata = isConnectionMetadata(params)
                ? params
                : await comm.getMetadata();
            const instance = new PositronConnectionInstance(
                session.sessionId,
                client.getClientId(),
                metadata,
                comm,
                client,
            );
            this._instances.set(id, instance);
            this._disposables.push(
                instance.onDidChange(() => {
                    this._updateModel(instance);
                    this._onDidChangeConnections.fire(this.connections);
                }),
                instance.onDidFocus(() => this._onDidFocusConnection.fire(instance)),
            );
            this._updateModel(instance);
            this._onDidChangeConnections.fire(this.connections);
        } catch (error) {
            comm.dispose();
            this._outputChannel.error(`[Connections] Failed to register ${id}: ${error}`);
        } finally {
            this._pendingClients.delete(id);
        }
    }

    private _updateModel(instance: PositronConnectionInstance): void {
        this._lifecycle.upsertModel({
            id: createSurfaceModelId(SurfaceModelKind.Connection, instance.sessionId, instance.clientId),
            kind: SurfaceModelKind.Connection,
            resourceId: instance.id,
            title: instance.metadata.name,
            source: {
                kind: SurfaceSourceKind.Runtime,
                id: instance.clientId,
                sessionId: instance.sessionId,
            },
            retention: 'retain-on-detach',
            payload: {
                active: instance.active,
                host: instance.metadata.host,
                connectionType: instance.metadata.type,
                languageId: instance.metadata.language_id,
            },
        });
    }

    private _detachSession(sessionId: string): void {
        this._sessionDisposables.get(sessionId)?.forEach(disposable => disposable.dispose());
        this._sessionDisposables.delete(sessionId);
        for (const [id, instance] of [...this._instances]) {
            if (instance.sessionId === sessionId) {
                instance.dispose();
                this._instances.delete(id);
            }
        }
        this._onDidChangeConnections.fire(this.connections);
    }

    dispose(): void {
        this._sessionDisposables.forEach(disposables => disposables.forEach(disposable => disposable.dispose()));
        this._sessionDisposables.clear();
        this._instances.forEach(instance => instance.dispose());
        this._instances.clear();
        this._disposables.forEach(disposable => disposable.dispose());
    }
}

function isConnectionMetadata(value: Record<string, unknown>): value is Record<string, unknown> & ConnectionMetadata {
    return typeof value.name === 'string' && typeof value.language_id === 'string';
}
