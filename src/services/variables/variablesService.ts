/*---------------------------------------------------------------------------------------------
 *  PositronVariablesService Implementation
 *  1:1 replication of Positron's variables service class
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    IPositronVariablesService,
    IPositronVariablesInstance
} from './interfaces/variablesService';
import { PositronVariablesInstance } from './variablesInstance';
import { RuntimeSessionService } from '../../runtime/runtimeSession';
import { RuntimeSession } from '../../runtime/session';

/**
 * PositronVariablesService class (1:1 Positron).
 * Manages all variables instances across sessions.
 */
export class PositronVariablesService implements IPositronVariablesService {
    //#region Private Properties
    private readonly _variablesInstancesBySessionId = new Map<string, PositronVariablesInstance>();
    private _activeVariablesInstance: PositronVariablesInstance | undefined;
    private _viewVisible = false;
    private readonly _disposables: vscode.Disposable[] = [];

    // Event emitters (1:1 Positron naming)
    private readonly _onDidStartPositronVariablesInstanceEmitter = new vscode.EventEmitter<IPositronVariablesInstance>();
    private readonly _onDidStopPositronVariablesInstanceEmitter = new vscode.EventEmitter<IPositronVariablesInstance>();
    private readonly _onDidChangeActivePositronVariablesInstanceEmitter = new vscode.EventEmitter<IPositronVariablesInstance | undefined>();
    //#endregion

    constructor(
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _outputChannel: vscode.LogOutputChannel
    ) {
        this._outputChannel.debug('[PositronVariablesService] Created');
    }

    //#region IPositronVariablesService Implementation
    get positronVariablesInstances(): IPositronVariablesInstance[] {
        return Array.from(this._variablesInstancesBySessionId.values());
    }

    get activePositronVariablesInstance(): IPositronVariablesInstance | undefined {
        return this._activeVariablesInstance;
    }

    readonly onDidStartPositronVariablesInstance = this._onDidStartPositronVariablesInstanceEmitter.event;
    readonly onDidStopPositronVariablesInstance = this._onDidStopPositronVariablesInstanceEmitter.event;
    readonly onDidChangeActivePositronVariablesInstance = this._onDidChangeActivePositronVariablesInstanceEmitter.event;

    initialize(): void {
        this._outputChannel.debug('[PositronVariablesService] Initializing...');

        // Listen for session starts BEFORE kernel starts (Positron pattern)
        this._disposables.push(
            this._sessionManager.onWillStartSession((e) => {
                this._outputChannel.debug(`[PositronVariablesService] Session will start: ${e.session.sessionId}, activate: ${e.activate}`);
                this.createOrAssignPositronVariablesInstance(e.session, e.activate);
            })
        );

        // Follow foreground changes immediately; the service handoff can lag behind.
        this._disposables.push(
            this._sessionManager.onDidChangeForegroundSession((session: RuntimeSession | undefined) => {
                if (session) {
                    this._outputChannel.debug(`[PositronVariablesService] Active session changed: ${session.sessionId}`);
                    this.createOrAssignPositronVariablesInstance(session, true);
                } else {
                    this._setActivePositronVariablesInstance(undefined);
                }
            })
        );

        // Listen for session deletions
        this._disposables.push(
            this._sessionManager.onDidDeleteRuntimeSession((sessionId: string) => {
                this._outputChannel.debug(`[PositronVariablesService] Session deleted: ${sessionId}`);
                this.cleanupSession(sessionId);
            })
        );

        this._outputChannel.debug('[PositronVariablesService] Initialized');
    }

    setActivePositronVariablesSession(sessionId: string): void {
        const instance = this._variablesInstancesBySessionId.get(sessionId);
        if (instance && instance !== this._activeVariablesInstance) {
            this._outputChannel.debug(`[PositronVariablesService] Setting active variables: ${sessionId}`);
            this._setActivePositronVariablesInstance(instance);
        }
    }

    setViewVisible(visible: boolean): void {
        if (this._viewVisible === visible) {
            return;
        }

        this._viewVisible = visible;
        this._outputChannel.debug(`[PositronVariablesService] View visibility changed: ${visible}`);

        if (visible) {
            // Create instances for all active sessions
            for (const session of this._sessionManager.sessions) {
                const activate = session.sessionId === this._sessionManager.activeSessionId;
                this.createOrAssignPositronVariablesInstance(session, activate);
            }

            // Set active based on current session
            const activeSession = this._sessionManager.activeSession;
            if (activeSession) {
                this.setActivePositronVariablesSession(activeSession.sessionId);
            }
        } else {
            // Dispose all instances when view is hidden
            this.disposeAllInstances();
        }
    }

    getVariablesInstance(sessionId: string): IPositronVariablesInstance | undefined {
        return this._variablesInstancesBySessionId.get(sessionId);
    }

    dispose(): void {
        this._outputChannel.debug('[PositronVariablesService] Disposing...');

        // Dispose all variables instances
        this.disposeAllInstances();

        // Dispose event emitters
        this._onDidStartPositronVariablesInstanceEmitter.dispose();
        this._onDidStopPositronVariablesInstanceEmitter.dispose();
        this._onDidChangeActivePositronVariablesInstanceEmitter.dispose();

        // Dispose subscriptions
        this._disposables.forEach(d => d.dispose());
    }
    //#endregion

    //#region Private Methods
    private createOrAssignPositronVariablesInstance(session: RuntimeSession, activate: boolean): void {
        if (!this._viewVisible) {
            return;
        }

        // Check if instance already exists
        let instance = this._variablesInstancesBySessionId.get(session.sessionId);

        if (!instance) {
            this._outputChannel.debug(`[PositronVariablesService] Creating variables instance for: ${session.sessionId}`);
            instance = this.startPositronVariablesInstance(session, activate);
            return;
        }

        if (activate) {
            this._setActivePositronVariablesInstance(instance);
        }
    }

    private startPositronVariablesInstance(session: RuntimeSession, activate: boolean): PositronVariablesInstance {
        const instance = new PositronVariablesInstance(
            session, // RuntimeSession itself is the runtime session
            this._outputChannel
        );

        // Track instance
        this._variablesInstancesBySessionId.set(session.sessionId, instance);

        // Fire event
        this._onDidStartPositronVariablesInstanceEmitter.fire(instance);

        if (activate || !this._activeVariablesInstance) {
            this._setActivePositronVariablesInstance(instance);
        }

        return instance;
    }

    private cleanupSession(sessionId: string): void {
        const instance = this._variablesInstancesBySessionId.get(sessionId);
        if (instance) {
            this._variablesInstancesBySessionId.delete(sessionId);
            this._onDidStopPositronVariablesInstanceEmitter.fire(instance);
            instance.dispose();

            // Update active if needed
            if (this._activeVariablesInstance === instance) {
                const remaining = this.positronVariablesInstances;
                const nextActive = remaining.length > 0
                    ? remaining[0] as PositronVariablesInstance
                    : undefined;
                this._setActivePositronVariablesInstance(nextActive);
            }
        }
    }

    private disposeAllInstances(): void {
        for (const instance of this._variablesInstancesBySessionId.values()) {
            this._onDidStopPositronVariablesInstanceEmitter.fire(instance);
            instance.dispose();
        }
        this._variablesInstancesBySessionId.clear();
        this._setActivePositronVariablesInstance(undefined);
    }

    private _setActivePositronVariablesInstance(instance: PositronVariablesInstance | undefined): void {
        this._activeVariablesInstance = instance;
        if (instance) {
            instance.requestRefresh();
        }
        this._onDidChangeActivePositronVariablesInstanceEmitter.fire(instance);
    }
    //#endregion
}
