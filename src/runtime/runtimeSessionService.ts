import * as vscode from 'vscode';
import { RuntimeStartMode, RuntimeState } from '../internal/runtimeTypes';
import type { LanguageRuntimeMetadata, RuntimeSessionMetadata } from '../api';
import type { RuntimeSession } from './session';
import type { UiClientInstance } from './UiClientInstance';
import type { ILanguageRuntimeGlobalEvent } from './runtimeEvents';

export interface IRuntimeSessionWillStartEvent {
    session: RuntimeSession;
    startMode: RuntimeStartMode;
    hasConsole: boolean;
    activate: boolean;
}

export interface ILanguageRuntimeSessionStateEvent {
    session_id: string;
    old_state: RuntimeState;
    new_state: RuntimeState;
}

export interface IRuntimeUiClientStartedEvent {
    sessionId: string;
    uiClient: UiClientInstance;
}

export interface SerializedSessionMetadata {
    sessionName: string;
    runtimeMetadata: LanguageRuntimeMetadata;
    metadata: RuntimeSessionMetadata;
    sessionState: RuntimeState;
    workingDirectory?: string;
    hasConsole?: boolean;
    lastUsed: number;
    localWindowId?: string;
}

export interface IRuntimeSessionRestoreOptions {
    createConsole?: boolean;
    activate?: boolean;
    workingDirectory?: string;
}

export interface IRuntimeSessionService extends vscode.Disposable {
    readonly activeSession: RuntimeSession | undefined;
    readonly foregroundSession: RuntimeSession | undefined;
    readonly sessions: readonly RuntimeSession[];
    readonly onWillStartSession: vscode.Event<IRuntimeSessionWillStartEvent>;
    readonly onDidStartRuntime: vscode.Event<RuntimeSession>;
    readonly onDidFailStartRuntime: vscode.Event<RuntimeSession>;
    readonly onDidChangeRuntimeState: vscode.Event<ILanguageRuntimeSessionStateEvent>;
    readonly onDidReceiveRuntimeEvent: vscode.Event<ILanguageRuntimeGlobalEvent>;
    readonly onDidChangeForegroundSession: vscode.Event<RuntimeSession | undefined>;
    readonly onDidStartUiClient: vscode.Event<IRuntimeUiClientStartedEvent>;
    hasStartingOrRunningConsole(languageId?: string): boolean;
    validateRuntimeSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionId: string
    ): Promise<boolean>;
    restoreRuntimeSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        metadata: RuntimeSessionMetadata,
        sessionName: string,
        createConsole: boolean,
        activate: boolean,
        workingDirectory?: string
    ): Promise<RuntimeSession>;
    watchUiClient(
        sessionId: string,
        handler: (uiClient: UiClientInstance) => vscode.Disposable | void
    ): vscode.Disposable;
}
