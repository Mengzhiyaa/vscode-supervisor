/*---------------------------------------------------------------------------------------------
 *  RuntimeItemStarted - Represents a "started" runtime item.
 *  Mirrors: positron/src/vs/workbench/services/positronConsole/browser/classes/runtimeItemStarted.ts
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItemStandard } from './runtimeItem';

/**
 * RuntimeItemStarted class.
 */
export class RuntimeItemStarted extends RuntimeItemStandard {
    //#region Constructor

    /**
     * Constructor.
     * @param id The identifier.
     * @param message The started message (e.g., "R 4.3.3 started").
     */
    constructor(id: string, message: string) {
        super(id, message);
    }

    //#endregion Constructor
}
