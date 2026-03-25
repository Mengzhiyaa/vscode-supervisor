import * as vscode from 'vscode';
import { type LanguageRuntimeMetadata } from '../api';
import { Barrier } from '../supervisor/async';

export const POSITRON_NEW_FOLDER_CONFIG_STORAGE_KEY = 'vscode-supervisor.newFolderConfig.v1';

export enum NewFolderStartupPhase {
    Initializing = 'initializing',
    ApplyLayout = 'applyLayout',
    AwaitingTrust = 'awaitingTrust',
    CreatingFolder = 'creatingFolder',
    RuntimeStartup = 'runtimeStartup',
    PostInitialization = 'postInitialization',
    Complete = 'complete',
}

export interface NewFolderConfiguration {
    readonly folderScheme?: string;
    readonly folderAuthority?: string;
    readonly runtimeMetadata?: LanguageRuntimeMetadata;
    readonly folderTemplate?: string;
    readonly folderPath?: string;
    readonly folderName?: string;
    readonly initGitRepo?: boolean;
    readonly createPyprojectToml?: boolean;
    readonly pythonEnvProviderId?: string;
    readonly pythonEnvProviderName?: string;
    readonly pythonEnvName?: string;
    readonly installIpykernel?: boolean;
    readonly condaPythonVersion?: string;
    readonly uvPythonVersion?: string;
    readonly useRenv?: boolean;
    readonly openInNewWindow?: boolean;
}

export interface IPositronNewFolderTaskOptions {
    readonly label?: string;
    readonly runtimeMetadata?: LanguageRuntimeMetadata;
}

export interface IPositronNewFolderService extends vscode.Disposable {
    readonly onDidChangeNewFolderStartupPhase: vscode.Event<NewFolderStartupPhase>;
    readonly startupPhase: NewFolderStartupPhase;
    readonly onDidChangePendingInitTasks: vscode.Event<Set<string>>;
    readonly onDidChangePostInitTasks: vscode.Event<Set<string>>;
    readonly pendingInitTasks: Set<string>;
    readonly pendingPostInitTasks: Set<string>;
    readonly initTasksComplete: Barrier;
    readonly postInitTasksComplete: Barrier;
    readonly newFolderRuntimeMetadata: LanguageRuntimeMetadata | undefined;
    storeNewFolderConfig(newFolderConfig: NewFolderConfiguration): Promise<void>;
    clearNewFolderConfig(): Promise<void>;
    initNewFolder(): Promise<void>;
    completeRuntimeStartup(): Promise<void>;
    isCurrentWindowNewFolder(): boolean;
    registerInitTask(
        task: Promise<void> | (() => Promise<void>),
        options?: IPositronNewFolderTaskOptions,
    ): vscode.Disposable;
    registerPostInitTask(
        task: Promise<void> | (() => Promise<void>),
        options?: IPositronNewFolderTaskOptions,
    ): vscode.Disposable;
}
