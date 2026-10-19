import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { KallichoreServerState } from './ServerState';

// Public VS Code APIs do not distinguish a reload from a window close. Allow
// the replacement extension host to claim this lease before reclaiming a server.
export const SUPERVISOR_RECONNECT_GRACE_MS = 60_000;

/** A credential-free lease; connection credentials stay in the launcher's memory. */
export class SupervisorProcessLease implements vscode.Disposable {
    private readonly _timer: ReturnType<typeof setInterval>;
    private _disposed = false;
    private _claimed = false;
    private readonly _ownerId = randomUUID();

    constructor(
        readonly leasePath: string,
        private readonly _keepAlive: () => boolean,
        private readonly _onError: (error: unknown) => void,
    ) {
        this.renew();
        this._timer = setInterval(() => this.renew(), 20_000);
        this._timer.unref();
    }

    renew(): void {
        if (!this._disposed) { this.write(process.pid); }
    }

    private write(ownerPid: number): void {
        const temporaryPath = `${this.leasePath}.${process.pid}.tmp`;
        try {
            if (this._claimed) {
                const current = JSON.parse(fs.readFileSync(this.leasePath, 'utf8'));
                // A replacement host has claimed this server. The old host
                // must not overwrite its lease during delayed teardown.
                if (current.ownerId !== this._ownerId) {
                    clearInterval(this._timer);
                    this._disposed = true;
                    return;
                }
            }
            fs.writeFileSync(temporaryPath, JSON.stringify({
                version: 1,
                ownerId: this._ownerId,
                ownerPid,
                expiresAt: Date.now() + SUPERVISOR_RECONNECT_GRACE_MS,
                keepAlive: this._keepAlive(),
            }), { mode: 0o600 });
            fs.renameSync(temporaryPath, this.leasePath);
            this._claimed = true;
        } catch (error) {
            try { fs.unlinkSync(temporaryPath); } catch { /* already removed */ }
            this._onError(error);
        }
    }

    dispose(): void {
        if (this._disposed) { return; }
        this._disposed = true;
        clearInterval(this._timer);
        // An extension can be disabled without its host process exiting.
        this.write(0);
    }
}

/** Launch outside the terminal's process group on every shutdown policy. */
export function launchSupervisorProcess(
    extensionPath: string,
    args: string[],
    outFile: string,
    keepAlive: () => boolean,
    onError: (error: unknown) => void,
): { child: ChildProcess; lease: SupervisorProcessLease } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-process-'));
    fs.chmodSync(directory, 0o700);
    const lease = new SupervisorProcessLease(path.join(directory, 'lease.json'), keepAlive, onError);
    let output: number | undefined;
    try {
        output = fs.openSync(outFile, 'a', 0o600);
        const child = spawn(process.execPath, [
            path.join(extensionPath, 'resources', 'supervisor-launcher.cjs'),
            JSON.stringify({
                leasePath: lease.leasePath,
                wrapperPath: path.join(extensionPath, 'resources', 'supervisor-wrapper.sh'),
                args,
                outFile,
            }),
        ], {
            detached: true,
            windowsHide: true,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            stdio: ['ignore', output, output, 'ipc'],
        });
        child.on('error', onError);
        child.unref();
        return { child, lease };
    } catch (error) {
        lease.dispose();
        fs.rmSync(directory, { recursive: true, force: true });
        throw error;
    } finally {
        if (output !== undefined) { fs.closeSync(output); }
    }
}

/** Send the authenticated shutdown target over IPC, never via argv or a file. */
export async function configureSupervisorProcess(child: ChildProcess, state: KallichoreServerState): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        child.send({ kind: 'connection', state }, error => error ? reject(error) : resolve());
    });
}

/** An optional log display. Closing it has no effect on the supervisor. */
export function createSupervisorLogTerminal(outFile: string): vscode.Terminal {
    const write = new vscode.EventEmitter<string>();
    let timer: ReturnType<typeof setInterval> | undefined;
    let offset = 0;
    const read = () => {
        let descriptor: number | undefined;
        try {
            descriptor = fs.openSync(outFile, 'r');
            const size = fs.fstatSync(descriptor).size;
            if (size < offset) { offset = 0; }
            const buffer = Buffer.alloc(Math.min(64 * 1024, size - offset));
            const length = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
            offset += length;
            if (length) { write.fire(buffer.subarray(0, length).toString('utf8').replace(/\r?\n/g, '\r\n')); }
        } catch { /* The launcher may not have created the file yet. */ }
        finally { if (descriptor !== undefined) { fs.closeSync(descriptor); } }
    };
    return vscode.window.createTerminal({
        name: 'Kallichore',
        isTransient: true,
        pty: {
            onDidWrite: write.event,
            open: () => { read(); timer = setInterval(read, 500); timer.unref(); },
            close: () => { clearInterval(timer); write.dispose(); },
        },
    });
}
