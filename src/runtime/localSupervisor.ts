/**
 * Local Supervisor API implementation
 *
 * This replaces the dependency on positron-supervisor extension by using
 * the locally migrated Kallichore code.
 */

import * as vscode from 'vscode';
import * as os from 'os';
import {
    type JupyterKernelSpec,
    type LanguageRuntimeDynState,
    type LanguageRuntimeMetadata,
    type IRuntimeSessionMetadata,
} from '../api';
import { KCApi } from '../supervisor/KallichoreAdapterApi';
import { KallichoreTransport } from '../supervisor/KallichoreApiInstance';
import { KallichoreInstances } from '../supervisor/KallichoreInstances';
import {
    JupyterKernelExtra,
    JupyterLanguageRuntimeSession,
} from '../supervisor/positron-supervisor';
import { formatRawSupervisorLine } from '../logging/logSinks';

/**
 * Local implementation of the Supervisor API using migrated Kallichore code.
 */
export class LocalSupervisorApi implements vscode.Disposable {
    private _adapterApi: KCApi | undefined;
    private readonly _disposables: vscode.Disposable[] = [];

    /** Raw channel shared by extension-side events and kcserver's formatted log file. */
    private readonly _supervisorLog: vscode.OutputChannel;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _outputChannel: vscode.LogOutputChannel
    ) {
        this._supervisorLog = vscode.window.createOutputChannel('Kernel Supervisor');
        this._disposables.push(this._supervisorLog);
    }

    /**
     * Gets the supervisor log output channel
     */
    get supervisorLog(): vscode.OutputChannel {
        return this._supervisorLog;
    }

    /**
     * Initializes the local supervisor API
     */
    async initialize(): Promise<void> {
        this.log('Initializing local Kallichore supervisor...');
        this.log(`Platform: ${os.platform()}, Architecture: ${os.arch()}`);
        this.log(`Extension path: ${this._context.extensionPath}`, vscode.LogLevel.Debug);

        try {
            // Initialize KallichoreInstances first (required by KCApi)
            KallichoreInstances.initialize(this._context, this._supervisorLog);
            this.log('KallichoreInstances initialized', vscode.LogLevel.Debug);

            // Determine transport type based on platform
            let transport: KallichoreTransport;
            if (process.platform === 'win32') {
                transport = KallichoreTransport.NamedPipe;
                this.log('Using Named Pipe transport (Windows)');
            } else {
                transport = KallichoreTransport.UnixSocket;
                this.log('Using Unix Socket transport');
            }

            // Create the Kallichore adapter API with supervisor log
            this._adapterApi = new KCApi(
                this._context,
                this._supervisorLog,  // Use supervisor-specific log channel
                transport,
                true // enable session reconnect
            );

            // Restore the supervisor-management commands that upstream Positron
            // exposes at extension activation time.
            this._adapterApi.registerCommands();
            this._disposables.push(
                vscode.commands.registerCommand('positron.supervisor.showRunningSupervisors', () => {
                    return KallichoreInstances.showRunningSupervisors();
                }),
                vscode.commands.registerCommand('positron.supervisor.showKernelSupervisorLog', () => {
                    this.showLog();
                }),
            );

            // Log Kallichore path
            const kcPath = this._adapterApi.getKallichorePath();
            if (kcPath) {
                this.log(`Kallichore binary: ${kcPath}`);
            }

            this.log('Local supervisor initialized successfully');
        } catch (error) {
            this.log(`Failed to initialize supervisor: ${error}`, vscode.LogLevel.Error);
            this._outputChannel.error(`Failed to initialize Kernel Supervisor: ${error}. See the Kernel Supervisor output channel for details.`);
            throw error;
        }
    }

    /**
     * Creates a new session for a Jupyter-compatible kernel.
     */
    async createSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionMetadata: IRuntimeSessionMetadata,
        kernelSpec: JupyterKernelSpec,
        dynState: LanguageRuntimeDynState,
        extra?: JupyterKernelExtra
    ): Promise<JupyterLanguageRuntimeSession> {
        if (!this._adapterApi) {
            throw new Error('Supervisor not initialized');
        }

        this.log(`Creating session ${sessionMetadata.sessionId}...`);
        this.log(`Runtime: ${runtimeMetadata.runtimeName}`, vscode.LogLevel.Debug);
        this.log(`Session name: ${sessionMetadata.sessionName}`, vscode.LogLevel.Debug);
        this.log(`Session mode: ${sessionMetadata.sessionMode}`, vscode.LogLevel.Debug);
        this.log(`Kernel spec contains ${kernelSpec.argv.length} argument(s)`, vscode.LogLevel.Trace);

        const session = await this._adapterApi.createSession(
            runtimeMetadata,
            sessionMetadata,
            kernelSpec,
            dynState,
            extra
        );

        this.log(`Session ${sessionMetadata.sessionId} created successfully`);
        return session;
    }

    /**
     * Validates an existing session.
     */
    async validateSession(sessionId: string): Promise<boolean> {
        if (!this._adapterApi) {
            return false;
        }
        this.log(`Validating session ${sessionId}...`, vscode.LogLevel.Debug);
        const valid = await this._adapterApi.validateSession(sessionId);
        this.log(`Session ${sessionId} validation: ${valid ? 'valid' : 'invalid'}`, vscode.LogLevel.Debug);
        return valid;
    }

    /**
     * Restores a session.
     */
    async restoreSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionMetadata: IRuntimeSessionMetadata,
        dynState: LanguageRuntimeDynState
    ): Promise<JupyterLanguageRuntimeSession> {
        if (!this._adapterApi) {
            throw new Error('Supervisor not initialized');
        }

        this.log(`Restoring session ${sessionMetadata.sessionId}...`);

        const session = await this._adapterApi.restoreSession(
            runtimeMetadata,
            sessionMetadata,
            dynState
        );

        this.log(`Session ${sessionMetadata.sessionId} restored successfully`);
        return session;
    }

    /**
     * Gets the Kallichore binary path
     */
    getKallichorePath(): string | undefined {
        try {
            return this._adapterApi?.getKallichorePath();
        } catch {
            return undefined;
        }
    }

    /**
     * Shows the supervisor log in the output panel
     */
    showLog(): void {
        this._supervisorLog.show();
    }

    /** Best-effort shutdown for supervisors that share the application's lifetime. */
    async shutdownForQuit(): Promise<void> {
        await this._adapterApi?.shutdownForQuit();
    }

    private log(message: string, level: vscode.LogLevel = vscode.LogLevel.Info): void {
        this._supervisorLog.appendLine(formatRawSupervisorLine(message, level));
    }

    dispose(): void {
        this.log('Disposing supervisor...');
        this._adapterApi?.dispose();
        this._disposables.forEach(d => d.dispose());
    }
}
