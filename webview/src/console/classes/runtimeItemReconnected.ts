/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *  Ported to vscode-ark by the vscode-ark team.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItemStandard } from './runtimeItem';

/**
 * RuntimeItemReconnected class.
 * Represents a runtime that has been reconnected after a disconnect.
 */
export class RuntimeItemReconnected extends RuntimeItemStandard {
    //#region Constructor

    /**
     * Constructor.
     * @param id The identifier.
     * @param message The reconnection message.
     */
    constructor(id: string, message: string) {
        // Call the base class's constructor.
        super(id, message);
    }

    //#endregion Constructor
}
