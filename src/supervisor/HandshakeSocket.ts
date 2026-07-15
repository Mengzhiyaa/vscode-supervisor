/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { KallichoreServerState } from './ServerState';
import { PromiseHandles } from './async';

/**
 * A client-owned, one-shot socket used to receive connection details from
 * Kallichore without writing the bearer token to disk.
 */
export class HandshakeSocket implements vscode.Disposable {
	private readonly _payload = new PromiseHandles<KallichoreServerState>();
	private _socketDir: string | undefined;
	private _disposed = false;

	private constructor(
		private readonly _server: net.Server,
		public readonly socketPath: string,
		socketDir: string | undefined,
	) {
		this._socketDir = socketDir;

		this._server.on('connection', socket => {
			let text = '';
			socket.setEncoding('utf8');
			socket.on('data', (chunk: string) => { text += chunk; });
			socket.on('end', () => {
				try {
					this._payload.resolve(HandshakeSocket.parsePayload(text));
				} catch (err) {
					this._payload.reject(new Error(`Failed to parse handshake payload: ${err}`));
				}
			});
			socket.on('error', err => this._payload.reject(err));
		});

		this._server.on('error', err => this._payload.reject(err));
	}

	public static async create(baseName: string): Promise<HandshakeSocket> {
		if (os.platform() === 'win32') {
			const pipeName = `\\\\.\\pipe\\kallichore-handshake-${baseName}`;
			const server = await HandshakeSocket.listen(pipeName);
			return new HandshakeSocket(server, pipeName, undefined);
		}

		const runtimeDir = process.env['XDG_RUNTIME_DIR'] || os.tmpdir();
		const socketDir = await fs.promises.mkdtemp(path.join(runtimeDir, 'kc-handshake-'));
		const socketPath = path.join(socketDir, 's.sock');

		try {
			const server = await HandshakeSocket.listen(socketPath);
			try {
				await fs.promises.chmod(socketPath, 0o600);
			} catch {
				// The containing directory is already private (0700).
			}
			return new HandshakeSocket(server, socketPath, socketDir);
		} catch (err) {
			fs.rmSync(socketDir, { recursive: true, force: true });
			throw err;
		}
	}

	private static listen(listenPath: string): Promise<net.Server> {
		return new Promise((resolve, reject) => {
			const server = net.createServer();
			server.once('error', reject);
			server.listen(listenPath, () => {
				server.removeListener('error', reject);
				resolve(server);
			});
		});
	}

	private static parsePayload(text: string): KallichoreServerState {
		const parsed = JSON.parse(text) as Partial<KallichoreServerState>;
		if (!parsed || typeof parsed !== 'object') {
			throw new Error('payload is not an object');
		}
		if (!parsed.base_path && !parsed.socket_path && !parsed.named_pipe) {
			throw new Error('payload has no transport address');
		}
		if (typeof parsed.server_pid !== 'number') {
			throw new Error('payload has no server_pid');
		}
		if (typeof parsed.bearer_token !== 'string') {
			throw new Error('payload has no bearer_token');
		}
		if (typeof parsed.server_id !== 'string' || !parsed.server_id) {
			throw new Error('payload has no server_id');
		}
		if (typeof parsed.server_path !== 'string' || typeof parsed.log_path !== 'string') {
			throw new Error('payload is missing server paths');
		}
		return parsed as KallichoreServerState;
	}

	public async payload(timeoutMs: number): Promise<KallichoreServerState> {
		let handle: NodeJS.Timeout | undefined;
		const timer = new Promise<never>((_, reject) => {
			handle = setTimeout(() => {
				reject(new Error(
					`Timed out waiting for the supervisor to connect to the handshake socket after ${timeoutMs}ms`));
			}, timeoutMs);
			handle.unref?.();
		});

		try {
			return await Promise.race([this._payload.promise, timer]);
		} finally {
			if (handle) {
				clearTimeout(handle);
			}
		}
	}

	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;

		try {
			this._server.close();
		} catch {
			// The server may already be closed.
		}

		if (this._socketDir) {
			fs.rmSync(this._socketDir, { recursive: true, force: true });
			this._socketDir = undefined;
		}
	}

	/** Reads a one-shot payload from a broker socket used by remote/server hosts. */
	public static connect(socketPath: string, timeoutMs: number): Promise<KallichoreServerState> {
		const handles = new PromiseHandles<KallichoreServerState>();
		const socket = net.connect(socketPath);
		let text = '';

		socket.setEncoding('utf8');
		socket.on('data', (chunk: string) => { text += chunk; });
		socket.on('end', () => {
			try {
				handles.resolve(HandshakeSocket.parsePayload(text));
			} catch (err) {
				handles.reject(new Error(`Failed to parse handshake payload: ${err}`));
			}
		});
		socket.on('error', err => handles.reject(err));

		const timer = setTimeout(() => {
			socket.destroy();
			handles.reject(new Error(
				`Timed out reading handshake payload from ${socketPath} after ${timeoutMs}ms`));
		}, timeoutMs);
		timer.unref?.();

		return handles.promise.finally(() => {
			clearTimeout(timer);
			socket.destroy();
		});
	}
}
