/*---------------------------------------------------------------------------------------------
 *  RuntimeItemStartup - Represents startup messages (copyright, etc).
 *  Mirrors: positron/src/vs/workbench/services/positronConsole/browser/classes/runtimeItemStartup.ts
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItemStandard } from './runtimeItem';

/**
 * RuntimeItemStartup class.
 */
export class RuntimeItemStartup extends RuntimeItemStandard {
    //#region Constructor

    /**
     * Constructor.
     * @param id The identifier.
     * @param message The startup message.
     */
    constructor(id: string, message: string) {
        super(id, message);
    }

    //#endregion Constructor
}
