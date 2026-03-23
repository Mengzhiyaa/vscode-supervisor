/**
 * Local Supervisor API implementation
 *
 * This replaces the dependency on positron-supervisor extension by using
 * the locally migrated Kallichore code.
 */

import * as vscode from 'vscode';
import * as os from 'os';
import { KCApi } from '../supervisor/KallichoreAdapterApi';
import { KallichoreTransport } from '../supervisor/KallichoreApiInstance';
import { KallichoreInstances } from '../supervisor/KallichoreInstances';
import {
    JupyterLanguageRuntimeSession as SupervisorJupyterLanguageRuntimeSession,
    JupyterKernelSpec as SupervisorJupyterKernelSpec,
    JupyterKernelExtra as SupervisorJupyterKernelExtra
} from '../supervisor/positron-supervisor';
import * as positron from '../supervisor/positron';
import {
    JupyterLanguageRuntimeSession,
    JupyterKernelSpec,
    JupyterKernelExtra,
} from '../types/positron-supervisor';
import {
    LanguageRuntimeDynState,
    LanguageRuntimeMetadata,
    RuntimeSessionMetadata,
} from '../positronTypes';

/**
 * Local implementation of the Supervisor API using migrated Kallichore code.
 */
export class LocalSupervisorApi implements vscode.Disposable {
    private _adapterApi: KCApi | undefined;
    private readonly _disposables: vscode.Disposable[] = [];

    /** Separate log output channel for supervisor-specific logs (uses LogOutputChannel for consistent format) */
    private readonly _supervisorLog: vscode.LogOutputChannel;

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _outputChannel: vscode.LogOutputChannel
    ) {
        // Create a separate LogOutputChannel for detailed supervisor logs
        // This provides the same format as Ark logs: YYYY-MM-DD HH:MM:SS.mmm [level] message
        this._supervisorLog = vscode.window.createOutputChannel('Ark Kernel Supervisor', { log: true });
        this._disposables.push(this._supervisorLog);
    }

    /**
     * Gets the supervisor log output channel
     */
    get supervisorLog(): vscode.LogOutputChannel {
        return this._supervisorLog;
    }

    private toPositronRuntimeMetadata(metadata: LanguageRuntimeMetadata): positron.LanguageRuntimeMetadata {
        return {
            ...metadata,
        };
    }

    private toPositronSessionMetadata(metadata: RuntimeSessionMetadata): positron.RuntimeSessionMetadata {
        return {
            ...metadata,
        };
    }

    private toPositronDynState(state: LanguageRuntimeDynState): positron.LanguageRuntimeDynState {
        return {
            ...state,
        };
    }

    private toSupervisorKernelSpec(spec: JupyterKernelSpec): SupervisorJupyterKernelSpec {
        return {
            argv: spec.argv,
            display_name: spec.display_name,
            language: spec.language,
            interrupt_mode: spec.interrupt_mode,
            env: spec.env,
            kernel_protocol_version: spec.kernel_protocol_version,
            startup_command: spec.startup_command,
        };
    }

    private toSupervisorKernelExtra(extra: JupyterKernelExtra | undefined): SupervisorJupyterKernelExtra | undefined {
        if (!extra) {
            return undefined;
        }
        return {
            attachOnStartup: extra.attachOnStartup,
            sleepOnStartup: extra.sleepOnStartup,
        };
    }

    private toRuntimeSession(session: SupervisorJupyterLanguageRuntimeSession): JupyterLanguageRuntimeSession {
        return session as unknown as JupyterLanguageRuntimeSession;
    }

    /**
     * Initializes the local supervisor API
     */
    async initialize(): Promise<void> {
        this._supervisorLog.info('Initializing local Kallichore supervisor...');
        this._supervisorLog.info(`Platform: ${os.platform()}, Architecture: ${os.arch()}`);
        this._supervisorLog.debug(`Extension path: ${this._context.extensionPath}`);

        try {
            // Initialize KallichoreInstances first (required by KCApi)
            KallichoreInstances.initialize(this._context, this._supervisorLog);
            this._supervisorLog.debug('KallichoreInstances initialized');

            // Determine transport type based on platform
            let transport: KallichoreTransport;
            if (process.platform === 'win32') {
                transport = KallichoreTransport.NamedPipe;
                this._supervisorLog.info('Using Named Pipe transport (Windows)');
            } else {
                transport = KallichoreTransport.UnixSocket;
                this._supervisorLog.info('Using Unix Socket transport');
            }

            // Create the Kallichore adapter API with supervisor log
            this._adapterApi = new KCApi(
                this._context,
                this._supervisorLog,  // Use supervisor-specific log channel
                transport,
                true // enable session reconnect
            );

            // Log Kallichore path
            const kcPath = this._adapterApi.getKallichorePath();
            if (kcPath) {
                this._supervisorLog.info(`Kallichore binary: ${kcPath}`);
            }

            this._supervisorLog.info('Local supervisor initialized successfully');
            this._outputChannel.debug('Local Kallichore supervisor initialized');
        } catch (error) {
            this._supervisorLog.error(`Failed to initialize supervisor: ${error}`);
            this._outputChannel.error(`Failed to initialize supervisor: ${error}`);
            throw error;
        }
    }

    /**
     * Creates a new session for a Jupyter-compatible kernel.
     */
    async createSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionMetadata: RuntimeSessionMetadata,
        kernelSpec: JupyterKernelSpec,
        dynState: LanguageRuntimeDynState,
        extra?: JupyterKernelExtra
    ): Promise<JupyterLanguageRuntimeSession> {
        if (!this._adapterApi) {
            throw new Error('Supervisor not initialized');
        }

        this._supervisorLog.info(`Creating session ${sessionMetadata.sessionId}...`);
        this._supervisorLog.debug(`  Runtime: ${runtimeMetadata.runtimeName}`);
        this._supervisorLog.debug(`  Session name: ${sessionMetadata.sessionName}`);
        this._supervisorLog.debug(`  Session mode: ${sessionMetadata.sessionMode}`);
        this._supervisorLog.trace(`  Kernel spec: ${JSON.stringify(kernelSpec.argv)}`);

        const session = await this._adapterApi.createSession(
            this.toPositronRuntimeMetadata(runtimeMetadata),
            this.toPositronSessionMetadata(sessionMetadata),
            this.toSupervisorKernelSpec(kernelSpec),
            this.toPositronDynState(dynState),
            this.toSupervisorKernelExtra(extra)
        );

        this._supervisorLog.info(`Session ${sessionMetadata.sessionId} created successfully`);
        this._outputChannel.debug(`Session ${sessionMetadata.sessionId} created`);
        return this.toRuntimeSession(session);
    }

    /**
     * Validates an existing session.
     */
    async validateSession(sessionId: string): Promise<boolean> {
        if (!this._adapterApi) {
            return false;
        }
        this._supervisorLog.debug(`Validating session ${sessionId}...`);
        const valid = await this._adapterApi.validateSession(sessionId);
        this._supervisorLog.debug(`Session ${sessionId} validation: ${valid ? 'valid' : 'invalid'}`);
        return valid;
    }

    /**
     * Restores a session.
     */
    async restoreSession(
        runtimeMetadata: LanguageRuntimeMetadata,
        sessionMetadata: RuntimeSessionMetadata,
        dynState: LanguageRuntimeDynState
    ): Promise<JupyterLanguageRuntimeSession> {
        if (!this._adapterApi) {
            throw new Error('Supervisor not initialized');
        }

        this._supervisorLog.info(`Restoring session ${sessionMetadata.sessionId}...`);

        const session = await this._adapterApi.restoreSession(
            this.toPositronRuntimeMetadata(runtimeMetadata),
            this.toPositronSessionMetadata(sessionMetadata),
            this.toPositronDynState(dynState)
        );

        this._supervisorLog.info(`Session ${sessionMetadata.sessionId} restored successfully`);
        this._outputChannel.debug(`Session ${sessionMetadata.sessionId} restored`);
        return this.toRuntimeSession(session);
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

    dispose(): void {
        this._supervisorLog.info('Disposing supervisor...');
        this._adapterApi?.dispose();
        this._disposables.forEach(d => d.dispose());
    }
}
