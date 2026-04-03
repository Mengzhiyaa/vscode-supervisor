import * as path from 'path';
import * as vscode from 'vscode';
import {
    type IPositronNewFolderService,
    type IPositronNewFolderTaskOptions,
    type LanguageRuntimeMetadata,
    type NewFolderConfiguration,
    NewFolderStartupPhase,
} from '../api';
import { Barrier } from '../supervisor/async';
import { POSITRON_NEW_FOLDER_CONFIG_STORAGE_KEY } from './positronNewFolder';

interface IPositronNewFolderTaskRegistration {
    readonly id: number;
    readonly label: string;
    readonly task: () => Promise<void>;
    readonly runtimeMetadata?: LanguageRuntimeMetadata;
}

export class PositronNewFolderService implements IPositronNewFolderService {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _initTaskRegistrations = new Map<number, IPositronNewFolderTaskRegistration>();
    private readonly _postInitTaskRegistrations = new Map<number, IPositronNewFolderTaskRegistration>();
    private readonly _runningInitTasks = new Map<number, Promise<void>>();
    private readonly _runningPostInitTasks = new Map<number, Promise<void>>();

    private readonly _onDidChangeNewFolderStartupPhase = new vscode.EventEmitter<NewFolderStartupPhase>();
    readonly onDidChangeNewFolderStartupPhase = this._onDidChangeNewFolderStartupPhase.event;

    private readonly _onDidChangePendingInitTasks = new vscode.EventEmitter<Set<string>>();
    readonly onDidChangePendingInitTasks = this._onDidChangePendingInitTasks.event;

    private readonly _onDidChangePostInitTasks = new vscode.EventEmitter<Set<string>>();
    readonly onDidChangePostInitTasks = this._onDidChangePostInitTasks.event;

    readonly initTasksComplete = new Barrier();
    readonly postInitTasksComplete = new Barrier();

    private _startupPhase = NewFolderStartupPhase.Initializing;
    private _newFolderConfig: NewFolderConfiguration | undefined;
    private _newFolderRuntimeMetadata: LanguageRuntimeMetadata | undefined;
    private _nextTaskId = 1;
    private _initNewFolderPromise: Promise<void> | undefined;
    private _completeRuntimeStartupPromise: Promise<void> | undefined;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _outputChannel: vscode.LogOutputChannel,
    ) {
        this._newFolderConfig = this._context.globalState.get<NewFolderConfiguration>(
            POSITRON_NEW_FOLDER_CONFIG_STORAGE_KEY,
        );
        this._newFolderRuntimeMetadata = this._newFolderConfig?.runtimeMetadata;

        this._disposables.push(
            this._onDidChangeNewFolderStartupPhase,
            this._onDidChangePendingInitTasks,
            this._onDidChangePostInitTasks,
        );
        this._emitPendingTaskChanges();
    }

    get startupPhase(): NewFolderStartupPhase {
        return this._startupPhase;
    }

    get pendingInitTasks(): Set<string> {
        return new Set(
            Array.from(this._initTaskRegistrations.values(), (registration) => registration.label),
        );
    }

    get pendingPostInitTasks(): Set<string> {
        return new Set(
            Array.from(this._postInitTaskRegistrations.values(), (registration) => registration.label),
        );
    }

    get newFolderRuntimeMetadata(): LanguageRuntimeMetadata | undefined {
        return this._newFolderRuntimeMetadata;
    }

    async storeNewFolderConfig(newFolderConfig: NewFolderConfiguration): Promise<void> {
        this._newFolderConfig = newFolderConfig;
        this._newFolderRuntimeMetadata = newFolderConfig.runtimeMetadata;
        await this._context.globalState.update(POSITRON_NEW_FOLDER_CONFIG_STORAGE_KEY, newFolderConfig);
    }

    async clearNewFolderConfig(): Promise<void> {
        this._newFolderConfig = undefined;
        await this._context.globalState.update(POSITRON_NEW_FOLDER_CONFIG_STORAGE_KEY, undefined);
    }

    isCurrentWindowNewFolder(): boolean {
        if (!this._newFolderConfig) {
            return false;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return false;
        }

        if (this._newFolderConfig.folderScheme &&
            workspaceFolder.uri.scheme !== this._newFolderConfig.folderScheme) {
            return false;
        }

        if (this._newFolderConfig.folderAuthority &&
            workspaceFolder.uri.authority !== this._newFolderConfig.folderAuthority) {
            return false;
        }

        if (this._newFolderConfig.folderPath) {
            const normalizedWorkspacePath = path.normalize(workspaceFolder.uri.fsPath);
            const normalizedConfigPath = path.normalize(this._newFolderConfig.folderPath);
            return normalizedWorkspacePath === normalizedConfigPath;
        }

        return true;
    }

    registerInitTask(
        task: Promise<void> | (() => Promise<void>),
        options?: IPositronNewFolderTaskOptions,
    ): vscode.Disposable {
        const registration = this._registerTask(this._initTaskRegistrations, task, options);
        if (this._startupPhase === NewFolderStartupPhase.CreatingFolder) {
            this._startRegisteredInitTask(registration);
        }

        return new vscode.Disposable(() => {
            this._initTaskRegistrations.delete(registration.id);
            this._emitPendingTaskChanges();
        });
    }

    registerPostInitTask(
        task: Promise<void> | (() => Promise<void>),
        options?: IPositronNewFolderTaskOptions,
    ): vscode.Disposable {
        const registration = this._registerTask(this._postInitTaskRegistrations, task, options);
        if (this._startupPhase === NewFolderStartupPhase.PostInitialization) {
            this._startRegisteredPostInitTask(registration);
        }

        return new vscode.Disposable(() => {
            this._postInitTaskRegistrations.delete(registration.id);
            this._emitPendingTaskChanges();
        });
    }

    async initNewFolder(): Promise<void> {
        if (this._initNewFolderPromise) {
            return this._initNewFolderPromise;
        }

        this._initNewFolderPromise = this._doInitNewFolder();
        return this._initNewFolderPromise;
    }

    async completeRuntimeStartup(): Promise<void> {
        if (this.postInitTasksComplete.isOpen()) {
            return;
        }

        if (!this._completeRuntimeStartupPromise) {
            this._completeRuntimeStartupPromise = this._doCompleteRuntimeStartup();
        }
        await this._completeRuntimeStartupPromise;
    }

    dispose(): void {
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
    }

    private _registerTask(
        registrations: Map<number, IPositronNewFolderTaskRegistration>,
        task: Promise<void> | (() => Promise<void>),
        options?: IPositronNewFolderTaskOptions,
    ): IPositronNewFolderTaskRegistration {
        const id = this._nextTaskId++;
        const registration: IPositronNewFolderTaskRegistration = {
            id,
            label: options?.label ?? `task-${id}`,
            task: typeof task === 'function' ? task : () => task,
            runtimeMetadata: options?.runtimeMetadata,
        };
        registrations.set(registration.id, registration);
        this._emitPendingTaskChanges();
        return registration;
    }

    private async _doInitNewFolder(): Promise<void> {
        this._setStartupPhase(NewFolderStartupPhase.ApplyLayout);
        await this._applyLayout();

        if (!vscode.workspace.isTrusted) {
            this._setStartupPhase(NewFolderStartupPhase.AwaitingTrust);
            await new Promise<void>((resolve) => {
                const disposable = vscode.workspace.onDidGrantWorkspaceTrust(() => {
                    disposable.dispose();
                    resolve();
                });
            });
        }

        if (!this.isCurrentWindowNewFolder() && this._initTaskRegistrations.size === 0) {
            this._setStartupPhase(NewFolderStartupPhase.Complete);
            this.initTasksComplete.open();
            this.postInitTasksComplete.open();
            return;
        }

        this._setStartupPhase(NewFolderStartupPhase.CreatingFolder);
        for (const registration of this._initTaskRegistrations.values()) {
            this._startRegisteredInitTask(registration);
        }
        await this._waitForRunningTasks(this._runningInitTasks);

        this._setStartupPhase(NewFolderStartupPhase.RuntimeStartup);
        this.initTasksComplete.open();

        if (!this._newFolderRuntimeMetadata) {
            await this.completeRuntimeStartup();
        }
    }

    private async _doCompleteRuntimeStartup(): Promise<void> {
        await this.initNewFolder();
        if (this.postInitTasksComplete.isOpen()) {
            return;
        }

        this._setStartupPhase(NewFolderStartupPhase.PostInitialization);
        for (const registration of this._postInitTaskRegistrations.values()) {
            this._startRegisteredPostInitTask(registration);
        }
        await this._waitForRunningTasks(this._runningPostInitTasks);

        this._setStartupPhase(NewFolderStartupPhase.Complete);
        this.postInitTasksComplete.open();
        await this.clearNewFolderConfig();
    }

    private async _applyLayout(): Promise<void> {
        this._outputChannel.debug('[NewFolder] Apply layout phase started');
    }

    private _setStartupPhase(phase: NewFolderStartupPhase): void {
        if (this._startupPhase === phase) {
            return;
        }

        this._startupPhase = phase;
        this._outputChannel.debug(`[NewFolder] Phase changed to '${phase}'`);
        this._onDidChangeNewFolderStartupPhase.fire(phase);
    }

    private _startRegisteredInitTask(registration: IPositronNewFolderTaskRegistration): void {
        if (this._runningInitTasks.has(registration.id)) {
            return;
        }

        const taskPromise = this._runTask(
            registration,
            this._initTaskRegistrations,
            '[NewFolder] Init task',
        ).finally(() => {
            this._runningInitTasks.delete(registration.id);
            this._emitPendingTaskChanges();
        });
        this._runningInitTasks.set(registration.id, taskPromise);
    }

    private _startRegisteredPostInitTask(registration: IPositronNewFolderTaskRegistration): void {
        if (this._runningPostInitTasks.has(registration.id)) {
            return;
        }

        const taskPromise = this._runTask(
            registration,
            this._postInitTaskRegistrations,
            '[NewFolder] Post-init task',
        ).finally(() => {
            this._runningPostInitTasks.delete(registration.id);
            this._emitPendingTaskChanges();
        });
        this._runningPostInitTasks.set(registration.id, taskPromise);
    }

    private async _runTask(
        registration: IPositronNewFolderTaskRegistration,
        registrations: Map<number, IPositronNewFolderTaskRegistration>,
        logPrefix: string,
    ): Promise<void> {
        this._outputChannel.debug(`${logPrefix} '${registration.label}' started`);
        try {
            await registration.task();
            if (registration.runtimeMetadata) {
                this._newFolderRuntimeMetadata = registration.runtimeMetadata;
            }
        } catch (error) {
            this._outputChannel.error(`${logPrefix} '${registration.label}' failed: ${error}`);
        } finally {
            registrations.delete(registration.id);
        }
    }

    private async _waitForRunningTasks(
        runningTasks: Map<number, Promise<void>>,
    ): Promise<void> {
        while (runningTasks.size > 0) {
            await Promise.allSettled(Array.from(runningTasks.values()));
        }
    }

    private _emitPendingTaskChanges(): void {
        this._onDidChangePendingInitTasks.fire(this.pendingInitTasks);
        this._onDidChangePostInitTasks.fire(this.pendingPostInitTasks);
    }
}
