/*---------------------------------------------------------------------------------------------
 *  PositronHelpService Implementation
 *  Handles Help comm events and routes them to the Help view.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ViewIds } from '../../coreCommandIds';
import { RuntimeSessionService } from '../../runtime/runtimeSession';
import { RuntimeSession } from '../../runtime/session';
import { HelpClientInstance } from '../../runtime/HelpClientInstance';
import { ShowHelpEvent, ShowHelpKind } from '../../runtime/comms/positronHelpComm';
import { PositronHelpInstance } from './helpInstance';
import { HelpEntry } from './helpEntry';
import { IHelpEntry, IPositronHelpService } from './interfaces/helpService';
import { isLocalhost } from './utils';
import { HelpProxyService, HelpProxyInfo } from './helpProxyService';

export interface HelpViewProvider {
    reveal(preserveFocus: boolean): Promise<void>;
    find(): Promise<void>;
    getWelcomeUrl(): string | undefined;
}

/**
 * PositronHelpService class (aligned with Positron).
 */
export class PositronHelpService implements IPositronHelpService {
    private readonly _helpEntries: HelpEntry[] = [];
    private _helpEntryIndex = -1;
    private _helpViewProvider: HelpViewProvider | undefined;
    private _welcomeUrl: string | undefined;

    private readonly _helpClients = new Map<string, HelpClientInstance>();
    private readonly _instancesBySessionId = new Map<string, PositronHelpInstance>();
    private readonly _proxyService: HelpProxyService;

    private readonly _onDidChangeCurrentHelpEntryEmitter = new vscode.EventEmitter<IHelpEntry | undefined>();

    constructor(
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _outputChannel: vscode.LogOutputChannel,
        extensionUri: vscode.Uri
    ) {
        this._proxyService = new HelpProxyService(extensionUri, _outputChannel);
    }

    //#region IPositronHelpService Implementation
    get helpEntries(): IHelpEntry[] {
        return this._helpEntries;
    }

    get currentHelpEntry(): IHelpEntry | undefined {
        if (this._helpEntryIndex < 0 || this._helpEntryIndex >= this._helpEntries.length) {
            return undefined;
        }
        return this._helpEntries[this._helpEntryIndex];
    }

    get canNavigateBackward(): boolean {
        return this._helpEntryIndex > 0;
    }

    get canNavigateForward(): boolean {
        return this._helpEntryIndex >= 0 && this._helpEntryIndex < this._helpEntries.length - 1;
    }

    readonly onDidChangeCurrentHelpEntry = this._onDidChangeCurrentHelpEntryEmitter.event;

    initialize(): void {
        this._outputChannel.debug('[PositronHelpService] Initializing...');

        this._sessionManager.onWillStartSession(e => {
            this._ensureInstance(e.session);
        });

        this._sessionManager.onDidDeleteRuntimeSession(sessionId => {
            this._disposeInstance(sessionId);
            this.deleteHelpEntriesForSession(sessionId);
        });

        for (const session of this._sessionManager.sessions) {
            this._ensureInstance(session);
        }

        this._outputChannel.debug('[PositronHelpService] Initialized');
    }

    openHelpEntryIndex(helpEntryIndex: number): void {
        if (helpEntryIndex < 0 || helpEntryIndex > this._helpEntries.length - 1) {
            this._outputChannel.error(`[PositronHelpService] Help entry index ${helpEntryIndex} is out of range.`);
            return;
        }

        this._helpEntryIndex = helpEntryIndex;
        this._onDidChangeCurrentHelpEntryEmitter.fire(this._helpEntries[this._helpEntryIndex]);
    }

    async showHelpTopic(languageId: string, topic: string): Promise<boolean> {
        for (const client of this._helpClients.values()) {
            if (client.languageId === languageId) {
                return client.showHelpTopic(topic);
            }
        }

        this._outputChannel.warn(
            `[PositronHelpService] Can't show help for ${topic}: no runtime for language ${languageId} is active.`
        );
        return false;
    }

    navigate(fromUrl: string, toUrl: string): void {
        void this._navigateAsync(fromUrl, toUrl);
    }

    navigateBackward(): void {
        if (this._helpEntryIndex > 0) {
            this._helpEntryIndex -= 1;
            this._onDidChangeCurrentHelpEntryEmitter.fire(this._helpEntries[this._helpEntryIndex]);
        }
    }

    navigateForward(): void {
        if (this._helpEntryIndex < this._helpEntries.length - 1) {
            this._helpEntryIndex += 1;
            this._onDidChangeCurrentHelpEntryEmitter.fire(this._helpEntries[this._helpEntryIndex]);
        }
    }

    async find(): Promise<void> {
        if (!this._helpViewProvider) {
            await this._revealHelpView(false);
        }

        await this._helpViewProvider?.find();
    }

    showWelcomePage(): void {
        if (!this._welcomeUrl) {
            this._outputChannel.debug('[PositronHelpService] Welcome URL not yet available.');
            return;
        }

        const helpEntry = new HelpEntry(
            this._welcomeUrl,
            this._welcomeUrl,
            '',
            '',
            ''
        );
        helpEntry.setTitle('Welcome');
        this._addHelpEntry(helpEntry);
    }

    dispose(): void {
        for (const instance of this._instancesBySessionId.values()) {
            instance.dispose();
        }
        this._instancesBySessionId.clear();
        this._helpClients.clear();
        this._proxyService.dispose();
        this._onDidChangeCurrentHelpEntryEmitter.dispose();
    }
    //#endregion

    setHelpViewProvider(provider: HelpViewProvider | undefined): void {
        this._helpViewProvider = provider;
        this._welcomeUrl = provider?.getWelcomeUrl();
    }

    registerHelpClient(session: RuntimeSession, client: HelpClientInstance): void {
        this._helpClients.set(session.sessionId, client);
    }

    unregisterHelpClient(sessionId: string): void {
        this._helpClients.delete(sessionId);
    }

    updateCurrentEntryTitle(title?: string): void {
        const entry = this.currentHelpEntry as HelpEntry | undefined;
        entry?.setTitle(title);
    }

    updateCurrentEntryScroll(scrollX: number, scrollY: number): void {
        const entry = this.currentHelpEntry as HelpEntry | undefined;
        entry?.setScroll(scrollX, scrollY);
    }

    setProxyServerStyles(styles: Record<string, string | number>): void {
        this._proxyService.setStyles(styles);
    }

    async handleShowHelpEvent(session: RuntimeSession, showHelpEvent: ShowHelpEvent): Promise<void> {
        if (showHelpEvent.kind !== ShowHelpKind.Url) {
            this._outputChannel.error(`[PositronHelpService] Unsupported help event kind: ${showHelpEvent.kind}`);
            return;
        }

        let targetUrl: URL;
        try {
            targetUrl = new URL(showHelpEvent.content);
        } catch (error) {
            this._outputChannel.error(`[PositronHelpService] Invalid help URL: ${showHelpEvent.content}`);
            return;
        }

        this._outputChannel.info(`[PositronHelpService] Show help for: ${targetUrl.toString()}`);

        if (!isLocalhost(targetUrl.hostname)) {
            try {
                await vscode.env.openExternal(vscode.Uri.parse(targetUrl.toString()));
            } catch {
                vscode.window.showErrorMessage(`Unable to open '${targetUrl.toString()}'.`);
            }
            return;
        }

        let proxyInfo: HelpProxyInfo | undefined;
        try {
            proxyInfo = await this._proxyService.startProxyServer(targetUrl.origin);
        } catch (error) {
            this._outputChannel.error(`[PositronHelpService] Failed to start help proxy for ${targetUrl.origin}: ${error}`);
        }

        if (!proxyInfo) {
            vscode.window.showErrorMessage('The Ark help service is unavailable.');
            return;
        }

        const sourceUrl = this._proxyService.buildProxyUrl(targetUrl, proxyInfo);

        await this._revealHelpView(!showHelpEvent.focus);

        const helpEntry = new HelpEntry(
            sourceUrl,
            targetUrl.toString(),
            session.runtimeMetadata.languageId,
            session.sessionId,
            session.runtimeMetadata.languageName
        );

        this._addHelpEntry(helpEntry);
    }

    deleteHelpEntriesForSession(sessionId: string): void {
        const toDelete = this._helpEntries.filter(entry => entry.sessionId === sessionId);
        if (!toDelete.length) {
            return;
        }

        const current = this.currentHelpEntry as HelpEntry | undefined;
        this._helpEntries.splice(0, this._helpEntries.length, ...this._helpEntries.filter(e => e.sessionId !== sessionId));

        if (current) {
            if (current.sessionId === sessionId) {
                this._helpEntryIndex = this._helpEntries.length ? Math.min(this._helpEntryIndex, this._helpEntries.length - 1) : -1;
            } else {
                this._helpEntryIndex = this._helpEntries.indexOf(current);
            }
            this._onDidChangeCurrentHelpEntryEmitter.fire(this.currentHelpEntry);
        } else {
            this._helpEntryIndex = this._helpEntries.length ? this._helpEntries.length - 1 : -1;
            this._onDidChangeCurrentHelpEntryEmitter.fire(this.currentHelpEntry);
        }

        toDelete.forEach(entry => entry.dispose());

        const cleanupOrigins = new Set(toDelete.map(entry => new URL(entry.targetUrl).origin));
        const activeOrigins = new Set(this._helpEntries.map(entry => new URL(entry.targetUrl).origin));

        cleanupOrigins.forEach(origin => {
            if (!activeOrigins.has(origin)) {
                this._proxyService.stopProxyServer(origin);
            }
        });
    }

    private _ensureInstance(session: RuntimeSession): void {
        if (this._instancesBySessionId.has(session.sessionId)) {
            return;
        }
        const instance = new PositronHelpInstance(session, this, this._outputChannel);
        this._instancesBySessionId.set(session.sessionId, instance);
    }

    private _disposeInstance(sessionId: string): void {
        const instance = this._instancesBySessionId.get(sessionId);
        if (instance) {
            instance.dispose();
            this._instancesBySessionId.delete(sessionId);
        }
    }

    private async _navigateAsync(fromUrl: string, toUrl: string): Promise<void> {
        const current = this.currentHelpEntry as HelpEntry | undefined;
        if (!current || current.sourceUrl !== fromUrl) {
            return;
        }

        const currentTarget = new URL(current.targetUrl);
        const to = new URL(toUrl);

        let targetUrl: URL;
        if (to.origin === new URL(current.sourceUrl).origin) {
            targetUrl = new URL(toUrl);
            targetUrl.protocol = currentTarget.protocol;
            targetUrl.hostname = currentTarget.hostname;
            targetUrl.port = currentTarget.port;
        } else {
            targetUrl = to;
        }

        const isPdf = targetUrl.pathname.toLowerCase().endsWith('.pdf');
        if (!isLocalhost(targetUrl.hostname) || isPdf) {
            try {
                await vscode.env.openExternal(vscode.Uri.parse(targetUrl.toString()));
            } catch {
                vscode.window.showErrorMessage(`Unable to open '${targetUrl.toString()}'.`);
            }
            return;
        }

        let proxyInfo: HelpProxyInfo | undefined;
        try {
            proxyInfo = await this._proxyService.startProxyServer(targetUrl.origin);
        } catch (error) {
            this._outputChannel.error(`[PositronHelpService] Failed to start help proxy for ${targetUrl.origin}: ${error}`);
        }

        if (!proxyInfo) {
            vscode.window.showErrorMessage('The Ark help service is unavailable.');
            return;
        }

        const sourceUrl = this._proxyService.buildProxyUrl(targetUrl, proxyInfo);

        const helpEntry = new HelpEntry(
            sourceUrl,
            targetUrl.toString(),
            current.languageId,
            current.sessionId,
            current.languageName
        );

        this._addHelpEntry(helpEntry);
    }

    private _addHelpEntry(helpEntry: HelpEntry): void {
        if (this._helpEntries[this._helpEntryIndex]?.sourceUrl === helpEntry.sourceUrl) {
            return;
        }

        const deletedHelpEntries = [
            ...this._helpEntries.splice(
                this._helpEntryIndex + 1,
                Infinity,
                helpEntry
            ),
            ...this._helpEntries.splice(
                0,
                Math.max(0, this._helpEntries.length - 10)
            )
        ];

        deletedHelpEntries.forEach(entry => entry.dispose());

        this._helpEntryIndex = this._helpEntries.length - 1;
        this._onDidChangeCurrentHelpEntryEmitter.fire(this.currentHelpEntry);
    }

    private async _revealHelpView(preserveFocus: boolean): Promise<void> {
        if (this._helpViewProvider) {
            await this._helpViewProvider.reveal(preserveFocus);
            return;
        }

        const editorToRestore = preserveFocus ? vscode.window.activeTextEditor : undefined;
        const restoreFocus = async (): Promise<void> => {
            if (!editorToRestore) {
                return;
            }
            await vscode.window.showTextDocument(editorToRestore.document, {
                viewColumn: editorToRestore.viewColumn,
                preserveFocus: false
            });
        };

        try {
            await vscode.commands.executeCommand('workbench.views.action.showView', ViewIds.help);
        } finally {
            await restoreFocus();
        }
    }
}
