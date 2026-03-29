import { RuntimeSession } from '../runtime/session';
import { RuntimeSessionService } from '../runtime/runtimeSession';
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
        private readonly _sessionManager?: RuntimeSessionService,
        private readonly _consoleService?: PositronConsoleService,
    ) { }

    buildBaseSessions(): SessionProtocol.SessionInfo[] {
        return (this._sessionManager?.sessions ?? []).map(session =>
            this._buildBaseSessionInfo(session)
        );
    }

    buildSessionsWithConsoleOverlay(): SessionProtocol.SessionInfo[] {
        const sessions = this.buildBaseSessions();
        const sessionsById = new Map(sessions.map(session => [session.id, session]));

        if (!this._consoleService) {
            return sessions;
        }

        const overlaidSessions = sessions.map(session => {
            const instance = this._consoleService?.getConsoleInstance(session.id);
            const overlaid = instance
                ? this._applyConsoleOverlay(session, instance)
                : session;
            sessionsById.set(overlaid.id, overlaid);
            return overlaid;
        });

        for (const instance of this._consoleService.positronConsoleInstances) {
            if (sessionsById.has(instance.sessionId) || !instance.runtimeAttached) {
                continue;
            }

            overlaidSessions.push(this._buildConsoleOnlySessionInfo(instance));
        }

        return overlaidSessions;
    }

    resolveActiveSessionId(
        sessions: SessionProtocol.SessionInfo[],
        candidateIds: Array<string | undefined>
    ): string | undefined {
        if (sessions.length === 0) {
            return undefined;
        }

        const sessionsById = new Map(sessions.map(session => [session.id, session]));
        for (const candidateId of candidateIds) {
            const candidate = candidateId ? sessionsById.get(candidateId) : undefined;
            if (candidate && isPreferredActiveSessionCandidate(candidate)) {
                return candidateId;
            }
        }

        for (const candidateId of candidateIds) {
            const candidate = candidateId ? sessionsById.get(candidateId) : undefined;
            if (candidate && isActiveSessionCandidate(candidate)) {
                return candidateId;
            }
        }

        return sessions.find(isPreferredActiveSessionCandidate)?.id ??
            sessions.find(isActiveSessionCandidate)?.id;
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

    private _buildConsoleOnlySessionInfo(
        instance: IPositronConsoleInstance,
    ): SessionProtocol.SessionInfo {
        const languageId = instance.runtimeMetadata.languageId;
        return {
            id: instance.sessionId,
            name:
                instance.sessionMetadata.sessionName ||
                instance.sessionName ||
                instance.runtimeMetadata.runtimeName,
            runtimeName: instance.runtimeMetadata.runtimeName,
            state: mapConsoleStateToSessionState(instance.state),
            runtimePath: instance.runtimeMetadata.runtimePath,
            runtimeVersion: instance.runtimeMetadata.languageVersion,
            runtimeSource: instance.runtimeMetadata.runtimeSource,
            base64EncodedIconSvg: instance.runtimeMetadata.base64EncodedIconSvg,
            promptActive: instance.promptActive,
            runtimeAttached: instance.runtimeAttached,
            ...(languageId ? { languageId } : {}),
        };
    }
}

export function isActiveSessionCandidate(session: SessionProtocol.SessionInfo): boolean {
    switch (session.state) {
        case 'uninitialized':
        case 'exited':
        case 'disconnected':
            return false;
        default:
            return true;
    }
}

export function isPreferredActiveSessionCandidate(
    session: SessionProtocol.SessionInfo,
): boolean {
    return isActiveSessionCandidate(session) && session.runtimeAttached;
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
