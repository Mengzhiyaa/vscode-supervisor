/*---------------------------------------------------------------------------------------------
 *  Mouse Utilities - Port from Positron's mouseUtilities
 *--------------------------------------------------------------------------------------------*/

import { MouseSelectionType } from '../dataGridInstance';

const isMacintosh =
    typeof navigator !== 'undefined' &&
    navigator.platform.toLowerCase().includes('mac');

/**
 * Maps mouse modifier keys to a MouseSelectionType.
 */
export const selectionType = (event: MouseEvent): MouseSelectionType => {
    if (event.shiftKey) {
        return MouseSelectionType.Range;
    }

    if (isMacintosh ? event.metaKey : event.ctrlKey) {
        return MouseSelectionType.Multi;
    }

    return MouseSelectionType.Single;
};

