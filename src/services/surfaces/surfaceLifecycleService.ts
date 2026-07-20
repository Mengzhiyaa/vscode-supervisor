import * as vscode from 'vscode';

const DefaultStorageKey = 'supervisor.surfaceModels.v1';
const MaxPersistedModels = 200;

export enum SurfaceModelKind {
    Viewer = 'viewer',
    Plot = 'plot',
    DataExplorer = 'data-explorer',
    Connection = 'connection',
    Widget = 'widget',
    Help = 'help',
    Unknown = 'unknown',
}

export enum SurfaceKind {
    ViewerPane = 'viewer-pane',
    PlotsPane = 'plots-pane',
    PlotEditor = 'plot-editor',
    DataExplorerEditor = 'data-explorer-editor',
    DataExplorerInline = 'data-explorer-inline',
    NotebookCell = 'notebook-cell',
    ConnectionsPane = 'connections-pane',
    ExternalBrowser = 'external-browser',
    Fallback = 'fallback',
}

export enum SurfaceSourceKind {
    Runtime = 'runtime',
    Terminal = 'terminal',
    File = 'file',
    Extension = 'extension',
    Restore = 'restore',
}

export type SurfaceModelRetention = 'transient' | 'retain-on-detach' | 'persistent';
export type SurfaceModelState = 'created' | 'restored' | 'attached' | 'detached';
export type SurfaceDetachReason = 'replaced' | 'surface-disposed' | 'model-disposed' | 'owner-disposed';

export interface SurfaceModelSource {
    readonly kind: SurfaceSourceKind;
    readonly id: string;
    readonly sessionId?: string;
    readonly stop?: () => void | Promise<void>;
}

export interface SurfaceModelDescriptor {
    readonly id: string;
    readonly kind: SurfaceModelKind;
    readonly resourceId: string;
    readonly title: string;
    readonly source: SurfaceModelSource;
    readonly outputId?: string;
    readonly retention?: SurfaceModelRetention;
    readonly payload?: Readonly<Record<string, unknown>>;
    /** Optional resource owned by the model, disposed exactly once with it. */
    readonly ownedResource?: vscode.Disposable;
}

export interface SurfaceAttachmentDescriptor {
    readonly surfaceId: string;
    readonly kind: SurfaceKind;
    readonly ownerId: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SurfaceAttachmentSnapshot {
    readonly id: string;
    readonly modelId: string;
    readonly surfaceId: string;
    readonly kind: SurfaceKind;
    readonly ownerId: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly attachedAt: number;
}

export interface SurfaceModelSnapshot {
    readonly id: string;
    readonly kind: SurfaceModelKind;
    readonly resourceId: string;
    readonly title: string;
    readonly source: Readonly<Omit<SurfaceModelSource, 'stop'>>;
    readonly canStop: boolean;
    readonly outputId?: string;
    readonly retention: SurfaceModelRetention;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly state: SurfaceModelState;
    readonly version: number;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly attachments: readonly SurfaceAttachmentSnapshot[];
}

export interface SurfaceLifecycleEvent {
    readonly type: 'created' | 'restored' | 'updated' | 'attached' | 'detached' | 'disposed' | 'stop-requested';
    readonly model: SurfaceModelSnapshot;
    readonly attachment?: SurfaceAttachmentSnapshot;
    readonly reason?: string;
    readonly timestamp: number;
}

export interface SurfaceStopResult {
    readonly handled: boolean;
    readonly reason?: 'model-not-found' | 'unsupported' | 'failed';
    readonly error?: unknown;
}

export interface SurfaceAttachmentLease extends vscode.Disposable {
    readonly id: string;
    readonly modelId: string;
    readonly surfaceId: string;
}

interface MutableSurfaceModel {
    id: string;
    kind: SurfaceModelKind;
    resourceId: string;
    title: string;
    source: SurfaceModelSource;
    outputId?: string;
    retention: SurfaceModelRetention;
    payload: Readonly<Record<string, unknown>>;
    ownedResource?: vscode.Disposable;
    state: SurfaceModelState;
    version: number;
    createdAt: number;
    updatedAt: number;
    hasEverAttached: boolean;
    attachments: Map<string, SurfaceAttachmentSnapshot>;
}

interface PersistedSurfaceModel {
    version: 1;
    id: string;
    kind: SurfaceModelKind;
    resourceId: string;
    title: string;
    source: Omit<SurfaceModelSource, 'stop'>;
    outputId?: string;
    retention: 'persistent';
    payload: Record<string, unknown>;
    modelVersion: number;
    createdAt: number;
    updatedAt: number;
}

/** Produces a stable, collision-safe model ID from semantic identity parts. */
export function createSurfaceModelId(kind: SurfaceModelKind, ...identity: string[]): string {
    return [kind, ...identity].map(value => encodeURIComponent(value)).join(':');
}

/**
 * Surface-neutral ownership registry.
 *
 * Models own data/source identity. Attachments are leases held by UI surfaces.
 * Closing a surface detaches its lease; it does not implicitly destroy a retained
 * model or its backend. Session deletion and explicit model disposal are separate.
 */
export class SurfaceLifecycleService implements vscode.Disposable {
    private readonly _models = new Map<string, MutableSurfaceModel>();
    private readonly _attachments = new Map<string, SurfaceAttachmentSnapshot>();
    private readonly _surfaceAttachments = new Map<string, string>();
    private readonly _onDidChangeEmitter = new vscode.EventEmitter<SurfaceLifecycleEvent>();
    private _attachmentSequence = 0;
    private _initialized = false;
    private _disposed = false;
    private _persistChain: Promise<void> = Promise.resolve();

    readonly onDidChange = this._onDidChangeEmitter.event;

    constructor(
        private readonly _workspaceState: vscode.Memento,
        private readonly _outputChannel: vscode.LogOutputChannel,
        private readonly _storageKey: string = DefaultStorageKey,
    ) { }

    async initialize(): Promise<void> {
        if (this._initialized) {
            return;
        }
        this._initialized = true;

        const tokens = this._workspaceState.get<unknown>(this._storageKey);
        if (!Array.isArray(tokens)) {
            return;
        }

        for (const candidate of tokens) {
            const token = this._validateRestoreToken(candidate);
            if (!token || this._models.has(token.id)) {
                continue;
            }
            const model: MutableSurfaceModel = {
                id: token.id,
                kind: token.kind,
                resourceId: token.resourceId,
                title: token.title,
                source: token.source,
                outputId: token.outputId,
                retention: 'persistent',
                payload: token.payload,
                state: 'restored',
                version: token.modelVersion,
                createdAt: token.createdAt,
                updatedAt: token.updatedAt,
                hasEverAttached: false,
                attachments: new Map(),
            };
            this._models.set(model.id, model);
            this._emit('restored', model);
        }
    }

    upsertModel(descriptor: SurfaceModelDescriptor): SurfaceModelSnapshot {
        this._throwIfDisposed();
        const now = Date.now();
        const payload = cloneRecord(descriptor.payload);
        const existing = this._models.get(descriptor.id);
        if (existing) {
            existing.kind = descriptor.kind;
            existing.resourceId = descriptor.resourceId;
            existing.title = descriptor.title;
            existing.source = descriptor.source;
            existing.outputId = descriptor.outputId;
            existing.retention = descriptor.retention ?? existing.retention;
            existing.payload = payload;
            if (descriptor.ownedResource && descriptor.ownedResource !== existing.ownedResource) {
                existing.ownedResource?.dispose();
                existing.ownedResource = descriptor.ownedResource;
            }
            existing.version += 1;
            existing.updatedAt = now;
            if (existing.state === 'restored') {
                existing.state = existing.attachments.size > 0 ? 'attached' : 'detached';
            }
            this._emit('updated', existing);
            this._schedulePersist();
            return this._snapshot(existing);
        }

        const model: MutableSurfaceModel = {
            id: descriptor.id,
            kind: descriptor.kind,
            resourceId: descriptor.resourceId,
            title: descriptor.title,
            source: descriptor.source,
            outputId: descriptor.outputId,
            retention: descriptor.retention ?? 'retain-on-detach',
            payload,
            ownedResource: descriptor.ownedResource,
            state: 'created',
            version: 1,
            createdAt: now,
            updatedAt: now,
            hasEverAttached: false,
            attachments: new Map(),
        };
        this._models.set(model.id, model);
        this._emit('created', model);
        this._schedulePersist();
        return this._snapshot(model);
    }

    updateModel(
        modelId: string,
        patch: Partial<Pick<SurfaceModelDescriptor, 'resourceId' | 'title' | 'source' | 'outputId' | 'retention' | 'payload'>>,
    ): SurfaceModelSnapshot | undefined {
        const model = this._models.get(modelId);
        if (!model) {
            return undefined;
        }
        return this.upsertModel({
            id: model.id,
            kind: model.kind,
            resourceId: patch.resourceId ?? model.resourceId,
            title: patch.title ?? model.title,
            source: patch.source ?? model.source,
            outputId: patch.outputId ?? model.outputId,
            retention: patch.retention ?? model.retention,
            payload: patch.payload ?? model.payload,
            ownedResource: model.ownedResource,
        });
    }

    attach(modelId: string, descriptor: SurfaceAttachmentDescriptor): SurfaceAttachmentLease {
        this._throwIfDisposed();
        const model = this._models.get(modelId);
        if (!model) {
            throw new Error(`Surface model '${modelId}' does not exist`);
        }

        this.detachSurface(descriptor.surfaceId, 'replaced');
        const id = `${descriptor.surfaceId}#${++this._attachmentSequence}`;
        const attachment: SurfaceAttachmentSnapshot = {
            id,
            modelId,
            surfaceId: descriptor.surfaceId,
            kind: descriptor.kind,
            ownerId: descriptor.ownerId,
            metadata: cloneRecord(descriptor.metadata),
            attachedAt: Date.now(),
        };
        this._attachments.set(id, attachment);
        this._surfaceAttachments.set(descriptor.surfaceId, id);
        model.attachments.set(id, attachment);
        model.hasEverAttached = true;
        model.state = 'attached';
        model.updatedAt = Date.now();
        this._emit('attached', model, attachment);

        let active = true;
        return {
            id,
            modelId,
            surfaceId: descriptor.surfaceId,
            dispose: () => {
                if (!active) {
                    return;
                }
                active = false;
                this._detachAttachment(id, 'surface-disposed');
            },
        };
    }

    detachSurface(surfaceId: string, reason: SurfaceDetachReason = 'surface-disposed'): void {
        const attachmentId = this._surfaceAttachments.get(surfaceId);
        if (attachmentId) {
            this._detachAttachment(attachmentId, reason);
        }
    }

    detachOwner(ownerId: string): void {
        for (const attachment of [...this._attachments.values()]) {
            if (attachment.ownerId === ownerId) {
                this._detachAttachment(attachment.id, 'owner-disposed');
            }
        }
    }

    disposeModel(modelId: string, reason: string = 'explicit-dispose'): boolean {
        const model = this._models.get(modelId);
        if (!model) {
            return false;
        }
        const lastSnapshot = this._snapshot(model);
        for (const attachment of [...model.attachments.values()]) {
            this._detachAttachment(attachment.id, 'model-disposed', false);
        }
        this._models.delete(modelId);
        try {
            model.ownedResource?.dispose();
        } catch (error) {
            this._outputChannel.warn(`[SurfaceLifecycle] Failed to dispose resource for ${modelId}: ${error}`);
        }
        this._onDidChangeEmitter.fire({
            type: 'disposed',
            model: lastSnapshot,
            reason,
            timestamp: Date.now(),
        });
        this._schedulePersist();
        return true;
    }

    disposeSession(sessionId: string, reason: string = 'session-disposed'): number {
        const modelIds = [...this._models.values()]
            .filter(model => model.source.sessionId === sessionId)
            .map(model => model.id);
        modelIds.forEach(modelId => this.disposeModel(modelId, reason));
        return modelIds.length;
    }

    async stopModel(modelId: string): Promise<SurfaceStopResult> {
        const model = this._models.get(modelId);
        if (!model) {
            return { handled: false, reason: 'model-not-found' };
        }
        if (!model.source.stop) {
            return { handled: false, reason: 'unsupported' };
        }
        this._emit('stop-requested', model);
        try {
            await model.source.stop();
            return { handled: true };
        } catch (error) {
            return { handled: false, reason: 'failed', error };
        }
    }

    getModel(modelId: string): SurfaceModelSnapshot | undefined {
        const model = this._models.get(modelId);
        return model ? this._snapshot(model) : undefined;
    }

    getModels(kind?: SurfaceModelKind): readonly SurfaceModelSnapshot[] {
        return [...this._models.values()]
            .filter(model => !kind || model.kind === kind)
            .map(model => this._snapshot(model));
    }

    findModelByResource(kind: SurfaceModelKind, resourceId: string): SurfaceModelSnapshot | undefined {
        const model = [...this._models.values()].find(candidate =>
            candidate.kind === kind && candidate.resourceId === resourceId,
        );
        return model ? this._snapshot(model) : undefined;
    }

    getAttachments(): readonly SurfaceAttachmentSnapshot[] {
        return [...this._attachments.values()];
    }

    async whenPersisted(): Promise<void> {
        await this._persistChain;
    }

    private _detachAttachment(
        attachmentId: string,
        reason: SurfaceDetachReason,
        allowTransientDispose: boolean = true,
    ): void {
        const attachment = this._attachments.get(attachmentId);
        if (!attachment) {
            return;
        }
        this._attachments.delete(attachmentId);
        if (this._surfaceAttachments.get(attachment.surfaceId) === attachmentId) {
            this._surfaceAttachments.delete(attachment.surfaceId);
        }

        const model = this._models.get(attachment.modelId);
        if (!model) {
            return;
        }
        model.attachments.delete(attachmentId);
        model.updatedAt = Date.now();
        if (model.attachments.size === 0) {
            model.state = 'detached';
        }
        this._emit('detached', model, attachment, reason);
        if (
            allowTransientDispose &&
            model.retention === 'transient' &&
            model.hasEverAttached &&
            model.attachments.size === 0
        ) {
            this.disposeModel(model.id, 'last-surface-detached');
        }
    }

    private _snapshot(model: MutableSurfaceModel): SurfaceModelSnapshot {
        return {
            id: model.id,
            kind: model.kind,
            resourceId: model.resourceId,
            title: model.title,
            source: {
                kind: model.source.kind,
                id: model.source.id,
                sessionId: model.source.sessionId,
            },
            canStop: !!model.source.stop,
            outputId: model.outputId,
            retention: model.retention,
            payload: model.payload,
            state: model.state,
            version: model.version,
            createdAt: model.createdAt,
            updatedAt: model.updatedAt,
            attachments: [...model.attachments.values()],
        };
    }

    private _emit(
        type: SurfaceLifecycleEvent['type'],
        model: MutableSurfaceModel,
        attachment?: SurfaceAttachmentSnapshot,
        reason?: string,
    ): void {
        this._onDidChangeEmitter.fire({
            type,
            model: this._snapshot(model),
            attachment,
            reason,
            timestamp: Date.now(),
        });
    }

    private _schedulePersist(): void {
        if (!this._initialized || this._disposed) {
            return;
        }
        const tokens = [...this._models.values()]
            .filter((model): model is MutableSurfaceModel & { retention: 'persistent' } =>
                model.retention === 'persistent',
            )
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .slice(0, MaxPersistedModels)
            .map(model => this._toRestoreToken(model));
        this._persistChain = this._persistChain
            .catch(() => undefined)
            .then(() => this._workspaceState.update(this._storageKey, tokens))
            .catch(error => {
                this._outputChannel.warn(`[SurfaceLifecycle] Failed to persist restore tokens: ${error}`);
            });
    }

    private _toRestoreToken(model: MutableSurfaceModel): PersistedSurfaceModel {
        return {
            version: 1,
            id: model.id,
            kind: model.kind,
            resourceId: model.resourceId,
            title: model.title,
            source: {
                kind: model.source.kind,
                id: model.source.id,
                sessionId: model.source.sessionId,
            },
            outputId: model.outputId,
            retention: 'persistent',
            payload: cloneRecord(model.payload),
            modelVersion: model.version,
            createdAt: model.createdAt,
            updatedAt: model.updatedAt,
        };
    }

    private _validateRestoreToken(value: unknown): PersistedSurfaceModel | undefined {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return undefined;
        }
        const token = value as Partial<PersistedSurfaceModel>;
        if (
            token.version !== 1 ||
            typeof token.id !== 'string' ||
            !Object.values(SurfaceModelKind).includes(token.kind as SurfaceModelKind) ||
            typeof token.resourceId !== 'string' ||
            typeof token.title !== 'string' ||
            token.retention !== 'persistent' ||
            !token.source ||
            !Object.values(SurfaceSourceKind).includes(token.source.kind as SurfaceSourceKind) ||
            typeof token.source.id !== 'string' ||
            !token.payload ||
            typeof token.payload !== 'object' ||
            Array.isArray(token.payload) ||
            typeof token.modelVersion !== 'number' ||
            typeof token.createdAt !== 'number' ||
            typeof token.updatedAt !== 'number'
        ) {
            this._outputChannel.warn('[SurfaceLifecycle] Ignoring malformed restore token.');
            return undefined;
        }
        return token as PersistedSurfaceModel;
    }

    private _throwIfDisposed(): void {
        if (this._disposed) {
            throw new Error('SurfaceLifecycleService is disposed');
        }
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        for (const model of this._models.values()) {
            try {
                model.ownedResource?.dispose();
            } catch {
                // Best-effort extension-host shutdown.
            }
        }
        this._models.clear();
        this._attachments.clear();
        this._surfaceAttachments.clear();
        this._onDidChangeEmitter.dispose();
    }
}

function cloneRecord(value: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
    if (!value) {
        return {};
    }
    try {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    } catch {
        return { serializationError: 'Payload was not JSON-serializable.' };
    }
}
