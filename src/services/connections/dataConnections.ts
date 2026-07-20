import * as vscode from 'vscode';

const ProfilesStorageKey = 'supervisor.dataConnections.profiles.v1';
const SecretStorageKeyPrefix = 'supervisor.dataConnections.secret';

export type DataConnectionParameterValues = Record<string, boolean | number | string>;

export type DataConnectionParameter = {
    readonly id: string;
    readonly label: string;
    readonly type: 'boolean' | 'number' | 'string' | 'password' | 'option';
    readonly required?: boolean;
    readonly secret?: boolean;
    readonly defaultValue?: boolean | number | string;
    readonly options?: readonly string[];
    readonly placeholder?: string;
};

export interface DataConnectionMechanism {
    readonly id: string;
    readonly label: string;
    readonly description?: string;
    readonly parameters: readonly DataConnectionParameter[];
}

export interface DataConnectionDriverMetadata {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly iconSvg?: string;
    readonly mechanisms: readonly DataConnectionMechanism[];
    readonly supportedLanguageIds?: readonly string[];
}

export interface DataConnectionNode {
    readonly handle: number;
    readonly name: string;
    readonly kind: string;
    readonly dtype?: string;
    readonly hasChildren?: boolean;
    readonly containsData?: boolean;
}

export interface DataConnectionHandle extends vscode.Disposable {
    isConnected(): Promise<boolean>;
    getChildren(): Promise<readonly DataConnectionNode[]>;
    nodeGetChildren(nodeHandle: number): Promise<readonly DataConnectionNode[]>;
    nodePreview(nodeHandle: number): Promise<void>;
    disconnect(): Promise<void>;
}

export interface DataConnectionDriver {
    readonly id: string;
    readonly metadata: DataConnectionDriverMetadata;
    connect(mechanismId: string, params: DataConnectionParameterValues): Promise<DataConnectionHandle>;
}

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

    registerDriver(driver: DataConnectionDriver): vscode.Disposable {
        this._drivers.set(driver.id, driver);
        this._onDidChangeDrivers.fire(this.getDrivers());
        return new vscode.Disposable(() => {
            if (this._drivers.get(driver.id) === driver) {
                this._drivers.delete(driver.id);
                this._onDidChangeDrivers.fire(this.getDrivers());
            }
        });
    }

    getDriver(driverId: string): DataConnectionDriver | undefined { return this._drivers.get(driverId); }
    getDrivers(): readonly DataConnectionDriver[] { return [...this._drivers.values()]; }
    dispose(): void { this._drivers.clear(); this._onDidChangeDrivers.dispose(); }
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
    const mechanism = driver.metadata.mechanisms.find(candidate => candidate.id === mechanismId)
        ?? driver.metadata.mechanisms[0];
    return mechanism?.parameters
        .filter(parameter => parameter.type === 'password' || parameter.secret === true)
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
