import * as vscode from 'vscode';
import { RuntimeClientType, RuntimeState } from '../internal/runtimeTypes';
import {
    type BusyEvent,
    type ClearConsoleEvent,
    type OpenEditorEvent,
    type OpenWorkspaceEvent,
    type PromptStateEvent,
    type SetEditorSelectionsEvent,
    type ShowHtmlFileEvent,
    type ShowMessageEvent,
    type ShowUrlEvent,
    type WorkingDirectoryEvent,
    type OpenWithSystemEvent,
    type ClearWebviewPreloadsEvent,
    UiFrontendEvent,
} from './comms/positronUiComm';
import { RuntimeClientInstance } from './RuntimeClientInstance';
import { UiClientInstance } from './UiClientInstance';
import type { RuntimeSession } from './session';
import type { ILanguageRuntimeGlobalEvent } from './runtimeEvents';

class DeferredPromise<T> {
    readonly promise: Promise<T>;
    private _resolve!: (value: T) => void;
    private _reject!: (reason?: unknown) => void;
    private _isSettled = false;

    constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }

    get isSettled(): boolean {
        return this._isSettled;
    }

    complete(value: T): void {
        if (!this._isSettled) {
            this._isSettled = true;
            this._resolve(value);
        }
    }

    error(reason?: unknown): void {
        if (!this._isSettled) {
            this._isSettled = true;
            this._reject(reason);
        }
    }
}

/**
 * Positron-aligned active session container. It owns runtime UI forwarding and
 * tracks per-session state that should not live on the global session service.
 */
export class ActiveRuntimeSession implements vscode.Disposable {
    public state: RuntimeState;
    public workingDirectory = '';
    public hasConsole: boolean;

    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _onDidReceiveRuntimeEventEmitter =
        new vscode.EventEmitter<ILanguageRuntimeGlobalEvent>();
    private readonly _onUiClientStartedEmitter =
        new vscode.EventEmitter<UiClientInstance>();

    private _uiClient: UiClientInstance | undefined;
    private _uiClientId: string | undefined;
    private _uiClientDisposables: vscode.Disposable[] = [];
    private _runtimeClientManagerDisposable: vscode.Disposable | undefined;
    private _startingUiClient: DeferredPromise<string> | undefined;

    constructor(
        public readonly session: RuntimeSession,
        hasConsole: boolean,
    ) {
        this.state = session.state;
        this.workingDirectory = session.workingDirectory ?? '';
        this.hasConsole = hasConsole;

        this._disposables.push(
            this._onDidReceiveRuntimeEventEmitter,
            this._onUiClientStartedEmitter,
            session.onDidCreateClientManager(() => {
                this._attachToCurrentClientManager();
            }),
            session.onDidChangeRuntimeState((state) => {
                this.state = state;
            }),
            session.onDidChangeWorkingDirectory((directory) => {
                this.workingDirectory = directory;
            }),
        );

        this._attachToCurrentClientManager();
    }

    get uiClient(): UiClientInstance | undefined {
        return this._uiClient;
    }

    readonly onDidReceiveRuntimeEvent = this._onDidReceiveRuntimeEventEmitter.event;
    readonly onUiClientStarted = this._onUiClientStartedEmitter.event;

    register<T extends vscode.Disposable>(disposable: T): T {
        this._disposables.push(disposable);
        return disposable;
    }

    async startUiClient(): Promise<string> {
        if (this._uiClient && this._uiClientId) {
            return this._uiClientId;
        }

        if (this._startingUiClient && !this._startingUiClient.isSettled) {
            return this._startingUiClient.promise;
        }

        this._startingUiClient = new DeferredPromise<string>();
        this._attachToCurrentClientManager();
        return this._startingUiClient.promise;
    }

    dispose(): void {
        this._runtimeClientManagerDisposable?.dispose();
        this._disposeUiClient();
        this._startingUiClient?.error(new Error(`UI client was disposed for session '${this.session.sessionId}'`));
        this._startingUiClient = undefined;
        this._disposables.forEach((disposable) => disposable.dispose());
    }

    private _attachToCurrentClientManager(): void {
        this._runtimeClientManagerDisposable?.dispose();
        this._runtimeClientManagerDisposable = undefined;

        const manager = this.session.clientManager;
        if (!manager) {
            return;
        }

        this._runtimeClientManagerDisposable = manager.watchClient(
            RuntimeClientType.Ui,
            (client) => this._attachUiClientInstance(client),
        );
    }

    private _attachUiClientInstance(client: RuntimeClientInstance): void {
        this._disposeUiClient();

        const uiClient = new UiClientInstance(client);
        this._uiClient = uiClient;
        this._uiClientId = client.getClientId();

        const emitRuntimeEvent = (name: UiFrontendEvent, data: unknown) => {
            this._onDidReceiveRuntimeEventEmitter.fire({
                session_id: this.session.sessionId,
                event: {
                    name,
                    data,
                },
            });
        };

        this._uiClientDisposables = [
            uiClient,
            uiClient.onDidBusy((event: BusyEvent) => {
                const busy = !!event.busy;
                this.session.dynState.busy = busy;
                emitRuntimeEvent(UiFrontendEvent.Busy, { busy });
            }),
            uiClient.onDidClearConsole((event: ClearConsoleEvent) => {
                emitRuntimeEvent(UiFrontendEvent.ClearConsole, event);
            }),
            uiClient.onDidOpenEditor((event: OpenEditorEvent) => {
                emitRuntimeEvent(UiFrontendEvent.OpenEditor, event);
            }),
            uiClient.onDidShowMessage((event: ShowMessageEvent) => {
                emitRuntimeEvent(UiFrontendEvent.ShowMessage, event);
            }),
            uiClient.onDidPromptState((event: PromptStateEvent) => {
                const inputPrompt = typeof event.input_prompt === 'string'
                    ? event.input_prompt.trimEnd()
                    : this.session.dynState.inputPrompt;
                const continuationPrompt = typeof event.continuation_prompt === 'string'
                    ? event.continuation_prompt.trimEnd()
                    : this.session.dynState.continuationPrompt;

                this.session.dynState.inputPrompt = inputPrompt;
                this.session.dynState.continuationPrompt = continuationPrompt;

                emitRuntimeEvent(UiFrontendEvent.PromptState, {
                    input_prompt: inputPrompt,
                    continuation_prompt: continuationPrompt,
                });
            }),
            uiClient.onDidWorkingDirectory((event: WorkingDirectoryEvent) => {
                const directory = typeof event.directory === 'string' ? event.directory : '';
                if (directory.length > 0) {
                    this.workingDirectory = directory;
                    this.session.updateWorkingDirectory(directory);
                }

                emitRuntimeEvent(UiFrontendEvent.WorkingDirectory, { directory });
            }),
            uiClient.onDidOpenWorkspace((event: OpenWorkspaceEvent) => {
                emitRuntimeEvent(UiFrontendEvent.OpenWorkspace, event);
            }),
            uiClient.onDidSetEditorSelections((event: SetEditorSelectionsEvent) => {
                emitRuntimeEvent(UiFrontendEvent.SetEditorSelections, event);
            }),
            uiClient.onDidShowUrl((event: ShowUrlEvent) => {
                emitRuntimeEvent(UiFrontendEvent.ShowUrl, event);
            }),
            uiClient.onDidShowHtmlFile((event: ShowHtmlFileEvent) => {
                emitRuntimeEvent(UiFrontendEvent.ShowHtmlFile, event);
            }),
            uiClient.onDidOpenWithSystem((event: OpenWithSystemEvent) => {
                emitRuntimeEvent(UiFrontendEvent.OpenWithSystem, event);
            }),
            uiClient.onDidClearWebviewPreloads((event: ClearWebviewPreloadsEvent) => {
                emitRuntimeEvent(UiFrontendEvent.ClearWebviewPreloads, event);
            }),
        ];

        this._onUiClientStartedEmitter.fire(uiClient);
        this._startingUiClient?.complete(client.getClientId());
        this._startingUiClient = undefined;
    }

    private _disposeUiClient(): void {
        for (const disposable of this._uiClientDisposables) {
            disposable.dispose();
        }
        this._uiClientDisposables = [];
        this._uiClient = undefined;
        this._uiClientId = undefined;
    }
}
