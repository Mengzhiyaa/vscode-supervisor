import * as vscode from 'vscode';
import {
    type ILanguageRuntimePackageManagerProvider,
    type ILanguageRuntimeSession,
    type IPositronPackagesInstance,
    type IPositronPackagesService,
    type LanguageRuntimePackage,
    LanguageRuntimeSessionMode,
    type PackageSpec,
    type PackagesItemSize,
} from '../../api';
import { ContextKeys } from '../../coreCommandIds';
import { RuntimeSessionService } from '../../runtime/runtimeSession';
import { PositronPackagesInstance } from './packagesInstance';

const ITEM_SIZE_STORAGE_KEY = 'positron.packages.itemSize';
const TIMEOUT_REFRESH_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}

export class PositronPackagesService implements IPositronPackagesService {
    private readonly _providersByLanguageId = new Map<string, ILanguageRuntimePackageManagerProvider>();
    private readonly _instancesBySessionId = new Map<string, PositronPackagesInstance>();
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _activeInstanceDisposables: vscode.Disposable[] = [];

    private _activeInstance: PositronPackagesInstance | undefined;
    private _selectedPackage: string | undefined;
    private _itemSize: PackagesItemSize = 'card';
    private _initialized = false;
    private _activeBusy = false;

    private readonly _onDidChangeActivePackagesInstance = new vscode.EventEmitter<IPositronPackagesInstance | undefined>();
    private readonly _onDidStopPackagesInstance = new vscode.EventEmitter<IPositronPackagesInstance>();
    private readonly _onDidChangeItemSize = new vscode.EventEmitter<PackagesItemSize>();

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _outputChannel: vscode.LogOutputChannel,
    ) {
        this._itemSize = this._readStoredItemSize();
        this._disposables.push(
            this._onDidChangeActivePackagesInstance,
            this._onDidStopPackagesInstance,
            this._onDidChangeItemSize,
        );
        this._updateContextKeys(false);
    }

    readonly onDidChangeActivePackagesInstance = this._onDidChangeActivePackagesInstance.event;
    readonly onDidStopPackagesInstance = this._onDidStopPackagesInstance.event;
    readonly onDidChangeItemSize = this._onDidChangeItemSize.event;

    get activeSession(): ILanguageRuntimeSession | undefined {
        return this._activeInstance?.session;
    }

    get activePackagesInstance(): IPositronPackagesInstance | undefined {
        return this._activeInstance;
    }

    get selectedPackage(): string | undefined {
        return this._selectedPackage;
    }

    get itemSize(): PackagesItemSize {
        return this._itemSize;
    }

    initialize(): void {
        if (this._initialized) {
            return;
        }
        this._initialized = true;

        this._disposables.push(
            this._sessionManager.onWillStartSession(event => {
                this._createOrAssignInstance(event.session, event.activate);
            }),
            this._sessionManager.onDidChangeForegroundSession(session => {
                if (!session) {
                    this._setActiveInstance(undefined);
                    return;
                }

                const instance = this._createOrAssignInstance(session, true);
                if (!instance) {
                    this._setActiveInstance(undefined);
                }
            }),
            this._sessionManager.onDidDeleteRuntimeSession(sessionId => {
                this._cleanupSession(sessionId);
            }),
        );

        for (const session of this._sessionManager.sessions) {
            this._createOrAssignInstance(
                session,
                session.sessionId === this._sessionManager.activeSessionId,
            );
        }

        const foregroundSession = this._sessionManager.foregroundSession;
        if (foregroundSession) {
            const instance = this._createOrAssignInstance(foregroundSession, true);
            if (!instance) {
                this._setActiveInstance(undefined);
            }
        }
    }

    registerPackageManagerProvider(provider: ILanguageRuntimePackageManagerProvider): vscode.Disposable {
        const existing = this._providersByLanguageId.get(provider.languageId);
        if (existing && existing !== provider) {
            throw new Error(`Package manager provider for '${provider.languageId}' is already registered`);
        }

        this._providersByLanguageId.set(provider.languageId, provider);
        this._syncSessionsForProvider(provider);

        return new vscode.Disposable(() => {
            if (this._providersByLanguageId.get(provider.languageId) !== provider) {
                return;
            }

            this._providersByLanguageId.delete(provider.languageId);
            this._cleanupLanguage(provider.languageId);
        });
    }

    setActivePositronPackagesSession(session: ILanguageRuntimeSession): void {
        const instance = this._instancesBySessionId.get(session.sessionId) ??
            this._createOrAssignInstance(session, false);
        if (instance) {
            this._setActiveInstance(instance);
        }
    }

    setSelectedPackage(packageName: string | undefined): void {
        this._selectedPackage = packageName || undefined;
        void vscode.commands.executeCommand(
            'setContext',
            ContextKeys.packagesSelectedPackage,
            this._selectedPackage ?? '',
        );
    }

    setItemSize(itemSize: PackagesItemSize): void {
        if (itemSize !== 'card' && itemSize !== 'row') {
            return;
        }

        if (this._itemSize === itemSize) {
            return;
        }

        this._itemSize = itemSize;
        void this._context.globalState.update(ITEM_SIZE_STORAGE_KEY, itemSize);
        void vscode.commands.executeCommand('setContext', ContextKeys.packagesItemSize, itemSize);
        this._onDidChangeItemSize.fire(itemSize);
    }

    getInstances(): IPositronPackagesInstance[] {
        return Array.from(this._instancesBySessionId.values());
    }

    async refreshPackages(token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]> {
        return withTimeout(
            this._getActiveInstanceOrThrow().refreshPackages(token),
            TIMEOUT_REFRESH_MS,
            'Package refresh',
        );
    }

    async refreshMetadata(token?: vscode.CancellationToken): Promise<void> {
        await this._getActiveInstanceOrThrow().refreshMetadata(token);
    }

    async installPackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        await this._getActiveInstanceOrThrow().installPackages(packages, token);
    }

    async uninstallPackages(packageNames: string[], token?: vscode.CancellationToken): Promise<void> {
        await this._getActiveInstanceOrThrow().uninstallPackages(packageNames, token);
    }

    async updatePackages(packages: PackageSpec[], token?: vscode.CancellationToken): Promise<void> {
        await this._getActiveInstanceOrThrow().updatePackages(packages, token);
    }

    async updateAllPackages(token?: vscode.CancellationToken): Promise<void> {
        await this._getActiveInstanceOrThrow().updateAllPackages(token);
    }

    async searchPackages(query: string, token?: vscode.CancellationToken): Promise<LanguageRuntimePackage[]> {
        return this._getActiveInstanceOrThrow().searchPackages(query, token);
    }

    async searchPackageVersions(name: string, token?: vscode.CancellationToken): Promise<string[]> {
        return this._getActiveInstanceOrThrow().searchPackageVersions(name, token);
    }

    dispose(): void {
        while (this._activeInstanceDisposables.length) {
            this._activeInstanceDisposables.pop()?.dispose();
        }
        for (const instance of this._instancesBySessionId.values()) {
            instance.dispose();
        }
        this._instancesBySessionId.clear();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }

    private _createOrAssignInstance(
        session: ILanguageRuntimeSession,
        activate: boolean,
    ): PositronPackagesInstance | undefined {
        if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Background) {
            return undefined;
        }

        const provider = this._providersByLanguageId.get(session.runtimeMetadata.languageId);
        if (!provider) {
            return undefined;
        }

        let instance = this._instancesBySessionId.get(session.sessionId);
        if (instance) {
            if (instance.session !== session) {
                const packageManager = provider.createPackageManager(session);
                if (!packageManager) {
                    this._cleanupSession(session.sessionId);
                    return undefined;
                }
                instance.setRuntimeSession(session, packageManager);
            }
        } else {
            const packageManager = provider.createPackageManager(session);
            if (!packageManager) {
                return undefined;
            }

            instance = new PositronPackagesInstance(session, packageManager, this._outputChannel);
            this._instancesBySessionId.set(session.sessionId, instance);
        }

        if (activate) {
            this._setActiveInstance(instance);
        }

        return instance;
    }

    private _setActiveInstance(instance: PositronPackagesInstance | undefined): void {
        if (this._activeInstance === instance) {
            this._updateContextKeys(this._activeBusy);
            return;
        }

        while (this._activeInstanceDisposables.length) {
            this._activeInstanceDisposables.pop()?.dispose();
        }

        this._activeInstance = instance;
        let refreshLoading = false;
        let installLoading = false;
        let updateLoading = false;
        let updateAllLoading = false;
        let uninstallLoading = false;

        const updateBusy = () => {
            const busy = refreshLoading || installLoading || updateLoading || updateAllLoading || uninstallLoading;
            this._activeBusy = busy;
            this._updateContextKeys(busy);
        };

        if (instance) {
            this._activeInstanceDisposables.push(
                instance.onDidChangeRefreshState(isLoading => {
                    refreshLoading = isLoading;
                    updateBusy();
                }),
                instance.onDidChangeInstallState(isLoading => {
                    installLoading = isLoading;
                    updateBusy();
                }),
                instance.onDidChangeUpdateState(isLoading => {
                    updateLoading = isLoading;
                    updateBusy();
                }),
                instance.onDidChangeUpdateAllState(isLoading => {
                    updateAllLoading = isLoading;
                    updateBusy();
                }),
                instance.onDidChangeUninstallState(isLoading => {
                    uninstallLoading = isLoading;
                    updateBusy();
                }),
            );
        }

        this._activeBusy = false;
        this._updateContextKeys(false);
        this._onDidChangeActivePackagesInstance.fire(instance);
    }

    private _cleanupSession(sessionId: string): void {
        const instance = this._instancesBySessionId.get(sessionId);
        if (!instance) {
            return;
        }

        this._instancesBySessionId.delete(sessionId);
        if (this._activeInstance === instance) {
            this._setActiveInstance(undefined);
        }
        this._onDidStopPackagesInstance.fire(instance);
        instance.dispose();
    }

    private _cleanupLanguage(languageId: string): void {
        const sessionIds = Array.from(this._instancesBySessionId.entries())
            .filter(([, instance]) => instance.session.runtimeMetadata.languageId === languageId)
            .map(([sessionId]) => sessionId);
        for (const sessionId of sessionIds) {
            this._cleanupSession(sessionId);
        }
    }

    private _syncSessionsForProvider(provider: ILanguageRuntimePackageManagerProvider): void {
        for (const session of this._sessionManager.sessions) {
            if (session.runtimeMetadata.languageId !== provider.languageId) {
                continue;
            }

            this._createOrAssignInstance(
                session,
                session.sessionId === this._sessionManager.activeSessionId,
            );
        }

        const foregroundSession = this._sessionManager.foregroundSession;
        if (foregroundSession?.runtimeMetadata.languageId === provider.languageId) {
            this._createOrAssignInstance(foregroundSession, true);
        }
    }

    private _getActiveInstanceOrThrow(): PositronPackagesInstance {
        if (!this._activeInstance) {
            throw new Error('No active package-enabled session found.');
        }
        return this._activeInstance;
    }

    private _readStoredItemSize(): PackagesItemSize {
        const stored = this._context.globalState.get<string>(ITEM_SIZE_STORAGE_KEY);
        return stored === 'row' || stored === 'card' ? stored : 'card';
    }

    private _updateContextKeys(isBusy: boolean): void {
        void vscode.commands.executeCommand(
            'setContext',
            ContextKeys.packagesHasActiveSession,
            Boolean(this._activeInstance),
        );
        void vscode.commands.executeCommand('setContext', ContextKeys.packagesIsBusy, isBusy);
        void vscode.commands.executeCommand(
            'setContext',
            ContextKeys.packagesSelectedPackage,
            this._selectedPackage ?? '',
        );
        void vscode.commands.executeCommand('setContext', ContextKeys.packagesItemSize, this._itemSize);
    }
}
