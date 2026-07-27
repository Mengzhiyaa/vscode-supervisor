import * as vscode from 'vscode';
import type { IDataConnectionDriver } from '../../api';
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
import {
    DataConnection,
    DataConnectionNode,
    DataConnectionProfile,
    DataConnectionProfileStore,
    DataConnectionsDriverManager,
    DataConnectionDriver,
    getSecretParameterIds,
} from './dataConnections';

export interface ConnectionPathEntry extends ConnectionObjectSchema {
    readonly dtype?: string;
    readonly dataConnectionNode?: DataConnectionNode;
}

export interface PositronConnectionNode extends ConnectionPathEntry {
    readonly id: string;
    readonly path: readonly ConnectionPathEntry[];
    readonly containsData: boolean;
}

export interface IConnectionInstance extends vscode.Disposable {
    readonly sessionId: string;
    readonly clientId: string;
    readonly id: string;
    readonly metadata: ConnectionMetadata;
    readonly active: boolean;
    readonly onDidChange: vscode.Event<void>;
    readonly onDidFocus: vscode.Event<Record<string, never>>;
    getChildren(path?: readonly ConnectionPathEntry[]): Promise<readonly PositronConnectionNode[]>;
    preview(path: readonly ConnectionPathEntry[]): Promise<void>;
    refresh(): void;
    disconnect(): void;
}

export class PositronConnectionInstance implements IConnectionInstance {
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

class ProfileConnectionInstance implements IConnectionInstance {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    private readonly _onDidFocus = new vscode.EventEmitter<Record<string, never>>();
    private _active = true;

    readonly sessionId = 'profile';
    readonly clientId: string;
    readonly metadata: ConnectionMetadata;
    readonly onDidChange = this._onDidChange.event;
    readonly onDidFocus = this._onDidFocus.event;

    constructor(
        readonly profile: DataConnectionProfile,
        readonly driver: DataConnectionDriver,
        private readonly _handle: DataConnection,
    ) {
        this.clientId = profile.id;
        this.metadata = {
            name: profile.connectionName,
            language_id: driver.supportedLanguageIds[0] ?? 'unknown',
            type: driver.name,
            host: typeof profile.parameterValues.host === 'string' ? profile.parameterValues.host : undefined,
        };
    }

    get id(): string { return `${this.sessionId}:${this.clientId}`; }
    get active(): boolean { return this._active; }

    async getChildren(path: readonly ConnectionPathEntry[] = []): Promise<readonly PositronConnectionNode[]> {
        const parent = path.at(-1);
        const children = parent?.dataConnectionNode === undefined
            ? await this._handle.getChildren()
            : await parent.dataConnectionNode.getChildren?.() ?? [];
        return children.map(child => {
            const entry: ConnectionPathEntry = {
                name: child.name,
                kind: child.kind,
                dtype: child.dataType,
                has_children: !!child.getChildren,
                dataConnectionNode: child,
            };
            const childPath = [...path, entry];
            return {
                ...entry,
                id: childPath.map(item => `${item.kind}:${item.name}`).join('/'),
                path: childPath,
                containsData: !!child.preview,
            };
        });
    }

    async preview(path: readonly ConnectionPathEntry[]): Promise<void> {
        const node = path.at(-1)?.dataConnectionNode;
        if (!node?.preview) {
            throw new Error('The selected connection node cannot be previewed.');
        }
        await node.preview();
    }

    refresh(): void { this._onDidChange.fire(); }

    disconnect(): void {
        void this._handle.disconnect().finally(() => {
            this._active = false;
            this._onDidChange.fire();
        });
    }

    dispose(): void {
        this._active = false;
        const disposable = this._handle as DataConnection & Partial<vscode.Disposable>;
        disposable.dispose?.();
        this._onDidChange.dispose();
        this._onDidFocus.dispose();
    }
}

class StoredProfileConnectionInstance implements IConnectionInstance {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    private readonly _onDidFocus = new vscode.EventEmitter<Record<string, never>>();
    readonly sessionId = 'profile';
    readonly clientId: string;
    readonly active = false;
    readonly onDidChange = this._onDidChange.event;
    readonly onDidFocus = this._onDidFocus.event;
    readonly metadata: ConnectionMetadata;

    constructor(readonly profile: DataConnectionProfile) {
        this.clientId = profile.id;
        this.metadata = {
            name: profile.connectionName,
            language_id: 'unknown',
            type: profile.driverId,
            host: typeof profile.parameterValues.host === 'string' ? profile.parameterValues.host : undefined,
        };
    }

    get id(): string { return `profile:${this.clientId}`; }
    async getChildren(): Promise<readonly PositronConnectionNode[]> { return []; }
    async preview(): Promise<void> { throw new Error('Connect this profile before previewing data.'); }
    refresh(): void { this._onDidChange.fire(); }
    disconnect(): void { }
    dispose(): void { this._onDidChange.dispose(); this._onDidFocus.dispose(); }
}

export class PositronConnectionsService implements vscode.Disposable {
    private readonly _instances = new Map<string, IConnectionInstance>();
    private readonly _sessionDisposables = new Map<string, vscode.Disposable[]>();
    private readonly _attachedManagers = new WeakSet<RuntimeClientManager>();
    private readonly _pendingClients = new Set<string>();
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _onDidChangeConnections = new vscode.EventEmitter<readonly IConnectionInstance[]>();
    private readonly _onDidFocusConnection = new vscode.EventEmitter<IConnectionInstance>();
    private readonly _pendingProfiles = new Set<string>();
    readonly driverManager = new DataConnectionsDriverManager();
    readonly profileStore: DataConnectionProfileStore;
    private _initialized = false;

    readonly onDidChangeConnections = this._onDidChangeConnections.event;
    readonly onDidFocusConnection = this._onDidFocusConnection.event;

    constructor(
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _lifecycle: SurfaceLifecycleService,
        private readonly _outputChannel: vscode.LogOutputChannel,
        profileState: vscode.Memento,
        secretStorage: vscode.SecretStorage,
    ) {
        this.profileStore = new DataConnectionProfileStore(profileState, secretStorage);
        this._disposables.push(
            this._onDidChangeConnections,
            this._onDidFocusConnection,
            this.driverManager,
            this.profileStore,
            this.driverManager.onDidChangeDrivers(() => void this._restoreProfiles()),
            this.profileStore.onDidChangeProfiles(() => this._onDidChangeConnections.fire(this.connections)),
        );
    }

    get connections(): readonly IConnectionInstance[] {
        return [...this._instances.values()];
    }

    initialize(): void {
        if (this._initialized) {
            return;
        }
        this._initialized = true;
        for (const profile of this.profileStore.getProfiles()) {
            this._registerProfileDescriptor(profile);
        }
        void this._restoreProfiles();
        this._sessionManager.sessions.forEach(session => this._attachSession(session));
        this._disposables.push(
            this._sessionManager.onDidCreateSession(session => this._attachSession(session)),
            this._sessionManager.onDidDeleteRuntimeSession(sessionId => this._detachSession(sessionId)),
        );
    }

    getConnection(id: string): IConnectionInstance | undefined {
        return this._instances.get(id);
    }

    registerDriver(driver: DataConnectionDriver | IDataConnectionDriver): vscode.Disposable {
        return this.driverManager.registerDriver(driver);
    }

    async addUpdateProfile(profile: DataConnectionProfile, connect = true): Promise<DataConnectionProfile> {
        const driver = this.driverManager.getDriver(profile.driverId);
        if (!driver) {
            throw new Error(`Data connection driver '${profile.driverId}' is not registered.`);
        }
        const stored = await this.profileStore.addUpdateProfile(
            profile,
            getSecretParameterIds(driver, profile.mechanismId),
        );
        this._registerProfileDescriptor(stored);
        this._onDidChangeConnections.fire(this.connections);
        if (connect) {
            await this.connectProfile(stored.id);
        }
        return stored;
    }

    async connectProfile(profileId: string): Promise<IConnectionInstance> {
        const instanceId = `profile:${profileId}`;
        const existing = this._instances.get(instanceId);
        if (existing?.active) {
            return existing;
        }
        if (this._pendingProfiles.has(profileId)) {
            throw new Error(`Data connection profile '${profileId}' is already connecting.`);
        }
        const profile = await this.profileStore.getProfileWithSecrets(profileId);
        if (!profile) {
            throw new Error(`Data connection profile '${profileId}' was not found.`);
        }
        const driver = this.driverManager.getDriver(profile.driverId);
        if (!driver) {
            throw new Error(`Data connection driver '${profile.driverId}' is not registered.`);
        }
        const modelId = createSurfaceModelId(SurfaceModelKind.Connection, 'profile', profileId);
        this._pendingProfiles.add(profileId);
        this._lifecycle.setRestoreState(modelId, 'backend', 'pending');
        try {
            const handle = await driver.connect(profile.mechanismId, profile.parameterValues);
            const instance = new ProfileConnectionInstance(profile, driver, handle);
            existing?.dispose();
            this._instances.set(instance.id, instance);
            this._disposables.push(instance.onDidChange(() => {
                this._updateModel(instance);
                this._onDidChangeConnections.fire(this.connections);
            }));
            this._updateModel(instance);
            this._lifecycle.setRestoreState(modelId, 'backend', 'ready');
            profile.lastUsedAt = Date.now();
            await this.profileStore.addUpdateProfile(
                profile,
                getSecretParameterIds(driver, profile.mechanismId),
            );
            this._onDidChangeConnections.fire(this.connections);
            return instance;
        } catch (error) {
            this._lifecycle.setRestoreState(modelId, 'backend', 'failed', error);
            throw error;
        } finally {
            this._pendingProfiles.delete(profileId);
        }
    }

    async removeProfile(profileId: string): Promise<boolean> {
        const instance = this._instances.get(`profile:${profileId}`);
        instance?.dispose();
        this._instances.delete(`profile:${profileId}`);
        this._lifecycle.disposeModel(
            createSurfaceModelId(SurfaceModelKind.Connection, 'profile', profileId),
            'profile-removed',
        );
        return this.profileStore.removeProfile(profileId);
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

    private _registerProfileDescriptor(profile: DataConnectionProfile): void {
        this._lifecycle.upsertModel({
            id: createSurfaceModelId(SurfaceModelKind.Connection, 'profile', profile.id),
            kind: SurfaceModelKind.Connection,
            resourceId: `profile:${profile.id}`,
            title: profile.connectionName,
            source: { kind: SurfaceSourceKind.Extension, id: profile.driverId },
            retention: 'persistent',
            backendState: 'pending',
            payload: {
                profileId: profile.id,
                driverId: profile.driverId,
                mechanismId: profile.mechanismId,
                active: false,
            },
        });
        const instanceId = `profile:${profile.id}`;
        if (!this._instances.get(instanceId)?.active) {
            this._instances.get(instanceId)?.dispose();
            this._instances.set(instanceId, new StoredProfileConnectionInstance(profile));
        }
    }

    private async _restoreProfiles(): Promise<void> {
        for (const profile of this.profileStore.getProfiles()) {
            this._registerProfileDescriptor(profile);
            if (profile.autoConnect === false || !this.driverManager.getDriver(profile.driverId)) {
                continue;
            }
            if (this._instances.get(`profile:${profile.id}`)?.active || this._pendingProfiles.has(profile.id)) {
                continue;
            }
            try {
                await this.connectProfile(profile.id);
            } catch (error) {
                this._outputChannel.warn(`[Connections] Failed to restore profile '${profile.id}': ${error}`);
            }
        }
    }

    private _updateModel(instance: IConnectionInstance): void {
        const profileBacked = instance.sessionId === 'profile';
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
            retention: profileBacked ? 'persistent' : 'retain-on-detach',
            backendState: instance.active ? 'ready' : 'pending',
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
