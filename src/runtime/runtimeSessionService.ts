import * as vscode from 'vscode';
import { RuntimeState } from '../internal/runtimeTypes';
import type {
    ILanguageRuntimeSessionStateEvent as PublicLanguageRuntimeSessionStateEvent,
    IRuntimeSessionWillStartEvent as PublicRuntimeSessionWillStartEvent,
    INotebookSessionUriChangedEvent,
    IRuntimeSessionMetadata,
    IRuntimeSessionService as PublicRuntimeSessionService,
    LanguageRuntimeMetadata,
} from '../api';
import type { RuntimeSession } from './session';
import type { UiClientInstance } from './UiClientInstance';
import type { ILanguageRuntimeGlobalEvent } from './runtimeEvents';
import type { ActiveRuntimeSession } from './activeRuntimeSession';

export interface IRuntimeSessionWillStartEvent extends Omit<PublicRuntimeSessionWillStartEvent, 'session'> {
    session: RuntimeSession;
}

export type ILanguageRuntimeSessionStateEvent = PublicLanguageRuntimeSessionStateEvent;

export interface IRuntimeUiClientStartedEvent {
    sessionId: string;
    uiClient: UiClientInstance;
}

export interface SerializedSessionMetadata {
    sessionName: string;
    runtimeMetadata: LanguageRuntimeMetadata;
    metadata: IRuntimeSessionMetadata;
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

export interface IRuntimeSessionService extends PublicRuntimeSessionService, vscode.Disposable {
    readonly activeSession: RuntimeSession | undefined;
    foregroundSession: RuntimeSession | undefined;
    readonly activeSessions: readonly RuntimeSession[];
    readonly sessions: readonly RuntimeSession[];
    readonly onWillStartSession: vscode.Event<IRuntimeSessionWillStartEvent>;
    readonly onDidStartRuntime: vscode.Event<RuntimeSession>;
    readonly onDidFailStartRuntime: vscode.Event<RuntimeSession>;
    readonly onDidReceiveRuntimeEvent: vscode.Event<ILanguageRuntimeGlobalEvent>;
    readonly onDidChangeForegroundSession: vscode.Event<RuntimeSession | undefined>;
    readonly onDidUpdateNotebookSessionUri: vscode.Event<INotebookSessionUriChangedEvent>;
    readonly onDidStartUiClient: vscode.Event<IRuntimeUiClientStartedEvent>;
    getActiveSession(sessionId: string): ActiveRuntimeSession | undefined;
    getActiveSessions(): ActiveRuntimeSession[];
    hasStartingOrRunningConsole(languageId?: string): boolean;
    validateRuntimeSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionId: string
    ): Promise<boolean>;
    restoreRuntimeSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        metadata: IRuntimeSessionMetadata,
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
