/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { SocketMessage } from './SocketMessage';

/**
 * Represents a status message from the kernel.
 */
export interface KernelMessageStatus extends SocketMessage {
	status: string;
}

/**
 * Represents a message from the kernel containing output.
 */
export interface KernelOutputMessage extends SocketMessage {
	/**
	 * A 2-element array containing the stream name and the output text.
	 */
	output: [string, string];
}

/** A supervisor-side execution announcement, preceding its Jupyter messages. */
export interface KernelExecutionRequestedMessage extends SocketMessage {
    executionRequested: {
        msg_id: string;
        code: string;
        requested_at: string;
        attribution: {
            source: string;
            agent_name?: string;
            agent_version?: string;
            workspace_id: string;
            tool: string;
        };
    };
}
