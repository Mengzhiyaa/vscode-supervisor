/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterChannel } from './JupyterChannel';
import { JupyterDisplayData } from './JupyterDisplayData';
import { JupyterMessageType } from './JupyterMessageType';
import type { JupyterPositronLocation } from './JupyterPositronTypes';
import { JupyterRequest } from './JupyterRequest';


export class ExecuteRequest extends JupyterRequest<JupyterExecuteRequest, JupyterExecuteResult> {
	private readonly _cellId?: string;

	constructor(readonly requestId: string, req: JupyterExecuteRequest, cellId?: string) {
		super(JupyterMessageType.ExecuteRequest, req, JupyterMessageType.ExecuteResult, JupyterChannel.Shell);
		this._cellId = cellId;
	}
	protected override createMsgId(): string {
		return this.requestId;
	}
	protected override get metadata(): Record<string, unknown> {
		return this._cellId ? { cellId: this._cellId } : {};
	}
}

/**
 * Represents an execute_request from the Jupyter frontend to the kernel.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#execute
 */
export interface JupyterExecuteRequest {
	/** The code to be executed */
	code: string;

	/** Whether the code should be executed silently */
	silent: boolean;

	/** Whether the code should be stored in history */
	store_history: boolean;

	/** A mapping of expressions to be evaluated after the code is executed (TODO: needs to be display_data) */
	user_expressions: Record<string, unknown>;

	/** Whether to allow the kernel to send stdin requests */
	allow_stdin: boolean;

	/** Whether the kernel should stop the execution queue when an error occurs */
	stop_on_error: boolean;

	/** Positron extension */
	positron?: JupyterPositronExecuteRequest;
}

export interface JupyterPositronExecuteRequest {
	code_location?: JupyterPositronLocation;
	[key: string]: unknown;
}

/**
 * Represents an execute_result from the Jupyter kernel to the front end; this
 * is identical to the display_data message, with one additional field.
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#id6
 */
export interface JupyterExecuteResult extends JupyterDisplayData {

	/** Execution counter, monotonically increasing */
	execution_count: number;
}
