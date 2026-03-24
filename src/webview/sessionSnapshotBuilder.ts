import { RuntimeSession } from '../runtime/session';
import { SessionManager } from '../runtime/sessionManager';
import * as SessionProtocol from '../rpc/webview/session';
import { PositronConsoleService } from '../services/console/consoleService';
import {
    IPositronConsoleInstance,
    PositronConsoleState,
} from '../services/console/interfaces/consoleService';
import { RuntimeState } from '../internal/runtimeTypes';

/**
 * Shared helper for building the `session/info` snapshot sent to webviews.
 * Providers can keep their own active-session precedence while reusing the
 * same session/state mapping logic.
 */
export class SessionSnapshotBuilder {
    constructor(
        private readonly _sessionManager?: SessionManager,
        private readonly _consoleService?: PositronConsoleService,
    ) { }

    buildBaseSessions(): SessionProtocol.SessionInfo[] {
        return (this._sessionManager?.sessions ?? []).map(session =>
            this._buildBaseSessionInfo(session)
        );
    }

    buildSessionsWithConsoleOverlay(): SessionProtocol.SessionInfo[] {
        const sessions = this.buildBaseSessions();

        if (!this._consoleService) {
            return sessions;
        }

        return sessions.map(session => {
            const instance = this._consoleService?.getConsoleInstance(session.id);
            return instance
                ? this._applyConsoleOverlay(session, instance)
                : session;
        });
    }

    resolveActiveSessionId(
        sessions: Array<{ id: string }>,
        candidateIds: Array<string | undefined>
    ): string | undefined {
        if (sessions.length === 0) {
            return undefined;
        }

        const sessionIds = new Set(sessions.map(session => session.id));
        for (const candidateId of candidateIds) {
            if (candidateId && sessionIds.has(candidateId)) {
                return candidateId;
            }
        }

        return sessions[0]?.id;
    }

    private _buildBaseSessionInfo(session: RuntimeSession): SessionProtocol.SessionInfo {
        return {
            id: session.sessionId,
            name:
                session.dynState.sessionName ||
                session.sessionMetadata.sessionName ||
                session.runtimeMetadata.runtimeName,
            runtimeName: session.runtimeMetadata.runtimeName,
            state: mapRuntimeStateToSessionState(session.state),
            runtimePath: session.runtimeMetadata.runtimePath,
            runtimeVersion: session.runtimeMetadata.languageVersion,
            runtimeSource: session.runtimeMetadata.runtimeSource,
            base64EncodedIconSvg: session.runtimeMetadata.base64EncodedIconSvg,
            promptActive: false,
            runtimeAttached: false,
            ...(session.runtimeMetadata.languageId
                ? { languageId: session.runtimeMetadata.languageId }
                : {}),
        };
    }

    private _applyConsoleOverlay(
        session: SessionProtocol.SessionInfo,
        instance: IPositronConsoleInstance,
    ): SessionProtocol.SessionInfo {
        const languageId = instance.runtimeMetadata.languageId || session.languageId;
        return {
            ...session,
            state: mapConsoleStateToSessionState(instance.state),
            runtimePath: instance.runtimeMetadata.runtimePath || session.runtimePath,
            runtimeVersion: instance.runtimeMetadata.languageVersion || session.runtimeVersion,
            runtimeSource: instance.runtimeMetadata.runtimeSource || session.runtimeSource,
            base64EncodedIconSvg: instance.runtimeMetadata.base64EncodedIconSvg || session.base64EncodedIconSvg,
            promptActive: instance.promptActive,
            runtimeAttached: instance.runtimeAttached,
            ...(languageId ? { languageId } : {}),
        };
    }
}

export function mapConsoleStateToSessionState(
    state: PositronConsoleState
): SessionProtocol.SessionInfo['state'] {
    switch (state) {
        case PositronConsoleState.Uninitialized:
            return 'uninitialized';
        case PositronConsoleState.Starting:
            return 'starting';
        case PositronConsoleState.Busy:
            return 'busy';
        case PositronConsoleState.Ready:
            return 'ready';
        case PositronConsoleState.Offline:
            return 'offline';
        case PositronConsoleState.Interrupting:
            return 'interrupting';
        case PositronConsoleState.Restarting:
            return 'restarting';
        case PositronConsoleState.Exiting:
            return 'exiting';
        case PositronConsoleState.Exited:
            return 'exited';
        case PositronConsoleState.Disconnected:
            return 'disconnected';
        default:
            return 'uninitialized';
    }
}

export function mapRuntimeStateToSessionState(
    state: RuntimeState
): SessionProtocol.SessionInfo['state'] {
    switch (state) {
        case RuntimeState.Uninitialized:
            return 'uninitialized';
        case RuntimeState.Initializing:
        case RuntimeState.Starting:
            return 'starting';
        case RuntimeState.Ready:
        case RuntimeState.Idle:
            return 'ready';
        case RuntimeState.Busy:
            return 'busy';
        case RuntimeState.Offline:
            return 'offline';
        case RuntimeState.Interrupting:
            return 'interrupting';
        case RuntimeState.Restarting:
            return 'restarting';
        case RuntimeState.Exiting:
            return 'exiting';
        case RuntimeState.Exited:
            return 'exited';
        default:
            return 'uninitialized';
    }
}
