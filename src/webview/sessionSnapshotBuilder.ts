import { RuntimeSession } from '../runtime/session';
import { RuntimeSessionService } from '../runtime/runtimeSession';
import * as SessionProtocol from '../rpc/webview/session';
import { PositronConsoleService } from '../services/console/consoleService';
import {
    IPositronConsoleInstance,
    PositronConsoleState,
} from '../services/console/interfaces/consoleService';
import { RuntimeState } from '../internal/runtimeTypes';
import {
    positronConsoleStateToConsoleState,
    runtimeStateToConsoleState,
} from '../runtime/runtimeStateMapping';

/**
 * Shared helper for building the `session/info` snapshot sent to webviews.
 * Providers can keep their own foreground-session precedence while reusing the
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

    resolveForegroundConsoleSessionId(
        sessions: SessionProtocol.SessionInfo[],
        candidateIds: Array<string | undefined>
    ): string | undefined {
        if (sessions.length === 0) {
            return undefined;
        }

        const sessionsById = new Map(sessions.map(session => [session.id, session]));
        for (const candidateId of candidateIds) {
            const candidate = candidateId ? sessionsById.get(candidateId) : undefined;
            if (candidate && isPreferredForegroundConsoleSessionCandidate(candidate)) {
                return candidateId;
            }
        }

        for (const candidateId of candidateIds) {
            const candidate = candidateId ? sessionsById.get(candidateId) : undefined;
            if (candidate && isForegroundConsoleSessionCandidate(candidate)) {
                return candidateId;
            }
        }

        return sessions.find(isPreferredForegroundConsoleSessionCandidate)?.id ??
            sessions.find(isForegroundConsoleSessionCandidate)?.id;
    }

    resolveActiveSessionId(
        sessions: SessionProtocol.SessionInfo[],
        candidateIds: Array<string | undefined>
    ): string | undefined {
        return this.resolveForegroundConsoleSessionId(sessions, candidateIds);
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

export function isForegroundConsoleSessionCandidate(session: SessionProtocol.SessionInfo): boolean {
    switch (session.state) {
        case 'uninitialized':
        case 'exited':
        case 'disconnected':
            return false;
        default:
            return true;
    }
}

export function isPreferredForegroundConsoleSessionCandidate(
    session: SessionProtocol.SessionInfo,
): boolean {
    return isForegroundConsoleSessionCandidate(session) && session.runtimeAttached;
}

export function mapConsoleStateToSessionState(
    state: PositronConsoleState
): SessionProtocol.SessionInfo['state'] {
    return positronConsoleStateToConsoleState(state);
}

export function mapRuntimeStateToSessionState(
    state: RuntimeState
): SessionProtocol.SessionInfo['state'] {
    return runtimeStateToConsoleState(state);
}
