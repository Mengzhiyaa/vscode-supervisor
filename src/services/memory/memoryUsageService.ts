import * as vscode from 'vscode';
import { RuntimeSessionService } from '../../runtime/runtimeSession';
import { RuntimeSession } from '../../runtime/session';
import { RuntimeState, RuntimeResourceUsage } from '../../internal/runtimeTypes';
import {
    ExtensionHostMemoryInfoProvider,
    ISupervisorMemoryInfoProvider,
    MemoryUsageSource,
} from './memoryInfoProvider';

export const LOW_MEMORY_PERCENT_SETTING = 'memoryUsage.lowMemoryThresholdPercent';
export const LOW_MEMORY_MB_SETTING = 'memoryUsage.lowMemoryThresholdMB';

const ENABLED_SETTING = 'memoryUsage.enabled';
const POLLING_INTERVAL_SETTING = 'memoryUsage.pollingIntervalMs';
const LOW_MEMORY_NOTIFICATION_SETTING = 'memoryUsage.lowMemoryNotification';
const DEFAULT_POLLING_INTERVAL_MS = 10_000;
const UNFOCUSED_POLLING_INTERVAL_MS = 60_000;
const POST_EXECUTION_DELAY_MS = 2_000;
const DEFAULT_LOW_MEMORY_PERCENT = 5;

export const enum LowMemoryUnit {
    Percent = 'percent',
    Megabytes = 'megabytes',
}

export interface LowMemoryThresholds {
    percent?: number;
    megabytes?: number;
}

export interface LowMemoryStatus {
    unit: LowMemoryUnit;
    threshold: number;
    remaining: number;
}

export interface MemorySessionUsage {
    sessionId: string;
    sessionName: string;
    languageId: string;
    memoryBytes: number;
    processId?: number;
}

export interface MemoryUsageSnapshot {
    timestamp: number;
    totalSystemMemory: number;
    freeSystemMemory: number;
    kernelSessions: MemorySessionUsage[];
    kernelTotalBytes: number;
    supervisorOverheadBytes?: number;
    extensionHostOverheadBytes: number;
    otherProcessesBytes: number;
    source: MemoryUsageSource;
    lowMemory?: LowMemoryStatus;
}

export function computeLowMemoryStatus(
    freeBytes: number,
    totalBytes: number,
    thresholds: LowMemoryThresholds,
): LowMemoryStatus | undefined {
    if (totalBytes <= 0) {
        return undefined;
    }

    const percentRemaining = (freeBytes / totalBytes) * 100;
    const megabytesRemaining = freeBytes / (1024 * 1024);
    const percentLow = thresholds.percent !== undefined &&
        thresholds.percent > 0 &&
        percentRemaining <= thresholds.percent;
    const megabytesLow = thresholds.megabytes !== undefined &&
        thresholds.megabytes > 0 &&
        megabytesRemaining <= thresholds.megabytes;

    if (percentLow) {
        return {
            unit: LowMemoryUnit.Percent,
            threshold: thresholds.percent!,
            remaining: percentRemaining,
        };
    }

    if (megabytesLow) {
        return {
            unit: LowMemoryUnit.Megabytes,
            threshold: thresholds.megabytes!,
            remaining: megabytesRemaining,
        };
    }

    return undefined;
}

export class MemoryUsageService implements vscode.Disposable {
    private readonly _onDidUpdateMemoryUsage = new vscode.EventEmitter<MemoryUsageSnapshot>();
    readonly onDidUpdateMemoryUsage = this._onDidUpdateMemoryUsage.event;

    private readonly _onDidChangeEnabled = new vscode.EventEmitter<boolean>();
    readonly onDidChangeEnabled = this._onDidChangeEnabled.event;

    private readonly _kernelMemory = new Map<string, MemorySessionUsage>();
    private readonly _sessionListeners = new Map<string, vscode.Disposable[]>();
    private readonly _disposables: vscode.Disposable[] = [];

    private _enabled: boolean;
    private _configuredIntervalMs: number;
    private _windowFocused = vscode.window.state.focused;
    private _pollingTimer: NodeJS.Timeout | undefined;
    private _postExecutionTimer: NodeJS.Timeout | undefined;
    private _lowMemoryThresholds: LowMemoryThresholds;
    private _wasLowMemory: boolean | undefined;
    private _lowMemoryNotificationShown = false;
    private _currentSnapshot: MemoryUsageSnapshot | undefined;
    private _consecutivePollingFailures = 0;
    private _pollInProgress = false;

    get enabled(): boolean {
        return this._enabled;
    }

    get currentSnapshot(): MemoryUsageSnapshot | undefined {
        return this._currentSnapshot;
    }

    constructor(
        private readonly _sessionManager: RuntimeSessionService,
        private readonly _outputChannel: vscode.LogOutputChannel,
        private readonly _memoryInfoProvider: ISupervisorMemoryInfoProvider = new ExtensionHostMemoryInfoProvider(),
    ) {
        this._enabled = this._readEnabled();
        this._configuredIntervalMs = this._readPollingInterval();
        this._lowMemoryThresholds = this._readLowMemoryThresholds();

        this._disposables.push(
            this._onDidUpdateMemoryUsage,
            this._onDidChangeEnabled,
            this._sessionManager.onDidStartRuntime(session => {
                if (this._enabled) {
                    this._addSessionListener(session);
                }
            }),
            this._sessionManager.onDidDeleteRuntimeSession(sessionId => {
                this._removeSessionListener(sessionId);
                this._poll();
            }),
            this._sessionManager.onDidChangeRuntimeState(event => {
                if (!this._enabled) {
                    return;
                }

                if (event.new_state === RuntimeState.Exited) {
                    this._kernelMemory.delete(event.session_id);
                    this._poll();
                    return;
                }

                if (
                    event.old_state === RuntimeState.Busy &&
                    (event.new_state === RuntimeState.Idle || event.new_state === RuntimeState.Ready)
                ) {
                    this._schedulePostExecutionPoll();
                }
            }),
            vscode.window.onDidChangeWindowState(state => {
                this._windowFocused = state.focused;
                if (!this._enabled) {
                    return;
                }
                this._restartPolling();
                if (state.focused) {
                    this._consecutivePollingFailures = 0;
                    void this._poll();
                }
            }),
            vscode.workspace.onDidChangeConfiguration(event => {
                this._handleConfigurationChange(event);
            }),
        );

        if (this._enabled) {
            this._activate();
        }
    }

    private _activate(): void {
        for (const session of this._sessionManager.sessions) {
            this._addSessionListener(session);
        }
        this._restartPolling();
        void this._poll();
    }

    private _deactivate(): void {
        this._stopPolling();
        this._cancelPostExecutionPoll();
        for (const disposables of this._sessionListeners.values()) {
            disposables.forEach(disposable => disposable.dispose());
        }
        this._sessionListeners.clear();
        this._kernelMemory.clear();
        this._currentSnapshot = undefined;
        this._wasLowMemory = undefined;
    }

    private _handleConfigurationChange(event: vscode.ConfigurationChangeEvent): void {
        if (event.affectsConfiguration(ENABLED_SETTING)) {
            const enabled = this._readEnabled();
            if (enabled !== this._enabled) {
                this._enabled = enabled;
                if (enabled) {
                    this._activate();
                } else {
                    this._deactivate();
                }
                this._onDidChangeEnabled.fire(enabled);
            }
        }

        if (event.affectsConfiguration(POLLING_INTERVAL_SETTING)) {
            this._configuredIntervalMs = this._readPollingInterval();
            if (this._enabled) {
                this._restartPolling();
            }
        }

        if (
            event.affectsConfiguration(LOW_MEMORY_PERCENT_SETTING) ||
            event.affectsConfiguration(LOW_MEMORY_MB_SETTING)
        ) {
            this._lowMemoryThresholds = this._readLowMemoryThresholds();
            if (this._enabled && this._currentSnapshot) {
                const snapshot = {
                    ...this._currentSnapshot,
                    lowMemory: computeLowMemoryStatus(
                        this._currentSnapshot.freeSystemMemory,
                        this._currentSnapshot.totalSystemMemory,
                        this._lowMemoryThresholds,
                    ),
                };
                this._currentSnapshot = snapshot;
                this._maybeNotifyLowMemory(snapshot);
                this._onDidUpdateMemoryUsage.fire(snapshot);
            }
        }
    }

    private _addSessionListener(session: RuntimeSession): void {
        this._removeSessionListener(session.sessionId);

        const listener = session.onDidUpdateResourceUsage((usage: RuntimeResourceUsage) => {
            this._kernelMemory.set(session.sessionId, {
                sessionId: session.sessionId,
                sessionName: session.dynState.sessionName ||
                    session.sessionMetadata.sessionName ||
                    session.runtimeMetadata.runtimeName,
                languageId: session.runtimeMetadata.languageId,
                memoryBytes: Math.max(0, usage.memory_bytes),
                processId: usage.process_id,
            });
        });

        this._sessionListeners.set(session.sessionId, [listener]);
    }

    private _removeSessionListener(sessionId: string): void {
        const listeners = this._sessionListeners.get(sessionId);
        if (listeners) {
            listeners.forEach(listener => listener.dispose());
            this._sessionListeners.delete(sessionId);
        }
        this._kernelMemory.delete(sessionId);
    }

    private _readEnabled(): boolean {
        return vscode.workspace.getConfiguration().get<boolean>(ENABLED_SETTING, true);
    }

    private _readPollingInterval(): number {
        const configured = vscode.workspace.getConfiguration().get<number>(
            POLLING_INTERVAL_SETTING,
            DEFAULT_POLLING_INTERVAL_MS,
        );
        return Math.max(1000, configured);
    }

    private _readLowMemoryThresholds(): LowMemoryThresholds {
        const config = vscode.workspace.getConfiguration();
        return {
            percent: config.get<number>(LOW_MEMORY_PERCENT_SETTING, DEFAULT_LOW_MEMORY_PERCENT),
            megabytes: config.get<number>(LOW_MEMORY_MB_SETTING, 0),
        };
    }

    private _effectivePollingInterval(): number {
        return this._windowFocused ? this._configuredIntervalMs : UNFOCUSED_POLLING_INTERVAL_MS;
    }

    private _restartPolling(): void {
        this._stopPolling();
        this._pollingTimer = setInterval(() => this._poll(), this._effectivePollingInterval());
    }

    private _stopPolling(): void {
        if (this._pollingTimer) {
            clearInterval(this._pollingTimer);
            this._pollingTimer = undefined;
        }
    }

    private _schedulePostExecutionPoll(): void {
        this._cancelPostExecutionPoll();
        this._postExecutionTimer = setTimeout(() => {
            this._postExecutionTimer = undefined;
            this._poll();
        }, POST_EXECUTION_DELAY_MS);
    }

    private _cancelPostExecutionPoll(): void {
        if (this._postExecutionTimer) {
            clearTimeout(this._postExecutionTimer);
            this._postExecutionTimer = undefined;
        }
    }

    private async _poll(): Promise<void> {
        if (!this._enabled || this._pollInProgress) {
            return;
        }

        this._pollInProgress = true;
        try {
            const processMemoryInfo = await this._memoryInfoProvider.getProcessMemoryInfo();
            if (!this._enabled) {
                return;
            }
            const {
                totalSystemMemory,
                freeSystemMemory,
                extensionHostOverheadBytes,
                supervisorOverheadBytes,
                source,
            } = processMemoryInfo;
            const kernelSessions = Array.from(this._kernelMemory.values());
            const kernelTotalBytes = kernelSessions.reduce((sum, session) => sum + session.memoryBytes, 0);
            const usedBySystem = totalSystemMemory - freeSystemMemory;
            const otherProcessesBytes = Math.max(
                0,
                usedBySystem - kernelTotalBytes - extensionHostOverheadBytes - (supervisorOverheadBytes ?? 0),
            );

            const snapshot: MemoryUsageSnapshot = {
                timestamp: Date.now(),
                totalSystemMemory,
                freeSystemMemory,
                kernelSessions,
                kernelTotalBytes,
                supervisorOverheadBytes,
                extensionHostOverheadBytes,
                otherProcessesBytes,
                source,
                lowMemory: computeLowMemoryStatus(
                    freeSystemMemory,
                    totalSystemMemory,
                    this._lowMemoryThresholds,
                ),
            };

            this._currentSnapshot = snapshot;
            this._consecutivePollingFailures = 0;
            this._maybeNotifyLowMemory(snapshot);
            this._onDidUpdateMemoryUsage.fire(snapshot);
        } catch (error) {
            this._consecutivePollingFailures++;
            this._outputChannel.warn(`[MemoryUsage] Failed to poll memory usage: ${error}`);
            if (this._consecutivePollingFailures >= 5) {
                this._stopPolling();
                this._outputChannel.warn('[MemoryUsage] Polling paused after 5 consecutive failures; focus the window to retry.');
            }
        } finally {
            this._pollInProgress = false;
        }
    }

    private _maybeNotifyLowMemory(snapshot: MemoryUsageSnapshot): void {
        const isLowMemory = !!snapshot.lowMemory;
        const enteredLowMemory = isLowMemory && this._wasLowMemory === false;
        this._wasLowMemory = isLowMemory;

        if (!enteredLowMemory || this._lowMemoryNotificationShown) {
            return;
        }

        if (vscode.workspace.getConfiguration().get<boolean>(LOW_MEMORY_NOTIFICATION_SETTING, true) === false) {
            return;
        }

        const settingId = snapshot.lowMemory?.unit === LowMemoryUnit.Percent
            ? LOW_MEMORY_PERCENT_SETTING
            : LOW_MEMORY_MB_SETTING;
        this._lowMemoryNotificationShown = true;

        void vscode.window.showWarningMessage(
            `The system is low on memory (${formatBytes(snapshot.freeSystemMemory)} remaining). Consider removing data from memory or closing unused consoles.`,
            'Configure Low Memory Threshold',
        ).then(selection => {
            if (selection === 'Configure Low Memory Threshold') {
                void vscode.commands.executeCommand('workbench.action.openSettings', `@id:${settingId}`);
            }
        });
    }

    dispose(): void {
        this._deactivate();
        this._disposables.forEach(disposable => disposable.dispose());
    }
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }

    const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
}
