/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Function type for formatting messages before they are appended to the channel.
 */
export type MessageFormatter = (message: string) => string;

/**
 * OutputChannel with formatting applied to `appendLine()`.
 */
export class OutputChannelFormatted implements vscode.OutputChannel {
	private atLineStart = true;
	private pendingCarriageReturn = false;

	constructor(
		private readonly channel: vscode.OutputChannel,
		private readonly formatter: MessageFormatter
	) { }

	get name(): string {
		return this.channel.name;
	}

	append(value: string): void {
		this.write(value, false);
	}

	appendLine(value: string): void {
		this.write(value, true);
	}

	replace(value: string): void {
		this.atLineStart = true;
		this.pendingCarriageReturn = false;
		this.channel.replace(this.format(value, false));
	}

	clear(): void {
		this.atLineStart = true;
		this.pendingCarriageReturn = false;
		this.channel.clear();
	}

	show(preserveFocus?: boolean): void;
	show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
	show(columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
		if (typeof columnOrPreserveFocus === 'boolean' || columnOrPreserveFocus === undefined) {
			this.channel.show(columnOrPreserveFocus);
		} else {
			this.channel.show(preserveFocus);
		}
	}

	hide(): void {
		this.channel.hide();
	}

	dispose(): void {
		if (this.pendingCarriageReturn) {
			this.pendingCarriageReturn = false;
			this.write('\n', false);
		}
		this.channel.dispose();
	}

	private write(value: string, appendNewline: boolean): void {
		this.channel.append(this.format(value, appendNewline));
	}

	private format(value: string, appendNewline: boolean): string {
		let input = this.pendingCarriageReturn ? `\r${value}` : value;
		this.pendingCarriageReturn = false;

		if (!appendNewline && input.endsWith('\r')) {
			input = input.substring(0, input.length - 1);
			this.pendingCarriageReturn = true;
		}
		input = input.replace(/\r\n?/g, '\n');
		if (appendNewline) {
			input += '\n';
		}

		let output = '';
		for (const character of input) {
			if (this.atLineStart) {
				output += this.formatter('');
				this.atLineStart = false;
			}
			output += character;
			if (character === '\n') {
				this.atLineStart = true;
			}
		}
		return output;
	}
}

/**
 * A wrapper around LogOutputChannel that allows custom message formatting for all log methods.
 */
export class LogOutputChannelFormatted implements vscode.LogOutputChannel {
	constructor(
		private readonly channel: vscode.LogOutputChannel,
		private readonly formatter: MessageFormatter
	) { }

	get logLevel(): vscode.LogLevel {
		return this.channel.logLevel;
	}

	get onDidChangeLogLevel(): vscode.Event<vscode.LogLevel> {
		return this.channel.onDidChangeLogLevel;
	}

	get name(): string {
		return this.channel.name;
	}

	append(value: string): void {
		this.channel.append(value);
	}

	appendLine(value: string): void {
		this.channel.appendLine(this.formatter(value));
	}

	replace(value: string): void {
		this.channel.replace(value);
	}

	clear(): void {
		this.channel.clear();
	}

	show(preserveFocus?: boolean): void;
	show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
	show(columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
		if (typeof columnOrPreserveFocus === 'boolean' || columnOrPreserveFocus === undefined) {
			this.channel.show(columnOrPreserveFocus);
		} else {
			this.channel.show(preserveFocus);
		}
	}

	hide(): void {
		this.channel.hide();
	}

	dispose(): void {
		this.channel.dispose();
	}

	trace(message: string, ...args: any[]): void {
		this.channel.trace(this.formatter(message), ...args);
	}

	debug(message: string, ...args: any[]): void {
		this.channel.debug(this.formatter(message), ...args);
	}

	info(message: string, ...args: any[]): void {
		this.channel.info(this.formatter(message), ...args);
	}

	warn(message: string, ...args: any[]): void {
		this.channel.warn(this.formatter(message), ...args);
	}

	error(message: string | Error, ...args: any[]): void {
		if (typeof message === 'string') {
			this.channel.error(this.formatter(message), ...args);
		} else {
			// Format the error message and include stack trace if available
			const formatted = this.formatter(message.message);
			const fullMessage = message.stack
				? `${formatted}\n${message.stack}`
				: formatted;
			this.channel.error(fullMessage, ...args);
		}
	}
}
