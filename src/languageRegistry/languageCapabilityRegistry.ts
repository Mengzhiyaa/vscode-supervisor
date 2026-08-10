import * as vscode from 'vscode';
import type {
    IBinaryProvider,
    ILanguageCapabilityActivationContext,
    ILanguageCapabilityKey,
    ILanguageCapabilityRegistrationClient,
    ILanguageCapabilityRegistry,
    ILanguageCapabilitySnapshot,
    ILanguageCapabilityState,
    ILanguageCapabilityStateChangeEvent,
    ILanguageContributionServices,
    ILanguageLspFactory,
    ILanguageNotebookControllerCapability,
    ILanguageOperationKey,
    ILanguageOperationState,
    ILanguageOperationStateChangeEvent,
    ILanguageOptionalCapabilityDescriptor,
    ILanguageRegistrationBuilder,
    ILanguageRegistrationHandle,
    ILanguageRegistrationIdentity,
    ILanguageRegistrationState,
    ILanguageRuntimeProvider,
    ILanguageRuntimeSessionManager,
    LanguageCapabilityKind,
    SerializedCapabilityError,
} from '../api';

const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export interface LanguageCapabilityRegistryOptions {
    readonly services: ILanguageContributionServices;
    readonly validateOwner?: (ownerExtensionId: string) => boolean;
    readonly installSnapshot?: (
        snapshot: ILanguageCapabilitySnapshot,
    ) => vscode.Disposable | readonly vscode.Disposable[] | void;
    readonly log?: vscode.LogOutputChannel;
}

interface RegistrationDraft {
    readonly identity: ILanguageRegistrationIdentity;
    runtimeProvider?: ILanguageRuntimeProvider<unknown>;
    lspFactory?: ILanguageLspFactory;
    binaryProvider?: IBinaryProvider;
    sessionManager?: ILanguageRuntimeSessionManager;
    readonly notebookControllers: ILanguageNotebookControllerCapability[];
    readonly optionalCapabilities: ILanguageOptionalCapabilityDescriptor[];
}

interface ActiveRegistration {
    readonly snapshot: ILanguageCapabilitySnapshot;
    readonly leases: Set<LanguageRegistrationHandle>;
    readonly abortController: AbortController;
    readonly installationDisposables: vscode.Disposable[];
    readonly optionalDisposables: Map<string, vscode.Disposable[]>;
    phase: ILanguageRegistrationState['phase'];
}

function capabilityKeyToString(key: ILanguageCapabilityKey): string {
    return JSON.stringify([
        key.ownerExtensionId,
        key.languageId,
        key.registrationId,
        key.capabilityId,
    ]);
}

function operationKeyToString(key: ILanguageOperationKey): string {
    return JSON.stringify([
        key.ownerExtensionId,
        key.languageId,
        key.operation,
        key.entityId,
        key.generation,
    ]);
}

function toDisposables(
    value: vscode.Disposable | readonly vscode.Disposable[] | void,
): vscode.Disposable[] {
    if (!value) {
        return [];
    }
    return Array.isArray(value) ? [...value] : [value as vscode.Disposable];
}

function serializeError(error: unknown, kind: SerializedCapabilityError['kind'] = 'internal'):
    SerializedCapabilityError {
    if (error instanceof Error) {
        return { kind, message: error.message, stack: error.stack };
    }
    return { kind, message: String(error) };
}

function sameOptionalDescriptor(
    left: ILanguageOptionalCapabilityDescriptor,
    right: ILanguageOptionalCapabilityDescriptor,
): boolean {
    return left.id === right.id &&
        left.kind === right.kind &&
        left.revision === right.revision &&
        left.activate === right.activate &&
        JSON.stringify(left.dependencies ?? []) === JSON.stringify(right.dependencies ?? []);
}

function sameSnapshotObjects(
    snapshot: ILanguageCapabilitySnapshot,
    draft: RegistrationDraft,
): boolean {
    return snapshot.runtimeProvider === draft.runtimeProvider &&
        snapshot.lspFactory === draft.lspFactory &&
        snapshot.binaryProvider === draft.binaryProvider &&
        snapshot.sessionManager === draft.sessionManager &&
        snapshot.notebookControllers.length === draft.notebookControllers.length &&
        snapshot.notebookControllers.every((entry, index) => {
            const other = draft.notebookControllers[index];
            return entry.capabilityId === other.capabilityId &&
                entry.controller === other.controller &&
                JSON.stringify(entry.languageIds) === JSON.stringify(other.languageIds);
        }) &&
        snapshot.optionalCapabilities.length === draft.optionalCapabilities.length &&
        snapshot.optionalCapabilities.every((entry, index) =>
            sameOptionalDescriptor(entry, draft.optionalCapabilities[index]));
}

export class LanguageCapabilityRegistry implements ILanguageCapabilityRegistry, vscode.Disposable {
    private readonly _registrationsByLanguageId = new Map<string, ActiveRegistration>();
    private readonly _capabilityStates = new Map<string, ILanguageCapabilityState>();
    private readonly _operationStates = new Map<string, ILanguageOperationState>();
    private readonly _onDidChangeCapabilityState =
        new vscode.EventEmitter<ILanguageCapabilityStateChangeEvent>();
    private readonly _onDidChangeOperationState =
        new vscode.EventEmitter<ILanguageOperationStateChangeEvent>();
    private _nextGeneration = 1;
    private _disposed = false;

    readonly onDidChangeCapabilityState = this._onDidChangeCapabilityState.event;
    readonly onDidChangeOperationState = this._onDidChangeOperationState.event;

    constructor(private readonly _options: LanguageCapabilityRegistryOptions) {}

    forExtension(ownerExtensionId: string): ILanguageCapabilityRegistrationClient {
        this._assertStableId(ownerExtensionId, 'ownerExtensionId');
        if (this._options.validateOwner && !this._options.validateOwner(ownerExtensionId)) {
            throw new Error(`Language registration owner '${ownerExtensionId}' is not installed.`);
        }
        return new LanguageCapabilityRegistrationClient(this, ownerExtensionId);
    }

    getSnapshot(languageId: string): ILanguageCapabilitySnapshot | undefined {
        return this._registrationsByLanguageId.get(languageId)?.snapshot;
    }

    getCapabilityState(key: ILanguageCapabilityKey): ILanguageCapabilityState | undefined {
        return this._capabilityStates.get(capabilityKeyToString(key));
    }

    getOperationState(key: ILanguageOperationKey): ILanguageOperationState | undefined {
        return this._operationStates.get(operationKeyToString(key));
    }

    /** Internal reconciler hook; operation state never changes capability installation state. */
    setOperationState(state: ILanguageOperationState): void {
        const key = operationKeyToString(state.key);
        const previous = this._operationStates.get(key);
        const current = Object.freeze({ ...state, changedAt: Date.now() });
        this._operationStates.set(key, current);
        this._onDidChangeOperationState.fire({ previous, current });
    }

    commit(draft: RegistrationDraft): ILanguageRegistrationHandle {
        if (this._disposed) {
            throw new Error('Language capability registry is disposed.');
        }
        this._validateDraft(draft);

        const existing = this._registrationsByLanguageId.get(draft.identity.languageId);
        if (existing) {
            const currentIdentity = existing.snapshot.identity;
            if (currentIdentity.ownerExtensionId !== draft.identity.ownerExtensionId) {
                throw new Error(
                    `Language '${draft.identity.languageId}' is already owned by ` +
                    `'${currentIdentity.ownerExtensionId}/${currentIdentity.registrationId}'.`,
                );
            }
            if (currentIdentity.registrationId !== draft.identity.registrationId) {
                throw new Error(
                    `Language '${draft.identity.languageId}' already uses registration ` +
                    `'${currentIdentity.registrationId}'.`,
                );
            }
            if (draft.identity.revision < currentIdentity.revision) {
                throw new Error(
                    `Language registration revision ${draft.identity.revision} is older than ` +
                    `the active revision ${currentIdentity.revision}.`,
                );
            }
            if (draft.identity.revision === currentIdentity.revision) {
                if (!sameSnapshotObjects(existing.snapshot, draft)) {
                    throw new Error(
                        `Language registration '${draft.identity.registrationId}' revision ` +
                        `${draft.identity.revision} changed capability objects; increase revision.`,
                    );
                }
                return this._createLease(existing);
            }
        }

        const generation = this._nextGeneration;
        const snapshot = this._createSnapshot(draft, generation);
        let installationDisposables: vscode.Disposable[] = [];
        try {
            installationDisposables = toDisposables(this._options.installSnapshot?.(snapshot));
        } catch (error) {
            this._disposeAll(installationDisposables);
            throw error;
        }

        this._nextGeneration += 1;
        const active: ActiveRegistration = {
            snapshot,
            leases: new Set(),
            abortController: new AbortController(),
            installationDisposables,
            optionalDisposables: new Map(),
            phase: 'active',
        };
        this._registrationsByLanguageId.set(draft.identity.languageId, active);
        this._publishInitialStates(active);

        if (existing) {
            this._retire(existing, 'superseded');
        }

        queueMicrotask(() => this._activateReadyOptionalCapabilities(active));
        return this._createLease(active);
    }

    retry(snapshot: ILanguageCapabilitySnapshot, capabilityId?: string): void {
        const active = this._registrationsByLanguageId.get(snapshot.identity.languageId);
        if (!active || active.snapshot.generation !== snapshot.generation) {
            return;
        }
        const descriptors = capabilityId
            ? active.snapshot.optionalCapabilities.filter(entry => entry.id === capabilityId)
            : active.snapshot.optionalCapabilities;
        for (const descriptor of descriptors) {
            const state = this._getState(active, descriptor.id);
            if (!state || (state.phase !== 'failed' && state.phase !== 'degraded')) {
                continue;
            }
            this._setState(active, descriptor.id, descriptor.kind, 'registered', state.attempt);
        }
        for (const descriptor of active.snapshot.optionalCapabilities) {
            const state = this._getState(active, descriptor.id);
            if (state?.phase === 'degraded' && state.error?.kind === 'dependency-missing') {
                this._setState(active, descriptor.id, descriptor.kind, 'registered', state.attempt);
            }
        }
        queueMicrotask(() => this._activateReadyOptionalCapabilities(active));
    }

    waitForCapability(
        snapshot: ILanguageCapabilitySnapshot,
        capabilityId: string,
        options?: { timeout?: number; signal?: AbortSignal },
    ): Promise<ILanguageCapabilityState> {
        const key: ILanguageCapabilityKey = { ...snapshot.identity, capabilityId };
        const current = this.getCapabilityState(key);
        if (!current || current.generation !== snapshot.generation) {
            return Promise.reject(new Error(`Unknown capability '${capabilityId}'.`));
        }
        if (!['registered', 'activating'].includes(current.phase)) {
            return Promise.resolve(current);
        }

        return new Promise<ILanguageCapabilityState>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const finish = (callback: () => void) => {
                listener.dispose();
                options?.signal?.removeEventListener('abort', onAbort);
                if (timer) {
                    clearTimeout(timer);
                }
                callback();
            };
            const onAbort = () => finish(() => reject(new Error('Capability observation aborted.')));
            const listener = this.onDidChangeCapabilityState(event => {
                if (capabilityKeyToString(event.current) !== capabilityKeyToString(key) ||
                    event.current.generation !== snapshot.generation ||
                    ['registered', 'activating'].includes(event.current.phase)) {
                    return;
                }
                finish(() => resolve(event.current));
            });
            options?.signal?.addEventListener('abort', onAbort, { once: true });
            if (options?.signal?.aborted) {
                onAbort();
                return;
            }
            if (options?.timeout !== undefined) {
                timer = setTimeout(
                    () => finish(() => reject(new Error(
                        `Timed out observing capability '${capabilityId}'.`,
                    ))),
                    options.timeout,
                );
            }
        });
    }

    releaseLease(handle: LanguageRegistrationHandle): void {
        const active = this._registrationsByLanguageId.get(handle.snapshot.identity.languageId);
        if (!active || active.snapshot.generation !== handle.snapshot.generation) {
            return;
        }
        active.leases.delete(handle);
        if (active.leases.size > 0) {
            return;
        }
        this._registrationsByLanguageId.delete(active.snapshot.identity.languageId);
        this._retire(active, 'disposed');
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        for (const active of this._registrationsByLanguageId.values()) {
            this._retire(active, 'disposed');
        }
        this._registrationsByLanguageId.clear();
        this._onDidChangeCapabilityState.dispose();
        this._onDidChangeOperationState.dispose();
    }

    private _createLease(active: ActiveRegistration): ILanguageRegistrationHandle {
        const handle = new LanguageRegistrationHandle(this, active.snapshot);
        active.leases.add(handle);
        return handle;
    }

    private _createSnapshot(
        draft: RegistrationDraft,
        generation: number,
    ): ILanguageCapabilitySnapshot {
        return Object.freeze({
            identity: Object.freeze({ ...draft.identity }),
            generation,
            runtimeProvider: draft.runtimeProvider,
            lspFactory: draft.lspFactory,
            binaryProvider: draft.binaryProvider,
            sessionManager: draft.sessionManager,
            notebookControllers: Object.freeze(draft.notebookControllers.map(entry => Object.freeze({
                ...entry,
                languageIds: Object.freeze([...entry.languageIds]),
            }))),
            optionalCapabilities: Object.freeze(draft.optionalCapabilities.map(entry => Object.freeze({
                ...entry,
                dependencies: entry.dependencies ? Object.freeze([...entry.dependencies]) : undefined,
            }))),
        });
    }

    private _publishInitialStates(active: ActiveRegistration): void {
        const snapshot = active.snapshot;
        if (snapshot.runtimeProvider) {
            this._setState(active, 'core.runtimeProvider', 'runtimeProvider', 'ready', 1);
        }
        if (snapshot.sessionManager) {
            this._setState(active, 'core.sessionManager', 'sessionManager', 'ready', 1);
        }
        if (snapshot.lspFactory) {
            this._setState(active, 'core.lspFactory', 'lspFactory', 'ready', 1);
        }
        if (snapshot.binaryProvider) {
            this._setState(active, 'core.binaryProvider', 'binaryProvider', 'ready', 1);
        }
        for (const controller of snapshot.notebookControllers) {
            this._setState(active, controller.capabilityId, 'notebookController', 'ready', 1);
        }
        for (const descriptor of snapshot.optionalCapabilities) {
            this._setState(active, descriptor.id, descriptor.kind, 'registered', 0);
        }
    }

    private _activateReadyOptionalCapabilities(active: ActiveRegistration): void {
        if (!this._isCurrent(active)) {
            return;
        }
        for (const descriptor of active.snapshot.optionalCapabilities) {
            const state = this._getState(active, descriptor.id);
            if (!state || state.phase !== 'registered') {
                continue;
            }
            const dependencyStates = (descriptor.dependencies ?? []).map(id => this._getState(active, id));
            if (dependencyStates.some(state => !state)) {
                this._setState(
                    active,
                    descriptor.id,
                    descriptor.kind,
                    'degraded',
                    state.attempt,
                    serializeError('A capability dependency is missing.', 'dependency-missing'),
                );
                continue;
            }
            if (dependencyStates.some(state => state!.phase === 'failed' || state!.phase === 'degraded')) {
                this._setState(
                    active,
                    descriptor.id,
                    descriptor.kind,
                    'degraded',
                    state.attempt,
                    serializeError('A capability dependency is not ready.', 'dependency-missing'),
                );
                continue;
            }
            if (dependencyStates.some(state => state!.phase !== 'ready')) {
                continue;
            }
            void this._activateOptionalCapability(active, descriptor);
        }
    }

    private async _activateOptionalCapability(
        active: ActiveRegistration,
        descriptor: ILanguageOptionalCapabilityDescriptor,
    ): Promise<void> {
        const previous = this._getState(active, descriptor.id);
        if (!previous || previous.phase !== 'registered' || !this._isCurrent(active)) {
            return;
        }
        const attempt = previous.attempt + 1;
        this._setState(active, descriptor.id, descriptor.kind, 'activating', attempt);
        const context: ILanguageCapabilityActivationContext = {
            identity: active.snapshot.identity,
            generation: active.snapshot.generation,
            services: this._options.services,
        };
        try {
            const result = await descriptor.activate(context, active.abortController.signal);
            if (!this._isCurrent(active) || active.abortController.signal.aborted) {
                this._disposeAll(toDisposables(result));
                return;
            }
            active.optionalDisposables.set(descriptor.id, toDisposables(result));
            this._setState(active, descriptor.id, descriptor.kind, 'ready', attempt);
            this._activateReadyOptionalCapabilities(active);
        } catch (error) {
            if (!this._isCurrent(active) || active.abortController.signal.aborted) {
                return;
            }
            this._setState(
                active,
                descriptor.id,
                descriptor.kind,
                'failed',
                attempt,
                serializeError(error),
            );
            this._options.log?.error(
                `[LanguageRegistry] owner=${active.snapshot.identity.ownerExtensionId} ` +
                `language=${active.snapshot.identity.languageId} capability=${descriptor.id} ` +
                `generation=${active.snapshot.generation} attempt=${attempt} state=failed: ${error}`,
            );
            this._activateReadyOptionalCapabilities(active);
        }
    }

    private _retire(active: ActiveRegistration, phase: 'superseded' | 'disposed'): void {
        if (active.phase !== 'active') {
            return;
        }
        active.phase = phase;
        active.abortController.abort();
        for (const handle of active.leases) {
            handle.notifyState(phase);
        }
        for (const state of this._statesFor(active)) {
            this._setState(active, state.capabilityId, state.capability, 'disposed', state.attempt);
        }
        for (const operation of this._operationStates.values()) {
            if (operation.key.ownerExtensionId === active.snapshot.identity.ownerExtensionId &&
                operation.key.languageId === active.snapshot.identity.languageId &&
                operation.key.generation === active.snapshot.generation &&
                (operation.phase === 'pending' || operation.phase === 'running')) {
                this.setOperationState({
                    ...operation,
                    phase: 'cancelled',
                    changedAt: Date.now(),
                    error: { kind: 'cancelled', message: `Registration ${phase}.` },
                });
            }
        }
        for (const disposables of active.optionalDisposables.values()) {
            this._disposeAll(disposables);
        }
        this._disposeAll(active.installationDisposables);
    }

    private _isCurrent(active: ActiveRegistration): boolean {
        return active.phase === 'active' &&
            this._registrationsByLanguageId.get(active.snapshot.identity.languageId) === active;
    }

    private _statesFor(active: ActiveRegistration): ILanguageCapabilityState[] {
        return Array.from(this._capabilityStates.values()).filter(state =>
            state.ownerExtensionId === active.snapshot.identity.ownerExtensionId &&
            state.languageId === active.snapshot.identity.languageId &&
            state.registrationId === active.snapshot.identity.registrationId &&
            state.generation === active.snapshot.generation,
        );
    }

    private _getState(active: ActiveRegistration, capabilityId: string): ILanguageCapabilityState | undefined {
        return this.getCapabilityState({ ...active.snapshot.identity, capabilityId });
    }

    private _setState(
        active: ActiveRegistration,
        capabilityId: string,
        capability: LanguageCapabilityKind,
        phase: ILanguageCapabilityState['phase'],
        attempt: number,
        error?: SerializedCapabilityError,
    ): void {
        const key: ILanguageCapabilityKey = { ...active.snapshot.identity, capabilityId };
        const serializedKey = capabilityKeyToString(key);
        const previous = this._capabilityStates.get(serializedKey);
        const current: ILanguageCapabilityState = Object.freeze({
            ...key,
            capability,
            generation: active.snapshot.generation,
            phase,
            attempt,
            changedAt: Date.now(),
            error,
        });
        this._capabilityStates.set(serializedKey, current);
        this._onDidChangeCapabilityState.fire({ previous, current });
    }

    private _validateDraft(draft: RegistrationDraft): void {
        const identity = draft.identity;
        this._assertStableId(identity.ownerExtensionId, 'ownerExtensionId');
        this._assertStableId(identity.languageId, 'languageId');
        this._assertStableId(identity.registrationId, 'registrationId');
        if (!Number.isSafeInteger(identity.revision) || identity.revision < 0) {
            throw new Error('Language registration revision must be a non-negative integer.');
        }
        if (this._options.validateOwner && !this._options.validateOwner(identity.ownerExtensionId)) {
            throw new Error(`Language registration owner '${identity.ownerExtensionId}' is not installed.`);
        }
        if (!!draft.runtimeProvider !== !!draft.sessionManager) {
            throw new Error('runtimeProvider and sessionManager must be committed as one core bundle.');
        }
        if (draft.runtimeProvider && draft.runtimeProvider.languageId !== identity.languageId) {
            throw new Error('Runtime provider languageId does not match the registration identity.');
        }
        if (draft.lspFactory && draft.lspFactory.languageId !== identity.languageId) {
            throw new Error('LSP factory languageId does not match the registration identity.');
        }
        const ids = new Set<string>();
        if (draft.runtimeProvider) {
            ids.add('core.runtimeProvider');
        }
        if (draft.sessionManager) {
            ids.add('core.sessionManager');
        }
        if (draft.lspFactory) {
            ids.add('core.lspFactory');
        }
        if (draft.binaryProvider) {
            ids.add('core.binaryProvider');
        }
        for (const controller of draft.notebookControllers) {
            this._assertUniqueCapabilityId(ids, controller.capabilityId);
            if (!controller.languageIds.includes(identity.languageId)) {
                throw new Error(
                    `Notebook capability '${controller.capabilityId}' does not include '${identity.languageId}'.`,
                );
            }
        }
        for (const descriptor of draft.optionalCapabilities) {
            this._assertUniqueCapabilityId(ids, descriptor.id);
            if (!Number.isSafeInteger(descriptor.revision) || descriptor.revision < 0) {
                throw new Error(`Capability '${descriptor.id}' revision must be a non-negative integer.`);
            }
        }
    }

    private _assertUniqueCapabilityId(ids: Set<string>, id: string): void {
        this._assertStableId(id, 'capabilityId');
        if (ids.has(id)) {
            throw new Error(`Duplicate language capability id '${id}'.`);
        }
        ids.add(id);
    }

    private _assertStableId(value: string, field: string): void {
        if (!STABLE_ID_PATTERN.test(value)) {
            throw new Error(`${field} '${value}' is not a stable identifier.`);
        }
    }

    private _disposeAll(disposables: readonly vscode.Disposable[]): void {
        for (const disposable of [...disposables].reverse()) {
            try {
                disposable.dispose();
            } catch (error) {
                this._options.log?.error(`[LanguageRegistry] Failed to dispose registration: ${error}`);
            }
        }
    }
}

class LanguageCapabilityRegistrationClient implements ILanguageCapabilityRegistrationClient {
    constructor(
        private readonly _registry: LanguageCapabilityRegistry,
        readonly ownerExtensionId: string,
    ) {}

    begin(
        identity: Omit<ILanguageRegistrationIdentity, 'ownerExtensionId'>,
    ): ILanguageRegistrationBuilder {
        return new LanguageRegistrationBuilder(this._registry, {
            ...identity,
            ownerExtensionId: this.ownerExtensionId,
        });
    }
}

class LanguageRegistrationBuilder implements ILanguageRegistrationBuilder {
    private readonly _draft: RegistrationDraft;
    private _settled = false;

    constructor(
        private readonly _registry: LanguageCapabilityRegistry,
        identity: ILanguageRegistrationIdentity,
    ) {
        this._draft = {
            identity,
            notebookControllers: [],
            optionalCapabilities: [],
        };
    }

    setRuntimeProvider<TInstallation>(provider: ILanguageRuntimeProvider<TInstallation>): this {
        this._assertOpen();
        this._draft.runtimeProvider = provider as ILanguageRuntimeProvider<unknown>;
        return this;
    }

    setLspFactory(factory: ILanguageLspFactory): this {
        this._assertOpen();
        this._draft.lspFactory = factory;
        return this;
    }

    setBinaryProvider(provider: IBinaryProvider): this {
        this._assertOpen();
        this._draft.binaryProvider = provider;
        return this;
    }

    setSessionManager(manager: ILanguageRuntimeSessionManager): this {
        this._assertOpen();
        this._draft.sessionManager = manager;
        return this;
    }

    addNotebookController(
        capabilityId: string,
        controller: vscode.NotebookController,
        languageIds?: readonly string[],
    ): this {
        this._assertOpen();
        this._draft.notebookControllers.push({
            capabilityId,
            controller,
            languageIds: languageIds ?? [this._draft.identity.languageId],
        });
        return this;
    }

    addOptionalCapability(descriptor: ILanguageOptionalCapabilityDescriptor): this {
        this._assertOpen();
        this._draft.optionalCapabilities.push(descriptor);
        return this;
    }

    commit(): ILanguageRegistrationHandle {
        this._assertOpen();
        this._settled = true;
        return this._registry.commit(this._draft);
    }

    rollback(): void {
        this._settled = true;
    }

    private _assertOpen(): void {
        if (this._settled) {
            throw new Error('Language registration builder is already settled.');
        }
    }
}

class LanguageRegistrationHandle implements ILanguageRegistrationHandle {
    private readonly _onDidChangeState = new vscode.EventEmitter<ILanguageRegistrationState>();
    private _disposed = false;

    readonly onDidChangeState = this._onDidChangeState.event;

    constructor(
        private readonly _registry: LanguageCapabilityRegistry,
        readonly snapshot: ILanguageCapabilitySnapshot,
    ) {}

    get identity(): ILanguageRegistrationIdentity {
        return this.snapshot.identity;
    }

    get generation(): number {
        return this.snapshot.generation;
    }

    whenCapabilityReady(
        capabilityId: string,
        options?: { timeout?: number; signal?: AbortSignal },
    ): Promise<ILanguageCapabilityState> {
        return this._registry.waitForCapability(this.snapshot, capabilityId, options);
    }

    retry(capabilityId?: string): void {
        if (!this._disposed) {
            this._registry.retry(this.snapshot, capabilityId);
        }
    }

    notifyState(phase: ILanguageRegistrationState['phase']): void {
        this._onDidChangeState.fire({
            identity: this.identity,
            generation: this.generation,
            phase,
        });
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._registry.releaseLease(this);
        this.notifyState('disposed');
        this._onDidChangeState.dispose();
    }
}
