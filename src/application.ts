import * as vscode from 'vscode';
import {
    type ILanguageContributionServices,
    type IBinaryProvider,
    type ILanguageLspFactory,
    type ILanguageRuntimeProvider,
    type ILanguageRuntimeRegistration,
    type ILanguageSupportRegistration,
    type ILanguageWebviewAssets,
    type IRuntimeSessionMetadata,
    type ISupervisorFrameworkApi,
    type JupyterKernelSpec,
    type LanguageRuntimeDynState,
    type LanguageRuntimeMetadata,
    type LanguageContributionRegistrationResult,
    LanguageRuntimeSessionMode,
    RuntimeStartMode,
} from './api';
import { WebviewManager } from './webview/manager';
import { PositronNewFolderService } from './newFolder/positronNewFolderService';
import { RuntimeManager } from './runtime/manager';
import { RuntimeSession } from './runtime/session';
import { RuntimeSessionService } from './runtime/runtimeSession';
import { RuntimeStartupService } from './runtime/runtimeStartup';
import { PositronConsoleService } from './services/console';
import { PositronVariablesService } from './services/variables';
import { PositronPreviewService } from './services/preview';
import { PositronHelpService } from './services/help';
import { PositronPlotsService } from './runtime/positronPlotsService';
import { PlotEditorProvider, PlotsGalleryEditorProvider } from './editor';
import { registerConsoleActions } from './services/console/consoleActions';
import { DataExplorerService, DataExplorerEditorProvider, DataExplorerCustomEditorProvider } from './services/dataExplorer';
import { DuckDBInstance } from './services/duckdb/duckdbInstance';
import { DataExplorerCommandId } from './services/dataExplorer/dataExplorerEditorProvider';
import { CoreCommandIds, ContextKeys, InternalCommandIds, TestCommandIds } from './coreCommandIds';
import { UiFrontendEvent } from './runtime/comms/positronUiComm';
import {
    initializePositronCompatibility,
    LanguageRuntimeMessageType,
    type LanguageRuntimeSession,
    RuntimeExitReason,
    setForegroundSessionProvider,
} from './supervisor/positron';
import { ensureBinaries } from './binaryManager';

interface RuntimeQuickPickItem extends vscode.QuickPickItem {
    installation: unknown;
}

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

interface IMutableLanguageRuntimeProvider<TInstallation = unknown>
    extends ILanguageRuntimeProvider<TInstallation> {
    lspFactory?: ILanguageLspFactory;
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
    private readonly _runtimeStartupService: RuntimeStartupService;
    private readonly _positronNewFolderService: PositronNewFolderService;
    private readonly _outputChannel: vscode.LogOutputChannel;
    private readonly _languageSupport = new Map<string, ILanguageSupportRegistration<any>>();
    private readonly _pendingBinaryProviders = new Map<string, IBinaryProvider>();
    private readonly _pendingLspFactories = new Map<string, ILanguageLspFactory>();
    private readonly _languageWebviewAssets = new Map<string, ILanguageWebviewAssets>();
    private readonly _activatedLanguageContributionIds = new Set<string>();
    private _activated = false;
    private _runtimeStartupStarted = false;
    readonly version = '0.1.0';

    // Service-class session management (1:1 Positron pattern)
    private readonly _consoleService: PositronConsoleService;
    private readonly _variablesService: PositronVariablesService;
    private readonly _previewService: PositronPreviewService;
    private readonly _helpService: PositronHelpService;
    private readonly _plotsService: PositronPlotsService;

    // Editor providers for plots
    private readonly _plotEditorProvider: PlotEditorProvider;
    private readonly _plotsGalleryEditorProvider: PlotsGalleryEditorProvider;

    // Data Explorer service (1:1 Positron pattern)
    private readonly _dataExplorerService: DataExplorerService;
    private readonly _dataExplorerEditorProvider: DataExplorerEditorProvider;
    private readonly _sessionLifecycleWiredIds = new Set<string>();

    constructor(
        private readonly _context: vscode.ExtensionContext,
    ) {
        initializePositronCompatibility(_context);

        // Create log output channel for logging with level support
        this._outputChannel = vscode.window.createOutputChannel('Ark', { log: true });
        this._disposables.push(this._outputChannel);

        // Initialize session manager first (webview needs it)
        this._sessionManager = new RuntimeSessionService(_context, this._outputChannel);
        this._disposables.push(this._sessionManager);
        this._disposables.push(
            setForegroundSessionProvider(() =>
                this._sessionManager.activeSession?.kernelSession as unknown as
                    LanguageRuntimeSession | undefined
            )
        );

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
        this._consoleService = new PositronConsoleService(
            this._sessionManager,
            this._outputChannel,
            this._context,
            this._runtimeStartupService,
        );
        this._disposables.push(this._consoleService);

        this._variablesService = new PositronVariablesService(this._sessionManager, this._outputChannel);
        this._disposables.push(this._variablesService);

        this._plotsService = new PositronPlotsService(this._outputChannel, this._context);
        this._disposables.push(this._plotsService);

        this._previewService = new PositronPreviewService(this._sessionManager, this._plotsService, this._outputChannel);
        this._disposables.push(this._previewService);

        this._helpService = new PositronHelpService(this._sessionManager, this._outputChannel, this._context.extensionUri);
        this._disposables.push(this._helpService);

        // Initialize editor providers for plots
        this._plotEditorProvider = new PlotEditorProvider(
            this._context.extensionUri,
            this._outputChannel,
            this._plotsService,
        );
        this._disposables.push(this._plotEditorProvider);

        // Initialize Data Explorer service and editor provider
        this._dataExplorerService = new DataExplorerService(this._sessionManager, this._outputChannel);
        this._disposables.push(this._dataExplorerService);

        // Data Explorer editor provider (opens in editor area as tabs)
        this._dataExplorerEditorProvider = new DataExplorerEditorProvider(
            this._context.extensionUri,
            this._dataExplorerService,
            this._outputChannel,
            () => this._getLanguageWebviewLocalResourceRoots(),
            (webview) => this._getLanguageMonacoSupportModuleUris(webview),
            (webview) => this._getLanguageTextMateGrammarDefinitions(webview),
        );
        this._disposables.push(this._dataExplorerEditorProvider);

        // Custom editor provider (enables "Reopen With → Data Explorer" for data files)
        const dataExplorerCustomEditorProvider = new DataExplorerCustomEditorProvider(
            this._dataExplorerService,
            this._dataExplorerEditorProvider,
            this._outputChannel
        );
        this._disposables.push(
            vscode.window.registerCustomEditorProvider(
                DataExplorerCustomEditorProvider.viewType,
                dataExplorerCustomEditorProvider,
                { supportsMultipleEditorsPerDocument: false }
            )
        );

        // Initialize webview manager with session manager and services
        this._webviewManager = new WebviewManager(
            _context,
            this._outputChannel,
            this._sessionManager,
            this._consoleService,
            this._variablesService,
            this._plotsService,
            this._previewService,
            this._helpService,
            this._runtimeStartupService,
            () => this._getLanguageWebviewLocalResourceRoots(),
            (webview) => this._getLanguageMonacoSupportModuleUris(webview),
            (webview) => this._getLanguageTextMateGrammarDefinitions(webview),
        );
        this._disposables.push(this._webviewManager);

        this._plotsGalleryEditorProvider = new PlotsGalleryEditorProvider(
            this._context.extensionUri,
            this._outputChannel,
            () => this._webviewManager.plotsProvider
        );
        this._disposables.push(this._plotsGalleryEditorProvider);

        this._updateGlobalContexts();
        this._outputChannel.debug('[Ark] Application initialized');
    }

    get runtimeSessionService(): ISupervisorFrameworkApi['runtimeSessionService'] {
        return this._sessionManager;
    }

    get runtimeStartupService(): ISupervisorFrameworkApi['runtimeStartupService'] {
        return this._runtimeStartupService;
    }

    get positronNewFolderService(): ISupervisorFrameworkApi['positronNewFolderService'] {
        return this._positronNewFolderService;
    }

    getApi(): ISupervisorFrameworkApi {
        return {
            runtimeSessionService: this.runtimeSessionService,
            runtimeStartupService: this.runtimeStartupService,
            positronNewFolderService: this.positronNewFolderService,
            version: this.version,
            startRuntime: (metadata, source, activate) =>
                this.startRuntime(metadata, source, activate),
            createSession: (runtimeMetadata, sessionMetadata, kernelSpec, dynState) =>
                this.createSession(runtimeMetadata, sessionMetadata, kernelSpec, dynState),
            restoreSession: (runtimeMetadata, sessionMetadata, dynState) =>
                this.restoreSession(runtimeMetadata, sessionMetadata, dynState),
            validateSession: (sessionId) => this.validateSession(sessionId),
            registerLanguageSupport: <TInstallation = unknown>(
                registration: ILanguageSupportRegistration<TInstallation>
            ) => this.registerLanguageSupport(registration),
            registerLanguageRuntime: <TInstallation = unknown>(
                registration:
                    | ILanguageRuntimeRegistration<TInstallation>
                    | ILanguageSupportRegistration<TInstallation>
                    | ILanguageRuntimeProvider<TInstallation>
            ) => this.registerLanguageRuntime(registration),
            registerLspFactory: (factory: ILanguageLspFactory) => this.registerLspFactory(factory),
            registerBinaryProvider: (provider: IBinaryProvider) => this.registerBinaryProvider(provider),
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

    async registerLanguageSupport<TInstallation = unknown>(
        registration: ILanguageSupportRegistration<TInstallation>
    ): Promise<void> {
        const { runtimeProvider } = registration;
        const lspFactory = this._pendingLspFactories.get(runtimeProvider.languageId);
        if (lspFactory) {
            this._setLanguageLspFactory(runtimeProvider, lspFactory);
        }

        const normalizedRegistration: ILanguageSupportRegistration<TInstallation> = {
            ...registration,
            binaryProvider: registration.binaryProvider ?? this._pendingBinaryProviders.get(runtimeProvider.languageId),
        };
        const existing = this._languageSupport.get(runtimeProvider.languageId);
        if (existing) {
            if (existing.runtimeProvider === runtimeProvider &&
                existing.binaryProvider === normalizedRegistration.binaryProvider &&
                existing.languageContribution === normalizedRegistration.languageContribution &&
                existing.webviewAssets === normalizedRegistration.webviewAssets) {
                return;
            }

            if (existing.runtimeProvider === runtimeProvider) {
                const updatedRegistration: ILanguageSupportRegistration<TInstallation> = {
                    runtimeProvider,
                    binaryProvider: normalizedRegistration.binaryProvider ?? existing.binaryProvider,
                    languageContribution: normalizedRegistration.languageContribution ?? existing.languageContribution,
                    webviewAssets: normalizedRegistration.webviewAssets ?? existing.webviewAssets,
                };
                this._languageSupport.set(runtimeProvider.languageId, updatedRegistration);
                this._setLanguageWebviewAssets(runtimeProvider.languageId, updatedRegistration.webviewAssets);
                this._refreshLanguageSupportAssetsInWebviews();

                if (this._activated) {
                    await this._initializeLanguageSupportAfterActivation(updatedRegistration);
                    this._startDeferredActivationTasks();
                }
                return;
            }

            throw new Error(`Language support for '${runtimeProvider.languageId}' is already registered`);
        }

        this._languageSupport.set(runtimeProvider.languageId, normalizedRegistration);
        this._setLanguageWebviewAssets(runtimeProvider.languageId, normalizedRegistration.webviewAssets);
        this._refreshLanguageSupportAssetsInWebviews();
        this._sessionManager.registerRuntimeProvider(runtimeProvider);
        this._runtimeManager.registerRuntimeProvider(runtimeProvider);

        if (!this._activated) {
            return;
        }

        await this._initializeLanguageSupportAfterActivation(normalizedRegistration);
        this._startDeferredActivationTasks();
    }

    async registerLanguageRuntime<TInstallation = unknown>(
        registration:
            | ILanguageRuntimeRegistration<TInstallation>
            | ILanguageSupportRegistration<TInstallation>
            | ILanguageRuntimeProvider<TInstallation>
    ): Promise<void> {
        await this.registerLanguageSupport(
            this._normalizeRuntimeRegistration(registration)
        );
    }

    async registerLspFactory(factory: ILanguageLspFactory): Promise<void> {
        this._pendingLspFactories.set(factory.languageId, factory);

        const existing = this._languageSupport.get(factory.languageId);
        if (!existing) {
            return;
        }

        this._setLanguageLspFactory(existing.runtimeProvider, factory);
    }

    async registerBinaryProvider(provider: IBinaryProvider): Promise<void> {
        this._pendingBinaryProviders.set(provider.ownerId, provider);

        const existing = this._languageSupport.get(provider.ownerId);
        if (!existing || existing.binaryProvider === provider) {
            return;
        }

        const updatedRegistration: ILanguageSupportRegistration = {
            ...existing,
            binaryProvider: provider,
        };
        this._languageSupport.set(provider.ownerId, updatedRegistration);

        if (this._activated) {
            await this._ensureRegisteredBinaries();
        }
    }

    private _getLanguageContributionServices(): ILanguageContributionServices {
        return {
            logChannel: this._outputChannel,
            runtimeSessionService: this._sessionManager,
            runtimeStartupService: this._runtimeStartupService,
            positronNewFolderService: this._positronNewFolderService,
            runtimeManager: this._runtimeManager,
            positronConsoleService: {
                onDidChangeConsoleWidth: this._consoleService.onDidChangeConsoleWidth,
                revealConsole: (preserveFocus?: boolean) =>
                    this._consoleService.revealConsole(preserveFocus),
                focusConsole: () => this._consoleService.focusConsole(),
                showConsole: () => this._consoleService.showConsole(),
                getConsoleWidth: () => {
                    return this._consoleService.getConsoleWidth();
                },
                executeCode: (languageId, sessionId, code, attribution, focus) =>
                    this._consoleService.executeCode(
                        languageId,
                        sessionId,
                        code,
                        attribution,
                        focus
                    ),
            },
            positronHelpService: this._helpService,
        };
    }

    private _normalizeContributionRegistrationResult(
        result: LanguageContributionRegistrationResult
    ): vscode.Disposable[] {
        if (!result) {
            return [];
        }

        return Array.isArray(result)
            ? [...result]
            : [result as vscode.Disposable];
    }

    private async _activateLanguageContribution(
        registration: ILanguageSupportRegistration<any>
    ): Promise<void> {
        const { languageContribution, runtimeProvider } = registration;
        if (!languageContribution || this._activatedLanguageContributionIds.has(runtimeProvider.languageId)) {
            return;
        }

        const contributionDisposables = this._normalizeContributionRegistrationResult(
            await languageContribution.registerContributions(this._getLanguageContributionServices())
        );
        this._activatedLanguageContributionIds.add(runtimeProvider.languageId);
        this._disposables.push(...contributionDisposables);
    }

    private async _activateRegisteredLanguageContributions(): Promise<void> {
        for (const registration of this._languageSupport.values()) {
            await this._activateLanguageContribution(registration);
        }
    }

    private async _initializeLanguageSupportAfterActivation(
        registration: ILanguageSupportRegistration<any>
    ): Promise<void> {
        await this._activateLanguageContribution(registration);
        await this._ensureRegisteredBinaries();

        const { runtimeProvider } = registration;
        if (this._sessionManager.isInitialized &&
            !this._sessionManager.getDefaultInstallation(runtimeProvider.languageId)) {
            const installation = await runtimeProvider.resolveInitialInstallation(this._outputChannel);
            if (installation) {
                this._sessionManager.setDefaultInstallation(runtimeProvider.languageId, installation);
            }
        }

        if (this._runtimeManager.discoveryComplete) {
            await this._runtimeStartupService.rediscoverAllRuntimes();
        } else {
            void this._runtimeManager.discoverAllRuntimes([]).catch((error) => {
                this._outputChannel.error(`[Discovery] Failed to refresh runtime discovery: ${error}`);
            });
        }
    }

    private _updateGlobalContexts(): void {
        const isDevelopment = this._context.extensionMode !== vscode.ExtensionMode.Production;
        void vscode.commands.executeCommand('setContext', ContextKeys.isDevelopment, isDevelopment);
    }

    private _setLanguageWebviewAssets(
        languageId: string,
        assets: ILanguageWebviewAssets | undefined
    ): void {
        if (!assets) {
            this._languageWebviewAssets.delete(languageId);
            return;
        }

        this._languageWebviewAssets.set(languageId, assets);
    }

    private _refreshLanguageSupportAssetsInWebviews(): void {
        this._webviewManager.refreshLanguageSupportAssets();
    }

    private _startDeferredActivationTasks(): void {
        if (!this._activated || this._languageSupport.size === 0) {
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

        for (const assets of this._languageWebviewAssets.values()) {
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
            Array.from(this._languageWebviewAssets.entries())
                .flatMap(([languageId, assets]) => {
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
            Array.from(this._languageWebviewAssets.entries())
                .flatMap(([languageId, assets]) => {
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
        const provider = this._requireRuntimeProvider(this._getPreferredLanguageId());
        const installations = this._runtimeManager.getInstallations(provider.languageId);

        return installations.map(installation => ({
            label: provider.formatRuntimeName(installation),
            iconPath: provider.getRuntimeIconPath?.(installation),
            description: this._toRuntimeSourceLabel(provider.getRuntimeSource(installation)),
            detail: provider.getRuntimePath(installation),
            picked: provider.getRuntimePath(installation) === this._sessionManager.activeSession?.runtimeMetadata.runtimePath,
            installation,
        }));
    }

    private async _pickRuntimeFromCache(): Promise<unknown | undefined> {
        const provider = this._requireRuntimeProvider(this._getPreferredLanguageId());
        let items = this._buildRuntimeQuickPickItems();

        // Positron-style behavior: quick pick should be responsive and cache-driven.
        // If cache is still empty, wait once for background discovery to complete.
        if (items.length === 0 && this._runtimeManager.isDiscovering) {
            await new Promise<void>(resolve => {
                const disposable = this._runtimeManager.onDidFinishDiscovery(() => {
                    disposable.dispose();
                    resolve();
                });
            });
            items = this._buildRuntimeQuickPickItems();
        }

        if (items.length === 0) {
            return undefined;
        }

        const selected = await vscode.window.showQuickPick<RuntimeQuickPickItem>(items, {
            title: `Start New ${provider.languageName} Session`,
            placeHolder: `Select ${provider.languageName} installation to start`,
            canPickMany: false,
        });

        return selected?.installation;
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
            const provider = this._requireRuntimeProvider(this._getPreferredLanguageId());
            const installation = await this._pickRuntimeFromCache();
            if (!installation) {
                this._outputChannel.warn('[Ark] No discovered runtimes available in cache');
                void vscode.window.showWarningMessage(
                    `No discovered ${provider.languageName} installations available yet. Wait for discovery to finish or configure the language runtime.`
                );
                return;
            }

            await this._startSessionForInstallation(
                provider.languageId,
                installation,
                provider.formatRuntimeName(installation)
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

        // Ensure binaries are available (downloads on first run for universal VSIX)
        await this._ensureRegisteredBinaries();

        // Initialize service-class services before session restore so they can
        // observe reconnect events fired during session manager initialization.
        this._consoleService.initialize();
        this._variablesService.initialize();
        this._plotsService.initialize(this._sessionManager);
        this._previewService.initialize();
        this._helpService.initialize();
        this._dataExplorerService.initialize();

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
        await this._activateRegisteredLanguageContributions();

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

    private _normalizeRuntimeRegistration<TInstallation>(
        registration:
            | ILanguageRuntimeRegistration<TInstallation>
            | ILanguageSupportRegistration<TInstallation>
            | ILanguageRuntimeProvider<TInstallation>
    ): ILanguageSupportRegistration<TInstallation> {
        if ('discoverInstallations' in registration) {
            return {
                runtimeProvider: registration,
            };
        }

        if ('runtimeProvider' in registration) {
            return registration;
        }

        return {
            runtimeProvider: registration.provider,
        };
    }

    private _setLanguageLspFactory<TInstallation>(
        runtimeProvider: ILanguageRuntimeProvider<TInstallation>,
        factory: ILanguageLspFactory
    ): void {
        const mutableProvider = runtimeProvider as IMutableLanguageRuntimeProvider<TInstallation>;
        if (mutableProvider.lspFactory === factory) {
            return;
        }

        mutableProvider.lspFactory = factory;
    }

    private async _ensureRegisteredBinaries(): Promise<void> {
        const binaryProviders = Array.from(this._languageSupport.values())
            .map(entry => entry.binaryProvider)
            .filter((provider): provider is NonNullable<typeof provider> => !!provider);

        if (binaryProviders.length === 0) {
            return;
        }

        await ensureBinaries(
            this._context,
            this._outputChannel,
            binaryProviders
        );
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
                    const provider = session?.lsp.statementRangeProvider;
                    if (!session || !provider) {
                        return undefined;
                    }

                    if (document.languageId !== session.runtimeMetadata.languageId) {
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

        // Open Plots Gallery command
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.openPlotsGallery, async (options?: { openInNewWindow?: boolean }) => {
                await this._plotsGalleryEditorProvider.openGallery(options);
            })
        );

        // Open Plot in Editor command (requires plotId and plotData from webview)
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.openPlotInEditor, async (plotId?: string, plotData?: string, viewColumn?: vscode.ViewColumn, moveToNewWindow?: boolean) => {
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
                vscode.commands.executeCommand(DataExplorerCommandId.Copy)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerCopyTableData, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.CopyTableData)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerCollapseSummary, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.CollapseSummary)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerExpandSummary, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.ExpandSummary)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerSummaryOnLeft, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.SummaryOnLeft)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerSummaryOnRight, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.SummaryOnRight)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerSummaryOnLeftActive, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.SummaryOnLeft)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerSummaryOnRightActive, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.SummaryOnRight)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerClearColumnSorting, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.ClearColumnSorting)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerConvertToCode, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.ConvertToCode)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerOpenAsPlaintext, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.OpenAsPlaintext)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerToggleFileOptions, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.ToggleFileOptions)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerMoveToNewWindow, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.MoveToNewWindow)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerShowColumnContextMenu, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.ShowColumnContextMenu)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerShowRowContextMenu, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.ShowRowContextMenu)
            )
        );
        this._disposables.push(
            vscode.commands.registerCommand(CoreCommandIds.dataExplorerShowCellContextMenu, () =>
                vscode.commands.executeCommand(DataExplorerCommandId.ShowCellContextMenu)
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
                    await this._dataExplorerService.openWithDuckDB(uri);
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
                if (!manager) {
                    throw new Error(`RuntimeClientManager is unavailable for session ${sessionId}`);
                }

                const commId = params.commId ?? `e2e-comm-open-${Date.now()}`;
                const handled = manager.openClientInstance({
                    id: commId,
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
                if (!manager) {
                    throw new Error(`RuntimeClientManager is unavailable for session ${sessionId}`);
                }

                let registration: vscode.Disposable | undefined;
                if (params.register) {
                    registration = manager.registerClientInstance(params.commId);
                }

                try {
                    const handled = manager.emitDidReceiveClientMessage({
                        id: `${params.commId}-data`,
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
        await this._sessionManager.shutdown();

        this._disposables.forEach(d => {
            if (d !== this._sessionManager) {
                d.dispose();
            }
        });
    }
}
