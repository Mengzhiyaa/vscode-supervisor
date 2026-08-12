import * as vscode from 'vscode';
import {
    type ILanguageContributionServices,
    type ILanguageCapabilityRegistry,
    type ILanguageCapabilitySnapshot,
    type ILanguageRuntimeProvider,
    type IDataExplorerBackendProvider,
    type IRuntimeOutputRenderer,
    type IDataConnectionDriver,
    type DataConnection,
    type DataConnectionDriver,
    type DataConnectionDriverSummary,
    type DataConnectionParameterValues,
    type IDataConnectionProfile,
    type IRuntimeSessionMetadata,
    type ISupervisorFrameworkApi,
    type ISupervisorEnvironmentVariableAction,
    type JupyterKernelSpec,
    type LanguageRuntimeDynState,
    type LanguageRuntimeMetadata,
    LanguageRuntimeSessionMode,
    RuntimeStartMode,
} from './api';
import { WebviewManager } from './webview/manager';
import { PositronNewFolderService } from './newFolder/positronNewFolderService';
import { RuntimeManager } from './runtime/manager';
import { RuntimeSession } from './runtime/session';
import { resolveStatementRangeProvider } from './runtime/statementRange';
import { RuntimeSessionService } from './runtime/runtimeSession';
import { RuntimeFrontendEventService } from './runtime/runtimeFrontendEventService';
import { RuntimeStartupService } from './runtime/runtimeStartup';
import {
    ConsoleErrorFollowupService,
    MissingPackageErrorProvider,
    PositronConsoleService,
} from './services/console';
import { PositronVariablesService } from './services/variables';
import { PositronPreviewService } from './services/preview';
import { PositronHelpService } from './services/help';
import { MemoryUsageService } from './services/memory';
import { PositronPackagesService } from './services/packages';
import { PositronPlotsService } from './runtime/positronPlotsService';
import { RichOutputRouter } from './runtime/richOutputRouter';
import { migrateLegacyPlotsConfiguration } from './runtime/plotsConfiguration';
import { RuntimeSessionsTreeProvider } from './services/runtimeSessions/runtimeSessionsTreeProvider';
import {
    DataScienceSurfaceLifecycle,
    InlineDataExplorerNotebookService,
    NotebookSurfaceLifecycle,
    SurfaceLifecycleService,
} from './services/surfaces';
import { ConnectionsTreeProvider, PositronConnectionsService } from './services/connections';
import { PlotEditorProvider, PlotsGalleryEditorProvider, type PlotEditorContent } from './editor';
import { registerConsoleActions } from './services/console/consoleActions';
import {
    PositronDataExplorerService,
    PositronDataExplorerEditorProvider,
    PositronDataExplorerCustomEditorProvider,
    POSITRON_DATA_EXPLORER_CUSTOM_EDITOR_OPTIONS,
    PositronDataExplorerEditorContribution,
} from './services/dataExplorer';
import { DuckDBInstance } from './services/duckdb/duckdbInstance';
import { PositronDataExplorerCommandId } from './services/dataExplorer/positronDataExplorerActions';
import { CoreCommandIds, ContextKeys, InternalCommandIds, TestCommandIds, ViewIds } from './coreCommandIds';
import { UiFrontendEvent } from './runtime/comms/positronUiComm';
import {
    initializePositronCompatibility,
    LanguageRuntimeMessageType,
    type LanguageRuntimeSession,
    RuntimeExitReason,
    registerEnvironmentContributions as registerCompatEnvironmentContributions,
    setConsoleWidthSource,
    setForegroundSessionProvider,
} from './supervisor/positron';
import { ensureBinaries } from './binaryManager';
import {
    buildRuntimeQuickPickItems,
    type RuntimeQuickPickCandidate,
    type RuntimeQuickPickItem,
} from './runtime/runtimeQuickPick';
import { LanguageCapabilityRegistry } from './languageRegistry/languageCapabilityRegistry';
import { PassiveLanguageAssetCatalog } from './languageRegistry/passiveLanguageAssetCatalog';

interface SessionQuickLaunchPickItem extends vscode.QuickPickItem {
    installation?: unknown;
    action?: 'startAnother' | 'switchSession';
    sessionId?: string;
}


interface TestRuntimeSnapshot {
    activeSessionId: string | undefined;
    sessionIds: string[];
    lastClearReason: 'user' | 'runtime' | undefined;
    serializedState: unknown;
    workingDirectory: string | undefined;
    lspState: string | undefined;
    lspTransportKind: 'serverComm' | undefined;
    clientInfo: {
        variablesClientId: string | undefined;
        uiClientId: string | undefined;
        helpClientId: string | undefined;
        clientIds: string[];
    } | undefined;
}

interface TestEmitRuntimeEventParams {
    sessionId?: string;
    name: UiFrontendEvent;
    data?: unknown;
}

interface TestSimulateCommOpenParams {
    sessionId?: string;
    commId?: string;
    targetName: string;
    data?: Record<string, unknown>;
}

function isStatementRangeSyntaxError(error: unknown): error is { name: 'StatementRangeSyntaxError'; line?: number } {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const candidate = error as { name?: unknown; line?: unknown };
    return (
        candidate.name === 'StatementRangeSyntaxError' &&
        (typeof candidate.line === 'number' || typeof candidate.line === 'undefined')
    );
}

interface TestSimulateCommDataParams {
    sessionId?: string;
    commId: string;
    data?: Record<string, unknown>;
    register?: boolean;
}

interface TestSetWorkingDirectoryParams {
    sessionId?: string;
    workingDirectory: string;
}

interface TestOpenConsoleCodeInEditorParams {
    code: string;
}

/**
 * Main application class that manages all extension components.
 * This centralizes initialization, lifecycle management, and inter-component communication.
 */
export class SupervisorApplication implements vscode.Disposable, ISupervisorFrameworkApi {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _webviewManager: WebviewManager;
    private readonly _runtimeManager: RuntimeManager;
    private readonly _sessionManager: RuntimeSessionService;
    private readonly _runtimeFrontendEventService: RuntimeFrontendEventService;
    private readonly _runtimeStartupService: RuntimeStartupService;
    private readonly _positronNewFolderService: PositronNewFolderService;
    private readonly _outputChannel: vscode.LogOutputChannel;
    private readonly _languageCapabilityRegistry: LanguageCapabilityRegistry;
    private readonly _languageAssetCatalog: PassiveLanguageAssetCatalog;
    private _activated = false;
    private _runtimeStartupStarted = false;
    readonly version = '0.1.0';
    readonly apiVersion = 2 as const;
    readonly protocolVersion = Object.freeze({ major: 2 as const, minor: 0 });
    readonly capabilities = Object.freeze([
        'languageCapabilityRegistry',
        'passiveLanguageAssets',
        'optionalLanguageCapabilities',
        'languageCapabilityState',
        'languageOperationState',
    ] as const);

    // Service-class session management (1:1 Positron pattern)
    private readonly _consoleService: PositronConsoleService;
    private readonly _consoleErrorFollowupService: ConsoleErrorFollowupService;
    private readonly _variablesService: PositronVariablesService;
    private readonly _previewService: PositronPreviewService;
    private readonly _helpService: PositronHelpService;
    private readonly _memoryUsageService: MemoryUsageService;
    private readonly _plotsService: PositronPlotsService;
    private readonly _packagesService: PositronPackagesService;
    private readonly _richOutputRouter: RichOutputRouter;
    private readonly _runtimeSessionsTreeProvider: RuntimeSessionsTreeProvider;
    private readonly _surfaceLifecycle: SurfaceLifecycleService;
    private readonly _dataScienceSurfaceLifecycle: DataScienceSurfaceLifecycle;
    private readonly _notebookSurfaceLifecycle: NotebookSurfaceLifecycle;
    private readonly _inlineDataExplorerNotebookService: InlineDataExplorerNotebookService;
    private readonly _connectionsService: PositronConnectionsService;
    private readonly _connectionsTreeProvider: ConnectionsTreeProvider;

    // Editor providers for plots
    private readonly _plotEditorProvider: PlotEditorProvider;
    private readonly _plotsGalleryEditorProvider: PlotsGalleryEditorProvider;

    // Data Explorer service (1:1 Positron pattern)
    private readonly _positronDataExplorerService: PositronDataExplorerService;
    private readonly _positronDataExplorerEditorProvider: PositronDataExplorerEditorProvider;
    private readonly _sessionLifecycleWiredIds = new Set<string>();

    constructor(
        private readonly _context: vscode.ExtensionContext,
    ) {
        initializePositronCompatibility(_context);

        // Create log output channel for logging with level support
        this._outputChannel = vscode.window.createOutputChannel('Ark', { log: true });
        this._disposables.push(this._outputChannel);
        this._languageAssetCatalog = new PassiveLanguageAssetCatalog(
            () => vscode.extensions.all,
            vscode.extensions.onDidChange,
            this._outputChannel,
        );
        this._disposables.push(this._languageAssetCatalog);

        // Initialize session manager first (webview needs it)
        this._sessionManager = new RuntimeSessionService(_context, this._outputChannel);
        this._disposables.push(this._sessionManager);
        this._disposables.push(
            setForegroundSessionProvider(() =>
                this._sessionManager.activeSession?.kernelSession as unknown as
                    LanguageRuntimeSession | undefined
            )
        );

        this._surfaceLifecycle = new SurfaceLifecycleService(
            _context.workspaceState,
            this._outputChannel,
        );

        this._runtimeFrontendEventService = new RuntimeFrontendEventService(
            this._sessionManager,
            this._outputChannel,
        );
        this._disposables.push(this._runtimeFrontendEventService);

        // Initialize runtime manager
        this._runtimeManager = new RuntimeManager(_context, this._sessionManager, this._outputChannel);
        this._disposables.push(this._runtimeManager);

        this._positronNewFolderService = new PositronNewFolderService(_context, this._outputChannel);
        this._disposables.push(this._positronNewFolderService);

        // Initialize runtime startup orchestration (Positron-style)
        this._runtimeStartupService = new RuntimeStartupService(
            _context,
            this._runtimeManager,
            this._sessionManager,
            this._positronNewFolderService,
            this._outputChannel
        );
        this._disposables.push(this._runtimeStartupService);
        this._disposables.push(
            this._runtimeStartupService.registerRuntimeManager(this._runtimeManager),
            this._runtimeManager.onDidFinishDiscovery(() => {
                this._runtimeStartupService.completeDiscovery(this._runtimeManager.id);
            }),
        );

        // Initialize service-class services (1:1 Positron pattern)
        this._consoleErrorFollowupService = new ConsoleErrorFollowupService();
        this._disposables.push(this._consoleErrorFollowupService);
        this._consoleService = new PositronConsoleService(
            this._sessionManager,
            this._outputChannel,
            this._context,
            this._runtimeStartupService,
            this._consoleErrorFollowupService,
        );
        this._disposables.push(this._consoleService);
        this._disposables.push(setConsoleWidthSource(
            this._consoleService.onDidChangeConsoleWidth,
            () => this._consoleService.getConsoleWidth(),
        ));

        this._variablesService = new PositronVariablesService(this._sessionManager, this._outputChannel);
        this._disposables.push(this._variablesService);

        this._memoryUsageService = new MemoryUsageService(this._sessionManager, this._outputChannel);
        this._disposables.push(this._memoryUsageService);

        this._plotsService = new PositronPlotsService(this._outputChannel, this._context);
        this._disposables.push(this._plotsService);

        this._packagesService = new PositronPackagesService(
            this._context,
            this._sessionManager,
            this._outputChannel,
        );
        this._disposables.push(
            this._packagesService,
            this._consoleErrorFollowupService.registerProvider(
                new MissingPackageErrorProvider(this._packagesService),
            ),
        );

        this._previewService = new PositronPreviewService(
            this._sessionManager,
            this._plotsService,
            this._outputChannel,
            this._surfaceLifecycle,
            this._context.workspaceState,
        );
        this._disposables.push(this._previewService);

        this._richOutputRouter = new RichOutputRouter(
            this._context,
            this._sessionManager,
            this._plotsService,
            this._previewService,
            this._outputChannel,
            this._surfaceLifecycle,
        );
        this._disposables.push(this._richOutputRouter);

        this._runtimeSessionsTreeProvider = new RuntimeSessionsTreeProvider(
            this._sessionManager,
            this._richOutputRouter,
            this._surfaceLifecycle,
        );
        this._disposables.push(
            this._runtimeSessionsTreeProvider,
            vscode.window.createTreeView(ViewIds.runtimeSessions, {
                treeDataProvider: this._runtimeSessionsTreeProvider,
                showCollapseAll: true,
            }),
        );

        this._helpService = new PositronHelpService(this._sessionManager, this._outputChannel, this._context.extensionUri);
        this._disposables.push(this._helpService);

        // Initialize editor providers for plots
        this._plotEditorProvider = new PlotEditorProvider(
            this._context.extensionUri,
            this._outputChannel,
            this._plotsService,
            this._surfaceLifecycle,
        );
        this._disposables.push(this._plotEditorProvider);

        // Initialize Data Explorer service and editor provider
        this._positronDataExplorerService = new PositronDataExplorerService(this._sessionManager, this._outputChannel);
        this._disposables.push(this._positronDataExplorerService);

        this._dataScienceSurfaceLifecycle = new DataScienceSurfaceLifecycle(
            this._surfaceLifecycle,
            this._sessionManager,
            this._plotsService,
            this._positronDataExplorerService,
            this._outputChannel,
        );
        this._disposables.push(this._dataScienceSurfaceLifecycle);

        this._notebookSurfaceLifecycle = new NotebookSurfaceLifecycle(
            this._surfaceLifecycle,
            this._sessionManager,
        );
        this._disposables.push(this._notebookSurfaceLifecycle);

        // Data Explorer editor provider (opens in editor area as tabs)
        this._positronDataExplorerEditorProvider = new PositronDataExplorerEditorProvider(
            this._context.extensionUri,
            this._positronDataExplorerService,
            this._outputChannel,
            () => this._getLanguageWebviewLocalResourceRoots(),
            (webview) => this._getLanguageMonacoSupportModuleUris(webview),
            (webview) => this._getLanguageTextMateGrammarDefinitions(webview),
            this._surfaceLifecycle,
        );
        this._disposables.push(this._positronDataExplorerEditorProvider);
        this._disposables.push(new PositronDataExplorerEditorContribution(
            this._variablesService,
            this._sessionManager,
        ));

        this._inlineDataExplorerNotebookService = new InlineDataExplorerNotebookService(
            this._positronDataExplorerService,
            this._surfaceLifecycle,
            this._outputChannel,
        );
        this._disposables.push(this._inlineDataExplorerNotebookService);

        this._connectionsService = new PositronConnectionsService(
            this._sessionManager,
            this._surfaceLifecycle,
            this._outputChannel,
            this._context.globalState,
            this._context.secrets,
        );
        this._connectionsTreeProvider = new ConnectionsTreeProvider(
            this._connectionsService,
            this._surfaceLifecycle,
        );
        const connectionsTreeView = vscode.window.createTreeView(ViewIds.connections, {
            treeDataProvider: this._connectionsTreeProvider,
            showCollapseAll: true,
        });
        this._connectionsTreeProvider.bindTreeView(connectionsTreeView);
        this._disposables.push(
            this._connectionsService,
            this._connectionsTreeProvider,
            connectionsTreeView,
        );

        this._languageCapabilityRegistry = new LanguageCapabilityRegistry({
            services: this._getLanguageContributionServices(),
            validateOwner: ownerExtensionId => !!vscode.extensions.getExtension(ownerExtensionId),
            installSnapshot: snapshot => this._installLanguageCapabilitySnapshot(snapshot),
            log: this._outputChannel,
        });
        this._disposables.push(this._languageCapabilityRegistry);

        // Custom editor provider (enables "Reopen With → Data Explorer" for data files)
        const dataExplorerCustomEditorProvider = new PositronDataExplorerCustomEditorProvider(
            this._positronDataExplorerService,
            this._positronDataExplorerEditorProvider,
            this._outputChannel
        );
        this._disposables.push(
            vscode.window.registerCustomEditorProvider(
                PositronDataExplorerCustomEditorProvider.viewType,
                dataExplorerCustomEditorProvider,
                POSITRON_DATA_EXPLORER_CUSTOM_EDITOR_OPTIONS,
            )
        );

        // Initialize webview manager with session manager and services
        this._webviewManager = new WebviewManager(
            _context,
            this._outputChannel,
            this._sessionManager,
            this._consoleService,
            this._variablesService,
            this._memoryUsageService,
            this._plotsService,
            this._packagesService,
            this._previewService,
            this._helpService,
            this._runtimeStartupService,
            () => this._getLanguageWebviewLocalResourceRoots(),
            (webview) => this._getLanguageMonacoSupportModuleUris(webview),
            (webview) => this._getLanguageTextMateGrammarDefinitions(webview),
            this._positronDataExplorerService,
        );
        this._disposables.push(this._webviewManager);
        this._disposables.push(this._languageAssetCatalog.onDidChangeSnapshot(() => {
            this._refreshLanguageSupportAssetsInWebviews();
        }));

        this._plotsGalleryEditorProvider = new PlotsGalleryEditorProvider(
            this._context.extensionUri,
            this._outputChannel,
            () => this._webviewManager.plotsProvider
        );
        this._disposables.push(this._plotsGalleryEditorProvider);

        // Registry is disposed last so providers/services can release leases first.
        this._disposables.push(this._surfaceLifecycle);

        this._updateGlobalContexts();
        this._outputChannel.debug('[Ark] Application initialized');
    }

    get languages(): ILanguageCapabilityRegistry {
        return this._languageCapabilityRegistry;
    }

    get services(): ILanguageContributionServices {
        return this._getLanguageContributionServices();
    }

    getApi(): ISupervisorFrameworkApi {
        return {
            apiVersion: this.apiVersion,
            protocolVersion: this.protocolVersion,
            capabilities: this.capabilities,
            services: this.services,
            languages: this.languages,
            version: this.version,
            startRuntime: (metadata, source, activate) =>
                this.startRuntime(metadata, source, activate),
            createSession: (runtimeMetadata, sessionMetadata, kernelSpec, dynState) =>
                this.createSession(runtimeMetadata, sessionMetadata, kernelSpec, dynState),
            restoreSession: (runtimeMetadata, sessionMetadata, dynState) =>
                this.restoreSession(runtimeMetadata, sessionMetadata, dynState),
            validateSession: (sessionId) => this.validateSession(sessionId),
            registerDataExplorerBackendProvider: (provider: IDataExplorerBackendProvider) =>
                this._positronDataExplorerService.registerBackendProvider(provider),
            openDataExplorer: async (uri, providerId) => {
                await this._positronDataExplorerService.openWithBackend(uri, providerId);
            },
            registerRuntimeOutputRenderer: renderer =>
                this._richOutputRouter.registerRenderer(renderer),
            registerDataConnectionDriver: driver =>
                this._connectionsService.registerDriver(driver),
            getDataConnectionDrivers: async () =>
                this._connectionsService.driverManager.getDriverSummaries(),
            connectDataConnection: (driverId, mechanismId, parameters) =>
                this._connectionsService.driverManager.connect(driverId, mechanismId, parameters),
            addUpdateDataConnectionProfile: async (profile: IDataConnectionProfile, connect = true) => {
                await this._connectionsService.addUpdateProfile(profile, connect);
            },
            connectDataConnectionProfile: async profileId => {
                await this._connectionsService.connectProfile(profileId);
            },
            registerEnvironmentContributions: (extensionId, actions) =>
                this.registerEnvironmentContributions(extensionId, actions),
        };
    }

    async startRuntime(
        metadata: LanguageRuntimeMetadata,
        source: string,
        activate: boolean,
    ): Promise<string> {
        return this._sessionManager.startRuntime(metadata, source, activate);
    }

    async createSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionMetadata: IRuntimeSessionMetadata,
        kernelSpec: JupyterKernelSpec,
        dynState: LanguageRuntimeDynState,
    ): Promise<RuntimeSession> {
        return this._sessionManager.createSession(
            runtimeMetadata,
            sessionMetadata,
            kernelSpec,
            dynState,
        );
    }

    async restoreSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionMetadata: IRuntimeSessionMetadata,
        dynState: LanguageRuntimeDynState,
    ): Promise<RuntimeSession> {
        return this._sessionManager.restoreSession(
            runtimeMetadata,
            sessionMetadata,
            dynState,
        );
    }

    async validateSession(sessionId: string): Promise<boolean> {
        return this._sessionManager.validateSession(sessionId);
    }

    registerDataExplorerBackendProvider(provider: IDataExplorerBackendProvider): vscode.Disposable {
        return this._positronDataExplorerService.registerBackendProvider(provider);
    }

    async openDataExplorer(uri: vscode.Uri, providerId?: string): Promise<void> {
        await this._positronDataExplorerService.openWithBackend(uri, providerId);
    }

    registerRuntimeOutputRenderer(renderer: IRuntimeOutputRenderer): vscode.Disposable {
        return this._richOutputRouter.registerRenderer(renderer);
    }

    registerDataConnectionDriver(
        driver: DataConnectionDriver | IDataConnectionDriver,
    ): vscode.Disposable {
        return this._connectionsService.registerDriver(driver);
    }

    async getDataConnectionDrivers(): Promise<readonly DataConnectionDriverSummary[]> {
        return this._connectionsService.driverManager.getDriverSummaries();
    }

    async connectDataConnection(
        driverId: string,
        mechanismId: string,
        parameters: DataConnectionParameterValues,
    ): Promise<DataConnection> {
        return this._connectionsService.driverManager.connect(driverId, mechanismId, parameters);
    }

    async addUpdateDataConnectionProfile(profile: IDataConnectionProfile, connect = true): Promise<void> {
        await this._connectionsService.addUpdateProfile(profile, connect);
    }

    async connectDataConnectionProfile(profileId: string): Promise<void> {
        await this._connectionsService.connectProfile(profileId);
    }

    registerEnvironmentContributions(
        extensionId: string,
        actions: readonly ISupervisorEnvironmentVariableAction[],
    ): vscode.Disposable {
        const registration = registerCompatEnvironmentContributions(extensionId, actions);
        this._disposables.push(registration);
        return registration;
    }

    private _getLanguageContributionServices(): ILanguageContributionServices {
        return {
            logChannel: this._outputChannel,
            runtimeSessionService: this._sessionManager,
            runtimeStartupService: this._runtimeStartupService,
            positronNewFolderService: this._positronNewFolderService,
            positronConsoleService: {
                onDidChangeConsoleWidth: this._consoleService.onDidChangeConsoleWidth,
                revealConsole: preserveFocus => this._consoleService.revealConsole(preserveFocus),
                focusConsole: () => this._consoleService.focusConsole(),
                showConsole: () => this._consoleService.showConsole(),
                getConsoleWidth: () => this._consoleService.getConsoleWidth(),
                executeCode: (...args) => this._consoleService.executeCode(...args),
            },
            positronHelpService: this._helpService,
            positronPackagesService: this._packagesService,
        };
    }

    private _installLanguageCapabilitySnapshot(
        snapshot: ILanguageCapabilitySnapshot,
    ): readonly vscode.Disposable[] {
        const disposables: vscode.Disposable[] = [];
        try {
            if (snapshot.runtimeProvider) {
                disposables.push(
                    this._runtimeManager.registerRuntimeProvider(
                        snapshot.runtimeProvider,
                        snapshot.identity,
                    ),
                    this._sessionManager.registerRuntimeProvider(snapshot.runtimeProvider),
                );
            }
            if (snapshot.sessionManager) {
                disposables.push(this._sessionManager.registerSessionManager(snapshot.sessionManager));
            }
            if (snapshot.lspFactory) {
                disposables.push(this._sessionManager.registerLspFactory(
                    snapshot.lspFactory,
                    snapshot.generation,
                ));
            }
            for (const capability of snapshot.notebookControllers) {
                disposables.push(this._sessionManager.registerNotebookController(
                    capability.controller,
                    capability.languageIds,
                ));
            }
            if (snapshot.runtimeProvider) {
                queueMicrotask(() => this._reconcileLanguageDiscovery(snapshot));
            }
            if (snapshot.binaryProvider) {
                queueMicrotask(() => {
                    void ensureBinaries(this._context, this._outputChannel, [snapshot.binaryProvider!])
                        .catch(error => this._outputChannel.error(
                            `[LanguageRegistry] Failed to ensure binaries for ` +
                            `${snapshot.identity.languageId}: ${error}`,
                        ));
                });
            }
            return disposables;
        } catch (error) {
            for (const disposable of disposables.reverse()) {
                disposable.dispose();
            }
            throw error;
        }
    }

    private async _reconcileLanguageDiscovery(
        snapshot: ILanguageCapabilitySnapshot,
    ): Promise<void> {
        const operationKey = {
            ownerExtensionId: snapshot.identity.ownerExtensionId,
            languageId: snapshot.identity.languageId,
            operation: 'discovery' as const,
            entityId: 'initial',
            generation: snapshot.generation,
        };
        this._languageCapabilityRegistry.setOperationState({
            key: operationKey,
            phase: 'running',
            attempt: 1,
            changedAt: Date.now(),
        });
        try {
            await this._runtimeManager.discoverLanguageRuntime(snapshot.identity.languageId);
            if (this.languages.getSnapshot(snapshot.identity.languageId)?.generation !== snapshot.generation) {
                return;
            }
            this._languageCapabilityRegistry.setOperationState({
                key: operationKey,
                phase: 'succeeded',
                attempt: 1,
                changedAt: Date.now(),
            });
        } catch (error) {
            if (this.languages.getSnapshot(snapshot.identity.languageId)?.generation !== snapshot.generation) {
                return;
            }
            this._languageCapabilityRegistry.setOperationState({
                key: operationKey,
                phase: 'degraded',
                attempt: 1,
                changedAt: Date.now(),
                error: {
                    kind: 'transient-io',
                    message: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                },
            });
        }
    }

    private _updateGlobalContexts(): void {
        const isDevelopment = this._context.extensionMode !== vscode.ExtensionMode.Production;
        void vscode.commands.executeCommand('setContext', ContextKeys.isDevelopment, isDevelopment);
    }

    private _refreshLanguageSupportAssetsInWebviews(): void {
        this._webviewManager.refreshLanguageSupportAssets();
    }

    private _startDeferredActivationTasks(): void {
        if (!this._activated) {
            return;
        }

        if (!this._runtimeStartupStarted) {
            this._runtimeStartupStarted = true;
            void this._runtimeStartupService.startup().catch((error) => {
                this._runtimeStartupStarted = false;
                this._outputChannel.error(`[RuntimeStartup] Failed to start runtime startup sequence: ${error}`);
            });
        }
    }

    private _getLanguageWebviewLocalResourceRoots(): vscode.Uri[] {
        const uniqueRoots = new Map<string, vscode.Uri>();

        for (const { assets } of this._languageAssetCatalog.snapshot.entries) {
            for (const root of assets.localResourceRoots ?? []) {
                uniqueRoots.set(root.toString(), root);
            }
        }

        return Array.from(uniqueRoots.values());
    }

    private _getLanguageMonacoSupportModuleUris(
        webview: vscode.Webview
    ): Readonly<Record<string, string>> {
        return Object.fromEntries(
            this._languageAssetCatalog.snapshot.entries
                .flatMap(({ languageId, assets }) => {
                    if (!assets.monacoSupportModule) {
                        return [];
                    }

                    return [[
                        languageId,
                        webview.asWebviewUri(assets.monacoSupportModule).toString(),
                    ]];
                })
        );
    }

    private _getLanguageTextMateGrammarDefinitions(
        webview: vscode.Webview
    ): Readonly<Record<string, { scopeName: string; grammarUrl: string }>> {
        return Object.fromEntries(
            this._languageAssetCatalog.snapshot.entries
                .flatMap(({ languageId, assets }) => {
                    if (!assets.textMateGrammar) {
                        return [];
                    }

                    return [[
                        languageId,
                        {
                            scopeName: assets.textMateGrammar.scopeName,
                            grammarUrl: webview.asWebviewUri(
                                assets.textMateGrammar.grammarUri,
                            ).toString(),
                        },
                    ]];
                })
        );
    }

    private _updateConsoleSessionsExistContext(): void {
        const hasSessions = this._sessionManager.sessions.length > 0;
        void vscode.commands.executeCommand('setContext', ContextKeys.consoleSessionsExist, hasSessions);
    }

    private _toRuntimeSourceLabel(source: string): string {
        switch (source) {
            case 'configured':
                return 'Configured';
            case 'conda':
                return 'Conda';
            case 'path':
                return 'PATH';
            case 'system':
                return 'System';
            default:
                return source || '';
        }
    }

    private _getPreferredLanguageId(): string {
        const activeLanguageId = this._sessionManager.activeSession?.runtimeMetadata.languageId;
        if (activeLanguageId) {
            return activeLanguageId;
        }

        const firstLanguageId = this._runtimeManager.getSupportedLanguageIds()[0];
        if (firstLanguageId) {
            return firstLanguageId;
        }

        throw new Error('No language support is registered');
    }

    private _requireRuntimeProvider(languageId: string): ILanguageRuntimeProvider<unknown> {
        const provider = this._runtimeManager.getRuntimeProvider(languageId);
        if (!provider) {
            throw new Error(`Language support for '${languageId}' is not registered`);
        }
        return provider;
    }

    private _buildRuntimeQuickPickItems(): RuntimeQuickPickItem[] {
        const activeRuntime = this._sessionManager.activeSession?.runtimeMetadata;
        const runtimes = this._runtimeManager.runtimes;
        const candidates: RuntimeQuickPickCandidate[] = [];

        for (const languageId of this._runtimeManager.getSupportedLanguageIds()) {
            const provider = this._requireRuntimeProvider(languageId);
            const preferredRuntime = this._runtimeStartupService.getPreferredRuntime(languageId);
            const runtimeMetadataByPath = new Map(
                runtimes
                    .filter(runtime => runtime.languageId === languageId)
                    .map(runtime => [runtime.runtimePath, runtime]),
            );

            for (const installation of this._runtimeManager.getInstallations(languageId)) {
                const runtimePath = provider.getRuntimePath(installation);
                const metadata = runtimeMetadataByPath.get(runtimePath);
                candidates.push({
                    languageId,
                    languageName: provider.languageName,
                    languageVersion: metadata?.languageVersion,
                    runtimeName: metadata?.runtimeName ?? provider.formatRuntimeName(installation),
                    runtimePath,
                    runtimeSource: this._toRuntimeSourceLabel(
                        metadata?.runtimeSource ?? provider.getRuntimeSource(installation),
                    ),
                    iconPath: provider.getRuntimeIconPath?.(installation),
                    installation,
                    preferred:
                        metadata?.runtimeId === preferredRuntime?.runtimeId ||
                        runtimePath === preferredRuntime?.runtimePath,
                    active:
                        languageId === activeRuntime?.languageId &&
                        runtimePath === activeRuntime.runtimePath,
                });
            }
        }

        return buildRuntimeQuickPickItems(candidates);
    }

    private async _pickRuntimeFromCache(): Promise<RuntimeQuickPickItem | undefined> {
        const quickPick = vscode.window.createQuickPick<RuntimeQuickPickItem>();
        quickPick.title = 'Start New Interpreter Session';
        quickPick.canSelectMany = false;

        const rebuildItems = () => {
            const activeKey = quickPick.activeItems[0]
                ? `${quickPick.activeItems[0].languageId}:${quickPick.activeItems[0].runtimePath}`
                : undefined;
            quickPick.items = this._buildRuntimeQuickPickItems();
            const activeItem = activeKey
                ? quickPick.items.find(item => `${item.languageId}:${item.runtimePath}` === activeKey)
                : quickPick.items.find(item => item.picked);
            if (activeItem) {
                quickPick.activeItems = [activeItem];
            }

            quickPick.busy = this._runtimeManager.isDiscovering;
            quickPick.placeholder = quickPick.busy
                ? 'Discovering interpreters...'
                : quickPick.items.some(item => item.kind !== vscode.QuickPickItemKind.Separator)
                    ? undefined
                    : 'No interpreters found';
        };

        return new Promise<RuntimeQuickPickItem | undefined>(resolve => {
            let accepted: RuntimeQuickPickItem | undefined;
            const disposables = [
                this._runtimeManager.onDidDiscoverRuntime(rebuildItems),
                this._runtimeManager.onDidFinishDiscovery(rebuildItems),
                quickPick.onDidAccept(() => {
                    const selected = quickPick.activeItems[0];
                    if (!selected?.languageId || selected.installation === undefined) {
                        return;
                    }
                    accepted = selected;
                    quickPick.hide();
                }),
                quickPick.onDidHide(() => {
                    disposables.forEach(disposable => disposable.dispose());
                    quickPick.dispose();
                    resolve(accepted);
                }),
            ];

            rebuildItems();
            quickPick.show();
        });
    }

    private _resolveInstallationForSession(session: RuntimeSession): unknown | undefined {
        const provider = this._runtimeManager.getRuntimeProvider(session.runtimeMetadata.languageId);
        if (!provider) {
            return undefined;
        }

        const runtimePath = session.runtimeMetadata.runtimePath;
        return this._runtimeManager.getInstallations(session.runtimeMetadata.languageId).find(
            inst => provider.getRuntimePath(inst) === runtimePath
        ) ?? provider.restoreInstallationFromMetadata?.(session.runtimeMetadata);
    }

    private _buildSessionQuickLaunchItems(): SessionQuickLaunchPickItem[] {
        const activeSession = this._sessionManager.activeSession;
        const preferredLanguageId = this._getPreferredLanguageId();
        const provider = this._requireRuntimeProvider(preferredLanguageId);

        const orderedSessions: RuntimeSession[] = [];
        if (activeSession) {
            orderedSessions.push(activeSession);
        }

        const allSessions = this._sessionManager.sessions;
        for (let index = allSessions.length - 1; index >= 0; index--) {
            const session = allSessions[index];
            if (activeSession && session.sessionId === activeSession.sessionId) {
                continue;
            }
            orderedSessions.push(session);
        }

        const seenRuntimePaths = new Set<string>();
        const runtimeItems: SessionQuickLaunchPickItem[] = [];

        for (const session of orderedSessions) {
            if (session.runtimeMetadata.languageId !== preferredLanguageId) {
                continue;
            }

            const installation = this._resolveInstallationForSession(session);
            if (!installation) {
                continue;
            }

            const runtimePath = provider.getRuntimePath(installation);
            if (seenRuntimePaths.has(runtimePath)) {
                continue;
            }

            seenRuntimePaths.add(runtimePath);
            runtimeItems.push({
                label: provider.formatRuntimeName(installation),
                iconPath: provider.getRuntimeIconPath?.(installation),
                description: this._toRuntimeSourceLabel(provider.getRuntimeSource(installation)),
                detail: runtimePath,
                installation,
            });
        }

        const items: SessionQuickLaunchPickItem[] = [];
        if (runtimeItems.length > 0) {
            items.push({
                kind: vscode.QuickPickItemKind.Separator,
                label: 'Recent',
            });
            items.push(...runtimeItems);
        }

        // Running sessions section (for switching)
        if (allSessions.length > 1) {
            items.push({
                kind: vscode.QuickPickItemKind.Separator,
                label: 'Running Sessions',
            });
            for (const session of allSessions) {
                const installation = this._resolveInstallationForSession(session);
                const sessionName = session.dynState.sessionName
                    || session.sessionMetadata.sessionName
                    || session.runtimeMetadata.runtimeName
                    || 'R';
                const isActive = activeSession && session.sessionId === activeSession.sessionId;
                items.push({
                    label: sessionName,
                    iconPath: installation
                        ? (provider.getRuntimeIconPath?.(installation) ?? new vscode.ThemeIcon('debug-start'))
                        : new vscode.ThemeIcon('debug-start'),
                    description: isActive ? '(active)' : '',
                    action: 'switchSession',
                    sessionId: session.sessionId,
                });
            }
        }

        items.push({
            kind: vscode.QuickPickItemKind.Separator,
            label: 'More',
        });
        items.push({
            label: 'Start Another...',
            iconPath: new vscode.ThemeIcon('add'),
            detail: `Choose from discovered ${provider.languageName} installations`,
            alwaysShow: true,
            action: 'startAnother',
        });

        return items;
    }

    private _wireSessionLifecycle(session: RuntimeSession): void {
        if (this._sessionLifecycleWiredIds.has(session.sessionId)) {
            return;
        }

        this._sessionLifecycleWiredIds.add(session.sessionId);
        this._webviewManager.onSessionCreated(session);

        session.onDidEndSession((exit) => {
            if (exit.reason === RuntimeExitReason.Restart) {
                this._outputChannel.debug(
                    `[SupervisorApplication] Session ${session.sessionId} exited for restart; keeping webview subscriptions`
                );
                return;
            }

            this._webviewManager.onSessionClosed(session.sessionId);
            this._sessionLifecycleWiredIds.delete(session.sessionId);
        });
    }

    private async _startSessionForInstallation(
        languageId: string,
        installation: unknown,
        sessionName: string
    ): Promise<RuntimeSession> {
        const provider = this._requireRuntimeProvider(languageId);
        this._outputChannel.info(
            `[Ark] Creating new ${provider.languageName} session (${provider.getRuntimePath(installation)})...`
        );

        const runtimeMetadata = provider.createRuntimeMetadata(
            this._context,
            installation,
            this._outputChannel,
        );
        this._sessionManager.registerDiscoveredRuntime(languageId, installation, runtimeMetadata);

        const sessionId = await this._sessionManager.startNewRuntimeSession(
            runtimeMetadata.runtimeId,
            sessionName || runtimeMetadata.runtimeName,
            LanguageRuntimeSessionMode.Console,
            undefined,
            'SupervisorApplication.startSessionForInstallation',
            RuntimeStartMode.Starting,
            true,
        );
        const session = this._sessionManager.getSession(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} was not created`);
        }

        this._updateConsoleSessionsExistContext();
        this._outputChannel.info('[Ark] New session created successfully');
        return session;
    }

    private async _startNewSessionFromDiscoveredRuntimes(): Promise<void> {
        try {
            const selected = await this._pickRuntimeFromCache();
            if (!selected?.languageId || selected.installation === undefined) {
                return;
            }

            const provider = this._requireRuntimeProvider(selected.languageId);
            await this._startSessionForInstallation(
                selected.languageId,
                selected.installation,
                provider.formatRuntimeName(selected.installation)
            );
        } catch (error) {
            this._outputChannel.error(`[Ark] Failed to create session: ${error}`);
            vscode.window.showErrorMessage(`Failed to create session: ${error}`);
        }
    }

    private async _quickLaunchSessionFromRecentRuntimes(): Promise<void> {
        try {
            const items = this._buildSessionQuickLaunchItems();
            const selected = await vscode.window.showQuickPick<SessionQuickLaunchPickItem>(items, {
                title: 'Quick Launch Session',
                placeHolder: 'Start a new session from a recent runtime or choose another installation',
                canPickMany: false,
            });

            if (!selected) {
                return;
            }

            if (selected.action === 'startAnother') {
                await this._startNewSessionFromDiscoveredRuntimes();
                return;
            }

            if (selected.action === 'switchSession' && selected.sessionId) {
                this._sessionManager.focusSession(selected.sessionId);
                return;
            }

            if (!selected.installation) {
                return;
            }

            await this._startSessionForInstallation(
                this._getPreferredLanguageId(),
                selected.installation,
                this._requireRuntimeProvider(this._getPreferredLanguageId()).formatRuntimeName(selected.installation)
            );
        } catch (error) {
            this._outputChannel.error(`[Ark] Failed to quick launch session: ${error}`);
            vscode.window.showErrorMessage(`Failed to quick launch session: ${error}`);
        }
    }

    private async _duplicateActiveSession(): Promise<void> {
        const currentSession = this._sessionManager.activeSession;
        if (!currentSession) {
            vscode.window.showWarningMessage('No active session to duplicate');
            return;
        }

        const runtimePath = currentSession.runtimeMetadata.runtimePath;
        const provider = this._runtimeManager.getRuntimeProvider(currentSession.runtimeMetadata.languageId);
        const installation = this._runtimeManager.getInstallations(currentSession.runtimeMetadata.languageId).find(
            inst => provider?.getRuntimePath(inst) === runtimePath
        ) ?? provider?.restoreInstallationFromMetadata?.(currentSession.runtimeMetadata);
        if (!installation) {
            this._outputChannel.warn(`[Ark] Active runtime ${runtimePath} not found in cache; opening runtime picker`);
            await this._startNewSessionFromDiscoveredRuntimes();
            return;
        }

        try {
            await this._startSessionForInstallation(
                currentSession.runtimeMetadata.languageId,
                installation,
                currentSession.dynState.sessionName || currentSession.sessionMetadata.sessionName || currentSession.runtimeMetadata.runtimeName
            );
        } catch (error) {
            this._outputChannel.error(`[Ark] Failed to duplicate session: ${error}`);
            vscode.window.showErrorMessage(`Failed to duplicate session: ${error}`);
        }
    }

    /**
     * Activates the application - called from extension.ts activate()
     */
    async activate(): Promise<void> {
        this._outputChannel.info('[Ark] Activating extension...');

        try {
            await migrateLegacyPlotsConfiguration(this._outputChannel);
        } catch (error) {
            this._outputChannel.warn(`[Plots] Failed to migrate legacy configuration: ${error}`);
        }

        // Initialize service-class services before session restore so they can
        // observe reconnect events fired during session manager initialization.
        await this._surfaceLifecycle.initialize();
        this._dataScienceSurfaceLifecycle.initialize();
        this._notebookSurfaceLifecycle.initialize();
        this._connectionsService.initialize();
        this._consoleService.initialize();
        this._variablesService.initialize();
        this._plotsService.initialize(this._sessionManager);
        this._packagesService.initialize();
        this._previewService.initialize();
        this._richOutputRouter.initialize();
        this._helpService.initialize();
        this._positronDataExplorerService.initialize();
        this._runtimeFrontendEventService.initialize();

        // Pre-initialize DuckDB-WASM engine so it's ready when a file is opened.
        // Fire-and-forget: failure here is non-fatal (DuckDB will retry on first use).
        DuckDBInstance.getInstance().initialize().catch(err => {
            this._outputChannel.warn(`[DuckDB] Pre-initialization failed (will retry on first use): ${err}`);
        });

        // Initialize session manager (acquires Supervisor API + restores sessions)
        await this._sessionManager.initialize();

        // Start non-blocking runtime discovery (Positron pattern)
        // Discovery happens in background; runtimes are available incrementally
        this._runtimeManager.onDidDiscoverRuntime(({ provider, installation }) => {
            const runtimePath = provider.getRuntimePath(installation);
            this._outputChannel.info(
                `[Discovery] Found ${provider.formatRuntimeName(installation)} (${provider.getRuntimeSource(installation)}) at ${runtimePath}`
            );

            // Update session manager with first discovered installation per language
            if (!this._sessionManager.getDefaultInstallation(provider.languageId)) {
                this._sessionManager.setDefaultInstallation(provider.languageId, installation);
            }
        });

        this._runtimeManager.onDidFinishDiscovery(() => {
            const summary = this._runtimeManager
                .getSupportedLanguageIds()
                .map(languageId => {
                    const provider = this._runtimeManager.getRuntimeProvider(languageId);
                    const label = provider?.languageName ?? languageId;
                    const count = this._runtimeManager.getInstallations(languageId).length;
                    return `${label}: ${count}`;
                })
                .join(', ');

            this._outputChannel.info(`[Discovery] Complete.${summary ? ` ${summary} installation(s) available.` : ''}`);
        });

        // Register webview providers
        this._webviewManager.registerProviders();

        // Register commands
        this._registerCommands();

        // Listen for session changes and keep context keys in sync
        this._disposables.push(
            this._sessionManager.onWillStartSession((event) => {
                this._wireSessionLifecycle(event.session);
            }),
            this._sessionManager.onDidChangeForegroundSession(() => {
                this._updateConsoleSessionsExistContext();
            }),
            this._sessionManager.onDidDeleteRuntimeSession((sessionId) => {
                this._webviewManager.onSessionClosed(sessionId);
                this._sessionLifecycleWiredIds.delete(sessionId);
                this._updateConsoleSessionsExistContext();
            })
        );

        for (const session of this._sessionManager.sessions) {
            this._wireSessionLifecycle(session);
        }

        this._updateConsoleSessionsExistContext();

        this._activated = true;
        this._outputChannel.info('[Ark] Extension activated');
        this._startDeferredActivationTasks();
    }

    /**
     * Registers extension commands
     */
    private _registerCommands(): void {
        // Register console actions (execute code, clear console, etc.)
        const consoleActions = registerConsoleActions(this._consoleService, this._outputChannel);
        this._disposables.push(...consoleActions);
        this._disposables.push(
            vscode.commands.registerCommand(
                InternalCommandIds.lspGetStatementRange,
                async (
                    documentUri: string,
                    position: { line: number; character: number }
                ) => {
                    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(documentUri));
                    const session = this._sessionManager.getConsoleSessionForLanguage(document.languageId);
                    if (!session) {
                        return undefined;
                    }

                    if (document.languageId !== session.runtimeMetadata.languageId) {
                        return undefined;
                    }

                    const provider = await resolveStatementRangeProvider(
                        session,
                        this._outputChannel,
                    );
                    if (!provider) {
                        return undefined;
                    }

                    const tokenSource = new vscode.CancellationTokenSource();
                    try {
                        const statementRange = await provider.provideStatementRange(
                            document,
                            new vscode.Position(position.line, position.character),
                            tokenSource.token
                        );
                        if (!statementRange) {
                            return undefined;
                        }

                        return {
                            kind: 'success' as const,
                            range: {
                                start: {
                                    line: statementRange.range.start.line,
                                    character: statementRange.range.start.character,
                                },
                                end: {
                                    line: statementRange.range.end.line,
                                    character: statementRange.range.end.character,
                                },
                            },
                            code: statementRange.code,
                        };
                    } catch (error) {
                        if (isStatementRangeSyntaxError(error)) {
                            return {
                                kind: 'rejection' as const,
                                rejectionKind: 'syntax' as const,
                                line: error.line,
                            };
                        }
                        this._outputChannel.debug(`[LspBridge] Failed to resolve statement range: ${error}`);
                        return undefined;
                    } finally {
                        tokenSource.dispose();
                    }
                }
            )
        );

        this._registerTestCommands();

        // Start New Session command (Positron pattern: choose from discovered runtimes)
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.newSession, async () => {
                await this._startNewSessionFromDiscoveredRuntimes();
            })
        );

        // Duplicate Active Session command (Positron pattern when session exists)
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.duplicateSession, async () => {
                await this._duplicateActiveSession();
            })
        );

        // Quick Launch Session command (Positron-style dropdown equivalent)
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.quickLaunchSession, async () => {
                await this._quickLaunchSessionFromRecentRuntimes();
            })
        );

        // Interrupt Execution command
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.interruptExecution, async () => {
                const session = this._sessionManager.activeSession;
                const instance = session
                    ? this._consoleService.getConsoleInstance(session.sessionId)
                    : this._consoleService.activePositronConsoleInstance;

                if (instance) {
                    instance.interrupt();
                } else if (session) {
                    await session.interrupt();
                } else {
                    vscode.window.showWarningMessage('No active session');
                }
            })
        );

        // Clear Output command
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.clearOutput, () => {
                const activeSessionId = this._sessionManager.activeSessionId;
                if (activeSessionId) {
                    const instance = this._consoleService.getConsoleInstance(activeSessionId);
                    if (instance?.clearConsole()) {
                        this._webviewManager.consoleProvider?.clearOutput(activeSessionId, 'user');
                    }
                }
            })
        );

        // Show Supervisor Log command
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.showSupervisorLog, () => {
                this._sessionManager.showSupervisorLog();
            })
        );

        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.refreshRuntimeSessions, () => {
                this._runtimeSessionsTreeProvider.refresh();
            })
        );

        // Open Plots Gallery command
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.openPlotsGallery, async (options?: { openInNewWindow?: boolean }) => {
                await this._plotsGalleryEditorProvider.openGallery(options);
            })
        );

        // Open Plot in Editor command (requires plotId and plotData from webview)
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.openPlotInEditor, async (
                plotId?: string,
                plotData?: string | PlotEditorContent,
                viewColumn?: vscode.ViewColumn,
                moveToNewWindow?: boolean,
            ) => {
                if (plotId && plotData) {
                    this._plotEditorProvider.openPlotInEditor(plotId, plotData, undefined, viewColumn);
                    if (moveToNewWindow) {
                        await this._plotEditorProvider.markAsNewWindowPanel(plotId);
                    }
                } else {
                    vscode.window.showWarningMessage('No plot selected to open in editor');
                }
            })
        );

        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.packagesRefresh, async () => {
                try {
                    await this._packagesService.refreshPackages();
                } catch (error) {
                    this._outputChannel.warn(`[Packages] Refresh failed: ${error}`);
                    vscode.window.showErrorMessage(`Failed to refresh packages: ${error}`);
                }
            })
        );

        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.packagesUpdateAll, async () => {
                try {
                    await this._packagesService.updateAllPackages();
                } catch (error) {
                    this._outputChannel.warn(`[Packages] Update all failed: ${error}`);
                    vscode.window.showErrorMessage(`Failed to update packages: ${error}`);
                }
            })
        );

        // Close active plot/gallery panel in auxiliary windows.
        // This avoids cmd+w in an auxiliary plots window leaking into main editor close behavior.
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.closeAuxiliaryPlotsPanel, async () => {
                if (this._plotEditorProvider.closeActivePanel()) {
                    return;
                }

                if (this._plotsGalleryEditorProvider.closeActivePanel()) {
                    return;
                }
                this._outputChannel.debug('No active plots panel found to close in auxiliary window');
            })
        );

        // Data Explorer command aliases (keep command surface explicit in app registrations).
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerCopy, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.Copy)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerCopyTableData, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.CopyTableData)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerCollapseSummary, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.CollapseSummary)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerExpandSummary, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.ExpandSummary)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerSummaryOnLeft, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.SummaryOnLeft)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerSummaryOnRight, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.SummaryOnRight)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerSummaryOnLeftActive, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.SummaryOnLeft)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerSummaryOnRightActive, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.SummaryOnRight)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerClearColumnSorting, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.ClearColumnSorting)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerConvertToCode, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.ConvertToCode)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerOpenAsPlaintext, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.OpenAsPlaintext)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerOpenAsSpreadsheet, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.OpenAsSpreadsheet)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerToggleFileOptions, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.ToggleFileOptions)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerMoveToNewWindow, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.MoveToNewWindow)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerShowColumnContextMenu, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.ShowColumnContextMenu)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerShowRowContextMenu, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.ShowRowContextMenu)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerShowCellContextMenu, () =>
                vscode.commands.executeCommand(PositronDataExplorerCommandId.ShowCellContextMenu)
            )
        );

        // Open file in Data Explorer using DuckDB-WASM (context menu on file explorer)
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerOpenFile, async (uri?: vscode.Uri) => {
                if (!uri) {
                    // If invoked from the command palette, prompt for a file
                    const files = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectMany: false,
                        filters: {
                            'Data Files': ['csv', 'tsv', 'parquet', 'parq'],
                        },
                        title: 'Open Data File in Data Explorer',
                    });
                    if (!files || files.length === 0) {
                        return;
                    }
                    uri = files[0];
                }

                try {
                    await this._positronDataExplorerService.openWithDuckDB(uri);
                } catch (error) {
                    this._outputChannel.error(`[DuckDB] Failed to open file: ${error}`);
                    vscode.window.showErrorMessage(`Failed to open file in Data Explorer: ${error}`);
                }
            })
        );
    }


    private _registerTestCommands(): void {
        this._disposables.push(
            vscode.commands.registerCommand(TestCommandIds.getRuntimeSnapshot, (): TestRuntimeSnapshot => {
                const sessionId = this._sessionManager.activeSessionId;
                const session = sessionId ? this._sessionManager.getSession(sessionId) : undefined;
                const serializedState = sessionId
                    ? this._consoleService.getSerializedState(sessionId)
                    : undefined;
                const clientManager = session?.clientManager;

                return {
                    activeSessionId: sessionId,
                    sessionIds: this._sessionManager.sessions.map(entry => entry.sessionId),
                    lastClearReason: sessionId
                        ? this._webviewManager.consoleProvider?.getLastClearReason(sessionId)
                        : undefined,
                    serializedState,
                    workingDirectory: session?.workingDirectory,
                    lspState: session?.lsp.state,
                    lspTransportKind: session?.lspTransportKind,
                    clientInfo: clientManager
                        ? {
                            variablesClientId: clientManager.variablesClientId,
                            uiClientId: clientManager.uiClientId,
                            helpClientId: clientManager.helpClientId,
                            clientIds: clientManager.clientInstances.map(client => client.getClientId()),
                        }
                        : undefined,
                };
            }),
            vscode.commands.registerCommand(TestCommandIds.emitRuntimeEvent, (params: TestEmitRuntimeEventParams) => {
                if (!params || typeof params.name !== 'string') {
                    throw new Error('name is required');
                }

                const runtimeEventName = params.name as UiFrontendEvent;
                if (!Object.values(UiFrontendEvent).includes(runtimeEventName)) {
                    throw new Error(`Unsupported runtime event: ${params.name}`);
                }

                const sessionId = params.sessionId ?? this._sessionManager.activeSessionId;
                if (!sessionId) {
                    throw new Error('No active session available');
                }

                this._sessionManager.emitTestRuntimeEvent(sessionId, runtimeEventName, params.data ?? {});
                return { sessionId, name: runtimeEventName };
            }),
            vscode.commands.registerCommand(TestCommandIds.simulateCommOpen, (params: TestSimulateCommOpenParams) => {
                if (!params || typeof params.targetName !== 'string' || params.targetName.length === 0) {
                    throw new Error('targetName is required');
                }

                const sessionId = params.sessionId ?? this._sessionManager.activeSessionId;
                if (!sessionId) {
                    throw new Error('No active session available');
                }

                const session = this._sessionManager.getSession(sessionId);
                const manager = session?.clientManager;
                if (!session || !manager) {
                    throw new Error(`RuntimeClientManager is unavailable for session ${sessionId}`);
                }

                const commId = params.commId ?? `e2e-comm-open-${Date.now()}`;
                const handled = session.emitRuntimeMessage({
                    id: commId,
                    event_clock: 0,
                    parent_id: '',
                    when: new Date().toISOString(),
                    type: LanguageRuntimeMessageType.CommOpen,
                    comm_id: commId,
                    target_name: params.targetName,
                    data: params.data ?? {},
                    metadata: {},
                });

                return {
                    handled,
                    hasClient: !!manager.getClient(commId),
                    clientIds: manager.clientInstances.map(client => client.getClientId()),
                };
            }),
            vscode.commands.registerCommand(TestCommandIds.simulateCommData, (params: TestSimulateCommDataParams) => {
                if (!params || typeof params.commId !== 'string' || params.commId.length === 0) {
                    throw new Error('commId is required');
                }

                const sessionId = params.sessionId ?? this._sessionManager.activeSessionId;
                if (!sessionId) {
                    throw new Error('No active session available');
                }

                const session = this._sessionManager.getSession(sessionId);
                const manager = session?.clientManager;
                if (!session || !manager) {
                    throw new Error(`RuntimeClientManager is unavailable for session ${sessionId}`);
                }

                let registration: vscode.Disposable | undefined;
                if (params.register) {
                    registration = manager.registerClientInstance(params.commId);
                }

                try {
                    const handled = session.emitRuntimeMessage({
                        id: `${params.commId}-data`,
                        event_clock: 0,
                        parent_id: `${params.commId}-parent`,
                        when: new Date().toISOString(),
                        type: LanguageRuntimeMessageType.CommData,
                        comm_id: params.commId,
                        data: params.data ?? {},
                        metadata: {},
                    });

                    return { handled };
                } finally {
                    registration?.dispose();
                }
            }),
            vscode.commands.registerCommand(TestCommandIds.clearConsoleAsUser, () => {
                const instance = this._consoleService.activePositronConsoleInstance;
                if (!instance) {
                    throw new Error('No active console instance');
                }

                instance.clearConsole();
                this._webviewManager.consoleProvider?.clearOutput(instance.sessionId, 'user');
                return { sessionId: instance.sessionId };
            }),
            vscode.commands.registerCommand(TestCommandIds.setWorkingDirectory, async (params: TestSetWorkingDirectoryParams) => {
                if (!params || typeof params.workingDirectory !== 'string' || params.workingDirectory.length === 0) {
                    throw new Error('workingDirectory is required');
                }

                const sessionId = params.sessionId ?? this._sessionManager.activeSessionId;
                if (!sessionId) {
                    throw new Error('No active session available');
                }

                const session = this._sessionManager.getSession(sessionId);
                if (!session) {
                    throw new Error(`Session ${sessionId} not found`);
                }

                await session.setWorkingDirectory(params.workingDirectory);
                return {
                    sessionId,
                    workingDirectory: session.workingDirectory,
                };
            }),
            vscode.commands.registerCommand(TestCommandIds.openConsoleCodeInEditor, async (params: TestOpenConsoleCodeInEditorParams) => {
                if (!params || typeof params.code !== 'string') {
                    throw new Error('code is required');
                }

                const success = await this._webviewManager.consoleProvider?.openCodeInEditor(params.code);
                return { success: !!success };
            })
        );
    }

    /**
     * Gets the log output channel for child components
     */
    get outputChannel(): vscode.LogOutputChannel {
        return this._outputChannel;
    }

    /**
     * Gets the console service (1:1 Positron pattern)
     */
    get consoleService(): PositronConsoleService {
        return this._consoleService;
    }

    /**
     * Gets the variables service (1:1 Positron pattern)
     */
    get variablesService(): PositronVariablesService {
        return this._variablesService;
    }

    /**
     * Gets the plots service (1:1 Positron pattern)
     */
    get plotsService(): PositronPlotsService {
        return this._plotsService;
    }

    /**
     * Disposes of all resources
     */
    dispose(): void {
        void this.shutdown();
    }

    async shutdown(): Promise<void> {
        this._outputChannel.debug('[Ark] Disposing extension...');

        await this._consoleService.flushPersistedState();
        await this._runtimeStartupService.prepareForExtensionHostShutdown();
        await this._sessionManager.detachForExtensionHostShutdown();
        await this._surfaceLifecycle.whenPersisted();

        this._languageCapabilityRegistry.dispose();

        this._disposables.forEach(d => {
            if (d !== this._sessionManager) {
                d.dispose();
            }
        });
    }
}
