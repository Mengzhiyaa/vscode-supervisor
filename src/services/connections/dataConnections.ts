import * as vscode from 'vscode';
import {
    DataConnectionNodeKind,
    DataConnectionParameterType,
    type DataConnection,
    type DataConnectionDriver,
    type DataConnectionDriverSummary,
    type DataConnectionMechanism,
    type DataConnectionNode,
    type DataConnectionParameter,
    type DataConnectionParameterValues,
    type IDataConnectionDriver,
    type IDataConnectionHandle,
    type IDataConnectionNode,
} from '../../api';

export {
    DataConnectionNodeKind,
    DataConnectionParameterType,
    type DataConnection,
    type DataConnectionDriver,
    type DataConnectionDriverSummary,
    type DataConnectionMechanism,
    type DataConnectionNode,
    type DataConnectionParameter,
    type DataConnectionParameterValues,
};

const ProfilesStorageKey = 'supervisor.dataConnections.profiles.v1';
const SecretStorageKeyPrefix = 'supervisor.dataConnections.secret';

export interface DataConnectionProfile {
    readonly id: string;
    readonly createdAt: number;
    lastUsedAt?: number;
    readonly driverId: string;
    connectionName: string;
    mechanismId: string;
    parameterValues: DataConnectionParameterValues;
    autoConnect?: boolean;
}

interface PersistedDataConnectionProfile {
    readonly profile: DataConnectionProfile;
    readonly secretParameterIds: readonly string[];
}

export class DataConnectionsDriverManager implements vscode.Disposable {
    private readonly _drivers = new Map<string, DataConnectionDriver>();
    private readonly _onDidChangeDrivers = new vscode.EventEmitter<readonly DataConnectionDriver[]>();
    readonly onDidChangeDrivers = this._onDidChangeDrivers.event;

    registerDriver(driver: DataConnectionDriver | IDataConnectionDriver): vscode.Disposable {
        const normalized = normalizeDataConnectionDriver(driver);
        this._drivers.set(normalized.id, normalized);
        this._onDidChangeDrivers.fire(this.getDrivers());
        return new vscode.Disposable(() => {
            if (this._drivers.get(normalized.id) === normalized) {
                this._drivers.delete(normalized.id);
                this._onDidChangeDrivers.fire(this.getDrivers());
            }
        });
    }

    getDriver(driverId: string): DataConnectionDriver | undefined { return this._drivers.get(driverId); }
    getDrivers(): readonly DataConnectionDriver[] { return [...this._drivers.values()]; }
    getDriverSummaries(): readonly DataConnectionDriverSummary[] {
        return this.getDrivers().map(driver => ({
            id: driver.id,
            name: driver.name,
            description: driver.description,
            mechanisms: driver.mechanisms,
            supportedLanguageIds: driver.supportedLanguageIds,
        }));
    }
    async connect(
        driverId: string,
        mechanismId: string,
        parameters: DataConnectionParameterValues,
    ): Promise<DataConnection> {
        const driver = this.getDriver(driverId);
        if (!driver) {
            throw new Error(`Data connection driver '${driverId}' is not registered.`);
        }
        return driver.connect(mechanismId, parameters);
    }
    dispose(): void { this._drivers.clear(); this._onDidChangeDrivers.dispose(); }
}

function normalizeDataConnectionDriver(
    driver: DataConnectionDriver | IDataConnectionDriver,
): DataConnectionDriver {
    if (!('metadata' in driver)) {
        return driver;
    }

    const legacy = driver as IDataConnectionDriver;
    return {
        id: legacy.id,
        name: legacy.metadata.name,
        description: legacy.metadata.description ?? '',
        iconSvg: legacy.metadata.iconSvg ?? '',
        supportedLanguageIds: legacy.metadata.supportedLanguageIds ?? [],
        mechanisms: legacy.metadata.mechanisms.map(mechanism => ({
            id: mechanism.id,
            label: mechanism.label,
            description: mechanism.description ?? '',
            parameters: mechanism.parameters.map(normalizeLegacyParameter),
        })),
        async connect(mechanismId, parameters) {
            const handle = await legacy.connect(mechanismId, parameters);
            return adaptLegacyConnection(handle);
        },
    };
}

function normalizeLegacyParameter(
    parameter: IDataConnectionDriver['metadata']['mechanisms'][number]['parameters'][number],
): DataConnectionParameter {
    const base = {
        id: parameter.id,
        label: parameter.label,
        required: parameter.required,
    };
    switch (parameter.type) {
        case 'boolean':
            return { ...base, type: DataConnectionParameterType.Boolean, defaultValue: parameter.defaultValue as boolean | undefined };
        case 'number':
            return { ...base, type: DataConnectionParameterType.Number, defaultValue: parameter.defaultValue as number | undefined, placeholder: parameter.placeholder };
        case 'option':
            return { ...base, type: DataConnectionParameterType.Option, options: [...(parameter.options ?? [])], defaultValue: parameter.defaultValue as string | undefined, placeholder: parameter.placeholder };
        case 'password':
            return { ...base, type: DataConnectionParameterType.Password, secret: true, placeholder: parameter.placeholder };
        default:
            return parameter.secret
                ? { ...base, type: DataConnectionParameterType.String, secret: true, placeholder: parameter.placeholder }
                : { ...base, type: DataConnectionParameterType.String, secret: false, defaultValue: parameter.defaultValue as string | undefined, placeholder: parameter.placeholder };
    }
}

function adaptLegacyConnection(handle: IDataConnectionHandle): DataConnection {
    const adaptNode = (node: IDataConnectionNode): DataConnectionNode => ({
        name: node.name,
        kind: normalizeNodeKind(node.kind),
        dataType: node.dtype,
        getChildren: node.hasChildren
            ? async () => (await handle.nodeGetChildren(node.handle)).map(adaptNode)
            : undefined,
        preview: node.containsData
            ? () => handle.nodePreview(node.handle)
            : undefined,
    });
    return {
        isReadOnly: async () => false,
        isConnected: () => handle.isConnected(),
        getChildren: async () => (await handle.getChildren()).map(adaptNode),
        disconnect: () => handle.disconnect(),
        dispose: () => handle.dispose(),
    } as DataConnection & vscode.Disposable;
}

function normalizeNodeKind(kind: string): DataConnectionNodeKind {
    return (Object.values(DataConnectionNodeKind) as string[]).includes(kind)
        ? kind as DataConnectionNodeKind
        : DataConnectionNodeKind.Database;
}

/** Stores profile descriptors in Memento and cleartext values only in SecretStorage. */
export class DataConnectionProfileStore implements vscode.Disposable {
    private readonly _profiles = new Map<string, PersistedDataConnectionProfile>();
    private readonly _onDidChangeProfiles = new vscode.EventEmitter<readonly DataConnectionProfile[]>();
    readonly onDidChangeProfiles = this._onDidChangeProfiles.event;

    constructor(
        private readonly _state: vscode.Memento,
        private readonly _secrets: vscode.SecretStorage,
    ) {
        for (const persisted of _state.get<PersistedDataConnectionProfile[]>(ProfilesStorageKey, [])) {
            if (isPersistedProfile(persisted)) {
                this._profiles.set(persisted.profile.id, clonePersistedProfile(persisted));
            }
        }
    }

    getProfiles(): readonly DataConnectionProfile[] {
        return [...this._profiles.values()].map(value => cloneProfile(value.profile));
    }

    getProfile(id: string): DataConnectionProfile | undefined {
        const persisted = this._profiles.get(id);
        return persisted ? cloneProfile(persisted.profile) : undefined;
    }

    getSecretParameterIds(id: string): readonly string[] {
        return [...(this._profiles.get(id)?.secretParameterIds ?? [])];
    }

    async getProfileWithSecrets(id: string): Promise<DataConnectionProfile | undefined> {
        const persisted = this._profiles.get(id);
        if (!persisted) {
            return undefined;
        }
        const profile = cloneProfile(persisted.profile);
        for (const parameterId of persisted.secretParameterIds) {
            const value = await this._secrets.get(secretKey(id, parameterId));
            if (value !== undefined) {
                profile.parameterValues[parameterId] = value;
            }
        }
        return profile;
    }

    async addUpdateProfile(
        profile: DataConnectionProfile,
        secretParameterIds: readonly string[],
    ): Promise<DataConnectionProfile> {
        const previous = this._profiles.get(profile.id);
        const secretIds = new Set(secretParameterIds);
        const sanitized = cloneProfile(profile);
        for (const parameterId of secretIds) {
            const value = profile.parameterValues[parameterId];
            if (value !== undefined && value !== '') {
                await this._secrets.store(secretKey(profile.id, parameterId), String(value));
            }
            delete sanitized.parameterValues[parameterId];
        }
        for (const oldParameterId of previous?.secretParameterIds ?? []) {
            if (!secretIds.has(oldParameterId)) {
                await this._secrets.delete(secretKey(profile.id, oldParameterId));
            }
        }
        const persisted = { profile: sanitized, secretParameterIds: [...secretIds] };
        this._profiles.set(profile.id, persisted);
        await this._persist();
        this._onDidChangeProfiles.fire(this.getProfiles());
        return cloneProfile(sanitized);
    }

    async removeProfile(id: string): Promise<boolean> {
        const persisted = this._profiles.get(id);
        if (!persisted) {
            return false;
        }
        this._profiles.delete(id);
        await Promise.all(persisted.secretParameterIds.map(parameterId => this._secrets.delete(secretKey(id, parameterId))));
        await this._persist();
        this._onDidChangeProfiles.fire(this.getProfiles());
        return true;
    }

    private async _persist(): Promise<void> {
        await this._state.update(ProfilesStorageKey, [...this._profiles.values()].map(clonePersistedProfile));
    }

    dispose(): void { this._profiles.clear(); this._onDidChangeProfiles.dispose(); }
}

export function getSecretParameterIds(
    driver: DataConnectionDriver,
    mechanismId: string,
): readonly string[] {
    const mechanism = driver.mechanisms.find(candidate => candidate.id === mechanismId)
        ?? driver.mechanisms[0];
    return mechanism?.parameters
        .filter(parameter => parameter.type === DataConnectionParameterType.Password ||
            ('secret' in parameter && parameter.secret === true))
        .map(parameter => parameter.id) ?? [];
}

function secretKey(profileId: string, parameterId: string): string {
    return `${SecretStorageKeyPrefix}.${encodeURIComponent(profileId)}.${encodeURIComponent(parameterId)}`;
}

function cloneProfile(profile: DataConnectionProfile): DataConnectionProfile {
    return { ...profile, parameterValues: { ...profile.parameterValues } };
}

function clonePersistedProfile(value: PersistedDataConnectionProfile): PersistedDataConnectionProfile {
    return { profile: cloneProfile(value.profile), secretParameterIds: [...value.secretParameterIds] };
}

function isPersistedProfile(value: unknown): value is PersistedDataConnectionProfile {
    if (!value || typeof value !== 'object') { return false; }
    const persisted = value as Partial<PersistedDataConnectionProfile>;
    return !!persisted.profile && typeof persisted.profile.id === 'string' &&
        typeof persisted.profile.driverId === 'string' && Array.isArray(persisted.secretParameterIds);
}
