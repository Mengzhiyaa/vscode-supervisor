/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import { Tail } from 'tail';
import { type IRawLogSink, redactLogMessage } from '../logging/logSinks';

// Wrapper around Tail that flushes on `dispose()`.
// Prevents losing output on reload.

/** Splits file text into logical lines without inventing a trailing blank line. */
export function splitLogicalLines(contents: string): string[] {
	if (contents.length === 0) {
		return [];
	}
	const lines = contents.replace(/\r\n?/g, '\n').split('\n');
	if (contents.endsWith('\n') || contents.endsWith('\r')) {
		lines.pop();
	}
	return lines;
}

export class LogStreamer implements vscode.Disposable {
	private _tail: Tail;
	private _linesCounter: number = 0;

	constructor(
		private _output: IRawLogSink,
		private _path: string,
		private _prefix?: string,
	) {
		this._tail = new Tail(this._path, { fromBeginning: true, useWatchFile: true });

		// Establish listeners for new lines in the log file
		this._tail.on('line', (line) => this.appendLine(line, true));
		this._tail.on('error', (error) => this.appendLine(String(error), false));
	}

	/**
	 * Starts watching the log file. Waits up to 10 seconds for the log file to
	 * be created if it doesn't exist.
	 */
	public async watch() {
		// Wait up to 10 seconds for the log file to be created.
		for (let retry = 0; retry < 50; retry++) {
			if (fs.existsSync(this._path)) {
				break;
			} else {
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
		}

		if (!fs.existsSync(this._path)) {
			this.appendLine(`Log file '${this._path}' not found after 10 seconds.`);
			return;
		}

		// Start watching the log file. This streams output until the streamer is
		// disposed. fromBeginning means _linesCounter tracks every file line that
		// was actually delivered, including content written before watch().
		this._tail.watch();
	}

	private appendLine(line: string, countFileLine = false) {
		if (countFileLine) {
			this._linesCounter += 1;
		}
		line = line.replace(/\r$/, '');
		line = redactLogMessage(line);

		if (this._prefix) {
			this._output.appendLine(`[${this._prefix}] ${line}`);
		} else {
			this._output.appendLine(line);
		}
	}

	public dispose() {
		this._tail.unwatch();

		if (!fs.existsSync(this._path)) {
			return;
		}

		const lines = splitLogicalLines(fs.readFileSync(this._path, 'utf8'));

		// Push remaining lines in case new line events haven't had time to
		// fire up before unwatching. We skip lines that we've already seen and
		// flush the rest.
		for (let i = this._linesCounter; i < lines.length; ++i) {
			this.appendLine(lines[i], true);
		}
	}
}
