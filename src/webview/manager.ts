import * as vscode from 'vscode';
import { ConsoleViewProvider } from './consoleProvider';
import { VariablesViewProvider } from './variablesProvider';
import { PlotsViewProvider } from './plotsProvider';
import { ViewerViewProvider } from './viewerProvider';
import { HelpViewProvider } from './helpProvider';
import { ViewCommands, ViewIds } from '../coreCommandIds';
import { SessionManager } from '../runtime/sessionManager';
import { RuntimeSession } from '../runtime/session';
import { PositronConsoleService } from '../services/console';
import { PositronVariablesService } from '../services/variables';
import { PositronPlotsService } from '../runtime/positronPlotsService';
import { PositronPreviewService } from '../services/preview';
import { PositronHelpService } from '../services/help';
import { RuntimeStartupService } from '../runtime/runtimeStartupService';

/**
 * Manages all webview providers for the extension.
 * Handles webview creation, lifecycle, and communication.
 */
export class WebviewManager implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _consoleProvider: ConsoleViewProvider | undefined;
    private _variablesProvider: VariablesViewProvider | undefined;
    private _plotsProvider: PlotsViewProvider | undefined;
    private _viewerProvider: ViewerViewProvider | undefined;
    private _helpProvider: HelpViewProvider | undefined;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _outputChannel: vscode.LogOutputChannel,
        private readonly _sessionManager: SessionManager,
        private readonly _consoleService: PositronConsoleService,
        private readonly _variablesService: PositronVariablesService,
        private readonly _plotsService: PositronPlotsService,
        private readonly _previewService: PositronPreviewService,
        private readonly _helpService: PositronHelpService,
        private readonly _runtimeStartupService: RuntimeStartupService,
        private readonly _getAdditionalLocalResourceRoots: () => readonly vscode.Uri[],
        private readonly _getLanguageMonacoSupportModuleUris: (webview: vscode.Webview) => Readonly<Record<string, string>>,
        private readonly _getLanguageTextMateGrammarDefinitions: (
            webview: vscode.Webview,
        ) => Readonly<Record<string, { scopeName: string; grammarUrl: string }>>,
    ) { }

    /**
     * Registers all webview providers with VS Code
     */
    registerProviders(): void {
        // Console Panel Provider
        this._consoleProvider = new ConsoleViewProvider(
            this._context.extensionUri,
            this._outputChannel,
            this._sessionManager,
            this._consoleService,
            this._runtimeStartupService,
            this._getAdditionalLocalResourceRoots,
            this._getLanguageMonacoSupportModuleUris,
            this._getLanguageTextMateGrammarDefinitions,
        );
        this._consoleService.setConsoleViewProvider(this._consoleProvider);
        this._disposables.push(
            vscode.window.registerWebviewViewProvider(
                ViewIds.console,
                this._consoleProvider,
                {
                    webviewOptions: {
                        retainContextWhenHidden: true
                    }
                }
            )
        );

        // Variables Sidebar Provider
        this._variablesProvider = new VariablesViewProvider(
            this._context.extensionUri,
            this._outputChannel,
            this._sessionManager,
            this._variablesService,
            this._getAdditionalLocalResourceRoots,
        );
        this._disposables.push(
            vscode.window.registerWebviewViewProvider(
                ViewIds.variables,
                this._variablesProvider,
                {
                    webviewOptions: {
                        retainContextWhenHidden: true
                    }
                }
            )
        );

        // Plots Sidebar Provider
        this._plotsProvider = new PlotsViewProvider(
            this._context.extensionUri,
            this._outputChannel,
            this._sessionManager,
            this._plotsService,
            this._consoleService,
            this._getAdditionalLocalResourceRoots,
        );
        this._disposables.push(
            vscode.window.registerWebviewViewProvider(
                ViewIds.plots,
                this._plotsProvider,
                {
                    webviewOptions: {
                        retainContextWhenHidden: true
                    }
                }
            )
        );

        // Viewer Sidebar Provider
        this._viewerProvider = new ViewerViewProvider(
            this._context.extensionUri,
            this._outputChannel,
            this._previewService,
            this._consoleService,
            this._getAdditionalLocalResourceRoots,
        );
        this._disposables.push(
            vscode.window.registerWebviewViewProvider(
                ViewIds.viewer,
                this._viewerProvider,
                {
                    webviewOptions: {
                        retainContextWhenHidden: true
                    }
                }
            )
        );

        // Help Panel Provider
        this._helpProvider = new HelpViewProvider(
            this._context.extensionUri,
            this._outputChannel,
            this._helpService,
            this._getAdditionalLocalResourceRoots,
        );
        this._disposables.push(
            vscode.window.registerWebviewViewProvider(
                ViewIds.help,
                this._helpProvider,
                {
                    webviewOptions: {
                        retainContextWhenHidden: true
                    }
                }
            )
        );

        // Subscribe to service events (Positron 1:1 pattern)
        this._subscribeToServiceEvents();

        // Bootstrap providers with sessions that may have been restored before
        // webview providers were registered.
        for (const session of this._sessionManager.sessions) {
            this.onSessionCreated(session);
        }

        this._outputChannel.debug('[WebviewManager] Webview providers registered');
    }

    /**
     * Subscribes providers to service events (Positron pattern).
     * Services manage instance lifecycle; providers react to service events.
     */
    private _subscribeToServiceEvents(): void {
        // Console service events
        this._disposables.push(
            this._consoleService.onDidStartPositronConsoleInstance(instance => {
                this._outputChannel.debug(`[WebviewManager] Console instance started: ${instance.sessionId}`);
                // Providers can subscribe directly to console instance events
            }),
            this._consoleService.onDidDeletePositronConsoleInstance(instance => {
                this._outputChannel.debug(`[WebviewManager] Console instance deleted: ${instance.sessionId}`);
            }),
            this._consoleService.onDidChangeActivePositronConsoleInstance(instance => {
                this._outputChannel.debug(`[WebviewManager] Active console instance changed: ${instance?.sessionId || 'none'}`);
            }),
            this._consoleService.onDidExecuteCode(event => {
                this._outputChannel.debug(`[WebviewManager] Code executed: ${event.executionId}`);
            })
        );

        // Variables service events
        this._disposables.push(
            this._variablesService.onDidStartPositronVariablesInstance(instance => {
                this._outputChannel.debug(`[WebviewManager] Variables instance started: ${instance.session.sessionId}`);
            }),
            this._variablesService.onDidStopPositronVariablesInstance(instance => {
                this._outputChannel.debug(`[WebviewManager] Variables instance stopped: ${instance.session.sessionId}`);
            }),
            this._variablesService.onDidChangeActivePositronVariablesInstance(instance => {
                this._outputChannel.debug(`[WebviewManager] Active variables instance changed: ${instance?.session.sessionId || 'none'}`);
            })
        );

        // Plots service events
        this._disposables.push(
            this._plotsService.onDidEmitPlot(plot => {
                this._outputChannel.debug(`[WebviewManager] Plot emitted: ${plot.id} from session ${plot.metadata.session_id}`);
            }),
            this._plotsService.onDidSelectPlot(plotId => {
                this._outputChannel.debug(`[WebviewManager] Plot selected: ${plotId || 'none'}`);
            }),
            this._plotsService.onDidRemovePlot(plot => {
                this._outputChannel.debug(`[WebviewManager] Plot removed: ${plot.id}`);
            })
        );
    }

    refreshLanguageSupportAssets(): void {
        this._consoleProvider?.refreshLanguageSupportAssets();
    }

    /**
     * Called when a new session is created (multi-session support).
     * Subscribes all providers to the new session's events.
     */
    onSessionCreated(session: RuntimeSession): void {
        this._outputChannel.debug(`[WebviewManager] Session created: ${session.sessionId} (multi-session)`);
        this._consoleProvider?.subscribeToSession(session);
        this._variablesProvider?.subscribeToSession(session);
        this._plotsProvider?.subscribeToSession(session);
    }

    /**
     * Called when a session is closed (multi-session support).
     * Unsubscribes all providers from the session's events.
     */
    onSessionClosed(sessionId: string): void {
        this._outputChannel.debug(`[WebviewManager] Session closed: ${sessionId} (multi-session)`);
        this._consoleProvider?.unsubscribeFromSession(sessionId);
        this._variablesProvider?.unsubscribeFromSession(sessionId);
        this._plotsProvider?.unsubscribeFromSession(sessionId);
    }

    /**
     * Shows the console webview
     */
    showConsole(): void {
        vscode.commands.executeCommand(ViewCommands.consoleFocus);
    }

    /**
     * Gets the console provider
     */
    get consoleProvider(): ConsoleViewProvider | undefined {
        return this._consoleProvider;
    }

    /**
     * Gets the variables provider
     */
    get variablesProvider(): VariablesViewProvider | undefined {
        return this._variablesProvider;
    }

    /**
     * Gets the plots provider
     */
    get plotsProvider(): PlotsViewProvider | undefined {
        return this._plotsProvider;
    }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }
}
