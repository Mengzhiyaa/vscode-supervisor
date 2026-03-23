/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *  Ported to vscode-ark by the vscode-ark team.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItemStandard } from './runtimeItem';

/**
 * RuntimeItemStartupFailure class.
 * Represents a runtime startup failure with error details.
 */
export class RuntimeItemStartupFailure extends RuntimeItemStandard {
    //#region Constructor

    /**
     * Constructor.
     * @param id The identifier.
     * @param message The failure message (short summary).
     * @param details The failure details or logs.
     */
    constructor(
        id: string,
        readonly message: string,
        details: string,
    ) {
        // Call the base class's constructor with details as the ANSI output.
        super(id, details);
    }

    //#endregion Constructor
}
